// Build the site, then serve website/dist. No dependencies.
// From the repo root: node website/serve.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = build();
const port = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const candidates = [rel];
  if (!path.extname(rel)) candidates.push(`${rel}.html`);
  for (const candidate of candidates) {
    const full = path.resolve(dist, candidate);
    if (full !== dist && !full.startsWith(dist + path.sep)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');
  if (!file) {
    const missing = path.join(dist, '404.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(missing));
    return;
  }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(fs.readFileSync(file));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Lookout site: http://127.0.0.1:${port}`);
});
