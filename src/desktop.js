// The bridge to the Seatbelt desktop app (src-tauri). Only active when the app
// starts this server with SEATBELT_DESKTOP=1. It writes one-line JSON messages to stdout,
// each prefixed with "@@seatbelt ", which the app reads to drive the menu bar icon:
//   ready   { port }                         the dashboard is up
//   status  { score, band, active, paused }  sent whenever the summary changes
//   notify  { title, body }                  Seatbelt paused or ended a session on its own
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { listAgents, listEvents, onEvent } from './store.js';
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

  // Quit along with the app, even if it crashes: the app holds our stdin open.
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();

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
