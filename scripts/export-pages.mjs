import { copyFile, lstat, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const manifestPath = path.join(root, '.pages-manifest.json');
const checkOnly = process.argv.includes('--check');
// Astro emits bundled styles and scripts into _astro; public assets retain their
// original paths. Keep both directories owned by the export manifest so a new
// build can also remove obsolete, hashed assets without touching source files.
const generatedDirectories = new Set(['_astro', 'assets', 'apps', 'platforms', 'guides', 'faq', 'archive', 'compare', 'downloads', 'about', 'privacy']);
const generatedFiles = new Set(['index.html', '404.html', 'robots.txt', 'sitemap.xml', 'catalog.json', 'build-info.json', '.nojekyll']);

function validate(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')
    || path.posix.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`生成文件路径无效：${relative}`);
  }
  const parts = relative.split('/');
  if (!(parts.length === 1 ? generatedFiles.has(relative) : generatedDirectories.has(parts[0]))) {
    throw new Error(`拒绝覆盖源码或未知目录：${relative}。新增页面目录时请先更新导出白名单。`);
  }
  return relative;
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`不导出符号链接：${relative}`);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files.push(validate(relative));
    else throw new Error(`不支持的生成文件：${relative}`);
  }
  return files.sort();
}

async function rejectSymlinks(relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error(`根目录目标包含符号链接：${relative}`);
  }
}

async function readManifest() {
  const info = await lstat(manifestPath).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!info) return undefined;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('发布清单必须是普通文件。');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('发布清单格式无效。');
  const files = manifest.files.map(validate);
  if (new Set(files).size !== files.length) throw new Error('发布清单存在重复文件。');
  return files.sort();
}

async function sameFile(left, right) {
  try { return (await readFile(left)).equals(await readFile(right)); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('仅支持 --check 参数。');
  const files = await listFiles(dist).catch(error => {
    if (error.code === 'ENOENT') throw new Error('找不到 dist，请先运行 npm run build。');
    throw error;
  });
  if (!files.includes('index.html') || !files.includes('.nojekyll')) throw new Error('dist 缺少首页或 .nojekyll，不能发布。');
  const previous = await readManifest();
  const owned = new Set(previous || []);
  const next = new Set(files);
  const stale = (previous || []).filter(relative => !next.has(relative));
  for (const relative of new Set([...files, ...(previous || [])])) await rejectSymlinks(relative);

  if (checkOnly) {
    const differences = [];
    if (!previous) differences.push('缺少 .pages-manifest.json');
    else if (JSON.stringify(previous) !== JSON.stringify(files)) differences.push('发布清单与 dist 文件列表不一致');
    for (const relative of files) {
      if (!await sameFile(path.join(root, relative), path.join(dist, relative))) differences.push(`缺失或内容不同：${relative}`);
    }
    for (const relative of stale) {
      if (await lstat(path.join(root, relative)).catch(() => undefined)) differences.push(`仍保留旧生成文件：${relative}`);
    }
    if (differences.length) throw new Error(`根目录发布产物未同步（${differences.length} 项）：\n${differences.slice(0, 12).map(message => '- ' + message).join('\n')}\n请运行 npm run export:pages，并提交生成文件和清单。`);
    console.log(`发布产物一致：根目录与 dist 的 ${files.length} 个文件完全相同。`);
    return;
  }

  // Validate every destination before changing anything. Only the previous manifest
  // grants permission to replace an existing generated file with different bytes.
  for (const relative of files) {
    const destination = path.join(root, relative);
    const info = await lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (info && !info.isFile()) throw new Error(`目标不是普通文件：${relative}`);
    if (info && !owned.has(relative) && !await sameFile(destination, path.join(dist, relative))) {
      throw new Error(`目标已存在且不属于上一批产物，拒绝覆盖：${relative}`);
    }
  }
  for (const relative of files) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(dist, relative), destination);
  }
  for (const relative of stale) {
    const destination = path.join(root, relative);
    const info = await lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (info && !info.isFile()) throw new Error(`旧产物已变为目录，拒绝清理：${relative}`);
    await rm(destination, { force: true });
    let directory = path.dirname(destination);
    while (directory !== root) {
      try { await rmdir(directory); } catch { break; }
      directory = path.dirname(directory);
    }
  }
  await writeFile(manifestPath, JSON.stringify({ version: 1, files }, null, 2) + '\n');
  console.log(`已导出 ${files.length} 个文件到仓库根目录，清理 ${stale.length} 个旧生成文件；源码保留。`);
}

main().catch(error => {
  console.error(`发布导出失败：${error.message}`);
  process.exitCode = 1;
});
