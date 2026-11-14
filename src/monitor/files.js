// File activity:
//  1. Decoy secrets ("bait files"). The system updates a file's access time when it is read,
//     so we can tell when something opens one without admin rights. (Windows may have
//     access-time updates turned off; the command-line rules still catch most reads.)
//  2. Files changed inside each agent's project folder (batched into one readable line).
//  3. Changes to sensitive places outside the project (login items, SSH folder, shell startup files,
//     credentials and package-manager settings, the crontab).
//  4. Attempts to switch Harness off (removing its Claude Code hooks) or to make git run code.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { addEvent, listAgents, getAgent } from '../store.js';
import crypto from 'node:crypto';
import { analyzePath, baitPaths, baitMarkers, maxRisk, riskRank, shortPath } from '../rules.js';
import { SENSITIVE_DIRS, IS_WIN } from '../platform.js';
import { registerMonitor, monitorOk, monitorFailed } from './health.js';
import { DATA_DIR, DEMO_DIR } from '../paths.js';

const HOME = os.homedir();
export const BAIT_DIR = path.join(HOME, '.harness', 'bait');
const LEGACY_BAIT_DIRS = ['.lookout', '.seatbelt'].map(name => path.join(HOME, name, 'bait'));

// Each decoy embeds a random marker made at install time (kept in data/bait-markers.json), so the
// values are unique to this computer and can be recognised wherever they show up later.
const BAIT_FILES = {
  'aws_credentials': (m) => `# Harness decoy. These keys are fake and do nothing.\n[default]\naws_access_key_id = AKIA${m}\naws_secret_access_key = hr-decoy/${m}${m.toLowerCase().slice(0, 12)}\n`,
  'passwords.txt': (m) => `Harness decoy file. Nothing real here.\nbank: ${m}-decoy\nemail: ${m.toLowerCase()}-decoy\n`,
  'id_ed25519_backup': (m) => `-----BEGIN OPENSSH PRIVATE KEY-----\n${Buffer.from(`Harness decoy key. Not real. ${m}`).toString('base64')}\n${m}\n-----END OPENSSH PRIVATE KEY-----\n`,
};
const MARKERS_FILE = path.join(DATA_DIR, 'bait-markers.json');
// The demo's .env is rebuilt by demo/reset.js with fixed values; this string is in all of them.
const DEMO_MARKER = 'DECOY-NOT-REAL';

function newMarker() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return [...crypto.randomBytes(16)].map((b) => abc[b % 32]).join('');
}
const DEMO_ENV = path.join(DEMO_DIR, 'victim-project', '.env');

const lastAtime = new Map();
// Right after the first arm, antivirus and indexers (Windows Defender, Search) scan the file we
// just touched. That is not an agent, so access-time changes in this window only re-arm.
const SETTLE_MS = 6000;
const settleUntil = new Map();
const quiet = new Map(); // dir -> until (ms): Harness's own writes, not the agent's

export function ignoreWrites(dir, ms = 4000) {
  quiet.set(dir, Date.now() + ms);
}

function isOwned(body) {
  // The SSH decoy hides the wording in the base64 line. The others say it in plain text.
  return /Harness decoy|Lookout decoy|Seatbelt decoy/i.test(Buffer.from(body.split('\n')[1] ?? '', 'base64').toString() + body);
}

/** The random value already written into one of our decoys, if the file still has it. */
export function markerIn(body) {
  if (!body) return null;
  const key = body.match(/aws_access_key_id = AKIA([A-Z2-7]{16})/);
  if (key) return key[1];
  const bank = body.match(/bank: ([A-Z2-7]{16})-decoy/);
  if (bank) return bank[1];
  const line = body.match(/^([A-Z2-7]{16})$/m);
  return line ? line[1] : null;
}

function setupBait(baitDir, markersFile) {
  fs.mkdirSync(baitDir, { recursive: true });
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(markersFile, 'utf8')); } catch {}
  for (const [name, render] of Object.entries(BAIT_FILES)) {
    const p = path.join(baitDir, name);
    let body = null;
    try { body = fs.readFileSync(p, 'utf8'); } catch {}
    let marker = saved[name];
    const found = markerIn(body);
    const owned = body !== null && isOwned(body);
    // A copied decoy can hold a marker that isn't in the markers file yet. Keep that value.
    if (owned && found && !(marker && body.includes(marker))) marker = found;
    // Write the decoy if it's missing, or upgrade an older decoy that has no marker yet.
    // Never overwrite a file that isn't one of ours.
    // Rewrite old "Seatbelt decoy" wording in place, keeping the same marker.
    const legacyWording = owned && marker && body.includes(marker) && /Lookout decoy|Seatbelt decoy/i.test(body);
    if (body === null || (owned && !(marker && body.includes(marker))) || legacyWording) {
      if (!marker) marker = newMarker();
      fs.writeFileSync(p, render(marker), { mode: 0o600 });
    } else if (!(marker && body.includes(marker))) {
      marker = null;
    }
    if (marker) {
      saved[name] = marker;
      baitMarkers.set(marker, p);
    }
    baitPaths.add(p);
  }
  fs.mkdirSync(path.dirname(markersFile), { recursive: true });
  fs.writeFileSync(markersFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
}

