// Minimal static server for the viewer: `npm run viewer` then open http://localhost:4321
// Serves the repo folder so /viewer/index.html can load /data/index.js and the screenshots.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4321);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.svg': 'image/svg+xml' };

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/viewer/index.html';
    const file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    let st;
    try { st = statSync(file); } catch { res.writeHead(404); res.end('not found'); return; }
    if (st.isDirectory()) { res.writeHead(302, { location: urlPath.replace(/\/?$/, '/') + 'index.html' }); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Sectionary viewer: http://localhost:${port}`));
