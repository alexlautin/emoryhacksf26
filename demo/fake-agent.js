// A scripted stand-in for an AI coding agent, so the demo works the same way every time.
// It does what a real agent would do when asked to "set up this project": look around,
// run npm install, tweak a config file, start the app. It never does anything sneaky
// itself; the sneaky part is hidden inside the color-helpers package's install script.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(DEMO, 'victim-project');
const API = `http://127.0.0.1:${process.env.PORT ?? 4100}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function report(body) {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`${API}/api/demo/step`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: process.pid, ...body }) });
      if (r.ok) return;
    } catch {}
    await sleep(300); // Seatbelt hasn't noticed us yet
  }
}

const WIN = process.platform === 'win32';

function sh(cmd) {
  console.log(`[demo agent] $ ${cmd}`);
  return new Promise((resolve) => {
    const p = WIN
      ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { cwd: PROJECT, stdio: 'inherit', windowsHide: true })
      : spawn('/bin/zsh', ['-c', cmd], { cwd: PROJECT, stdio: 'inherit' });
    p.on('exit', resolve);
  });
}

await sleep(1200);
await report({ task: 'Set up this project and get it running' });
await sleep(1500);

await report({ title: 'Demo agent looked through the project files', command: WIN ? 'dir && type README.md' : 'ls -la && cat README.md' });
await sh(WIN ? 'dir > NUL && type README.md > NUL' : 'ls -la > /dev/null && cat README.md > /dev/null');
await sleep(1500);

await report({ title: 'Demo agent installed packages', command: 'npm install' });
await sh('npm install --no-audit --no-fund');
await sleep(1000);

await report({ title: 'Demo agent edited src/config.js', command: 'edit src/config.js' });
const cfg = path.join(PROJECT, 'src', 'config.js');
fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('port: 3000', 'port: 3000,\n  theme: "light"'));
await sleep(1500);

await report({ title: 'Demo agent started the app', command: 'npm start' });
await sh('npm start');
await sleep(800);
await report({ title: 'Demo agent finished: “Your project is set up and running ✓”', command: '' });
console.log('[demo agent] done');