// Decoys from before the rename live in ~/.seatbelt/bait.
// Copy them once, and keep watching the old files so a read there still counts.
function migrateBaitDir(baitDir, legacyDir) {
  if (fs.existsSync(baitDir) || !fs.existsSync(legacyDir)) return;
  fs.mkdirSync(path.dirname(baitDir), { recursive: true });
  fs.cpSync(legacyDir, baitDir, { recursive: true });
}

function registerLegacyBait(legacyDir) {
  if (!fs.existsSync(legacyDir)) return;
  for (const name of Object.keys(BAIT_FILES)) {
    const p = path.join(legacyDir, name);
    let body = null;
    try { body = fs.readFileSync(p, 'utf8'); } catch {}
    if (body === null) continue;
    baitPaths.add(p);
    // The old file can still hold a value the new file no longer has. Remember it.
    const marker = isOwned(body) ? markerIn(body) : null;
    if (marker && !baitMarkers.has(marker)) baitMarkers.set(marker, p);
  }
}

/** Plant the decoys, copy an old bait folder once, and remember every marker in either place. */
export function prepareBait({ baitDir = BAIT_DIR, legacyDir, legacyDirs = legacyDir ? [legacyDir] : LEGACY_BAIT_DIRS, markersFile = MARKERS_FILE } = {}) {
  for (const dir of legacyDirs) migrateBaitDir(baitDir, dir);
  setupBait(baitDir, markersFile);
  for (const dir of legacyDirs) registerLegacyBait(dir);
}

function refreshDemoBait() {
  if (fs.existsSync(DEMO_ENV)) {
    baitPaths.add(DEMO_ENV);
    baitMarkers.set(DEMO_MARKER, DEMO_ENV);
  } else {
    baitPaths.delete(DEMO_ENV);
    baitMarkers.delete(DEMO_MARKER);
  }
}

/**
 * Push atime behind mtime so the next read is guaranteed to update it again (macOS only updates
 * atime when it is older than mtime). Windows updates atime on every read, so there we only record
 * the current value: touching the file would make antivirus rescan it, and the rescan looks like a
 * read, which re-arms it again, in a loop of false alerts.
 */
function arm(p) {
  try {
    if (process.platform !== 'win32') {
      const st = fs.statSync(p);
      const t = new Date(st.mtimeMs - 2000);
      fs.utimesSync(p, t, st.mtime);
    }
    lastAtime.set(p, fs.statSync(p).atimeMs);
  } catch {}
}

/** The agent most likely responsible right now (most recently active, alive). */
function likelyAgent(withinMs = 15000) {
  const now = Date.now();
  const live = listAgents().filter((a) => a.alive && now - (a.lastActive ?? 0) < withinMs);
  live.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  return { agent: live[0] ?? null, sure: live.length === 1 };
}

function pollBait() {
  refreshDemoBait();
  for (const p of baitPaths) {
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (!lastAtime.has(p)) { arm(p); settleUntil.set(p, Date.now() + SETTLE_MS); continue; }
    if (st.atimeMs !== lastAtime.get(p) && Date.now() < (settleUntil.get(p) ?? 0)) { arm(p); continue; }
    if (st.atimeMs !== lastAtime.get(p)) {
      const { agent, sure } = likelyAgent();
      addEvent({
        agentId: agent?.id ?? null,
        kind: 'file',
        risk: 'critical',
        reasons: [
          'opened a decoy secret Harness planted on purpose. No honest task needs it, so this is a strong sign something went rogue',
          agent ? `happened while ${agent.label} was the active program` : 'happened while no agent was active, so it may have been something else on this computer',
        ],
        title: agent ? `Something under ${agent.label} opened a decoy secret: ${path.basename(p)}` : `Something opened a decoy secret: ${path.basename(p)}`,
        detail: `${shortPath(p)} was read at ${new Date(st.atimeMs).toLocaleTimeString()}`,
        path: p,
        bait: true,
        // Access times don't say which process read the file. With several agents active this is a
        // guess, so auto-protect won't pause anyone over it (the person still gets the alert).
        attribution: sure ? 'sole' : 'guess',
      });
      arm(p);
    }
  }
}

