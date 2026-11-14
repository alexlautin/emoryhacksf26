// The bridge to the Harness desktop app (src-tauri). Only active when the app
// starts this server with HARNESS_DESKTOP=1 (SEATBELT_DESKTOP=1 still works).
//
// Out, on stdout: one-line JSON messages prefixed with "@@harness ", read by the app
// (the app also accepts the old "@@seatbelt " prefix):
//   ready   { port }
//   status  { score, level, active, paused, alerts, autoProtect, menuBarDisplay }
//   notify  { title, body }
// In, on stdin: one JSON command per line, from the menu bar:
//   { cmd: 'auto-protect', level }   { cmd: 'menu-bar', mode }
//   { cmd: 'demo' }   { cmd: 'pause' }   { cmd: 'protect' | 'unprotect', dir }
// When stdin closes (the app quit or crashed), the server exits.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { listAgents, listEvents, onEvent } from './store.js';
import { getSettings, setSettings, pauseAgent } from './guard.js';
import { protect, unprotect } from './protect.js';
import { alertCount, computeScore } from '../public/score.js';

export const IS_DESKTOP = process.env.HARNESS_DESKTOP === '1' || process.env.LOOKOUT_DESKTOP === '1' || process.env.SEATBELT_DESKTOP === '1';

const send = (msg) => process.stdout.write(`@@harness ${JSON.stringify(msg)}\n`);
const recentDanger = new Map();

/** The menu bar app turns this into a system notification. */
export function pushNotice(notice) {
  if (!IS_DESKTOP || !notice) return;
  if (notice.agentId) recentDanger.set(notice.agentId, Date.now());
  send({ type: 'notify', title: notice.title, body: notice.body });
}

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
      const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__LKPATH__%s__LKPATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      shellPath = out.match(/__LKPATH__(.*)__LKPATH__/)?.[1] ?? '';
    } catch {}
  }
  const parts = [...shellPath.split(path.delimiter), ...(process.env.PATH ?? '').split(path.delimiter), bundled];
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(path.delimiter);
}

export function startDesktopBridge(port) {
  if (!IS_DESKTOP) return;
  send({ type: 'ready', port });

  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => command(line, port).catch((err) => send({ type: 'notify', title: 'Harness', body: err.message })));
  lines.on('close', () => process.exit(0));

  let last = '';
  const tick = () => {
    const agents = listAgents().filter((a) => a.alive);
    const events = listEvents({ limit: 5000 });
    const sc = computeScore(events);
    const status = {
      type: 'status',
      score: sc.score,
      level: sc.level.name,
      active: agents.length,
      paused: agents.filter((a) => a.paused).map((a) => ({ label: a.label, project: a.project })),
      alerts: alertCount(events, agents),
      autoProtect: getSettings().autoProtect,
      menuBarDisplay: getSettings().menuBarDisplay,
    };
    const key = JSON.stringify(status);
    if (key !== last) { last = key; send(status); }
  };
  tick();
  setInterval(tick, 1000).unref();

  onEvent((e) => {
    if (e.guard === 'paused' && e.title.startsWith('Harness')) {
      if (Date.now() - (recentDanger.get(e.agentId) || 0) < 8000) return;
      send({ type: 'notify', title: e.title, body: e.detail ?? '' });
    }
    if (e.guard === 'ended' && e.title.startsWith('Harness')) send({ type: 'notify', title: e.title, body: e.detail ?? '' });
  });
}

async function command(line, port) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.cmd === 'auto-protect') {
    setSettings({ autoProtect: msg.level });
  } else if (msg.cmd === 'menu-bar') {
    setSettings({ menuBarDisplay: msg.mode });
  } else if (msg.cmd === 'pause') {
    const live = listAgents().filter((a) => a.alive && !a.paused);
    if (!live.length) throw new Error('No agents to pause');
    for (const a of live) await pauseAgent(a.id, { reason: 'you paused it from the menu bar' });
  } else if (msg.cmd === 'demo') {
    const r = await fetch(`http://127.0.0.1:${port}/api/demo/run`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json()).error ?? 'Could not start the demo');
  } else if (msg.cmd === 'protect') {
    const dir = protect(msg.dir);
    send({ type: 'notify', title: `Protecting ${path.basename(dir)}`, body: 'Harness now checks every Claude Code action there before it runs. Restart Claude Code in that folder to pick it up.' });
  } else if (msg.cmd === 'unprotect') {
    const dir = unprotect(msg.dir);
    send({ type: 'notify', title: `Stopped protecting ${path.basename(dir)}`, body: "Removed Harness's Claude Code hooks from that folder." });
  }
}
