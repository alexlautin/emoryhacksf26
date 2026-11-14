// Watches every process on the computer and follows the ones started by an AI agent,
// all the way down (agent -> shell -> npm -> install script -> curl ...).
// No admin rights needed: polls the process list (`ps` on macOS, PowerShell on Windows).
// Very short-lived processes (under about half a second) can be missed.
import path from 'node:path';
import os from 'node:os';
import { listProcesses, processCwd, exeName, isShell } from '../platform.js';
import { addEvent, upsertAgent, getAgent } from '../store.js';
import { analyzeCommand, maxRisk, riskRank } from '../rules.js';
import { extractCommand, friendlyCommand, truncate, AGENT_LABELS } from '../describe.js';

const SELF = process.pid;
const POLL_MS = 500;

/** pid -> { pid, ppid, comm, args, cmd, agentId, key } for processes we've seen */
const known = new Map();
/** agentId -> root pid */
const agentRoots = new Map();

function agentKind(comm, args) {
  if (/demo[\\/]fake-agent\.js/.test(args)) return 'demo';
  const base = exeName(comm);
  if (base === 'claude' || /@anthropic-ai[\\/]claude-code[\\/]/.test(args)) return 'claude';
  if (base === 'codex' || /@openai[\\/]codex[\\/]/.test(args)) return 'codex';
  if (base === 'gemini' || /@google[\\/]gemini-cli[\\/]/.test(args)) return 'gemini';
  if (base === 'cursor-agent' || /[\\/]cursor-agent[\\/]/.test(args)) return 'cursor';
  if (base === 'copilot' || /@github[\\/]copilot[\\/]/.test(args)) return 'copilot';
  if (base === 'opencode' || /[\\/]opencode-ai[\\/]/.test(args)) return 'opencode';
  if (base === 'amp' || /@sourcegraph[\\/]amp[\\/]/.test(args)) return 'amp';
  return null;
}

const snapshot = (opts) => listProcesses(opts);
const cwdOf = processCwd;

/** Walk up the tree. Returns the agent root pid, or null if not under an agent (or under Lookout itself). */
function findAgentRoot(pid, procs) {
  let cur = procs.get(pid);
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.pid === SELF) return null; // Lookout's own helpers
    if (agentKind(cur.comm, cur.args)) return cur.pid;
    if (cur.ppid <= 1) return null;
    cur = procs.get(cur.ppid);
  }
  return null;
}

function ancestorsUntil(pid, rootPid, procs) {
  const chain = [];
  let cur = procs.get(procs.get(pid)?.ppid);
  while (cur && cur.pid !== rootPid) {
    chain.push(cur);
    cur = procs.get(cur.ppid);
  }
  return chain; // nearest first
}

/** A friendly name for an agent's folder. */
export function projectName(cwd) {
  if (!cwd) return 'an unknown folder';
  if (cwd === os.homedir()) return 'your home folder';
  if (cwd === '/' || /^[A-Za-z]:\\?$/.test(cwd)) return 'the whole computer';
  return path.basename(cwd);
}

async function registerAgent(root) {
  const kind = agentKind(root.comm, root.args);
  const id = `${kind}-${root.pid}`;
  agentRoots.set(id, root.pid);
  const cwd = await cwdOf(root.pid);
  const project = projectName(cwd);
  const agent = upsertAgent({ id, kind, label: AGENT_LABELS[kind], pid: root.pid, cwd, project, startedAt: Date.now(), lastActive: Date.now(), alive: true });
  addEvent({
    agentId: id, kind: 'system', risk: 'info',
    title: `Started watching ${agent.label} in ${project}`,
    detail: `pid ${root.pid} · ${cwd ?? ''}`,
  });
  return id;
}

let firstPoll = true;

