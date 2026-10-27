import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const json = async filename => JSON.parse(await readFile(path.join(root, 'data', filename), 'utf8'));
const decode = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
  if (entity[0] === '#') {
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()];
});
const normalize = value => decode(value).replace(/\s+/g, ' ').trim();
const inside = filename => filename === output || filename.startsWith(output + path.sep);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function attributes(source) {
  const attrs = {};
  const matcher = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(matcher)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  return attrs;
}

function elements(html) {
  const result = [];
  // Skip comments; quoted attributes may contain a > character.
  const matcher = /<!--[\s\S]*?-->|<([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  for (const match of html.matchAll(matcher)) {
    if (match[1]) result.push({ tag: match[1].toLowerCase(), attrs: attributes(match[2]) });
  }
  return result;
}

function releaseAsset(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
      && !url.search && !url.hash && /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname);
  } catch { return false; }
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(filename));
    else if (entry.isFile()) result.push(filename);
  }
  return result;
}

async function main() {
  const site = await json('site.json');
  const base = (process.env.SITE_URL || site.url).replace(/\/$/, '');
  const origin = new URL(base).origin;
  const proxy = new URL(site.downloadProxy);
  assert(proxy.protocol === 'https:' && !proxy.username && !proxy.password && !proxy.search && !proxy.hash,
    'site.json：downloadProxy 必须为不含凭据、查询或片段的 HTTPS 前缀。');
  assert(site.downloadProxy.endsWith('/'), 'site.json：downloadProxy 应以 / 结尾。');
  const dataFiles = (await readdir(path.join(root, 'data'))).filter(name => name.endsWith('-apps.json'));
  const apps = (await Promise.all(dataFiles.map(json))).flat();
  const guides = await json('guides.json');
  const appSlugs = new Set();
  const guideSlugs = new Set();
  const sources = new Set();
  for (const [list, seen, label] of [[apps, appSlugs, '软件'], [guides, guideSlugs, '教程']]) {
    for (const item of list) {
      assert(slugPattern.test(item.slug), `${label} slug 无效：${item.slug}`);
      assert(!seen.has(item.slug), `${label} slug 重复：${item.slug}`);
      seen.add(item.slug);
      assert(Boolean(item.name || item.title), `${label} ${item.slug} 缺少名称或标题。`);
      assert(Boolean(item.description?.trim()), `${label} ${item.slug} 缺少描述。`);
    }
  }
  for (const app of apps) {
    assert(['active', 'archived', 'discontinued', 'unknown'].includes(app.status), `${app.slug}：维护状态无效。`);
    assert(Array.isArray(app.platforms) && app.platforms.length > 0, `${app.slug}：缺少平台。`);
    for (const download of app.downloads || []) {
      assert(['github', 'store', 'unavailable'].includes(download.kind), `${app.slug}：下载类型无效。`);
      if (download.kind === 'github') {
        assert(releaseAsset(download.url), `${app.slug}：GitHub 下载必须指向 Release 资产：${download.url}`);
        sources.add(download.url);
      } else if (download.kind === 'unavailable') {
        assert(download.url === null, `${app.slug}：不可用下载的 URL 应为 null。`);
      } else {
        try { assert(new URL(download.url).protocol === 'https:', `${app.slug}：官方分发入口应使用 HTTPS。`); }
        catch { errors.push(`${app.slug}：官方分发入口 URL 无效。`); }
      }
    }
  }
  for (const guide of guides) {
    for (const slug of guide.relatedApps || []) assert(appSlugs.has(slug), `教程 ${guide.slug} 引用了不存在的软件：${slug}`);
    for (const slug of guide.relatedGuides || []) assert(guideSlugs.has(slug), `教程 ${guide.slug} 引用了不存在的教程：${slug}`);
    assert(Array.isArray(guide.sections) && guide.sections.length > 0, `教程 ${guide.slug} 缺少正文。`);
  }

  let allFiles;
  try { allFiles = await files(output); }
  catch { throw new Error('找不到 dist，请先运行 npm run build。'); }
  const htmlFiles = allFiles.filter(filename => filename.endsWith('.html'));
  assert(htmlFiles.length > 0, 'dist 没有 HTML 页面。');
  const documents = new Map();
  const titles = new Map();
  const descriptions = new Map();
  let acceleratedCount = 0;
  for (const filename of htmlFiles) {
    const relative = path.relative(output, filename).replaceAll(path.sep, '/');
    const route = '/' + (relative === 'index.html' ? '' : relative.endsWith('/index.html') ? relative.slice(0, -10) : relative);
    const canonical = base + route;
    const html = await readFile(filename, 'utf8');
    const tags = elements(html);
    const name = relative;
    const titleMatches = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
    const title = normalize(titleMatches[0]?.[1] || '');
    assert(titleMatches.length === 1 && title.length > 0, `${name}：需要一个非空 title。`);
    assert(!titles.has(title), `${name}：title 与 ${titles.get(title)} 重复。`);
    titles.set(title, name);
    const metas = tags.filter(node => node.tag === 'meta' && node.attrs.name?.toLowerCase() === 'description');
    const description = normalize(metas[0]?.attrs.content || '');
    assert(metas.length === 1 && description.length > 0, `${name}：需要一个非空 description。`);
    assert(!descriptions.has(description), `${name}：description 与 ${descriptions.get(description)} 重复。`);
    descriptions.set(description, name);
    const canonicalLinks = tags.filter(node => node.tag === 'link' && node.attrs.rel?.toLowerCase().split(/\s+/).includes('canonical'));
    assert(canonicalLinks.length === 1 && canonicalLinks[0].attrs.href === canonical, `${name}：canonical 必须自引用 ${canonical}`);
    assert(tags.find(node => node.tag === 'html')?.attrs.lang === 'zh-CN', `${name}：html lang 必须为 zh-CN。`);
    assert(tags.filter(node => node.tag === 'h1').length === 1, `${name}：必须且只能有一个 h1。`);
    const robots = tags.filter(node => node.tag === 'meta' && node.attrs.name?.toLowerCase() === 'robots').map(node => node.attrs.content).join(',');
    const indexable = !/\bnoindex\b/i.test(robots);
    assert(relative !== '404.html' || !indexable, '404.html 应设置 noindex。');
    const ids = new Set();
    for (const node of tags) {
      const id = node.attrs.id || (node.tag === 'a' && node.attrs.name);
      if (id) {
        assert(!ids.has(id), `${name}：重复 HTML id：${id}`);
        ids.add(id);
      }
      if (Object.hasOwn(node.attrs, 'data-download-source')) {
        const source = node.attrs['data-download-source'];
        assert(node.tag === 'a' && releaseAsset(source), `${name}：data-download-source 不是 GitHub Release 资产。`);
        assert(sources.has(source), `${name}：下载来源未收录于软件数据。`);
        assert(node.attrs.href === site.downloadProxy + source, `${name}：下载 href 未使用配置的加速前缀。`);
        acceleratedCount++;
      }
    }
    const schemaScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
      .filter(match => attributes(match[1]).type?.toLowerCase() === 'application/ld+json');
    assert(schemaScripts.length > 0, `${name}：缺少 JSON-LD。`);
    for (const match of schemaScripts) {
      try {
        const schema = JSON.parse(match[2]);
        assert(schema && typeof schema === 'object', `${name}：JSON-LD 应为对象或数组。`);
        assert(!/"(?:aggregateRating|ratingValue|reviewCount|ratingCount|bestRating)"\s*:/i.test(match[2]), `${name}：不应加入未经证实的评分数据。`);
      } catch { errors.push(`${name}：JSON-LD 不能解析。`); }
    }
    const visible = normalize(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<[^>]+>/g, ' '));
    assert(!/\b(?:Lorem ipsum|TODO|FIXME|REPLACE_ME|YOUR_SITE_URL|YOUR_SITE_NAME)\b|\{\{[^{}]+\}\}|\$\{[^{}]+\}|待补充内容|占位标题|待填写标题/i.test(visible), `${name}：存在未替换的内容模板。`);
    documents.set(filename, { name, route, canonical, tags, ids, indexable });
  }

  let internalCount = 0;
  for (const document of documents.values()) {
    for (const node of document.tags) {
      const values = [];
      if (node.attrs.href !== undefined) values.push(node.attrs.href);
      if (['script', 'img', 'source'].includes(node.tag) && node.attrs.src) values.push(node.attrs.src);
      for (const value of values) {
        if (/^(?:mailto:|tel:|data:|blob:)/i.test(value)) continue;
        let url;
        try { url = new URL(value, document.canonical); }
        catch { errors.push(`${document.name}：无效链接 ${value}`); continue; }
        assert(!/^javascript:/i.test(value), `${document.name}：不允许 javascript 链接。`);
        if (url.origin !== origin) continue;
        internalCount++;
        let pathname;
        try { pathname = decodeURIComponent(url.pathname); }
        catch { errors.push(`${document.name}：链接路径编码无效 ${value}`); continue; }
        let target = path.resolve(output, '.' + pathname);
        if (!inside(target)) { errors.push(`${document.name}：链接越出站点目录 ${value}`); continue; }
        let info = await stat(target).catch(() => undefined);
        if (info?.isDirectory()) {
          target = path.join(target, 'index.html');
          info = await stat(target).catch(() => undefined);
        }
        assert(info?.isFile(), `${document.name}：站内目标不存在 ${value}`);
        if (info?.isFile() && url.hash && documents.has(target)) {
          let fragment;
          try { fragment = decodeURIComponent(url.hash.slice(1)); }
          catch { errors.push(`${document.name}：片段编码无效 ${value}`); continue; }
          // Text-fragment directives are browser instructions, not element IDs.
          const elementId = fragment.split(':~:text=')[0];
          if (elementId) assert(documents.get(target).ids.has(elementId), `${document.name}：目标片段不存在 ${value}`);
        }
      }
    }
  }
  for (const slug of appSlugs) assert(documents.has(path.join(output, 'apps', slug, 'index.html')), `缺少软件详情页：${slug}`);
  for (const slug of guideSlugs) assert(documents.has(path.join(output, 'guides', slug, 'index.html')), `缺少教程页：${slug}`);
  const sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
  const locations = [...sitemap.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map(match => decode(match[1].trim()));
  const listed = new Set();
  const indexablePages = new Set([...documents.values()].filter(document => document.indexable).map(document => document.canonical));
  for (const location of locations) {
    assert(!listed.has(location), `sitemap：重复地址 ${location}`);
    assert(indexablePages.has(location), `sitemap：地址不是可索引的真实网页 ${location}`);
    listed.add(location);
  }
  for (const location of indexablePages) assert(listed.has(location), `sitemap：遗漏网页 ${location}`);
  const robots = await readFile(path.join(output, 'robots.txt'), 'utf8');
  assert(robots.includes(`Sitemap: ${base}/sitemap.xml`), 'robots.txt：缺少正确的网站地图地址。');
  if (errors.length) {
    console.error(`校验失败：${errors.length} 项。`);
    for (const error of errors.slice(0, 35)) console.error(`- ${error}`);
    if (errors.length > 35) console.error(`另有 ${errors.length - 35} 项，请修复上述问题后重试。`);
    process.exitCode = 1;
  } else {
    console.log(`校验通过：${htmlFiles.length} 个页面 · ${apps.length} 个项目 · ${guides.length} 篇教程 · ${acceleratedCount} 个加速下载 · ${internalCount} 处站内引用。`);
  }
}

main().catch(error => {
  console.error(`校验无法完成：${error.message}`);
  process.exitCode = 1;
});
