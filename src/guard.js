// Auto-protect: pauses an agent as soon as it does something flagged, and lets the person
// resume or end it. Pausing freezes the agent and every program it started and can be
// undone, so a false alarm costs one click.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { addEvent, upsertAgent, getAgent, listAgents, onEvent, broadcast } from './store.js';
import { agentTree } from './monitor/processes.js';
import { riskRank } from './rules.js';
import { suspend, resume, terminate } from './platform.js';

import { DATA_DIR } from './paths.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Agents Harness has frozen, by root pid. Kept on disk because a frozen agent stays frozen when
// Harness quits or crashes: the next Harness has to show it as paused, or it would sit frozen with
// no Continue or End button. It is not resumed on its own, since Harness paused it for a reason.
const FROZEN_FILE = path.join(DATA_DIR, 'frozen.json');
const frozen = new Map(); // rootPid -> { pids, reason, since }
let leftovers = loadFrozen(); // what the previous Harness left frozen

function loadFrozen(file = FROZEN_FILE) {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))).map(([pid, entry]) => [Number(pid), entry]));
  } catch {
    return new Map();
  }
}

function saveFrozen() {
  try { fs.writeFileSync(FROZEN_FILE, JSON.stringify(Object.fromEntries([...leftovers, ...frozen]))); } catch {}
}

function forgetFrozen(rootPid) {
  const was = frozen.delete(rootPid);
  if (leftovers.delete(rootPid) || was) saveFrozen();
}

/**
 * Match what the last Harness left frozen against the agents this one sees. A still-stopped agent
 * is shown as paused again. One that is running (someone resumed it) or gone is forgotten.
 */
export function sortLeftovers(left, agents, stoppedPids) {
  const adopt = [];
  const drop = [];
  for (const [rootPid, entry] of left) {
    const agent = agents.find((a) => a.alive && a.pid === rootPid);
    if (!agent) continue; // not seen yet; the caller gives up after a while
    if (stoppedPids.has(rootPid)) adopt.push({ agent, rootPid, entry });
    else drop.push(rootPid);
  }
  return { adopt, drop };
}

const run = promisify(execFile);

/** Which of these processes are stopped (ps state T), on macOS and Linux. */
async function stoppedAmong(pids) {
  if (!pids.length) return new Set();
  try {
    const { stdout } = await run('ps', ['-o', 'pid=,stat=', '-p', pids.join(',')]);
    return new Set(stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter(([, stat]) => stat?.startsWith('T')).map(([pid]) => Number(pid)));
  } catch {
    return new Set(); // ps exits 1 when none of them exist
  }
}

async function adoptLeftovers() {
  const { adopt, drop } = sortLeftovers(leftovers, listAgents(), await stoppedAmong([...leftovers.keys()]));
  for (const rootPid of drop) leftovers.delete(rootPid);
  for (const { agent, rootPid, entry } of adopt) {
    leftovers.delete(rootPid);
    frozen.set(rootPid, entry);
    if (agent.paused) continue;
    upsertAgent({ id: agent.id, paused: true, pausedAt: entry.since ?? Date.now(), pausedBy: 'harness', pausedReason: entry.reason ?? null, pausedEventId: null });
    addEvent({
      agentId: agent.id, kind: 'system', risk: 'info', guard: 'paused',
      title: `${agent.label} is still paused`,
      detail: 'Harness restarted while it was paused. Let it continue or end it.',
    });
  }
  if (adopt.length || drop.length) saveFrozen();
}

/** autoProtect: 'off' | 'dangerous' (critical only) | 'risky' (high and critical) */
const DEFAULTS = { autoProtect: 'dangerous', menuBarDisplay: 'score' };
const THRESHOLD = { dangerous: 'critical', risky: 'high' };
const DISPLAYS = new Set(['score', 'icon', 'agents', 'alerts']);