async function poll() {
  const procs = await snapshot();

  // 1. Discover agents.
  for (const p of procs.values()) {
    if (!agentKind(p.comm, p.args)) continue;
    const kind = agentKind(p.comm, p.args);
    const id = `${kind}-${p.pid}`;
    if (!agentRoots.has(id) && findAgentRoot(p.ppid, procs) === null && (kind === 'demo' || !isUnderSelf(p, procs))) {
      await registerAgent(p);
    }
  }
  // 2. Mark agents that exited.
  for (const [id, pid] of agentRoots) {
    const a = getAgent(id);
    if (!procs.has(pid) && a?.alive) {
      upsertAgent({ id, alive: false, paused: false });
      addEvent({ agentId: id, kind: 'system', risk: 'info', title: `${a.label} in ${a.project} stopped`, detail: `pid ${pid}` });
    }
  }

  // 3. New processes under an agent.
  for (const p of procs.values()) {
    const key = `${p.pid}:${p.args}`;
    if (known.get(p.pid)?.key === key) continue;
    const rootPid = findAgentRoot(p.pid, procs);
    if (!rootPid || rootPid === p.pid) {
      known.set(p.pid, { ...p, key, agentId: null });
      continue;
    }
    const root = procs.get(rootPid);
    const agentId = `${agentKind(root.comm, root.args)}-${rootPid}`;
    const cmd = extractCommand(p.args);
    const entry = { ...p, key, cmd, agentId };
    known.set(p.pid, entry);
    // Processes that already existed when Lookout started aren't news.
    if (firstPoll) continue;
    emitProcess(entry, rootPid, procs);
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

function emitProcess(entry, rootPid, procs) {
  const agent = getAgent(entry.agentId);
  if (!agent) return;
  const chain = ancestorsUntil(entry.pid, rootPid, procs).map((a) => known.get(a.pid)).filter(Boolean);

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

  const depth = chain.length;
  const verb = friendlyCommand(entry.cmd);
  const title = depth === 0 || (depth === 1 && isShell(chain[0]?.comm))
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
    detail: `pid ${entry.pid} ← ${chain.map((c) => `${c.pid} ${truncate(c.cmd, 30)}`).join(' ← ') || `${agent.label} (${rootPid})`}`,
    pid: entry.pid,
    ppid: entry.ppid,
    depth,
  });
}

/**
 * Every live process belonging to an agent: its root plus all descendants, from a fresh `ps`.
 * Lookout's own process (and anything under it) is never included, and `hostsLookout`
 * says whether the agent is one of Lookout's ancestors (then it must not be stopped).
 */
export async function agentTree(agentId) {
  const rootPid = agentRoots.get(agentId);
  if (!rootPid) return null;
  const procs = await snapshot({ fresh: true });
  if (!procs.has(rootPid)) return { rootPid, pids: [], hostsLookout: false };
  const children = new Map();
  for (const p of procs.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const pids = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    if (pid === SELF) continue;
    pids.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  let hostsLookout = false;
  for (let cur = procs.get(SELF), guard = 0; cur && guard++ < 64; cur = procs.get(cur.ppid)) {
    if (cur.pid === rootPid) { hostsLookout = true; break; }
    if (cur.ppid <= 1) break;
  }
  return { rootPid, pids, hostsLookout };
}

export function trackedPids() {
  const out = new Map(); // pid -> { agentId, isRoot, cmd }
  for (const [id, pid] of agentRoots) if (getAgent(id)?.alive) out.set(pid, { agentId: id, isRoot: true, cmd: getAgent(id).label });
  for (const p of known.values()) if (p.agentId) out.set(p.pid, { agentId: p.agentId, isRoot: false, cmd: p.cmd });
  return out;
}

export function agentForPid(pid) {
  const p = known.get(pid);
  if (p?.agentId) return p.agentId;
  for (const [id, rp] of agentRoots) if (rp === pid) return id;
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
  const loop = async () => {
    try {
      await poll();
    } catch (err) {
      console.error('[processes]', err.message);
    }
    setTimeout(loop, POLL_MS);
  };
  loop();
}
