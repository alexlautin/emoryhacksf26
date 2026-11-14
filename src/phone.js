// Phone access: an optional second server on this computer's Wi-Fi address, so a phone on the
// same network can open the dashboard. It is off until you turn it on in Settings.
//
// What keeps it safe:
//  - A phone has to scan the pairing QR code first. The code carries a random 256-bit key in the
//    URL fragment (never sent to a server or kept in logs); the pairing page trades it for a
//    cookie that only this server reads. "Unpair phones" makes a new key, which signs every phone out.
//  - A paired phone can only watch, and pause, resume or end an agent. It cannot change settings,
//    mark things as normal, reset activity, run the demo, or reach the Claude Code hooks.
//  - The normal dashboard stays on 127.0.0.1 only, exactly as before.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import qrcode from 'qrcode-generator';
import { DATA_DIR } from './paths.js';

const FILE = path.join(DATA_DIR, 'phone.json');
const COOKIE = 'harness_phone';
const PREFERRED_PORT = +(process.env.HARNESS_PHONE_PORT ?? 4101);

let config = { enabled: false, key: '' };
try { config = { ...config, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}

let server = null;
let port = 0;
const sockets = new Set();

function save() {
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function newKey() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Same length and same bytes, compared in constant time. */
export function keyMatches(given, key) {
  if (typeof given !== 'string' || !key) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function readCookie(header, name = COOKIE) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const PHONE_API = new Set(['GET /api/state', 'GET /api/stream', 'POST /api/agent', 'POST /api/summary', 'GET /api/report.md']);

/** What a paired phone may reach: the dashboard's files, and the watch / pause / resume / end API. */
export function phoneAllows(method, pathname) {
  if (pathname.startsWith('/api/') || pathname.startsWith('/hooks/')) return PHONE_API.has(`${method} ${pathname}`);
  return method === 'GET' || method === 'HEAD';
}

/**
 * Addresses a phone could reach, best first:
 *  - Tailscale (100.64.0.0/10 on a tailscale* or utun* interface): encrypted, and works on school or
 *    public Wi-Fi that blocks devices from talking to each other. The phone needs Tailscale too.
 *  - Private Wi-Fi / Ethernet addresses (10/8, 172.16/12, 192.168/16).
 * Each comes back as { name, address, kind: 'tailscale' | 'wifi' }.
 */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      const [p, q] = a.address.split('.').map(Number);
      // 100.64/10 is also carrier-grade NAT, so only trust it on Tailscale's own interface.
      const isTailscale = p === 100 && q >= 64 && q <= 127 && /^(tailscale|utun)/i.test(name);
      const isPrivate = p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168);
      if (!isTailscale && !isPrivate) continue;
      // Tailscale first, then Wi-Fi and Ethernet, then other tunnels and VM bridges.
      const rank = isTailscale ? 0 : /^(en|eth|wlan|wi-?fi|ethernet)/i.test(name) ? 1 : /^(utun|tun|wg|bridge|vmnet|vboxnet|docker)/i.test(name) ? 3 : 2;
      out.push({ name, address: a.address, kind: isTailscale ? 'tailscale' : 'wifi', rank });
    }
  }
  return out.sort((x, y) => x.rank - y.rank).map(({ name, address, kind }) => ({ name, address, kind }));
}

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

/** For the Settings screen on this computer only. Never sent to a phone. */
export function phoneStatus() {
  const addresses = lanAddresses();
  const base = server && addresses[0] ? `http://${addresses[0].address}:${port}` : '';
  const pairUrl = base && config.key ? `${base}/pair#k=${config.key}` : '';
  return {
    enabled: config.enabled,
    running: !!server,
    port,
    address: addresses[0]?.address ?? '',
    via: addresses[0]?.kind ?? '',
    otherAddresses: addresses.slice(1).map((a) => a.address),
    url: base,
    pairUrl,
    qr: pairUrl ? qrSvg(pairUrl) : '',
  };
}

