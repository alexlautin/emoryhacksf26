// Reads the agents' own session logs (new lines only) to learn:
//  - what task the person gave the agent
//  - which files it read or edited and which web pages or connectors it used
// Claude Code: ~/.claude/projects/<folder>/<session>.jsonl
// Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addEvent, listAgents, upsertAgent } from '../store.js';
import { analyzePath, shortPath } from '../rules.js';
import { truncate } from '../describe.js';
import { projectName } from './processes.js';
import { gatedToolUses } from '../hooks.js';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude', 'projects');
const CODEX_DIR = path.join(HOME, '.codex', 'sessions');

const files = new Map(); // path -> { offset, partial, kind, cwd }
let started = false;

function listClaude() {
  try {
    return fs.readdirSync(CLAUDE_DIR).flatMap((d) => {
      const dir = path.join(CLAUDE_DIR, d);
      try {
        return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
      } catch { return []; }
    });
  } catch { return []; }
}

function listCodex() {
  const out = [];
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86400000);
    const dir = path.join(CODEX_DIR, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
    } catch {}
  }
  return out;
}

function codexCwd(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const first = buf.subarray(0, n).toString().split('\n')[0];
    return JSON.parse(first)?.payload?.cwd ?? null;
  } catch { return null; }
}

function discover() {
  const recent = Date.now() - 6 * 3600 * 1000;
  for (const [kind, list] of [['claude', listClaude()], ['codex', listCodex()]]) {
    for (const f of list) {
      if (files.has(f)) continue;
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < recent && started) continue;
      // Files that existed before Lookout started: only read what gets added from now on.
      files.set(f, { offset: started ? 0 : st.size, partial: '', kind, cwd: kind === 'codex' ? codexCwd(f) : null });
    }
  }
  started = true;
}

function findAgent(kind, cwd) {
  const candidates = listAgents().filter((a) => a.kind === kind && a.alive);
  const exact = candidates.filter((a) => cwd && a.cwd === cwd);
  exact.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  if (exact.length) return exact[0];
  // Windows can't tell us a process's folder. If exactly one agent of this kind has no folder
  // yet, this log belongs to it, and the log says where it's working.
  const unknown = candidates.filter((a) => !a.cwd);
  if (cwd && unknown.length === 1) return upsertAgent({ id: unknown[0].id, cwd, project: projectName(cwd) });
  return null;
}

function readNew() {
  for (const [f, s] of files) {
    let st;
    try { st = fs.statSync(f); } catch { files.delete(f); continue; }
    if (st.size <= s.offset) continue;
    const fd = fs.openSync(f, 'r');
    const len = Math.min(st.size - s.offset, 8 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, s.offset);
    fs.closeSync(fd);
    s.offset += len;
    const text = s.partial + buf.toString('utf8');
    const lines = text.split('\n');
    s.partial = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      try {
        if (s.kind === 'claude') handleClaude(d);
        else handleCodex(d, s);
      } catch (err) {
        console.error('[transcripts]', err.message);
      }
    }
  }
}

function setTask(agent, text) {
  const clean = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();
  if (!clean || clean.length < 3) return;
  upsertAgent({ id: agent.id, task: truncate(clean, 220) });
  addEvent({ agentId: agent.id, kind: 'task', risk: 'info', title: `You asked ${agent.label}: “${truncate(clean, 120)}”`, detail: truncate(clean, 600) });
}

function handleClaude(d) {
  const agent = findAgent('claude', d.cwd);
  if (!agent) return;
  if (d.type === 'user' && !d.isMeta && !d.isSidechain) {
    const c = d.message?.content;
    // Tool results also arrive as "user" lines; only plain text is the person talking.
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c) && c.length && c.every((x) => x.type === 'text')) text = c.map((x) => x.text).join('\n');
    if (text) setTask(agent, text);
    return;
  }
  if (d.type !== 'assistant') return;
  for (const block of d.message?.content ?? []) {
    if (block.type !== 'tool_use') continue;
    if (gatedToolUses.has(block.id)) continue; // already recorded (and blocked or asked) by the hook
    toolEvent(agent, block.name, block.input ?? {});
  }
}

