#!/usr/bin/env node
/**
 * Read-only upstream check: node scripts/refresh-releases.mjs
 * Requires Node 20+; optionally reads GITHUB_TOKEN from the environment.
 * Writes only data/release-report.json. It never edits the curated catalogues,
 * downloads release files, logs credentials, or opens an authentication flow.
 *
 * Maintenance status requires a human review of the maintainer's announcements,
 * README, repository identity and release history. Neither a recent commit nor
 * archived:false proves ongoing maintenance. Never batch-update status from this
 * report. A GitHub "Latest" badge can also point to a tag named rc/beta/nightly.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['desktop-apps.json', 'ecosystem-apps.json'];
const outputFile = path.join(root, 'data', 'release-report.json');
const concurrency = 2;
const timeoutMs = 15_000;
const maxReleasePages = 3;
const preTag = /(?:^|[-._/])(alpha|beta|rc|pre(?:release)?|preview|dev|nightly|canary|snapshot|test|unstable|release[-_.]?candidate)(?:$|[-._\d/])/i;
const preName = /\b(?:alpha|beta|rc|preview|nightly|canary|snapshot|pre[- ]?release|release[- ]candidate)\b/i;

export function stableRejection(release) {
  if (!release || typeof release.tag_name !== 'string' || !release.tag_name) return 'invalid-release';
  if (release.draft !== false) return 'draft-or-missing-draft-flag';
  if (release.prerelease !== false) return 'prerelease-or-missing-prerelease-flag';
  if (preTag.test(release.tag_name) || preName.test(release.name || '')) return 'prerelease-name';
  return null;
}

export function compareVersion(curated, upstream) {
  if (!upstream) return 'no-stable-release';
  if (!curated) return 'curated-version-missing';
  // Tags need not use SemVer. Report a difference without guessing upgrade order.
  const normalize = value => String(value).trim().replace(/^v(?=\d)/i, '');
  return normalize(curated) === normalize(upstream) ? 'same' : 'different';
}

function repoFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || parts.length !== 2) return null;
    if (parts.some(part => !/^[\w.-]+$/.test(part))) return null;
    return parts.join('/');
  } catch {
    return null;
  }
}

function publicRelease(release) {
  return {
    tagName: release.tag_name,
    name: release.name || release.tag_name,
    publishedAt: release.published_at || null,
    url: release.html_url,
    assetCount: Array.isArray(release.assets) ? release.assets.length : 0,
  };
}

export async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('用法：node scripts/refresh-releases.mjs\n只核验 GitHub 上游并生成 data/release-report.json，不修改目录数据或下载软件。\n可选环境变量：GITHUB_TOKEN（只用于 API 请求，不写入报告或日志）。');
    return;
  }
  if (process.argv.slice(2).length) throw new Error('仅支持 --help 参数。');

  const generatedAt = new Date().toISOString();
  const apps = [];
  for (const file of sourceFiles) {
    const data = JSON.parse(await readFile(path.join(root, 'data', file), 'utf8'));
    if (!Array.isArray(data)) throw new Error(`${file} 必须是 JSON 数组。`);
    apps.push(...data.map(app => ({ ...app, sourceFile: `data/${file}` })));
  }

  const grouped = new Map();
  const skippedProjects = [];
  for (const app of apps) {
    if (!app.repo) {
      skippedProjects.push({ slug: app.slug, reason: 'no-curated-repository' });
      continue;
    }
    const repo = repoFromUrl(app.repo);
    if (!repo) {
      skippedProjects.push({ slug: app.slug, reason: 'invalid-github-repository-url' });
      continue;
    }
    const key = repo.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { repo, apps: [] });
    grouped.get(key).apps.push(app);
  }

  // Credential values stay in this closure and are never included in errors/report.
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Clash-Atlas-Release-Review',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let requestsMade = 0;
  let apiBlock = null;

  async function api(endpoint) {
    if (apiBlock) return { ok: false, error: { ...apiBlock, requestSkipped: true } };
    requestsMade += 1;
    let response;
    try {
      response = await fetch(`https://api.github.com${endpoint}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, error: {
        code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network-error',
        message: '无法完成 GitHub API 请求；请检查网络后重试。',
      } };
    }

    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const resetAt = reset > 0 ? new Date(reset * 1000).toISOString() : null;
    let data;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: { code: 'invalid-api-response', status: response.status, message: 'GitHub API 未返回有效 JSON。' } };
    }
    const rateLimited = response.status === 429 || (response.status === 403 && (
      response.headers.get('x-ratelimit-remaining') === '0' ||
      /rate limit|secondary rate|abuse/i.test(data?.message || '')
    ));
    if (rateLimited) {
      apiBlock = {
        code: 'rate-limited', status: response.status, resetAt,
        message: 'GitHub API 请求额度不足，本次停止后续请求；可等待额度恢复，或在环境中配置 GITHUB_TOKEN 后重试。',
      };
      return { ok: false, error: { ...apiBlock } };
    }
    if (response.status === 401) {
      apiBlock = { code: 'authentication-failed', status: 401, message: 'GitHub API 认证失败；请检查环境中的 GITHUB_TOKEN。脚本不会请求登录。' };
      return { ok: false, error: { ...apiBlock } };
    }
    if (!response.ok) {
      const code = response.status === 404 ? 'not-found' : response.status === 403 ? 'forbidden' : 'http-error';
      return { ok: false, error: {
        code, status: response.status,
        message: response.status === 404
          ? '上游地址或发布资源不可访问；404 也可能表示仓库私有，不能自动推断停更或删除原因。'
          : `GitHub API 返回 HTTP ${response.status}，需要稍后或人工复核。`,
      } };
    }
    return { ok: true, data, hasNextPage: /rel="next"/.test(response.headers.get('link') || '') };
  }

  async function checkRepository(group) {
    const result = {
      requestedRepo: group.repo, canonicalRepo: null, url: `https://github.com/${group.repo}`,
      archived: null, disabled: null, pushedAt: null, latestStableRelease: null,
      releaseSelection: { source: null, excludedReleases: [], scanIncomplete: false },
      errors: [],
    };
    const metadata = await api(`/repos/${group.repo}`);
    if (!metadata.ok) {
      result.errors.push({ scope: 'repository', ...metadata.error });
      return { ...group, result, release: null };
    }
    result.canonicalRepo = metadata.data.full_name || group.repo;
    result.url = metadata.data.html_url || result.url;
    result.archived = metadata.data.archived;
    result.disabled = metadata.data.disabled;
    result.pushedAt = metadata.data.pushed_at || null;
    const repo = repoFromUrl(result.url);
    if (!repo) {
      result.errors.push({ scope: 'repository', code: 'invalid-canonical-repository', message: 'GitHub 返回的仓库地址不符合预期，未继续请求。' });
      return { ...group, result, release: null };
    }

    let release = null;
    const latest = await api(`/repos/${repo}/releases/latest`);
    if (latest.ok) {
      const reason = stableRejection(latest.data);
      if (!reason) {
        release = latest.data;
        result.releaseSelection.source = 'github-latest-stable';
      } else {
        result.releaseSelection.excludedReleases.push({ tagName: latest.data.tag_name || null, reason });
      }
    } else if (latest.error.code !== 'not-found') {
      result.errors.push({ scope: 'release', ...latest.error });
    }

    // A missing /latest or a misleading rc/beta tag falls back to the release list.
    // Scan at most 300 entries; if no stable release was found, say so explicitly.
    if (!release && !result.errors.some(error => error.scope === 'release')) {
      const candidates = [];
      for (let page = 1; page <= maxReleasePages; page += 1) {
        const listing = await api(`/repos/${repo}/releases?per_page=100&page=${page}`);
        if (!listing.ok) {
          result.errors.push({ scope: 'release-list', ...listing.error });
          break;
        }
        if (!Array.isArray(listing.data)) {
          result.errors.push({ scope: 'release-list', code: 'invalid-api-response', message: 'GitHub 发布列表格式不符合预期。' });
          break;
        }
        for (const candidate of listing.data) {
          const reason = stableRejection(candidate);
          if (!reason) candidates.push(candidate);
          else if (!result.releaseSelection.excludedReleases.some(item => item.tagName === candidate.tag_name)) {
            result.releaseSelection.excludedReleases.push({ tagName: candidate.tag_name || null, reason });
          }
        }
        if (!listing.hasNextPage) break;
        if (page === maxReleasePages) result.releaseSelection.scanIncomplete = true;
      }
      release = candidates.sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0))[0] || null;
      if (release) result.releaseSelection.source = 'published-date-from-filtered-release-list';
    }
    if (release) result.latestStableRelease = publicRelease(release);
    return { ...group, result, release };
  }

  const queue = [...grouped.values()];
  const checked = new Array(queue.length);
  let next = 0;
  // Two repository workers, with sequential requests inside each: at most 2 fetches.
  async function worker() {
    while (next < queue.length) {
      const index = next++;
      checked[index] = await checkRepository(queue[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  const projects = checked.flatMap(({ repo, apps: groupApps, result, release }) => groupApps.map(app => {
    const versionComparison = result.errors.length ? 'unverified' : compareVersion(app.version, release?.tag_name);
    const reasons = [];
    if (result.errors.length) reasons.push('upstream-check-incomplete-or-inaccessible');
    if (versionComparison !== 'same') reasons.push(versionComparison);
    if (result.archived === true && app.status !== 'archived') reasons.push('repository-archived-curated-status-differs');
    if (result.disabled === true) reasons.push('repository-disabled');
    if (result.canonicalRepo && result.canonicalRepo.toLowerCase() !== repo.toLowerCase()) reasons.push('repository-identity-changed');
    if (release && (!Array.isArray(release.assets) || release.assets.length === 0)) reasons.push('stable-release-has-no-assets');
    if (result.releaseSelection.scanIncomplete) reasons.push('release-list-scan-incomplete');
    const assetUrls = new Set((release?.assets || []).map(asset => asset.browser_download_url));
    const selectedDownloads = (app.downloads || []).filter(download => download.kind === 'github');
    const missingCurrentAssets = versionComparison === 'same'
      ? selectedDownloads.filter(download => !assetUrls.has(download.url)).map(download => ({ label: download.label, url: download.url }))
      : [];
    if (missingCurrentAssets.length) reasons.push('curated-download-not-in-current-release-assets');
    return {
      slug: app.slug, name: app.name, sourceFile: app.sourceFile,
      curatedVersion: app.version || null, curatedStatus: app.status,
      repository: repo, latestStableVersion: release?.tag_name || null,
      versionComparison, missingCurrentAssets,
      manualReview: { required: reasons.length > 0, reasons },
    };
  }));

  const incomplete = checked.some(({ result }) => result.errors.some(error => error.code !== 'not-found'))
    || skippedProjects.some(project => project.reason === 'invalid-github-repository-url');
  const report = {
    generatedAt, completedAt: new Date().toISOString(), mode: 'report-only',
    status: incomplete ? 'incomplete' : 'complete',
    policy: '仅报告差异，不修改人工目录。维护状态必须结合作者公告、README、仓库身份与发布历史人工核验；未归档或近期更新不自动等于持续维护。',
    limits: { concurrentRequests: concurrency, requestTimeoutMs: timeoutMs, maxReleaseListEntries: maxReleasePages * 100 },
    summary: {
      catalogueProjects: apps.length, repositories: checked.length,
      repositoryChecksCompleted: checked.filter(({ result }) => result.canonicalRepo).length,
      apiRequestsMade: requestsMade, projectsNeedingReview: projects.filter(project => project.manualReview.required).length,
      skippedWithoutRepository: skippedProjects.filter(project => project.reason === 'no-curated-repository').length,
    },
    apiBlock, repositories: checked.map(({ result }) => result), projects, skippedProjects,
  };
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`已生成 data/release-report.json：核验 ${checked.length} 个仓库，${report.summary.projectsNeedingReview} 个项目需要人工复核。目录数据未修改。`);
  if (apiBlock) console.warn(`${apiBlock.message}${apiBlock.resetAt ? ` 额度恢复时间：${apiBlock.resetAt}（UTC）。` : ''}`);
  if (incomplete) {
    console.warn('部分 API 核验未完成；报告保留具体错误，不能据此推断项目停更。');
    process.exitCode = 2;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Do not print raw fetch errors, request objects, headers or environment values.
    console.error(error instanceof SyntaxError ? '目录 JSON 无法解析，未生成报告。' : `发布核验未完成：${error?.code === 'ENOENT' ? '缺少目录文件。' : '请检查目录格式、文件写入权限和 Node 版本。'}`);
    process.exitCode = 1;
  });
}