let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
if (!DISPLAYS.has(settings.menuBarDisplay)) settings.menuBarDisplay = DEFAULTS.menuBarDisplay;

export function getSettings() {
  return { ...settings };
}

export function setSettings(patch) {
  const next = { ...settings };
  if (patch.autoProtect !== undefined) {
    if (!(patch.autoProtect in THRESHOLD) && patch.autoProtect !== 'off') {
      throw new Error('autoProtect must be off, dangerous or risky');
    }
    next.autoProtect = patch.autoProtect;
  }
  if (patch.menuBarDisplay !== undefined) {
    if (!DISPLAYS.has(patch.menuBarDisplay)) {
      throw new Error('menuBarDisplay must be score, icon, agents or alerts');
    }
    next.menuBarDisplay = patch.menuBarDisplay;
  }
  settings = next;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  broadcast('settings', settings);
  return getSettings();
}

const busy = new Set();

async function treeFor(agentId) {
  const tree = await agentTree(agentId);
  if (!tree || !tree.pids.length) throw new Error('That session is no longer running');
  if (tree.hostsHarness) throw new Error('Harness itself was started from this session, so it can’t stop it');
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
    frozen.set(tree.rootPid, { pids: [...new Set([...tree.pids, ...missed])], reason, since: Date.now() });
    saveFrozen();
    upsertAgent({ id: agentId, paused: true, pausedAt: Date.now(), pausedBy: auto ? 'harness' : 'you', pausedReason: reason, pausedEventId: trigger?.id ?? null });
    addEvent({
      agentId, kind: 'system', risk: 'info', guard: 'paused',
      title: auto ? `Harness paused ${a.label}` : `You paused ${a.label}`,
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
  forgetFrozen(tree.rootPid);
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
  forgetFrozen(tree.rootPid);
  upsertAgent({ id: agentId, endedBy: auto ? 'harness' : 'you', endedAt: Date.now() });
  if (!quiet) {
    addEvent({ agentId, kind: 'system', risk: 'info', guard: 'ended', title: auto ? `Harness ended ${a.label}` : `You ended ${a.label}`, detail: `${tree.pids.length} programs stopped` });
  }
  await new Promise((r) => setTimeout(r, 1500));
  await terminate(tree.pids, { force: true });
  return getAgent(agentId);
}

const warned = new Set();

export function startGuard() {
  // Windows pauses with NtSuspendProcess, which ps can't report, so it doesn't adopt leftovers yet.
  if (process.platform === 'win32') leftovers.clear();
  if (leftovers.size) {
    // Give the process monitor time to find the agents, then stop looking.
    const timer = setInterval(() => { adoptLeftovers().catch(() => {}); }, 2000);
    setTimeout(() => { clearInterval(timer); if (leftovers.size) { leftovers.clear(); saveFrozen(); } }, 60000).unref();
    timer.unref();
  }
  onEvent((e) => {
    if (settings.autoProtect === 'off' || !e.agentId || e.kind === 'system' || e.kind === 'task') return;
    if (riskRank(e.risk) < riskRank(THRESHOLD[settings.autoProtect])) return;
    if (e.attribution === 'guess') return; // never freeze a session over a guess about who did it
    if (e.prevented) return; // a Claude Code hook already blocked it before it ran
    const a = getAgent(e.agentId);
    if (!a?.alive || a.paused) return;
    // Lead with the most serious reason (decoy secrets and Keychain/disk wipes outrank the rest).
    const reasons = e.reasons ?? [];
    const reason = reasons.find((r) => /decoy secret|Keychain|whole home folder/.test(r)) ?? reasons[0] ?? e.title;
    pauseAgent(e.agentId, { reason, auto: true, trigger: e }).catch((err) => {
      if (warned.has(e.agentId)) return;
      warned.add(e.agentId);
      addEvent({ agentId: e.agentId, kind: 'system', risk: 'info', title: `Harness couldn’t pause ${a.label}`, detail: err.message });
    });
  });
}