function toolEvent(agent, name, input) {
  const p = input.file_path || input.path || input.notebook_path;
  if (['Read', 'NotebookRead'].includes(name) && p) {
    const r = analyzePath(p);
    const inside = agent.cwd && p.startsWith(agent.cwd);
    addEvent({
      agentId: agent.id, kind: 'tool', risk: r.risk, reasons: r.reasons,
      title: r.risk === 'info' ? `${agent.label} read ${inside ? path.relative(agent.cwd, p) : shortPath(p)}` : `${agent.label} read ${shortPath(p)}`,
      detail: `${name} ${shortPath(p)}`, tool: name,
    });
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) && p) {
    const r = analyzePath(p, { write: true, projectDir: agent.cwd });
    addEvent({
      agentId: agent.id, kind: 'tool', risk: r.risk, reasons: r.reasons,
      title: `${agent.label} ${name === 'Write' ? 'wrote' : 'edited'} ${agent.cwd && p.startsWith(agent.cwd) ? path.relative(agent.cwd, p) : shortPath(p)}`,
      detail: `${name} ${shortPath(p)}`, tool: name,
    });
  } else if (['WebFetch', 'WebSearch'].includes(name)) {
    const target = input.url ?? input.query ?? '';
    addEvent({
      agentId: agent.id, kind: 'tool', risk: 'info',
      title: name === 'WebFetch' ? `${agent.label} opened a web page: ${truncate(target, 80)}` : `${agent.label} searched the web for “${truncate(target, 80)}”`,
      detail: `${name} ${target}`, tool: name,
    });
  } else if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__');
    addEvent({
      agentId: agent.id, kind: 'tool', risk: 'info',
      title: `${agent.label} used a connected app (${server.replace(/[-_]/g, ' ')}): ${tool?.replace(/[-_]/g, ' ')}`,
      detail: `${name} ${truncate(JSON.stringify(input), 200)}`, tool: name,
    });
  }
  // Bash commands are already captured (with their real effects) by the process monitor.
}

function handleCodex(d, s) {
  if (d.type === 'session_meta') s.cwd = d.payload?.cwd ?? s.cwd;
  const agent = findAgent('codex', s.cwd);
  if (!agent) return;
  const p = d.payload ?? {};
  if (d.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'UserMessage') {
    const text = (p.item.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    if (text) setTask(agent, text);
    return;
  }
  if (d.type === 'event_msg' && p.type === 'user_message' && p.message) {
    setTask(agent, p.message);
    return;
  }
  if (d.type !== 'response_item') return;
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    const body = p.arguments ?? p.input ?? '';
    // apply_patch edits: "*** Update File: path"
    const patched = [...String(body).matchAll(/\*\*\* (Add|Update|Delete) File: ([^\n\\"]+)/g)];
    if (patched.length) {
      for (const [, op, file] of patched) {
        const full = path.isAbsolute(file) ? file : path.join(s.cwd ?? '', file);
        const r = analyzePath(full, { write: true, projectDir: agent.cwd });
        addEvent({
          agentId: agent.id, kind: 'tool', risk: r.risk, reasons: r.reasons,
          title: `${agent.label} ${op === 'Add' ? 'created' : op === 'Delete' ? 'deleted' : 'edited'} ${agent.cwd && full.startsWith(agent.cwd) ? path.relative(agent.cwd, full) : shortPath(full)}`,
          detail: `${p.name} ${shortPath(full)}`, tool: p.name,
        });
      }
      return;
    }
    if (/exec_command|shell|exec/.test(p.name ?? '')) return; // seen by the process monitor
    addEvent({
      agentId: agent.id, kind: 'tool', risk: 'info',
      title: `${agent.label} used a tool: ${String(p.name).replace(/[-_]/g, ' ')}`,
      detail: `${p.namespace ? p.namespace + '.' : ''}${p.name} ${truncate(String(body), 200)}`, tool: p.name,
    });
  }
}

export function startTranscriptMonitor() {
  discover();
  setInterval(discover, 3000);
  setInterval(readNew, 1000);
}