// ---- project folders ----
const watchers = new Map(); // agentId -> { watcher, pending: Set }
const IGNORED = /(^|[\\/])(\.git|\.DS_Store|\.next|dist|build|\.turbo|\.cache)([\\/]|$)/;
const DEPS = /[\\/](node_modules|\.venv)[\\/]/;
// Inside .git these two can make git run code: hooks run on commit, config can point git at programs.
const GIT_WATCHED = /(^|[\\/])\.git[\\/](hooks[\\/][^\\/]+|config)$/;
const GIT_CONFIG = /(^|[\\/])\.git[\\/]config$/;
const CLAUDE_SETTINGS = /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/;
const HOOK_MARKS = /harness-hook\.sh|lookout-hook\.sh|seatbelt-hook\.sh/;

/** Watch this path inside a project? Not build output or .git, except .git/hooks and .git/config. */
export function projectPathWatched(rel) {
  if (GIT_WATCHED.test(rel)) return !/\.sample$/.test(rel); // `git init` writes the samples
  return !IGNORED.test(rel);
}

/** Settings in a git config file that make git run another program. */
export function gitConfigRisks(text) {
  const found = [];
  const re = /^\s*(hooksPath|fsmonitor|sshCommand|pager|editor|askPass|gitProxy|clean|smudge|process|textconv)\s*=\s*(.+)$|^\s*([\w.-]+)\s*=\s*(!.+)$/gim;
  for (const m of String(text ?? '').matchAll(re)) {
    if (m[1] && /^(false|true|0|1)$/i.test(m[2].trim())) continue; // fsmonitor = true is git's own
    found.push(`${m[1] ?? m[3]} = ${(m[2] ?? m[4]).trim()}`);
  }
  return found;
}

/** Does this Claude Code settings text still have Harness's hooks? */
export const hasHarnessHooks = (text) => HOOK_MARKS.test(String(text ?? ''));
const hookState = new Map(); // settings file -> had Harness's hooks last time we looked

function readText(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
}

function seedHookState(dir) {
  for (const name of ['settings.json', 'settings.local.json']) {
    const f = path.join(dir, '.claude', name);
    if (!hookState.has(f)) hookState.set(f, hasHarnessHooks(readText(f)));
  }
}

/** A Claude Code settings file changed. Returns an event if Harness's hooks were just removed. */
export function hookRemovalEvent(file, agent, text = readText(file)) {
  const before = hookState.get(file) ?? false;
  const now = hasHarnessHooks(text);
  hookState.set(file, now);
  if (!before || now) return null;
  return {
    agentId: agent?.id ?? null,
    kind: 'file',
    risk: 'critical',
    reasons: ["removed Harness's Claude Code hooks, which switches off the checks that run before each action"],
    title: `Harness's safety hooks were removed from ${shortPath(file)}`,
    detail: `${shortPath(file)} no longer runs harness-hook.sh`,
    path: file,
    tamper: true,
  };
}

/** Harness itself just added or removed hooks in this folder: take the new state as normal. */
export function refreshHookState(dir) {
  for (const name of ['settings.json', 'settings.local.json']) {
    const f = path.join(dir, '.claude', name);
    hookState.set(f, hasHarnessHooks(readText(f)));
  }
}

/** For tests. */
export function rememberHookState(file, had) {
  hookState.set(file, had);
}

const short = (list) => (list.join(', ').length > 80 ? list.join(', ').slice(0, 79) + '…' : list.join(', '));

