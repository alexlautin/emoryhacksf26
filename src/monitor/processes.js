// Watches every process on the computer and follows the ones started by an AI agent,
// all the way down (agent -> shell -> npm -> install script -> curl ...).
// No admin rights needed: polls the process list (`ps` on macOS, PowerShell on Windows).
// Very short-lived processes (under about half a second) can be missed; deep mode
// (eslogger.js) fills that gap on macOS through recordExec().
//
// Once a process has been tied to an agent, that link is kept even after its parent exits and
// the system re-parents it to process 1 (`nohup curl … &`, self-detaching programs, an install
// script whose npm already exited). Its children inherit the link, and Pause freezes them too.
import path from 'node:path';
import os from 'node:os';
import { listProcesses, processCwd, exeName, isShell } from '../platform.js';
import { addEvent, upsertAgent, getAgent } from '../store.js';
import { analyzeCommand, maxRisk, riskRank } from '../rules.js';
import { extractCommand, friendlyCommand, truncate, AGENT_LABELS } from '../describe.js';
import { chainSteps } from '../../public/timeline.js';
import { registerMonitor, monitorOk, monitorFailed } from './health.js';

let SELF = process.pid;
const POLL_MS = 500;
const DETACHED_REASON = 'kept running in the background after the program that started it had exited, which hides it from a normal process tree';

/** pid -> { pid, ppid, comm, args, cmd, agentId, key } for processes we've seen. ppid is the parent when first seen. */
const known = new Map();
/** agentId -> root pid (kept after the agent exits, so detached leftovers still map to it) */
const agentRoots = new Map();
/**
 * Root pid -> the agent id it has now. Normally `<kind>-<pid>`. When an agent exits and a later
 * agent is handed the same pid (Windows reuses pids quickly), the new one gets its own id, so it
 * shows up as a new session instead of being filed under the finished one.
 */
const rootIds = new Map();
/** Agent ids whose root pid has been seen missing from a snapshot: that session is over for good. */
const goneRoots = new Set();
const idFor = (kind, pid) => rootIds.get(pid) ?? `${kind}-${pid}`;
/** The last full snapshot, so deep mode can describe a process's parents. */
let lastProcs = new Map();

let source = { list: listProcesses, cwd: processCwd };

/** Tests swap in a fake process list (and folder lookup). */
export function setProcessSource({ list, cwd, self } = {}) {
  if (list) source.list = list;
  if (cwd) source.cwd = cwd;
  if (self !== undefined) SELF = self;
}

/** Tests start from a clean slate. */
export function resetProcessState() {
  known.clear();
  agentRoots.clear();
  rootIds.clear();
  goneRoots.clear();
  lastProcs = new Map();
  firstPoll = true;
}

/**
 * Programs of the Claude desktop app: anything inside Claude.app on macOS; on Windows,
 * AnthropicClaude\ (the installer build) or WindowsApps\Claude_<version>\ (the Microsoft Store
 * build). Case matters: Claude Code sessions the app starts live in a lowercase claude.app.
 */
const IS_CLAUDE_DESKTOP = /[\\/]Claude\.app[\\/]Contents[\\/]|[\\/]AnthropicClaude[\\/]|[\\/]WindowsApps[\\/]Claude_[^\\/]+[\\/]/;

/** The program's path from a command line. Windows only reports the bare name as `comm`. */
function exePath(args) {
  const m = String(args ?? '').match(/^\s*(?:"([^"]+)"|(\S+))/);
  return m ? m[1] ?? m[2] : '';
}

function agentKind(comm, args) {
  if (/demo[\\/]fake-agent\.js/.test(args)) return 'demo';
  const base = exeName(comm);
  // The Claude desktop app's own process is also named Claude. It isn't an agent (its Claude Code
  // sessions run as separate `claude` processes), and counting it would put everything started from
  // the app, including its terminal, under an agent.
  if (IS_CLAUDE_DESKTOP.test(comm) || IS_CLAUDE_DESKTOP.test(exePath(args))) return null;
  if (base === 'claude' || /@anthropic-ai[\\/]claude-code[\\/]/.test(args)) return 'claude';
  if (base === 'codex' || /@openai[\\/]codex[\\/]/.test(args)) return 'codex';
  if (base === 'gemini' || /@google[\\/]gemini-cli[\\/]/.test(args)) return 'gemini';
  if (base === 'cursor-agent' || /[\\/]cursor-agent[\\/]/.test(args)) return 'cursor';
  if (base === 'copilot' || /@github[\\/]copilot[\\/]/.test(args)) return 'copilot';
  if (base === 'opencode' || /[\\/]opencode-ai[\\/]/.test(args)) return 'opencode';
  if (base === 'amp' || /@sourcegraph[\\/]amp[\\/]/.test(args)) return 'amp';
  return null;
}

