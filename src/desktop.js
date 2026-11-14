// The bridge to the Seatbelt desktop app (src-tauri). Only active when the app
// starts this server with SEATBELT_DESKTOP=1.
//
// Out, on stdout: one-line JSON messages prefixed with "@@seatbelt ", read by the app:
//   ready   { port }                                       the dashboard is up
//   status  { score, band, active, paused, autoProtect }   sent whenever the summary changes
//   notify  { title, body }                                show a system notification
// In, on stdin: one JSON command per line, from the menu bar menu:
//   { cmd: 'auto-protect', level }   { cmd: 'demo' }   { cmd: 'protect' | 'unprotect', dir }
// When stdin closes (the app quit or crashed), the server exits.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { listAgents, listEvents, onEvent } from './store.js';
import { getSettings, setSettings } from './guard.js';
import { protect, unprotect } from './protect.js';
import { computeScore } from '../public/score.js';

export const IS_DESKTOP = process.env.SEATBELT_DESKTOP === '1';

const send = (msg) => process.stdout.write(`@@seatbelt ${JSON.stringify(msg)}\n`);

/**
 * Apps opened from the Finder get a bare PATH (/usr/bin:/bin:...), so the demo's npm and
 * node wouldn't be found. Borrow the PATH the person's login shell sets up, and fall back
 * to the Node that ships inside the app.
 */
export function fixPath() {
  if (!IS_DESKTOP) return;
  const bundled = path.dirname(process.execPath);
  let shellPath = '';
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__SBPATH__%s__SBPATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      shellPath = out.match(/__SBPATH__(.*)__SBPATH__/)?.[1] ?? '';
    } catch {}
  }
  const parts = [...shellPath.split(path.delimiter), ...(process.env.PATH ?? '').split(path.delimiter), bundled];
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(path.delimiter);
}

export function startDesktopBridge(port) {
  if (!IS_DESKTOP) return;
  send({ type: 'ready', port });

  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => command(line, port).catch((err) => send({ type: 'notify', title: 'Seatbelt', body: err.message })));
  lines.on('close', () => process.exit(0));

  let last = '';
  const tick = () => {
    const agents = listAgents().filter((a) => a.alive);
    const sc = computeScore(listEvents({ limit: 5000 }));
    const status = {
      type: 'status',
      score: sc.score,
      band: sc.band.name,
      active: agents.length,
      paused: agents.filter((a) => a.paused).map((a) => ({ label: a.label, project: a.project })),
      autoProtect: getSettings().autoProtect,
    };
    const key = JSON.stringify(status);
    if (key !== last) { last = key; send(status); }
  };
  tick();
  setInterval(tick, 1000).unref();

  onEvent((e) => {
    if (e.guard === 'paused' && e.title.startsWith('Seatbelt')) send({ type: 'notify', title: e.title, body: e.detail ?? '' });
    if (e.guard === 'ended' && e.title.startsWith('Seatbelt')) send({ type: 'notify', title: e.title, body: e.detail ?? '' });
  });
}

async function command(line, port) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.cmd === 'auto-protect') {
    setSettings({ autoProtect: msg.level });
  } else if (msg.cmd === 'demo') {
    const r = await fetch(`http://127.0.0.1:${port}/api/demo/run`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json()).error ?? 'Could not start the demo');
  } else if (msg.cmd === 'protect') {
    const dir = protect(msg.dir);
    send({ type: 'notify', title: `Protecting ${path.basename(dir)}`, body: 'Seatbelt now checks every Claude Code action there before it runs. Restart Claude Code in that folder to pick it up.' });
  } else if (msg.cmd === 'unprotect') {
    const dir = unprotect(msg.dir);
    send({ type: 'notify', title: `Stopped protecting ${path.basename(dir)}`, body: "Removed Seatbelt's Claude Code hooks from that folder." });
  }
}