const PAIR_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair with Harness</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f5f2; --fg: #1d1b19; --muted: #6b655e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161412; --fg: #f1ede8; --muted: #a49c93; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 17px/1.5 -apple-system, system-ui, sans-serif; padding: 0 16px; }
  main { max-width: 22rem; text-align: center; }
  p { color: var(--muted); }
</style></head>
<body><main><h1 id="t">Pairing…</h1><p id="d">Connecting to Harness on your computer.</p></main>
<script>
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  history.replaceState(null, '', '/pair');
  const fail = (t, d) => { document.getElementById('t').textContent = t; document.getElementById('d').textContent = d; };
  if (!key) fail('Scan the code in Harness', 'On your computer, open Harness, then Settings, then Phone access, and scan the QR code with this phone.');
  else fetch('/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) })
    .then((r) => r.ok ? location.replace('/') : fail('That code has expired', 'Open Settings, then Phone access, in Harness on your computer and scan the current code.'))
    .catch(() => fail('Can’t reach Harness', 'Make sure this phone is on the same Wi-Fi as your computer.'));
</script></body></html>`;

function send(res, code, type, body, headers = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', ...headers });
  res.end(body);
}

async function readJson(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 4096) break; }
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/** POSTs must come from this server's own page: same Origin, JSON body. Stops other sites posting in. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function makeHandler(handle) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://phone');
    const { pathname } = url;
    if (pathname === '/pair' && req.method === 'GET') return send(res, 200, 'text/html; charset=utf-8', PAIR_PAGE);
    if (pathname === '/pair' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden');
      const { key } = await readJson(req);
      if (!keyMatches(key, config.key)) return send(res, 401, 'application/json', '{"error":"bad key"}');
      return send(res, 200, 'application/json', '{"ok":true}', {
        'set-cookie': `${COOKIE}=${config.key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 365}`,
      });
    }
    if (!keyMatches(readCookie(req.headers.cookie), config.key)) {
      if (pathname === '/' || pathname.endsWith('.html')) return send(res, 302, 'text/plain', '', { location: '/pair' });
      return send(res, 401, 'application/json', '{"error":"Pair this phone first"}');
    }
    if (!phoneAllows(req.method, pathname)) return send(res, 403, 'application/json', '{"error":"Do that on your computer"}');
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, 'application/json', '{"error":"Forbidden"}');
    return handle(req, res, { remote: true });
  };
}

function start(handle) {
  if (server) return Promise.resolve();
  return new Promise((resolve) => {
    const s = http.createServer(makeHandler(handle));
    s.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
    const listening = () => { server = s; port = s.address().port; console.log(`  Phone access on: http://${lanAddresses()[0]?.address ?? '0.0.0.0'}:${port}`); resolve(); };
    s.once('error', (err) => {
      if (err.code !== 'EADDRINUSE') { console.error('  Phone access could not start:', err.message); return resolve(); }
      s.once('error', (e) => { console.error('  Phone access could not start:', e.message); resolve(); });
      s.listen(0, '0.0.0.0', listening);
    });
    s.listen(PREFERRED_PORT, '0.0.0.0', listening);
  });
}

function stop() {
  if (!server) return;
  server.close();
  for (const sock of sockets) sock.destroy();
  sockets.clear();
  server = null;
  port = 0;
}

/** Signs every phone out: drops open connections, so a phone with an old cookie can't keep a live stream. */
function dropConnections() {
  for (const sock of sockets) sock.destroy();
  sockets.clear();
}

let mainHandler = null;

export async function startPhoneAccess(handle) {
  mainHandler = handle;
  if (config.enabled) await start(handle);
}

/** action: 'enable' | 'disable' | 'reset' */
export async function setPhoneAccess(action) {
  if (action === 'enable') {
    if (!config.key) config.key = newKey();
    config.enabled = true;
    save();
    await start(mainHandler);
  } else if (action === 'disable') {
    config.enabled = false;
    save();
    stop();
  } else if (action === 'reset') {
    config.key = newKey();
    save();
    dropConnections();
  } else {
    throw new Error('action must be enable, disable or reset');
  }
  return phoneStatus();
}