/** A process whose command line Windows wouldn't give is never called an agent on its name alone. */
const kindOf = (p) => (p.noArgs ? null : agentKind(p.comm, p.args));

const keyOf = (p) => `${p.pid}:${p.args}`;

/**
 * Which agent owns this process? Walks up the live parent chain first. If that chain is broken
 * (the parent exited and the process was re-parented to 1, or the parent is simply gone), falls
 * back to what was learned about the process or its ancestors earlier.
 * Returns { agentId, rootPid, detached } or null (not under an agent, or under Harness itself).
 */
function ownerOf(pid, procs) {
  const chain = [];
  let cur = procs.get(pid);
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.pid === SELF) return null; // Harness's own helpers
    const kind = kindOf(cur);
    if (kind) return { agentId: idFor(kind, cur.pid), rootPid: cur.pid, detached: false };
    chain.push(cur);
    if (cur.ppid <= 1 || cur.ppid === cur.pid) break;
    cur = procs.get(cur.ppid);
  }
  for (const c of chain) {
    const k = known.get(c.pid);
    if (k?.agentId && k.key === keyOf(c) && agentRoots.has(k.agentId)) {
      return { agentId: k.agentId, rootPid: agentRoots.get(k.agentId), detached: true };
    }
  }
  return null;
}

/**
 * The session an agent was started for, when its command line says so (`--resume=<id>` or
 * `--session-id <id>`: the Claude desktop app starts every Claude Code session this way). The
 * session's log has the same id, which ties the two together when several agents are running.
 */
export function sessionIdOf(args) {
  return String(args ?? '').match(/--(?:resume|session-id)[= ]"?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/i)?.[1].toLowerCase() ?? null;
}

/** A friendly name for an agent's folder. */
export function projectName(cwd) {
  if (!cwd) return 'an unknown folder';
  if (cwd === os.homedir()) return 'your home folder';
  if (cwd === '/' || /^[A-Za-z]:\\?$/.test(cwd)) return 'the whole computer';
  return path.basename(cwd);
}

async function registerAgent(root) {
  const kind = kindOf(root);
  let id = `${kind}-${root.pid}`;
  for (let n = 2; agentRoots.has(id); n++) id = `${kind}-${root.pid}-${n}`; // the pid was used by an earlier session
  agentRoots.set(id, root.pid);
  rootIds.set(root.pid, id);
  const cwd = await source.cwd(root.pid);
  const project = projectName(cwd);
  const sessionId = sessionIdOf(root.args);
  const agent = upsertAgent({ id, kind, label: AGENT_LABELS[kind], pid: root.pid, cwd, project, startedAt: Date.now(), lastActive: Date.now(), alive: true, ...(sessionId ? { sessionId } : {}) });
  addEvent({
    agentId: id, kind: 'system', risk: 'info',
    title: `Started watching ${agent.label} in ${project}`,
    detail: `pid ${root.pid} · ${cwd ?? ''}`,
  });
  return id;
}

let firstPoll = true;

/** One pass over the process list. `procs` is for tests; normally a fresh snapshot is taken. */
export async function pollProcesses(procs) {
  procs ??= await source.list();
  lastProcs = procs;

  // 1. Discover agents.
  for (const p of procs.values()) {
    const kind = kindOf(p);
    if (!kind) continue;
    const id = idFor(kind, p.pid);
    // New, or the session that had this pid is over and the pid has been handed to a new agent.
    if ((!agentRoots.has(id) || goneRoots.has(id)) && ownerOf(p.ppid, procs) === null && (kind === 'demo' || !isUnderSelf(p, procs))) {
      await registerAgent(p);
    }
  }
  // 2. Mark agents that exited.
  for (const [id, pid] of agentRoots) {
    const a = getAgent(id);
    if (!procs.has(pid)) goneRoots.add(id);
    if (!procs.has(pid) && a?.alive) {
      upsertAgent({ id, alive: false, paused: false });
      addEvent({ agentId: id, kind: 'system', risk: 'info', title: `${a.label} in ${a.project} stopped`, detail: `pid ${pid}` });
    }
  }

  // 3. New processes under an agent. A process already tied to an agent keeps that link
  //    (same pid and command line), even if its parent has since exited.
  for (const p of procs.values()) {
    const key = keyOf(p);
    if (known.get(p.pid)?.key === key) continue;
    const owner = ownerOf(p.pid, procs);
    if (!owner || owner.rootPid === p.pid) {
      known.set(p.pid, { ...p, key, agentId: null });
      continue;
    }
    const cmd = extractCommand(p.args);
    const entry = { ...p, key, cmd, agentId: owner.agentId };
    known.set(p.pid, entry);
    // Processes that already existed when Harness started aren't news. Neither is conhost.exe:
    // Windows starts one beside every console program, so it would double every row.
    if (firstPoll || exeName(p.comm) === 'conhost') continue;
    emitProcess(entry, owner.rootPid, procs, { detached: owner.detached });
  }
  firstPoll = false;

  for (const pid of known.keys()) if (!procs.has(pid)) known.delete(pid);
}

function isUnderSelf(p, procs) {
  let cur = procs.get(p.ppid);
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.pid === SELF) return true;
    cur = procs.get(cur.ppid);
  }
  return false;
}

