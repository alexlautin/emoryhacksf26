// Starts the server from the files the desktop app bundles (src-tauri/build/app, made by
// scripts/stage-desktop.mjs) and loads what the dashboard loads. The installed app has only
// those files, so anything the server reads from the repo's node_modules shows up here as a
// failure instead of in someone's installed copy.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'src-tauri', 'build', 'app');
const PORT = 4300 + Math.floor(Math.random() * 500);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-staged-'));

if (!fs.existsSync(path.join(APP, 'src', 'server.js'))) {
  console.error('No staged app. Run: node scripts/stage-desktop.mjs');
  process.exit(1);
}

// cwd is the staged folder, so nothing can be resolved from the repo by accident.
const child = spawn(process.execPath, [path.join(APP, 'src', 'server.js')], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), HARNESS_DATA_DIR: data, HARNESS_PHONE_PORT: '0', HARNESS_DESKTOP: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
let exited = null;
child.on('exit', (code) => { exited = code; });

const base = `http://127.0.0.1:${PORT}`;
const fail = (msg) => {
  console.error(msg);
  console.error('---- server output ----');
  console.error(log);
  child.kill();
  process.exit(1);
};

async function get(pathname) {
  if (exited !== null) fail(`The staged server exited (code ${exited}) before ${pathname}.`);
  let res;
  try { res = await fetch(base + pathname); } catch (err) { fail(`${pathname}: ${err.cause?.code ?? err.message}`); }
  const body = await res.text();
  if (res.status !== 200) fail(`${pathname} returned ${res.status}: ${body.slice(0, 200)}`);
  return body;
}

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  if (exited !== null) fail(`The staged server exited (code ${exited}) while starting.`);
  try { up = (await fetch(base + '/')).ok; } catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!up) fail('The staged server did not answer within 15 s.');

const page = await get('/');
if (!page.includes('<title>Harness</title>')) fail('/ was not the dashboard.');
const sprite = await get('/icons.svg');
for (const id of ['house', 'brand-claude', 'brandc-claude', 'brandc-codex']) {
  if (!sprite.includes(`id="${id}"`)) fail(`/icons.svg has no "${id}" icon.`);
}
for (const p of ['/app.js', '/styles.css', '/ui/tokens.css', '/ui/pug.png', '/fonts/instrument-sans.woff2', '/api/state', '/api/phone']) await get(p);
// Every request above has been answered; the server must still be there.
await new Promise((r) => setTimeout(r, 500));
await get('/api/state');

child.kill();
fs.rmSync(data, { recursive: true, force: true });
console.log('The staged app served the dashboard, its icons and its API.');
