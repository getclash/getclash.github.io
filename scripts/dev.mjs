import http from 'node:http';
import { watch } from 'node:fs';
import { readFile, realpath, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const host = '127.0.0.1';
const port = 4321;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};
const watchers = [];
let child;
let buildPromise;
let buildError;
let needsBuild = false;
let timer;
let stopping = false;

function rebuild() {
  needsBuild = true;
  if (buildPromise) return buildPromise;
  buildPromise = (async () => {
    while (needsBuild && !stopping) {
      needsBuild = false;
      try {
        await new Promise((resolve, reject) => {
          child = spawn(process.execPath, [path.join(root, 'scripts/build.mjs')], {
            cwd: root, stdio: 'inherit', env: process.env,
          });
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            child = undefined;
            code === 0 ? resolve() : reject(new Error(`构建未完成（${signal || `退出码 ${code}`}）。`));
          });
        });
        buildError = undefined;
      } catch (error) {
        buildError = error;
        console.error(error.message);
      }
    }
  })().finally(() => { buildPromise = undefined; });
  return buildPromise;
}

function sourceChanged(_event, filename) {
  if (stopping) return;
  const name = filename?.toString().replaceAll('\\', '/');
  if (name && !['data/', 'public/'].some(prefix => name.startsWith(prefix))
    && name !== 'scripts/build.mjs' && name !== 'package.json') return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('源文件已更新，重新构建…');
    void rebuild();
  }, 160);
}

async function watchSources() {
  try {
    const watcher = watch(root, { recursive: true }, sourceChanged);
    watcher.on('error', error => console.error(`文件监听：${error.message}`));
    watchers.push(watcher);
  } catch (error) {
    if (!['ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', 'ERR_INVALID_ARG_VALUE'].includes(error.code)) throw error;
    // Older Node/Linux versions need one watcher for each source directory.
    async function watchDirectory(directory) {
      const watcher = watch(directory, (event, name) => {
        const relative = path.relative(root, path.join(directory, name?.toString() || ''));
        sourceChanged(event, relative);
        if (event === 'rename') void addDirectories(directory);
      });
      watcher.on('error', error => console.error(`文件监听：${error.message}`));
      watchers.push(watcher);
      watched.add(directory);
      await addDirectories(directory);
    }
    const watched = new Set();
    async function addDirectories(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const next = path.join(directory, entry.name);
        if (entry.isDirectory() && !watched.has(next)) await watchDirectory(next);
      }
    }
    for (const directory of ['data', 'public', 'scripts']) await watchDirectory(path.join(root, directory));
  }
}

const inside = (parent, childPath) => childPath === parent || childPath.startsWith(parent + path.sep);
function send(request, response, status, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  response.writeHead(status, {
    'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      send(request, response, 405, '仅支持 GET 和 HEAD。', undefined, { Allow: 'GET, HEAD' });
      return;
    }
    let url;
    let pathname;
    try {
      url = new URL(request.url, `http://${host}:${port}`);
      pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
    } catch {
      send(request, response, 400, '请求路径无效。');
      return;
    }
    let file = path.resolve(output, '.' + pathname);
    if (!inside(output, file)) {
      send(request, response, 403, '禁止访问此路径。');
      return;
    }
    // build.mjs replaces dist; wait for the current build before opening files.
    if (buildPromise) await buildPromise;
    if (buildError) {
      send(request, response, 503, '构建失败。请查看终端错误，修正源文件后会自动重试。');
      return;
    }
    let info = await stat(file).catch(() => undefined);
    if (info?.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        send(request, response, 308, '', undefined, { Location: `${url.pathname}/${url.search}` });
        return;
      }
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => undefined);
    }
    if (!info?.isFile()) {
      const body = await readFile(path.join(output, '404.html')).catch(() => Buffer.from('页面不存在。'));
      send(request, response, 404, body, 'text/html; charset=utf-8');
      return;
    }
    const actual = await realpath(file);
    if (!inside(await realpath(output), actual)) {
      send(request, response, 403, '禁止访问此路径。');
      return;
    }
    send(request, response, 200, await readFile(actual), types[path.extname(actual).toLowerCase()] || 'application/octet-stream');
  } catch (error) {
    if (!response.headersSent) send(request, response, 500, '暂时无法读取页面。');
    else response.end();
    console.error(`预览服务：${error.message}`);
  }
});

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  child?.kill('SIGTERM');
  server.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
server.once('error', error => {
  console.error(`无法启动预览：${error.message}`);
  process.exitCode = 1;
  stop();
});

try {
  await watchSources();
  await rebuild();
  if (buildError) throw buildError;
  if (!stopping) server.listen(port, host, () => console.log(`本地预览 http://${host}:${port} · 修改源文件后自动构建，刷新浏览器即可查看。`));
} catch (error) {
  console.error(`预览未启动：${error.message}`);
  process.exitCode = 1;
  stop();
}