function ancestorEntries(pid, rootPid, procs) {
  const chain = [];
  let cur = procs.get(procs.get(pid)?.ppid);
  let guard = 0;
  while (cur && cur.pid !== rootPid && cur.pid > 1 && guard++ < 64) {
    const seen = known.get(cur.pid);
    chain.push({
      pid: cur.pid,
      comm: cur.comm,
      cmd: truncate(seen?.cmd || extractCommand(cur.args || ''), 400),
      shell: isShell(cur.comm),
      label: exeName(cur.comm),
    });
    if (cur.ppid === cur.pid) break;
    cur = procs.get(cur.ppid);
  }
  return chain; // nearest first
}

function emitProcess(entry, rootPid, procs, { detached = false, deep = false } = {}) {
  const agent = getAgent(entry.agentId);
  if (!agent) return;
  const chain = ancestorEntries(entry.pid, rootPid, procs);

  // A shell line like "git status && ls" shows up as the shell plus each piece.
  // Only report the pieces when they weren't already visible in a parent's command.
  const parentCmds = chain.map((c) => c.cmd).filter(Boolean);
  const short = entry.cmd.slice(0, 60);
  if (parentCmds.some((pc) => pc.includes(short) || pc.includes(entry.cmd.split(' ')[0] + ' ' + (entry.cmd.split(' ')[1] ?? '')))) {
    const { risk } = analyzeCommand(entry.cmd);
    if (riskRank(risk) < riskRank('medium')) return;
  }

  let { risk, reasons } = analyzeCommand(entry.cmd);
  const installer = chain.find((c) => /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install|\buv\s+(add|sync|pip)/.test(c.cmd ?? ''));
  const viaInstall = installer && chain[0] !== installer ? installer : null;
  if (viaInstall && riskRank(risk) >= riskRank('medium')) {
    risk = maxRisk(risk, 'high');
    reasons = [...reasons, `this came from a package's install script, not from ${agent.label} itself. ${agent.label}'s window only showed "${truncate(viaInstall.cmd, 40)}"`];
  }
  if (detached && riskRank(risk) >= riskRank('medium')) reasons = [...reasons, DETACHED_REASON];

  const depth = chain.length;
  const steps = chainSteps({
    agentLabel: agent.label,
    rootPid,
    ancestors: chain,
    current: {
      pid: entry.pid,
      cmd: truncate(entry.cmd, 500),
      shell: isShell(entry.comm),
      label: exeName(entry.comm),
    },
  });
  const verb = friendlyCommand(entry.cmd);
  const title = detached
    ? `A background program ${agent.label} started ${verb}`
    : depth === 0 || (depth === 1 && chain[0]?.shell)
      ? `${agent.label} ${verb}`
      : viaInstall
        ? `A package's install script ${verb}`
        : `A program ${agent.label} started ${verb}`;

  addEvent({
    agentId: entry.agentId,
    kind: 'process',
    risk,
    reasons,
    title,
    command: truncate(entry.cmd, 400),
    detail: `pid ${entry.pid} ← ${chain.map((c) => `${c.pid} ${truncate(c.cmd, 30)}`).join(' ← ') || `${agent.label} (${rootPid})`}${detached ? ' (detached)' : ''}${deep ? ' (deep mode)' : ''}`,
    pid: entry.pid,
    ppid: entry.ppid,
    depth,
    steps,
    ...(detached ? { detached: true } : {}),
    ...(deep ? { deep: true } : {}),
  });
}

