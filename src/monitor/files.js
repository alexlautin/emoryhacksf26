// File activity:
//  1. Decoy secrets ("bait files"). The system updates a file's access time when it is read,
//     so we can tell when something opens one without admin rights. (Windows may have
//     access-time updates turned off; the command-line rules still catch most reads.)
//  2. Files changed inside each agent's project folder (batched into one readable line).
//  3. Changes to sensitive places outside the project (login items, SSH folder, shell startup files).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addEvent, listAgents, getAgent } from '../store.js';
import crypto from 'node:crypto';
import { analyzePath, baitPaths, baitMarkers, maxRisk, shortPath } from '../rules.js';
import { SENSITIVE_DIRS } from '../platform.js';
import { DATA_DIR, DEMO_DIR } from '../paths.js';

const HOME = os.homedir();
export const BAIT_DIR = path.join(HOME, '.lookout', 'bait');
const LEGACY_BAIT_DIR = path.join(HOME, '.seatbelt', 'bait');

// Each decoy embeds a random marker made at install time (kept in data/bait-markers.json), so the
// values are unique to this computer and can be recognised wherever they show up later.
const BAIT_FILES = {
  'aws_credentials': (m) => `# Lookout decoy. These keys are fake and do nothing.\n[default]\naws_access_key_id = AKIA${m}\naws_secret_access_key = lk-decoy/${m}${m.toLowerCase().slice(0, 12)}\n`,
  'passwords.txt': (m) => `Lookout decoy file. Nothing real here.\nbank: ${m}-decoy\nemail: ${m.toLowerCase()}-decoy\n`,
  'id_ed25519_backup': (m) => `-----BEGIN OPENSSH PRIVATE KEY-----\n${Buffer.from(`Lookout decoy key. Not real. ${m}`).toString('base64')}\n${m}\n-----END OPENSSH PRIVATE KEY-----\n`,
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
const quiet = new Map(); // dir -> until (ms): Lookout's own writes, not the agent's

export function ignoreWrites(dir, ms = 4000) {
  quiet.set(dir, Date.now() + ms);
}

function setupBait() {
  fs.mkdirSync(BAIT_DIR, { recursive: true });
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf8')); } catch {}
  for (const [name, render] of Object.entries(BAIT_FILES)) {
    const p = path.join(BAIT_DIR, name);
    let body = null;
    try { body = fs.readFileSync(p, 'utf8'); } catch {}
    let marker = saved[name];
    // Write the decoy if it's missing, or upgrade an older decoy that has no marker yet.
    // Never overwrite a file that isn't one of ours.
    const owned = body !== null && /Lookout decoy|Seatbelt decoy/i.test(Buffer.from(body.split('\n')[1] ?? '', 'base64').toString() + body);
    // Rewrite old "Seatbelt decoy" wording in place, keeping the same marker.
    const legacyWording = owned && marker && body.includes(marker) && /Seatbelt decoy/i.test(body);
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MARKERS_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  registerLegacyBait();
}

// Decoys from before the rename live in ~/.seatbelt/bait.
// Copy them once, and keep watching the old files so a read there still counts.
function migrateBaitDir() {
  if (fs.existsSync(BAIT_DIR) || !fs.existsSync(LEGACY_BAIT_DIR)) return;
  fs.mkdirSync(path.dirname(BAIT_DIR), { recursive: true });
  fs.cpSync(LEGACY_BAIT_DIR, BAIT_DIR, { recursive: true });
}

function registerLegacyBait() {
  if (!fs.existsSync(LEGACY_BAIT_DIR)) return;
  for (const name of Object.keys(BAIT_FILES)) {
    const p = path.join(LEGACY_BAIT_DIR, name);
    if (fs.existsSync(p)) baitPaths.add(p);
  }
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

/** Push atime behind mtime so the next read is guaranteed to update it again. */
function arm(p) {
  try {
    const st = fs.statSync(p);
    const t = new Date(st.mtimeMs - 2000);
    fs.utimesSync(p, t, st.mtime);
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
    if (!lastAtime.has(p)) { arm(p); continue; }
    if (st.atimeMs !== lastAtime.get(p)) {
      const { agent, sure } = likelyAgent();
      addEvent({
        agentId: agent?.id ?? null,
        kind: 'file',
        risk: 'critical',
        reasons: [
          'opened a decoy secret Lookout planted on purpose. No honest task needs it, so this is a strong sign something went rogue',
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

function watchProjects() {
  for (const a of listAgents()) {
    if (!a.alive || !a.cwd || watchers.has(a.id)) continue;
    if (a.cwd === HOME || path.parse(a.cwd).root === a.cwd || !a.cwd.startsWith(HOME)) { watchers.set(a.id, null); continue; }
    try {
      const pending = new Set();
      const watcher = fs.watch(a.cwd, { recursive: true }, (_ev, rel) => {
        if (!rel) return;
        const full = path.join(a.cwd, rel.toString());
        if (full.startsWith(DATA_DIR) || IGNORED.test(rel.toString()) || baitPaths.has(full)) return;
        for (const [dir, until] of quiet) if (full.startsWith(dir) && Date.now() < until) return;
        // If another live agent works in a folder nested inside this one, the change is theirs.
        for (const [otherId, ow] of watchers) {
          if (otherId !== a.id && ow && ow.cwd.length > a.cwd.length && ow.cwd.startsWith(a.cwd + path.sep) && full.startsWith(ow.cwd + path.sep) && getAgent(otherId)?.alive) return;
        }
        pending.add(full);
      });
      watcher.on('error', () => {});
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
    const deps = files.filter((f) => DEPS.test(f));
    const own = files.filter((f) => !deps.includes(f));
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
function watchSensitive() {
  for (const { dir, only } of SENSITIVE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, (_ev, name) => {
        if (!name || (only && !only.test(name.toString()))) return;
        if (/^known_hosts/.test(name.toString())) return; // ssh updates this on every new server
        const { agent, sure } = likelyAgent(10000);
        if (!agent) return; // probably the person, not an agent
        const full = path.join(dir, name.toString());
        const r = analyzePath(full, { write: true, projectDir: agent.cwd });
        addEvent({
          agentId: agent.id,
          kind: 'file',
          risk: maxRisk(r.risk, 'medium'),
          reasons: r.reasons.length ? r.reasons : [`changed ${shortPath(full)} while ${agent.label} was working`],
          title: `${shortPath(full)} changed while ${agent.label} was working`,
          detail: `${shortPath(full)} (outside the project)`,
          path: full,
          attribution: sure ? 'sole' : 'guess',
        });
      });
      w.on('error', () => {});
    } catch {}
  }
}

export function startFileMonitor() {
  migrateBaitDir();
  setupBait();
  refreshDemoBait();
  watchSensitive();
  setInterval(pollBait, 700);
  setInterval(watchProjects, 2000);
  setInterval(flushProjects, 2500);
}

export function rearmBait() {
  refreshDemoBait();
  for (const p of baitPaths) arm(p);
}