function watchProjects() {
  for (const a of listAgents()) {
    if (!a.alive || !a.cwd || watchers.has(a.id)) continue;
    if (a.cwd === HOME || path.parse(a.cwd).root === a.cwd || !a.cwd.startsWith(HOME)) { watchers.set(a.id, null); continue; }
    try {
      const pending = new Set();
      const watcher = fs.watch(a.cwd, { recursive: true }, (_ev, rel) => {
        if (!rel) return;
        const full = path.join(a.cwd, rel.toString());
        if (full.startsWith(DATA_DIR) || !projectPathWatched(rel.toString()) || baitPaths.has(full)) return;
        for (const [dir, until] of quiet) if (full.startsWith(dir) && Date.now() < until) return;
        // If another live agent works in a folder nested inside this one, the change is theirs.
        for (const [otherId, ow] of watchers) {
          if (otherId !== a.id && ow && ow.cwd.length > a.cwd.length && ow.cwd.startsWith(a.cwd + path.sep) && full.startsWith(ow.cwd + path.sep) && getAgent(otherId)?.alive) return;
        }
        pending.add(full);
      });
      watcher.on('error', (err) => {
        monitorFailed('files', err);
        // Drop the broken watcher; the next pass (every 2 s) makes a new one.
        try { watcher.close(); } catch {}
        if (watchers.get(a.id)?.watcher === watcher) watchers.delete(a.id);
      });
      seedHookState(a.cwd);
      watchers.set(a.id, { watcher, pending, cwd: a.cwd });
    } catch {
      watchers.set(a.id, null);
    }
  }
  for (const [id, w] of watchers) {
    if (w && !getAgent(id)?.alive) { w.watcher.close(); watchers.delete(id); }
  }
}

function flushProjects() {
  for (const [id, w] of watchers) {
    if (!w || !w.pending.size) continue;
    const agent = getAgent(id);
    const files = [...w.pending].filter((f) => fs.existsSync(f) && !fs.statSync(f).isDirectory());
    const deleted = [...w.pending].filter((f) => !fs.existsSync(f));
    w.pending.clear();
    // Removing Harness's hooks, or making git run a program, gets its own event.
    for (const f of [...files, ...deleted].filter((x) => CLAUDE_SETTINGS.test(x))) {
      const ev = hookRemovalEvent(f, agent);
      if (ev) addEvent(ev);
    }
    for (const f of files.filter((x) => GIT_CONFIG.test(x))) {
      const risky = gitConfigRisks(readText(f));
      if (!risky.length) continue;
      addEvent({
        agentId: id, kind: 'file', risk: 'high',
        reasons: [`changed this project's git settings so a program will run automatically during git commands (${short(risky)})`],
        title: `Git settings in ${agent?.project ?? 'the project'} now run a program`,
        detail: `${path.relative(w.cwd, f)}: ${short(risky)}`,
        path: f,
      });
    }
    const deps = files.filter((f) => DEPS.test(f));
    // .git/config is only news when it runs something, and Claude Code's settings only when
    // Harness's hooks go (both above): git and Claude Code rewrite them in normal use.
    const own = files.filter((f) => !deps.includes(f) && !GIT_CONFIG.test(f) && !CLAUDE_SETTINGS.test(f));
    if (!own.length && !deps.length && !deleted.length) continue;

    let risk = 'info';
    const reasons = [];
    for (const f of own) {
      const r = analyzePath(f, { write: true, projectDir: w.cwd });
      // Editing a .env inside its own project is normal-ish; note it but don't alarm.
      const rr = r.reasons.every((x) => x.includes('.env')) ? (r.risk === 'info' ? 'info' : 'low') : r.risk;
      risk = maxRisk(risk, rr);
      reasons.push(...r.reasons);
    }
    const parts = [];
    if (own.length) parts.push(`${own.length} file${own.length > 1 ? 's' : ''}`);
    const gone = deleted.filter((f) => !DEPS.test(f)).length;
    if (gone) parts.push(`deleted ${gone}`);
    if (deps.length) parts.push(`${deps.length} inside installed packages`);
    addEvent({
      agentId: id,
      kind: 'file',
      risk,
      reasons: [...new Set(reasons)],
      title: `Files changed in ${agent?.project ?? 'the project'}: ${parts.join(', ')}`,
      detail: own.slice(0, 8).map((f) => path.relative(w.cwd, f)).join(', ') + (own.length > 8 ? ` … +${own.length - 8} more` : ''),
      files: own.slice(0, 50).map((f) => path.relative(w.cwd, f)),
      batch: true,
    });
  }
}

// ---- sensitive places outside any project (SENSITIVE_DIRS comes from platform.js) ----
// Folders that don't exist yet (a later `mkdir ~/.ssh`) are picked up on a later pass, and a
// watcher that fails is closed and made again.
const sensitiveWatchers = new Map(); // dir -> FSWatcher
const lastReported = new Map(); // path -> ms, so one save (several fs events) is one entry
const REPEAT_MS = 3000;

/**
 * The event for a change in a sensitive place. With no agent active it's still recorded, at a
 * lower risk and marked as a guess (a background program may have done it, or the person).
 */