/**
 * Deep mode saw a program start (eslogger exec event). Report it through the same path as
 * polling, and remember it so the next poll doesn't report it again.
 * Returns true if it was reported.
 */
export function recordExec({ pid, ppid, comm, args, agentId }) {
  const rootPid = agentRoots.get(agentId);
  if (!rootPid || pid === rootPid || !args) return false;
  const p = { pid, ppid, comm: comm || args.split(/\s+/)[0], args };
  const key = keyOf(p);
  if (known.get(pid)?.key === key) return false;
  const entry = { ...p, key, cmd: extractCommand(args), agentId };
  known.set(pid, entry);
  const view = new Map(lastProcs);
  view.set(pid, p);
  emitProcess(entry, rootPid, view, { deep: true });
  return true;
}

/**
 * Which processes belong to an agent in this snapshot: the root (if it's still the agent), every
 * descendant, and every live process already tied to the agent even if it was re-parented away.
 * Harness's own process (and anything under it) is never included, and `hostsHarness`
 * says whether the agent is one of Harness's ancestors (then it must not be stopped).
 */
export function collectTree(agentId, rootPid, procs) {
  const root = procs.get(rootPid);
  const rootLive = !!root && kindOf(root) !== null;
  const children = new Map();
  for (const p of procs.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const selfAncestors = new Set();
  for (let cur = procs.get(SELF), guard = 0; cur && guard++ < 64; cur = procs.get(cur.ppid)) {
    if (cur.pid !== SELF) selfAncestors.add(cur.pid);
    if (cur.ppid <= 1 || cur.ppid === cur.pid) break;
  }
  const seeds = rootLive ? [rootPid] : [];
  for (const k of known.values()) {
    const live = procs.get(k.pid);
    if (k.agentId === agentId && live && keyOf(live) === k.key) seeds.push(k.pid);
  }
  const pids = [];
  const visited = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const pid = queue.shift();
    if (visited.has(pid) || pid <= 1 || pid === SELF) continue;
    visited.add(pid);
    if (!selfAncestors.has(pid) || pid === rootPid) pids.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return { rootPid, pids, hostsHarness: rootLive && selfAncestors.has(rootPid) };
}

/** Every live process belonging to an agent, from a fresh snapshot (fails instead of hanging). */
export async function agentTree(agentId) {
  const rootPid = agentRoots.get(agentId);
  if (!rootPid) return null;
  const procs = await source.list({ fresh: true });
  return collectTree(agentId, rootPid, procs);
}

export function trackedPids() {
  const out = new Map(); // pid -> { agentId, isRoot, cmd }
  for (const [id, pid] of agentRoots) if (getAgent(id)?.alive) out.set(pid, { agentId: id, isRoot: true, cmd: getAgent(id).label });
  for (const p of known.values()) if (p.agentId) out.set(p.pid, { agentId: p.agentId, isRoot: false, cmd: p.cmd });
  return out;
}

/**
 * A local program asked the server for something: is it running, and is it under an agent?
 * Uses a fresh snapshot, so a program that started a moment ago is in it.
 * Returns { args, agentId } (agentId null when no agent started it), or null if the pid isn't running.
 */
export async function describeCaller(pid) {
  const procs = await source.list({ fresh: true });
  const p = procs.get(pid);
  if (!p) return null;
  return { args: p.args, agentId: ownerOf(pid, procs)?.agentId ?? null };
}

export function agentForPid(pid) {
  const p = known.get(pid);
  if (p?.agentId) return p.agentId;
  for (const [id, rp] of agentRoots) if (rp === pid && getAgent(id)?.alive) return id;
  return null;
}

export function activeAgentIds(withinMs = 5000) {
  const now = Date.now();
  const ids = new Set();
  for (const p of known.values()) if (p.agentId) ids.add(p.agentId);
  for (const id of agentRoots.keys()) {
    const a = getAgent(id);
    if (a?.alive && now - (a.lastActive ?? 0) < withinMs) ids.add(id);
  }
  return ids;
}

export function startProcessMonitor() {
  registerMonitor('processes', { label: 'Process watch', stallMs: 10000 });
  const loop = async () => {
    try {
      await pollProcesses();
      monitorOk('processes');
    } catch (err) {
      monitorFailed('processes', err);
      console.error('[processes]', err.message);
    }
    setTimeout(loop, POLL_MS);
  };
  loop();
}
