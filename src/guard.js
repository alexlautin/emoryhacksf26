// Auto-protect: pauses an agent as soon as it does something flagged, and lets the person
// resume or end it. Pausing freezes the agent and every program it started and can be
// undone, so a false alarm costs one click.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEvent, upsertAgent, getAgent, onEvent, broadcast } from './store.js';
import { agentTree } from './monitor/processes.js';
import { riskRank } from './rules.js';
import { suspend, resume, terminate } from './platform.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');

/** autoProtect: 'off' | 'dangerous' (critical only) | 'risky' (high and critical) */
const DEFAULTS = { autoProtect: 'dangerous' };
const THRESHOLD = { dangerous: 'critical', risky: 'high' };

let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}

export function getSettings() {
  return { ...settings };
}

export function setSettings(patch) {
  if (patch.autoProtect && !(patch.autoProtect in THRESHOLD) && patch.autoProtect !== 'off') {
    throw new Error(`autoProtect must be off, dangerous or risky`);
  }
  settings = { ...settings, ...patch };
  fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), () => {});
  broadcast('settings', settings);
  return getSettings();
}

const busy = new Set();

async function treeFor(agentId) {
  const tree = await agentTree(agentId);
  if (!tree || !tree.pids.length) throw new Error('That session is no longer running');
  if (tree.hostsSeatbelt) throw new Error('Seatbelt itself was started from this session, so it can’t stop it');
  return tree;
}

/** Freeze an agent and everything it started. */
export async function pauseAgent(agentId, { reason = null, auto = false, trigger = null } = {}) {
  const a = getAgent(agentId);
  if (!a?.alive) throw new Error('That session is no longer running');
  if (a.paused || busy.has(agentId)) return a;
  busy.add(agentId);
  try {
    const tree = await treeFor(agentId);
    // Root first so it can't start anything new, then a second sweep for anything that slipped in.
    await suspend([tree.rootPid]);
    await suspend(tree.pids.filter((p) => p !== tree.rootPid));
    const again = await agentTree(agentId);
    const missed = again ? again.pids.filter((p) => !tree.pids.includes(p)) : [];
    if (missed.length) await suspend(missed);
    upsertAgent({ id: agentId, paused: true, pausedAt: Date.now(), pausedBy: auto ? 'seatbelt' : 'you', pausedReason: reason, pausedEventId: trigger?.id ?? null });
    addEvent({
      agentId, kind: 'system', risk: 'info', guard: 'paused',
      title: auto ? `Seatbelt paused ${a.label}` : `You paused ${a.label}`,
      detail: auto && trigger ? `Because: ${trigger.title}` : `${(again ?? tree).pids.length} programs frozen`,
    });
    return getAgent(agentId);
  } finally {
    busy.delete(agentId);
  }
}

export async function resumeAgent(agentId) {
  const a = getAgent(agentId);
  if (!a?.alive) throw new Error('That session is no longer running');
  const tree = await treeFor(agentId);
  // Children first, then the agent, so nothing wakes up to find its helpers still frozen.
  await resume(tree.pids.filter((p) => p !== tree.rootPid));
  await resume([tree.rootPid]);
  upsertAgent({ id: agentId, paused: false, pausedAt: null, pausedBy: null, pausedReason: null, pausedEventId: null, resumedAt: Date.now() });
  addEvent({ agentId, kind: 'system', risk: 'info', guard: 'resumed', title: `You let ${a.label} continue` });
  return getAgent(agentId);
}

/** Stop an agent for good: ask it to quit, then force anything still running after 1.5 s. */
export async function endAgent(agentId, { auto = false, quiet = false } = {}) {
  const a = getAgent(agentId);
  if (!a?.alive) throw new Error('That session is no longer running');
  const tree = await treeFor(agentId);
  await terminate(tree.pids);
  upsertAgent({ id: agentId, endedBy: auto ? 'seatbelt' : 'you', endedAt: Date.now() });
  if (!quiet) {
    addEvent({ agentId, kind: 'system', risk: 'info', guard: 'ended', title: auto ? `Seatbelt ended ${a.label}` : `You ended ${a.label}`, detail: `${tree.pids.length} programs stopped` });
  }
  await new Promise((r) => setTimeout(r, 1500));
  await terminate(tree.pids, { force: true });
  return getAgent(agentId);
}

const warned = new Set();

export function startGuard() {
  onEvent((e) => {
    if (settings.autoProtect === 'off' || !e.agentId || e.kind === 'system' || e.kind === 'task') return;
    if (riskRank(e.risk) < riskRank(THRESHOLD[settings.autoProtect])) return;
    if (e.attribution === 'guess') return; // never freeze a session over a guess about who did it
    const a = getAgent(e.agentId);
    if (!a?.alive || a.paused) return;
    // Lead with the most serious reason (decoy secrets and Keychain/disk wipes outrank the rest).
    const reasons = e.reasons ?? [];
    const reason = reasons.find((r) => /decoy secret|Keychain|whole home folder/.test(r)) ?? reasons[0] ?? e.title;
    pauseAgent(e.agentId, { reason, auto: true, trigger: e }).catch((err) => {
      if (warned.has(e.agentId)) return;
      warned.add(e.agentId);
      addEvent({ agentId: e.agentId, kind: 'system', risk: 'info', title: `Seatbelt couldn’t pause ${a.label}`, detail: err.message });
    });
  });
}