export function sensitiveChangeEvent(full, { agent, sure }) {
  const r = analyzePath(full, { write: true, projectDir: agent?.cwd ?? null });
  if (agent) {
    return {
      agentId: agent.id,
      kind: 'file',
      risk: maxRisk(r.risk, 'medium'),
      reasons: r.reasons.length ? r.reasons : [`changed ${shortPath(full)} while ${agent.label} was working`],
      title: `${shortPath(full)} changed while ${agent.label} was working`,
      detail: `${shortPath(full)} (outside the project)`,
      path: full,
      attribution: sure ? 'sole' : 'guess',
    };
  }
  return {
    agentId: null,
    kind: 'file',
    risk: riskRank(r.risk) >= riskRank('high') ? 'medium' : 'low',
    reasons: [...r.reasons, 'happened while no agent was active, so it may have been you, another app, or a program an agent left running'],
    title: `${shortPath(full)} changed`,
    detail: `${shortPath(full)} (no agent was active)`,
    path: full,
    attribution: 'guess',
  };
}

function onSensitiveChange(dir, only, name) {
  if (!name) return;
  const rel = name.toString();
  const base = path.basename(rel);
  if (only && !only.test(base)) return;
  if (/^known_hosts/.test(base)) return; // ssh updates this on every new server
  const full = path.join(dir, rel);
  const now = Date.now();
  if (now - (lastReported.get(full) ?? 0) < REPEAT_MS) return;
  lastReported.set(full, now);
  if (lastReported.size > 500) lastReported.delete(lastReported.keys().next().value);
  for (const [q, until] of quiet) if (full.startsWith(q) && now < until) return;
  const who = likelyAgent(10000);
  if (CLAUDE_SETTINGS.test(full)) {
    const ev = hookRemovalEvent(full, who.agent);
    if (ev) addEvent({ ...ev, attribution: who.agent && who.sure ? 'sole' : 'guess' });
    return;
  }
  addEvent(sensitiveChangeEvent(full, who));
}

function watchSensitive() {
  for (const { dir, only, recursive } of SENSITIVE_DIRS) {
    if (sensitiveWatchers.has(dir) || !fs.existsSync(dir)) continue;
    try {
      if (only?.test('settings.json')) seedHookState(path.dirname(dir));
      const w = fs.watch(dir, { recursive: !!recursive }, (_ev, name) => onSensitiveChange(dir, only, name));
      w.on('error', (err) => {
        monitorFailed('files', new Error(`watching ${shortPath(dir)}: ${err.message}`));
        try { w.close(); } catch {}
        if (sensitiveWatchers.get(dir) === w) sensitiveWatchers.delete(dir);
      });
      sensitiveWatchers.set(dir, w);
    } catch (err) {
      monitorFailed('files', new Error(`watching ${shortPath(dir)}: ${err.message}`));
    }
  }
}

// ---- the crontab (no file we can watch without admin rights, so read it now and then) ----
let lastCrontab;
function pollCrontab() {
  if (IS_WIN) return;
  execFile('crontab', ['-l'], { timeout: 5000 }, (err, stdout) => {
    // "no crontab for <user>" exits 1 with nothing on stdout: that's an empty crontab.
    if (err && typeof err.code === 'string') return; // no crontab program
    const now = err ? '' : stdout;
    if (lastCrontab !== undefined && now !== lastCrontab) {
      const who = likelyAgent(15000);
      const ev = sensitiveChangeEvent('crontab', who);
      addEvent({
        ...ev,
        risk: who.agent ? maxRisk(ev.risk, 'high') : 'medium',
        reasons: ['set something up to run automatically in the background, even after a restart (your crontab changed)', ...(who.agent ? [] : [ev.reasons.at(-1)])],
        title: who.agent ? `Your crontab changed while ${who.agent.label} was working` : 'Your crontab changed',
        detail: now.trim() ? `crontab now:\n${now.trim().slice(0, 400)}` : 'crontab is now empty',
        path: 'crontab',
      });
    }
    lastCrontab = now;
  });
}

function safely(fn) {
  return () => {
    try { fn(); } catch (err) { monitorFailed('files', err); console.error('[files]', err.message); }
  };
}

export function startFileMonitor() {
  registerMonitor('files', { label: 'File watch', stallMs: 10000 });
  prepareBait();
  refreshDemoBait();
  watchSensitive();
  pollCrontab();
  setInterval(safely(() => { pollBait(); monitorOk('files'); }), 700);
  setInterval(safely(watchProjects), 2000);
  setInterval(safely(flushProjects), 2500);
  setInterval(safely(watchSensitive), 10000);
  setInterval(safely(pollCrontab), 15000);
}

export function rearmBait() {
  refreshDemoBait();
  for (const p of baitPaths) arm(p);
}
