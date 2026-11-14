// Harness dashboard. Plain JS, live updates over Server-Sent Events.
// Layout: a sidebar (overview, alerts, agents, score), a list in the middle, and a details panel.
// "Commands" switches the list between plain language and the exact commands.
import { computeScore } from './score.js';
import { canBaseline } from './baseline.js';
import { sessionTouch } from './touch.js';
import { mountPug, setPugMood } from './pug.js';

const $ = (s) => document.querySelector(s);
const PANEL = document.documentElement.classList.contains('panel');
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const VERDICT = { critical: ['Dangerous', 'bad'], high: ['Risky', 'bad'], medium: ['Worth a look', 'warn'], low: ['Note', 'note'] };
const KIND_ICON = { process: 'square-terminal', network: 'globe', file: 'file-text', tool: 'wrench', task: 'message-square', system: 'eye' };
const GUARD = { paused: ['Paused', 'pause', 'circle-pause'], resumed: ['Resumed', 'ok', 'play'], ended: ['Ended', 'bad', 'octagon-x'] };
const DISPLAYS = ['score', 'icon', 'agents', 'alerts'];
const PROTECT = {
  off: { word: 'Off', icon: 'shield-off', desc: 'Harness only watches and warns. Agents keep running even when they do something dangerous.' },
  dangerous: { word: 'On', icon: 'shield-check', desc: 'Pauses a session as soon as it does something dangerous, like opening your secrets or wiping files. You decide whether it continues.' },
  risky: { word: 'Strict', icon: 'shield-alert', desc: 'Pauses a session on anything risky, including uploads to unknown servers and background changes. Expect more interruptions.' },
};
const HEADLINE = { clear: 'All good', steady: 'All good, a few notes', review: 'Worth a look', act: 'Needs your attention' };
const MOD = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
const BRAND_KINDS = new Set(['claude', 'codex', 'gemini', 'cursor', 'copilot', 'opencode', 'amp']);
const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install)\b/;

const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byUs = (who) => who === 'harness' || who === 'lookout' || who === 'seatbelt';
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

async function loadIcons() {
  try {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    box.innerHTML = await (await fetch('/icons.svg')).text();
    document.body.prepend(box);
  } catch {}
}

function setHTML(el, html) {
  if (!el || el.__html === html) return;
  el.__html = html;
  el.innerHTML = html;
}

/** Keyed list update: only rows whose HTML changed are replaced, so focus and scroll survive. */
function setList(el, items) {
  if (el.__html !== undefined) { el.__html = undefined; el.innerHTML = ''; }
  const old = new Map([...el.children].map((c) => [c.dataset.key, c]));
  const focusedKey = document.activeElement?.closest?.('[data-key]')?.dataset.key;
  let prev = null;
  for (const [key, html] of items) {
    let node = old.get(key);
    if (!node || node.__html !== html) {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      const fresh = t.content.firstElementChild;
      fresh.dataset.key = key;
      fresh.__html = html;
      if (node) node.replaceWith(fresh);
      node = fresh;
      if (key === focusedKey) fresh.querySelector('button')?.focus({ preventScroll: true });
    }
    old.delete(key);
    const at = prev ? prev.nextElementSibling : el.firstElementChild;
    if (at !== node) el.insertBefore(node, at);
    prev = node;
  }
  for (const n of old.values()) n.remove();
}

const state = {
  agents: new Map(),
  events: [],
  settings: { autoProtect: 'dangerous', menuBarDisplay: 'score' },
  baselines: [],
  ready: false,
  connected: false,
  dismissedAlert: 0,
  confirmEnd: null,
  demoRunning: false,
  followDemoSince: 0,
  autoNavAt: 0,
  // What the window shows
  view: 'overview', // overview | alerts | agent
  agentId: null,
  tab: 'processes',
  sel: null,
  collapsed: new Set(),
  search: '',
  showCommands: document.documentElement.classList.contains('show-commands'),
  explain: null, // { agentId, text, loading }
};

function localGet(key) {
  try { return localStorage.getItem(`harness.${key}`) ?? localStorage.getItem(`lookout.${key}`) ?? localStorage.getItem(`seatbelt.${key}`); } catch { return null; }
}
function localSet(key, value) {
  try { localStorage.setItem(`harness.${key}`, value); } catch {}
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return clock(ts);
}
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const sentence = (r) => (/^(this|happened)\b/.test(r) ? r[0].toUpperCase() + r.slice(1) : `It ${r}`);
const eventsOf = (id) => state.events.filter((e) => e.agentId === id);
const liveAgents = () => [...state.agents.values()].filter((a) => a.alive);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isWhole = (a) => !a?.project || a.project === 'the whole computer';
const agentName = (a) => (isWhole(a) ? a?.label ?? 'Agent' : a.project);

function verdictOf(e) {
  if (!e) return null;
  if (e.guard) { const g = GUARD[e.guard]; return g ? { text: g[0], tone: g[1] } : null; }
  if (e.baseline) return { text: 'Normal here', tone: '' };
  const v = VERDICT[e.risk];
  return v ? { text: v[0], tone: v[1] } : null;
}
const verdictHTML = (v) => (v ? `<span class="cell verdict ${v.tone ? `t-${v.tone}` : ''}">${v.tone ? '<span class="vdot"></span>' : ''}${esc(v.text)}</span>` : '<span class="cell verdict"></span>');
const topEvent = (list) => list.reduce((best, e) => (!best || (RANK[e.risk] ?? 0) > (RANK[best.risk] ?? 0) || ((RANK[e.risk] ?? 0) === (RANK[best.risk] ?? 0) && e.id > best.id) ? e : best), null);

function sessionState(a) {
  if (a.alive && a.paused) return { cls: 'paused', text: byUs(a.pausedBy) ? 'Paused by Harness' : 'Paused by you' };
  if (!a.alive && a.endedBy) return { cls: 'ended', text: byUs(a.endedBy) ? 'Ended by Harness' : 'Ended by you' };
  if (!a.alive) return { cls: 'done', text: 'Finished' };
  const recent = Date.now() - (a.lastActive ?? 0) < 15000;
  return { cls: recent ? 'working' : 'idle', text: recent ? 'Working' : 'Idle' };
}

function agentLogo(a) {
  return BRAND_KINDS.has(a?.kind) ? `<svg class="brand" aria-hidden="true"><use href="#brandc-${a.kind}"/></svg>` : icon('bot');
}

/** The program a command runs, in one word: `zsh -c "npm install"` is npm. */
function progName(cmd) {
  let c = String(cmd ?? '').trim();
  const inner = c.match(/^(?:\S*\/)?(?:ba|z|da|k)?sh\s+(?:-\w+\s+)*-c\s+["']?(.+?)["']?$/);
  if (inner) c = inner[1];
  // In `sleep 1; cat a b | base64; curl …` the first program that does something is `cat`.
  const parts = c.split(/\s*(?:;|&&|\|\||\|)\s*/).map((p) => p.replace(/^(\w+=\S*\s+)+/, '').trim()).filter(Boolean);
  const names = parts.map((p) => (p.split(/\s+/)[0] || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').replace(/^["']|["']$/g, ''));
  return names.find((n) => n && !FILLER.has(n)) || names[0] || 'program';
}
const FILLER = new Set(['sleep', 'echo', 'cd', 'true', 'false', 'set', 'export', 'exit', 'rm', 'Start-Sleep']);

/* ---------------- Process tree ---------------- */

function buildTree(agent) {
  const nodes = new Map();
  const get = (pid) => {
    let n = nodes.get(pid);
    if (!n) nodes.set(pid, (n = { pid, cmd: '', role: '', label: '', parent: null, kids: [], ts: Infinity, events: [] }));
    return n;
  };
  const evs = eventsOf(agent.id);
  for (const e of evs) {
    if (!Array.isArray(e.steps)) continue;
    e.steps.forEach((s, i) => {
      if (s?.pid == null) return;
      const n = get(s.pid);
      if (!n.cmd && s.cmd) n.cmd = s.cmd;
      if (!n.role || (n.role === 'command' && s.role && s.role !== 'command')) n.role = s.role || n.role;
      if (!n.label && s.label) n.label = s.label;
      const up = e.steps[i - 1]?.pid;
      if (i > 0 && n.parent == null && up != null && up !== s.pid) n.parent = up;
      n.ts = Math.min(n.ts, e.ts);
    });
  }
  for (const e of evs) {
    if (e.pid == null || e.kind === 'system' || !nodes.has(e.pid)) continue;
    const n = nodes.get(e.pid);
    n.events.push(e);
    if (!n.cmd && e.command) n.cmd = e.command;
  }
  for (const n of nodes.values()) {
    if (n.parent != null && nodes.has(n.parent)) nodes.get(n.parent).kids.push(n);
    n.top = topEvent(n.events.filter((e) => !e.baseline || true));
  }
  for (const n of nodes.values()) n.kids.sort((a, b) => a.ts - b.ts || a.pid - b.pid);
  return [...nodes.values()].filter((n) => n.parent == null || !nodes.has(n.parent)).sort((a, b) => a.ts - b.ts);
}

function flatten(roots, agent) {
  const out = [];
  const walk = (n, depth, parent, underInstall) => {
    n.depth = depth;
    n.parentNode = parent;
    n.underInstall = underInstall;
    n.agent = agent;
    out.push(n);
    if (state.collapsed.has(n.pid)) return;
    const install = underInstall || n.role === 'install' || (n.role !== 'agent' && INSTALL.test(n.cmd) && !/^(?:\S*\/)?(ba|z)?sh\b/.test(n.cmd));
    for (const k of n.kids) walk(k, depth + 1, n, install);
  };
  for (const r of roots) walk(r, 0, null, false);
  return out;
}

const reasonText = (n) => (n.events ?? []).flatMap((e) => e.reasons ?? []).join(' · ');

function plainName(n) {
  if (n.role === 'agent') return n.label || n.agent?.label || 'Agent';
  const r = reasonText(n);
  if (/decoy secret/.test(r)) return /contents of a decoy/.test(r) ? 'Passed on a decoy secret' : 'Opened a decoy secret';
  if (/uploaded data|raw network connection/.test(r)) return 'Tried to send data out';
  if (/home folder or disk/.test(r)) return 'Tried to delete everything';
  if (/Keychain|saved passwords|accessed /.test(r)) return 'Went after your secrets';
  if (/run automatically/.test(r)) return 'Set up a background task';
  if (/downloaded a script/.test(r)) return 'Ran a script from the internet';
  if (n.role === 'install' || (INSTALL.test(n.cmd) && !n.underInstall)) return 'Installed packages';
  if (n.role === 'request') return 'Contacted a server';
  if (n.underInstall) return "A package's setup script";
  return `Ran ${progName(n.cmd)}`;
}

function procIcon(n) {
  if (n.role === 'agent') return agentLogo(n.agent);
  if (/decoy secret/.test(reasonText(n))) return icon('key-round', 'i row-icon');
  if (n.role === 'install' || INSTALL.test(n.cmd)) return icon('package', 'i row-icon');
  if (n.role === 'request' || /\b(curl|wget)\b/.test(n.cmd)) return icon('globe', 'i row-icon');
  return icon('square-terminal', 'i row-icon');
}

function procVerdict(n) {
  const a = n.agent;
  if (a?.paused && a.pausedEventId != null && n.events.some((e) => e.id === a.pausedEventId)) return { text: 'Paused here', tone: 'pause' };
  const v = n.top && RANK[n.top.risk] >= 1 ? verdictOf(n.top) : null;
  if (v) return v;
  if (n.role === 'agent') return { text: 'Agent', tone: '' };
  if (n.underInstall) return { text: 'Not typed by the agent', tone: 'warn' };
  if (n.parentNode?.role === 'agent') return { text: 'Started by the agent', tone: '' };
  return null;
}

function procOrigin(n) {
  if (n.role === 'agent') return 'The agent itself';
  if (n.underInstall) return "Started by a package's install script, not the agent";
  if (n.parentNode?.role === 'agent') return `Started by ${n.agent?.label ?? 'the agent'}`;
  if (n.parentNode) return `Started by ${progName(n.parentNode.cmd)}`;
  return 'Parent not seen';
}

/* ---------------- Rows for each view ---------------- */

function isNotable(e) {
  if (e.guard) return true;
  if (RANK[e.risk] >= 1) return true;
  if (e.kind === 'task' || e.agentReported) return true;
  if (e.kind === 'file' && e.batch) return true;
  if (e.kind === 'network' && !e.isAgentItself && !e.trusted) return true;
  if (e.baseline) return true;
  return false;
}

const COLS = {
  events: ['What happened', 'Agent', 'Verdict', 'When'],
  eventsT: 'minmax(0, 1fr) 170px 150px 90px',
  activity: ['What happened', 'Verdict', 'When'],
  activityT: 'minmax(0, 1fr) 150px 90px',
  processes: ['Process', 'Verdict', 'Started'],
  processesT: 'minmax(0, 1fr) 190px 90px',
  processesCmd: ['Process', 'Verdict', 'PID', 'Started'],
  processesCmdT: 'minmax(0, 1fr) 190px 70px 90px',
  files: ['File', 'What happened', 'When'],
  filesT: 'minmax(0, 1fr) 170px 90px',
  network: ['Server', 'Verdict', 'Connections', 'Last seen'],
  networkT: 'minmax(0, 1fr) 150px 100px 90px',
};

function eventRow(e, { showAgent }) {
  const a = state.agents.get(e.agentId);
  const v = verdictOf(e);
  const ic = e.guard ? GUARD[e.guard]?.[2] ?? 'info' : e.bait ? 'key-round' : KIND_ICON[e.kind] ?? 'info';
  const cmd = state.showCommands && e.command ? `<span class="cmd dim">${esc(e.command)}</span>` : '';
  return {
    key: `e${e.id}`,
    text: `${e.title} ${e.command ?? ''} ${a?.label ?? ''} ${a?.project ?? ''}`,
    cells: `<span class="cell">${icon(ic, 'i row-icon')}<span class="prim">${esc(e.title)}</span>${cmd}</span>
      ${showAgent ? `<span class="cell dim">${a ? esc(`${a.label}${isWhole(a) ? '' : ` · ${a.project}`}`) : ''}</span>` : ''}
      ${verdictHTML(v)}
      <span class="cell c2" title="${esc(new Date(e.ts).toLocaleString())}">${esc(ago(e.ts))}</span>`,
    label: `${e.title}. ${v ? v.text : ''}`,
  };
}

function procRow(n) {
  const v = procVerdict(n);
  const twisty = n.kids.length
    ? `<span class="twisty${state.collapsed.has(n.pid) ? ' closed' : ''}" data-toggle="${n.pid}" title="${state.collapsed.has(n.pid) ? 'Expand' : 'Collapse'}">${icon('chevron-down')}</span>`
    : '<span class="twisty"></span>';
  const name = state.showCommands
    ? `<span class="cmd">${esc(n.role === 'agent' ? n.label || n.cmd : n.cmd || n.label)}</span>`
    : `<span class="prim">${esc(plainName(n))}</span>${n.role === 'agent' ? '' : `<span class="dim">${esc(progName(n.cmd))}</span>`}`;
  return {
    key: `p${n.pid}`,
    text: `${plainName(n)} ${n.cmd} ${n.label}`,
    cells: `<span class="cell" style="padding-left:${n.depth * 16}px">${twisty}${procIcon(n)}${name}</span>
      ${verdictHTML(v)}
      ${state.showCommands ? `<span class="cell c2">${n.pid}</span>` : ''}
      <span class="cell c2">${Number.isFinite(n.ts) ? esc(clock(n.ts)) : ''}</span>`,
    label: `${plainName(n)}. ${v ? v.text : ''}`,
    node: n,
  };
}

function fileRows(agent) {
  const map = new Map();
  for (const e of eventsOf(agent.id)) {
    if (e.kind !== 'file') continue;
    const paths = [e.path, ...(e.files ?? [])].filter(Boolean);
    for (const p of paths) {
      const cur = map.get(p) ?? { path: p, events: [], bait: false, ts: 0 };
      cur.events.push(e);
      cur.bait ||= !!e.bait && p === e.path;
      cur.ts = Math.max(cur.ts, e.ts);
      map.set(p, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.ts - a.ts).map((f) => {
    const top = topEvent(f.events);
    const v = f.bait ? { text: 'Opened a decoy secret', tone: 'bad' } : verdictOf(top) ?? { text: 'Changed', tone: '' };
    const short = state.showCommands ? f.path : f.path.split(/[\\/]/).slice(-2).join('/');
    return {
      key: `f${f.path}`, text: f.path, file: f, top,
      cells: `<span class="cell">${icon(f.bait ? 'key-round' : 'file-text', 'i row-icon')}<span class="${state.showCommands ? 'cmd' : 'prim'}" title="${esc(f.path)}">${esc(short)}</span></span>
        ${verdictHTML(v)}<span class="cell c2">${esc(ago(f.ts))}</span>`,
      label: `${f.path}. ${v.text}`,
    };
  });
}

function hostRows(agent) {
  const map = new Map();
  for (const e of eventsOf(agent.id)) {
    if (e.kind !== 'network' || !e.host) continue;
    const cur = map.get(e.host) ?? { host: e.host, events: [], ts: 0, trusted: !!e.trusted };
    cur.events.push(e);
    cur.ts = Math.max(cur.ts, e.ts);
    map.set(e.host, cur);
  }
  return [...map.values()].sort((a, b) => b.ts - a.ts).map((h) => {
    const top = topEvent(h.events);
    const v = (RANK[top?.risk] ?? 0) >= 1 ? verdictOf(top) : { text: h.trusted ? 'Known service' : 'This computer', tone: '' };
    if (!h.trusted && (RANK[top?.risk] ?? 0) === 0 && !/^(127\.|::1|localhost)/.test(h.host)) v.text = 'Seen';
    return {
      key: `h${h.host}`, text: h.host, hostRow: h, top,
      cells: `<span class="cell">${icon('globe', 'i row-icon')}<span class="prim">${esc(h.host)}</span></span>
        ${verdictHTML(v)}<span class="cell c2">${h.events.length}</span><span class="cell c2">${esc(ago(h.ts))}</span>`,
      label: `${h.host}. ${v.text}`,
    };
  });
}

function currentRows() {
  if (state.view === 'agent') {
    const a = state.agents.get(state.agentId);
    if (!a) return { cols: COLS.activity, tpl: COLS.activityT, rows: [] };
    if (state.tab === 'processes') {
      const rows = flatten(buildTree(a), a).map(procRow);
      return state.showCommands
        ? { cols: COLS.processesCmd, tpl: COLS.processesCmdT, rows }
        : { cols: COLS.processes, tpl: COLS.processesT, rows };
    }
    if (state.tab === 'files') return { cols: COLS.files, tpl: COLS.filesT, rows: fileRows(a) };
    if (state.tab === 'network') return { cols: COLS.network, tpl: COLS.networkT, rows: hostRows(a) };
    const evs = eventsOf(a.id).filter(isNotable).slice(-300).reverse();
    return { cols: COLS.activity, tpl: COLS.activityT, rows: evs.map((e) => ({ ...eventRow(e, { showAgent: false }), event: e })) };
  }
  let evs = state.events.filter(isNotable);
  if (state.view === 'alerts') evs = evs.filter((e) => e.guard || (!e.baseline && RANK[e.risk] >= 2));
  evs = evs.slice(-300).reverse();
  return { cols: COLS.events, tpl: COLS.eventsT, rows: evs.map((e) => ({ ...eventRow(e, { showAgent: true }), event: e })) };
}

/* ---------------- Render: sidebar ---------------- */

function renderSidebar() {
  for (const b of document.querySelectorAll('.side-scroll [data-nav]')) {
    const on = b.dataset.nav === state.view && b.dataset.nav !== 'agent';
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const now = Date.now();
  const live = liveAgents().sort((a, b) => (b.paused - a.paused) || ((b.lastActive ?? 0) - (a.lastActive ?? 0)));
  const done = [...state.agents.values()].filter((a) => !a.alive && now - (a.lastActive ?? a.startedAt ?? 0) < 2 * 3600 * 1000)
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)).slice(0, 4);
  const shown = [...live, ...done];
  if (state.view === 'agent' && state.agentId && !shown.some((a) => a.id === state.agentId) && state.agents.has(state.agentId)) shown.push(state.agents.get(state.agentId));
  const box = $('#side-agents');
  if (!shown.length) {
    setHTML(box, '<p class="side-empty">No agents running</p>');
  } else {
    setList(box, shown.map((a) => {
      const st = sessionState(a);
      const on = state.view === 'agent' && state.agentId === a.id;
      return [a.id, `<button type="button" class="side-item${on ? ' on' : ''}${a.alive ? '' : ' done'}" data-nav="agent" data-id="${esc(a.id)}" title="${esc(`${a.label} in ${a.project}. ${st.text}`)}"${on ? ' aria-current="page"' : ''}>
        ${agentLogo(a)}<span class="side-text">${esc(agentName(a))}</span><span class="sdot ${st.cls}" aria-label="${esc(st.text)}"></span></button>`];
    }));
  }
  const alerts = state.events.filter((e) => e.kind !== 'system' && !e.baseline && RANK[e.risk] >= 3 && now - e.ts < 24 * 3600 * 1000).length;
  const ac = $('#alert-count');
  ac.textContent = alerts ? String(alerts) : '';
  ac.classList.toggle('bad', alerts > 0);
}

function renderScore() {
  const num = $('#score-num');
  const word = $('#score-level');
  const fill = $('#meter-fill');
  if (!state.ready) {
    num.textContent = '--';
    word.className = 'ss-word';
    word.textContent = 'Loading';
    fill.style.width = '0%';
    setPugMood({ level: 'loading' });
    return;
  }
  const s = computeScore(state.events);
  num.textContent = s.score;
  fill.style.width = `${s.score}%`;
  fill.className = `ss-fill ${s.level.cls}`;
  word.className = `ss-word ${s.level.cls}`;
  word.textContent = HEADLINE[s.level.cls] ?? s.level.name;
  $('#score-live').setAttribute('aria-label', `Safety score ${s.score} out of 100. ${s.level.blurb}`);
  const paused = liveAgents().some((a) => a.paused && byUs(a.pausedBy));
  const working = liveAgents().some((a) => !a.paused && Date.now() - (a.lastActive ?? 0) < 15000);
  setPugMood({ level: s.level.cls, score: s.score, paused, working, agents: liveAgents().length });
}

function renderProtect() {
  const lvl = state.settings.autoProtect ?? 'off';
  const p = PROTECT[lvl] ?? PROTECT.off;
  $('#protect').dataset.level = lvl;
  $('#protect-state').textContent = p.word;
  $('#protect-icon').setAttribute('href', `#${p.icon}`);
  $('#protect-desc').textContent = p.desc;
  $('#side-protect-state').textContent = p.word;
  $('#side-protect-icon').setAttribute('href', `#${p.icon}`);
  for (const b of document.querySelectorAll('#protect-seg button')) {
    const on = b.dataset.level === lvl;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

/* ---------------- Render: toolbar, banner, list ---------------- */

function renderToolbar() {
  const tabs = $('#tabs');
  if (state.view === 'agent') {
    const a = state.agents.get(state.agentId);
    $('#view-title').textContent = a ? agentName(a) : 'Agent';
    $('#view-sub').textContent = a ? `${isWhole(a) ? 'Watching the whole computer' : a.label} · ${sessionState(a).text}` : '';
    tabs.hidden = false;
    for (const b of tabs.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  } else {
    tabs.hidden = true;
    const live = liveAgents().length;
    $('#view-title').textContent = state.view === 'alerts' ? 'Alerts' : 'Overview';
    $('#view-sub').textContent = state.view === 'alerts'
      ? 'Risky moments and what Harness did about them'
      : live ? `Watching ${plural(live, 'agent')}` : 'No agents running';
  }
  const t = $('#cmd-toggle');
  t.setAttribute('aria-pressed', String(state.showCommands));
}

function endButton(a, cls, label) {
  const on = state.confirmEnd === a.id;
  return `<button type="button" class="pbtn ${cls}${on ? ' confirming' : ''}" data-act="end" data-id="${esc(a.id)}" title="Stops ${esc(a.label)} and every program it started">${on ? 'Click Again to End' : label}</button>`;
}

function renderBanner() {
  const el = $('#alert');
  const paused = liveAgents().filter((a) => a.paused && byUs(a.pausedBy));
  if (paused.length) {
    const a = paused[0];
    el.className = 'banner pause';
    el.hidden = false;
    setHTML(el, `${icon('circle-pause')}
      <p class="banner-text"><b>Harness paused ${esc(a.label)}${isWhole(a) ? '' : ` in ${esc(a.project)}`}.</b> <span>${a.pausedReason ? `It ${esc(a.pausedReason)}. ` : ''}Nothing it started can run until you decide.</span></p>
      <div class="banner-actions">
        ${state.view === 'agent' && state.agentId === a.id ? '' : `<button type="button" class="pbtn" data-nav="agent" data-id="${esc(a.id)}">Show</button>`}
        <button type="button" class="pbtn" data-act="resume" data-id="${esc(a.id)}">Let It Continue</button>
        ${endButton(a, 'danger', 'End Session')}
      </div>`);
    return;
  }
  const recent = state.events.filter((e) => e.kind !== 'system' && !e.baseline && RANK[e.risk] >= 3 && e.id > state.dismissedAlert && Date.now() - e.ts < 15 * 60 * 1000);
  if (!recent.length) { el.hidden = true; return; }
  const top = topEvent(recent);
  const a = state.agents.get(top.agentId);
  el.className = 'banner bad';
  el.hidden = false;
  setHTML(el, `${icon(top.risk === 'critical' ? 'octagon-alert' : 'triangle-alert')}
    <p class="banner-text"><b>${esc(top.title)}.</b> <span>${top.reasons?.[0] ? `${esc(sentence(top.reasons[0]))}.` : ''}${recent.length > 1 ? ` ${recent.length - 1} more in the last 15 minutes.` : ''}</span></p>
    <div class="banner-actions">
      ${a ? `<button type="button" class="pbtn" data-show-event="${top.id}">Show</button>` : ''}
      <button type="button" class="pbtn" data-dismiss>Got It</button>
      ${a?.alive && !a.paused ? endButton(a, 'danger', 'End Session') : ''}
    </div>`);
}

let lastRows = [];
function renderList() {
  const { cols, tpl, rows: all } = currentRows();
  const q = state.search.trim().toLowerCase();
  const rows = q ? all.filter((r) => r.text.toLowerCase().includes(q)) : all;
  lastRows = rows;
  const table = $('#table');
  table.style.setProperty('--cols', tpl);
  setHTML($('#thead'), cols.map((c) => `<span>${esc(c)}</span>`).join(''));
  if (state.sel && !rows.some((r) => r.key === state.sel)) state.sel = null;
  setList($('#rows'), rows.map((r) => [r.key,
    `<li><button type="button" class="row${r.key === state.sel ? ' sel' : ''}" data-row="${esc(r.key)}" aria-pressed="${r.key === state.sel}" aria-label="${esc(r.label)}">${r.cells}</button></li>`]));
  const empty = $('#empty');
  if (rows.length) { empty.hidden = true; return; }
  empty.hidden = false;
  if (!state.ready) { setHTML(empty, '<p>Connecting…</p>'); return; }
  if (q) { setHTML(empty, `<strong>No matches</strong><p>Nothing here matches “${esc(state.search)}”.</p>`); return; }
  const msg = state.view === 'agent'
    ? { processes: 'No programs seen yet.', files: 'No files touched yet.', network: 'No servers contacted yet.', activity: 'Nothing worth noting yet.' }[state.tab]
    : state.view === 'alerts' ? 'No alerts. Risky moments show up here.' : null;
  if (msg) { setHTML(empty, `<strong>${esc(msg)}</strong>`); return; }
  setHTML(empty, `<img src="/ui/pug.png" alt="" /><strong>${liveAgents().length ? 'All quiet' : 'No agents running'}</strong>
    <p>${liveAgents().length ? 'Risky commands, secret reads and uploads show up here as they happen.' : 'Open Claude Code or Codex and Harness picks it up on its own.'}</p>
    <button type="button" class="pbtn primary" data-demo>${icon('play')}Run Demo Attack</button>`);
}

/* ---------------- Render: details panel ---------------- */

const kv = (pairs) => `<dl class="kv">${pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const sec = (title, body) => (body ? `<section class="ins-sec"><h3>${esc(title)}</h3>${body}</section>` : '');
const reasonsHTML = (list) => {
  const r = [...new Set(list.filter(Boolean))];
  if (!r.length) return '';
  return r.length === 1 ? `<p>${esc(sentence(r[0]))}.</p>` : `<ul>${r.map((x) => `<li>${esc(sentence(x))}.</li>`).join('')}</ul>`;
};
const commandHTML = (cmd) => {
  if (!cmd) return '';
  const block = `<div class="codeblock">${esc(cmd)}</div>`;
  return state.showCommands ? sec('Command', block) : `<section class="ins-sec"><details><summary>Show the exact command</summary>${block}</details></section>`;
};
const vText = (v) => (v ? `<span class="${v.tone ? `t-${v.tone}` : ''}">${esc(v.text)}</span>` : '');

function factorsHTML(events) {
  const s = computeScore(events);
  const lost = s.factors.filter((f) => f.lost > 0 || f.count > 0);
  const rows = lost.length
    ? lost.map((f) => `<div class="factor-row"><span>${esc(f.name)}</span><span class="n ${f.lost >= 20 ? 'bad' : f.lost >= 5 ? 'warn' : ''}">${f.lost ? `−${f.lost}` : '0'}</span></div>`).join('')
    : '<p class="hint">Nothing has cost points.</p>';
  return { s, rows };
}

function insOverview() {
  if (!state.ready) return '<p class="hint">Getting the latest activity.</p>';
  const { s, rows } = factorsHTML(state.events);
  return `
    <div><div class="ins-title">Safety score</div><div class="ins-sub">${esc(s.level.blurb)}</div></div>
    <div class="ins-score"><b>${s.score}</b><span>/ 100 · <span class="ss-word ${s.level.cls}">${esc(s.level.name)}</span></span></div>
    ${sec('What cost points', rows)}
    ${sec('How it works', '<p>Everyone starts at 100. Risky things cost points by kind, each with a limit, and the cost halves every 12 hours.</p>')}
    <div class="ins-actions">
      <a class="pbtn" href="/api/report.md" download>${icon('download')}Download Report</a>
      <button type="button" class="pbtn" data-demo>${icon('play')}Run Demo</button>
    </div>`;
}

function insAgent(a) {
  const st = sessionState(a);
  const touch = sessionTouch(a, state.events);
  const { s, rows } = factorsHTML(eventsOf(a.id));
  const ex = state.explain?.agentId === a.id ? state.explain : null;
  return `
    <div><div class="ins-title">${esc(a.label)}</div><div class="ins-sub">${esc(isWhole(a) ? 'Watching the whole computer' : a.cwd || a.project)}</div></div>
    ${kv([
      ['Status', vText({ text: st.text, tone: st.cls === 'paused' ? 'pause' : st.cls === 'ended' ? 'bad' : '' })],
      ['Score', `${s.score} / 100 · <span class="ss-word ${s.level.cls}">${esc(s.level.name)}</span>`],
      ['Started', a.startedAt ? esc(clock(a.startedAt)) : ''],
      ['Programs', String(touch.commands.length)],
      ['Files', String(touch.files.length)],
      ['Servers', String(touch.hosts.length)],
    ])}
    ${a.task ? sec('You asked', `<p>“${esc(a.task)}”</p>`) : ''}
    ${sec('Summary', `<p>${esc(touch.headline)}</p>`)}
    ${ex ? sec('Explanation', `<p class="explain-text${ex.loading ? ' loading' : ''}">${esc(ex.loading ? 'Thinking it over…' : ex.text)}</p>`) : ''}
    ${sec('What cost points', rows)}
    <div class="ins-actions">
      ${a.alive && !a.paused ? `<button type="button" class="pbtn" data-act="pause" data-id="${esc(a.id)}">${icon('pause')}Pause</button>` : ''}
      ${a.alive && a.paused ? `<button type="button" class="pbtn" data-act="resume" data-id="${esc(a.id)}">${icon('play')}Let It Continue</button>` : ''}
      ${a.alive ? endButton(a, '', 'End Session') : ''}
      <button type="button" class="pbtn" data-explain="${esc(a.id)}" ${ex?.loading ? 'disabled' : ''}>${icon('sparkles')}Explain</button>
      <a class="pbtn" href="/api/report.md?agent=${encodeURIComponent(a.id)}" download>${icon('download')}Report</a>
    </div>`;
}

function baselineButton(e) {
  return e && canBaseline(e) ? `<div class="ins-actions"><button type="button" class="linkbtn" data-base="${e.id}">Normal for this project</button></div>` : '';
}

function insProc(n) {
  const v = procVerdict(n);
  const reasons = n.events.flatMap((e) => e.reasons ?? []);
  const hosts = [...new Set(n.events.filter((e) => e.kind === 'network' && e.host).map((e) => e.host))];
  const files = [...new Set(n.events.filter((e) => e.kind === 'file' && e.path).map((e) => e.path))];
  const top = n.top && RANK[n.top.risk] >= 1 ? n.top : null;
  return `
    <div><div class="ins-title">${esc(state.showCommands ? progName(n.cmd) || n.label : plainName(n))}</div><div class="ins-sub">${esc(procOrigin(n))}</div></div>
    ${kv([
      ['Verdict', v ? vText(v) : 'Routine'],
      ['Program', n.role === 'agent' ? esc(n.label) : `<span class="mono">${esc(progName(n.cmd))}</span>`],
      ['Started', Number.isFinite(n.ts) ? esc(clock(n.ts)) : ''],
      ['Parent', n.parentNode ? `<span class="mono">${esc(n.parentNode.role === 'agent' ? n.parentNode.label : progName(n.parentNode.cmd))}</span>` : ''],
      ['PID', state.showCommands ? String(n.pid) : ''],
      ['Programs under it', n.kids.length ? String(n.kids.length) : ''],
    ])}
    ${sec('Why it matters', reasonsHTML(reasons))}
    ${hosts.length ? sec('Servers', `<ul>${hosts.map((h) => `<li class="mono">${esc(h)}</li>`).join('')}</ul>`) : ''}
    ${files.length ? sec('Files', `<ul>${files.map((f) => `<li class="mono">${esc(f)}</li>`).join('')}</ul>`) : ''}
    ${n.role === 'agent' ? '' : commandHTML(n.cmd)}
    ${baselineButton(top)}`;
}

function insEvent(e) {
  const a = state.agents.get(e.agentId);
  const v = verdictOf(e);
  return `
    <div><div class="ins-title">${esc(e.title)}</div><div class="ins-sub">${a ? esc(`${a.label}${isWhole(a) ? '' : ` in ${a.project}`}`) : 'No agent'} · ${esc(new Date(e.ts).toLocaleString())}</div></div>
    ${kv([
      ['Verdict', v ? vText(v) : 'Routine'],
      ['Server', e.host ? `<span class="mono">${esc(e.host)}</span>` : ''],
      ['File', e.path ? `<span class="mono">${esc(e.path)}</span>` : ''],
      ['Harness', e.gate === 'deny' || e.prevented ? 'Blocked it before it ran' : e.gate === 'ask' ? 'Asked you first' : ''],
    ])}
    ${sec('Why it matters', reasonsHTML(e.reasons ?? []))}
    ${e.guard && e.detail ? sec('Details', `<p>${esc(e.detail)}</p>`) : ''}
    ${commandHTML(e.command)}
    <div class="ins-actions">
      ${a ? `<button type="button" class="pbtn" data-show-event="${e.id}">Show in Session</button>` : ''}
    </div>
    ${baselineButton(e)}`;
}

function insFile(r) {
  const f = r.file;
  return `
    <div><div class="ins-title">${esc(f.path.split(/[\\/]/).pop())}</div><div class="ins-sub mono">${esc(f.path)}</div></div>
    ${kv([['Verdict', f.bait ? vText({ text: 'Opened a decoy secret', tone: 'bad' }) : vText(verdictOf(r.top)) || 'Routine'], ['Last seen', esc(clock(f.ts))], ['Times', String(f.events.length)]])}
    ${f.bait ? sec('What this means', '<p>Harness planted this fake secret on purpose. Nothing you ask an agent to do needs it, so opening it is a strong sign something went rogue.</p>') : ''}
    ${sec('Why it matters', reasonsHTML(f.events.flatMap((e) => e.reasons ?? [])))}`;
}

function insHost(r) {
  const h = r.hostRow;
  return `
    <div><div class="ins-title">${esc(h.host)}</div><div class="ins-sub">${h.trusted ? 'A service Harness recognizes' : 'A server Harness doesn’t recognize'}</div></div>
    ${kv([['Verdict', vText(verdictOf(r.top)) || 'Routine'], ['Connections', String(h.events.length)], ['Last seen', esc(clock(h.ts))]])}
    ${sec('Why it matters', reasonsHTML(h.events.flatMap((e) => e.reasons ?? [])))}
    ${baselineButton(r.top && RANK[r.top.risk] >= 1 ? r.top : null)}`;
}

function renderInspector() {
  const el = $('#inspector');
  const r = state.sel ? lastRows.find((x) => x.key === state.sel) : null;
  let html;
  if (r?.node) html = insProc(r.node);
  else if (r?.event) html = insEvent(r.event);
  else if (r?.file) html = insFile(r);
  else if (r?.hostRow) html = insHost(r);
  else if (state.view === 'agent' && state.agents.get(state.agentId)) html = insAgent(state.agents.get(state.agentId));
  else html = insOverview();
  setHTML(el, html);
}

function renderStatus() {
  let text;
  if (state.view === 'agent') {
    const a = state.agents.get(state.agentId);
    const t = a ? sessionTouch(a, state.events) : null;
    text = t ? `${plural(t.commands.length, 'program')} · ${plural(t.files.length, 'file')} · ${plural(t.hosts.length, 'server')}` : '';
  } else {
    text = `${plural(liveAgents().length, 'agent')} running · ${plural(state.events.filter(isNotable).length, 'thing')} worth noting`;
  }
  $('#status-left').textContent = state.connected ? text : `${text} · Reconnecting`;
}

/* ---------------- Settings dialog ---------------- */

function renderPrefs() {
  const mode = state.settings.menuBarDisplay ?? 'score';
  for (const b of document.querySelectorAll('#display-seg [data-display]')) b.setAttribute('aria-checked', String(b.dataset.display === mode));
  const on = document.documentElement.dataset.contrast === 'high';
  const b = $('#prefs-contrast');
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('on', on);
  const list = $('#baseline-list');
  setHTML(list, state.baselines.length
    ? state.baselines.map((x) => `<li><span><b>${esc(x.project || 'Project')}</b> · <span class="mono">${esc(x.value)}</span></span><button type="button" class="link" data-unbase="${esc(x.id)}">Remove</button></li>`).join('')
    : '<li class="hint">Nothing is marked as normal yet.</li>');
}

/* ---------------- Menu bar panel ---------------- */

function renderPanel() {
  const s = state.ready ? computeScore(state.events) : null;
  $('#mp-score').textContent = s ? String(s.score) : '--';
  const level = $('#mp-level');
  level.className = `mp-level ${s ? s.level.cls : ''}`;
  level.textContent = s ? (HEADLINE[s.level.cls] ?? s.level.name) : 'Loading';
  let blurb = s ? s.level.blurb : 'Getting the latest activity.';
  if (s && !state.connected) blurb = 'Reconnecting. This may be a few seconds behind.';
  $('#mp-blurb').textContent = blurb;

  const active = liveAgents().sort((a, b) => (b.paused - a.paused) || ((b.lastActive ?? 0) - (a.lastActive ?? 0)));
  $('#mp-agent-count').textContent = String(active.length);
  if (!active.length) {
    setHTML($('#mp-agents'), '<div class="mp-empty">No agents running</div>');
  } else {
    setList($('#mp-agents'), active.map((a) => {
      const st = sessionState(a);
      return [a.id, `<button type="button" class="mp-agent" role="menuitem" data-open title="${esc(a.cwd || a.project)}">
        <span class="mp-dot ${st.cls}"></span>
        <span class="mp-agent-name">${esc(a.label)}</span>
        <span class="mp-agent-proj">${esc(a.project)}</span>
        <span class="mp-agent-state">${esc(st.text.replace(/ by (Harness|you)$/, ''))}</span>
      </button>`];
    }));
  }
  const pause = $('#mp-pause');
  pause.disabled = !active.some((a) => !a.paused);
  pause.textContent = active.filter((a) => !a.paused).length > 1 ? 'Pause agents' : 'Pause';
  $('#mp-open-key').textContent = `${MOD}O`;
  $('#mp-quit-key').textContent = `${MOD}Q`;
  fitPanel();
}

let panelFitQueued = false;
function fitPanel() {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!PANEL || !invoke || panelFitQueued) return;
  panelFitQueued = true;
  requestAnimationFrame(() => {
    panelFitQueued = false;
    invoke('resize_panel', { height: Math.ceil($('#menu-panel').offsetHeight) }).catch(() => {});
  });
}

/* ---------------- Render loop ---------------- */

/** When Harness pauses an agent, or the demo starts, jump to that session so the story is on screen. */
function autoNavigate() {
  const paused = liveAgents().filter((a) => a.paused && byUs(a.pausedBy) && (a.pausedAt ?? 0) > state.autoNavAt);
  if (paused.length) {
    const a = paused[0];
    state.autoNavAt = a.pausedAt ?? Date.now();
    const trigger = state.events.find((e) => e.id === a.pausedEventId);
    go({ view: 'agent', agentId: a.id, tab: 'processes', sel: trigger?.pid != null ? `p${trigger.pid}` : null, quiet: true });
    return;
  }
  if (state.followDemoSince) {
    const demo = [...state.agents.values()].find((a) => a.alive && /demo/i.test(`${a.kind} ${a.label}`) && (a.startedAt ?? 0) >= state.followDemoSince - 5000);
    if (demo) {
      state.followDemoSince = 0;
      go({ view: 'agent', agentId: demo.id, tab: 'processes', quiet: true });
    }
  }
}

let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (PANEL) { renderPanel(); return; }
    autoNavigate();
    renderSidebar();
    renderScore();
    renderProtect();
    renderToolbar();
    renderBanner();
    renderList();
    renderInspector();
    renderStatus();
    renderPrefs();
  });
}

function go({ view, agentId = null, tab, sel = null, quiet = false }) {
  const changed = view !== state.view || agentId !== state.agentId;
  state.view = view;
  state.agentId = view === 'agent' ? agentId : null;
  if (tab) state.tab = tab;
  else if (changed) state.tab = 'processes';
  state.sel = sel;
  if (changed) { state.search = ''; $('#search').value = ''; $('#rows').scrollTop = 0; }
  if (!quiet) render();
  if (sel) requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-row="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' })));
}

/* ---------------- Actions ---------------- */

async function agentAction(action, agentId, btn) {
  const a = state.agents.get(agentId);
  if (action === 'end' && state.confirmEnd !== agentId) {
    state.confirmEnd = agentId;
    clearTimeout(state.confirmTimer);
    state.confirmTimer = setTimeout(() => { state.confirmEnd = null; render(); }, 4000);
    render();
    return;
  }
  if (action === 'end') state.confirmEnd = null;
  if (btn) btn.disabled = true;
  try {
    const r = await post('/api/agent', { agentId, action });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) toast(j.error ?? 'That didn’t work');
    else toast({ pause: `${a?.label ?? 'Session'} is paused.`, resume: `${a?.label ?? 'Session'} is running again.`, end: `${a?.label ?? 'Session'} was ended.` }[action]);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function explain(agentId) {
  state.explain = { agentId, loading: true, text: '' };
  render();
  try {
    const r = await post('/api/summary', { agentId });
    const j = await r.json();
    state.explain = { agentId, loading: false, text: j.text || 'No explanation available.' };
  } catch {
    state.explain = { agentId, loading: false, text: 'Couldn’t get an explanation right now.' };
  }
  render();
}

function showEvent(id) {
  const e = state.events.find((x) => x.id === id);
  if (!e?.agentId) return;
  const inTree = Array.isArray(e.steps) && e.pid != null;
  go({ view: 'agent', agentId: e.agentId, tab: inTree ? 'processes' : e.kind === 'file' ? 'files' : e.kind === 'network' ? 'network' : 'activity',
    sel: inTree ? `p${e.pid}` : e.kind === 'file' && e.path ? `f${e.path}` : e.kind === 'network' && e.host ? `h${e.host}` : `e${e.id}` });
}

function toast(text, ms = 5000) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

async function markNormal(eventId) {
  const r = await post('/api/baseline', { eventId });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Could not save that'); return; }
  state.baselines = j.baselines || state.baselines;
  toast('Saved. Harness will treat that as normal in this project. It stays in the log.');
  render();
}

async function unmarkNormal(id) {
  const r = await post('/api/baseline', { action: 'remove', id });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Could not remove that'); return; }
  state.baselines = j.baselines || [];
  toast('Removed. Those actions count toward the score again.');
  render();
}

async function runDemo() {
  if (state.demoRunning) return;
  state.demoRunning = true;
  state.followDemoSince = Date.now();
  try {
    const r = await fetch('/api/demo/run', { method: 'POST' });
    if (!r.ok) { toast((await r.json()).error ?? 'Could not start the demo'); state.followDemoSince = 0; }
    else toast('A pretend agent was asked to set up a project.');
  } catch {
    toast('Could not start the demo');
    state.followDemoSince = 0;
  }
  setTimeout(() => { state.demoRunning = false; }, 15000);
}

function setCommands(on) {
  state.showCommands = on;
  document.documentElement.classList.toggle('show-commands', on);
  localSet('commands', on ? '1' : '0');
  render();
}

function setContrast(on) {
  if (on) document.documentElement.dataset.contrast = 'high';
  else delete document.documentElement.dataset.contrast;
  localSet('contrast', on ? '1' : '0');
  render();
}

function setTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  for (const b of document.querySelectorAll('#theme-seg button')) {
    const on = b.dataset.theme === t;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  localSet('theme', t);
}

async function setDisplay(mode) {
  if (!DISPLAYS.includes(mode)) return;
  const prev = state.settings.menuBarDisplay;
  state.settings = { ...state.settings, menuBarDisplay: mode };
  render();
  const r = await post('/api/settings', { menuBarDisplay: mode }).catch(() => null);
  if (!r?.ok) { state.settings = { ...state.settings, menuBarDisplay: prev }; render(); toast('Couldn’t save the menu bar setting'); }
}

function openDashboard() {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke) invoke('open_dashboard').catch(() => {});
  else location.href = '/';
}

function quitApp() {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke) invoke('quit_app').catch(() => {});
  else toast('Quit from the Harness menu bar app.');
}

async function pauseAll() {
  const live = liveAgents().filter((a) => !a.paused);
  if (!live.length) { toast('No agents to pause'); return; }
  for (const a of live) {
    const r = await post('/api/agent', { agentId: a.id, action: 'pause' });
    if (!r.ok) { toast((await r.json().catch(() => ({}))).error ?? 'Could not pause'); return; }
  }
  toast(live.length === 1 ? `${live[0].label} is paused.` : `Paused ${live.length} agents.`);
}

function announce(text) {
  const el = $('#announce');
  el.textContent = '';
  el.textContent = text;
}

/* ---------------- Events ---------------- */

document.addEventListener('click', (e) => {
  const t = e.target;
  const toggle = t.closest('[data-toggle]');
  if (toggle) {
    e.stopPropagation();
    const pid = Number(toggle.dataset.toggle);
    if (state.collapsed.has(pid)) state.collapsed.delete(pid); else state.collapsed.add(pid);
    render();
    return;
  }
  const act = t.closest('[data-act]');
  if (act) { agentAction(act.dataset.act, act.dataset.id, act); return; }
  const row = t.closest('[data-row]');
  if (row) { state.sel = row.dataset.row === state.sel ? null : row.dataset.row; render(); return; }
  const nav = t.closest('[data-nav]');
  if (nav) { go({ view: nav.dataset.nav, agentId: nav.dataset.id ?? null }); return; }
  const tab = t.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; state.sel = null; render(); return; }
  const show = t.closest('[data-show-event]');
  if (show) { showEvent(Number(show.dataset.showEvent)); return; }
  if (t.closest('[data-dismiss]')) {
    state.dismissedAlert = Math.max(state.dismissedAlert, ...state.events.map((x) => x.id));
    render();
    return;
  }
  const ex = t.closest('[data-explain]');
  if (ex) { explain(ex.dataset.explain); return; }
  const base = t.closest('[data-base]');
  if (base) { markNormal(Number(base.dataset.base)); return; }
  const unbase = t.closest('[data-unbase]');
  if (unbase) { unmarkNormal(unbase.dataset.unbase); return; }
  if (t.closest('[data-demo]')) { $('#prefs').close?.(); runDemo(); return; }
  if (t.closest('[data-prefs]')) {
    const d = $('#prefs');
    if (typeof d.showModal === 'function') d.showModal();
  }
});

$('#cmd-toggle').addEventListener('click', () => setCommands(!state.showCommands));
$('#search').addEventListener('input', (e) => { state.search = e.target.value; render(); });

$('#protect-seg').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const prev = state.settings.autoProtect;
  state.settings = { ...state.settings, autoProtect: b.dataset.level };
  renderProtect();
  const r = await post('/api/settings', { autoProtect: b.dataset.level }).catch(() => null);
  if (!r?.ok) { state.settings = { ...state.settings, autoProtect: prev }; renderProtect(); toast('Couldn’t change auto-protect'); }
});
$('#display-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-display]');
  if (b) setDisplay(b.dataset.display);
});
$('#theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (b) setTheme(b.dataset.theme);
});
$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  state.events = [];
  state.dismissedAlert = 0;
  state.sel = null;
  load();
};
$('#prefs-contrast').onclick = () => setContrast(document.documentElement.dataset.contrast !== 'high');
$('#prefs-notify').onclick = async () => {
  if (!('Notification' in window)) { toast('This browser does not show system alerts.'); return; }
  const perm = await Notification.requestPermission();
  toast(perm === 'granted' ? 'Browser alerts are on for Dangerous events.' : 'Browser alerts stay off.');
};
$('#prefs').addEventListener('click', (e) => { if (e.target === $('#prefs')) $('#prefs').close(); });

$('#mp-open').onclick = openDashboard;
$('#mp-quit').onclick = quitApp;
$('#mp-pause').onclick = () => pauseAll();
$('#mp-agents').addEventListener('click', (e) => { if (e.target.closest('[data-open]')) openDashboard(); });

document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (PANEL) {
    if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); openDashboard(); }
    if (meta && e.key.toLowerCase() === 'q') { e.preventDefault(); quitApp(); }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...document.querySelectorAll('#menu-panel [role="menuitem"]')].filter((el) => !el.disabled);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i === -1 ? 0 : next].focus();
    return;
  }
  if ($('#prefs').open) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (e.key === 'Escape') {
    if (typing) { document.activeElement.blur(); return; }
    if (state.sel) { state.sel = null; render(); }
    return;
  }
  if (typing || meta || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
  if (e.key === 'd' || e.key === 'D') { runDemo(); return; }
  if (e.key === 'c' || e.key === 'C') { setCommands(!state.showCommands); return; }
  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) && lastRows.length) {
    const i = lastRows.findIndex((r) => r.key === state.sel);
    const cur = lastRows[i];
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && cur?.node?.kids.length) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') state.collapsed.add(cur.node.pid); else state.collapsed.delete(cur.node.pid);
      render();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = lastRows[Math.max(0, Math.min(lastRows.length - 1, i === -1 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
    state.sel = next.key;
    render();
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-row="${CSS.escape(next.key)}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
});

/* ---------------- Data ---------------- */

async function load() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error(`status ${r.status}`);
    const s = await r.json();
    state.agents = new Map(s.agents.map((a) => [a.id, a]));
    state.events = s.events;
    if (s.settings) state.settings = { ...state.settings, ...s.settings };
    if (s.baselines) state.baselines = s.baselines;
    if (!state.ready) {
      // Don't jump to a pause that happened before this window opened.
      state.autoNavAt = Math.max(0, ...s.agents.map((a) => a.pausedAt ?? 0));
      state.dismissedAlert = 0;
    }
    state.ready = true;
    $('#conn-error').hidden = true;
  } catch {
    $('#conn-error').hidden = false;
    $('#live').classList.remove('on');
    $('#live-text').textContent = 'Reconnecting';
  }
  render();
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => {
    state.connected = true;
    $('#live').classList.add('on');
    $('#live').title = 'Live';
    $('#live-text').textContent = 'Live';
    $('#conn-error').hidden = true;
    load();
  };
  es.onerror = () => {
    state.connected = false;
    $('#live').classList.remove('on');
    $('#live').title = 'Reconnecting';
    $('#live-text').textContent = 'Reconnecting';
    if (state.ready) $('#conn-error').hidden = false;
    render();
  };
  es.addEventListener('agent', (m) => {
    const a = JSON.parse(m.data);
    state.agents.set(a.id, { ...state.agents.get(a.id), ...a });
    render();
  });
  es.addEventListener('event', (m) => {
    const e = JSON.parse(m.data);
    const i = state.events.findIndex((x) => x.id === e.id);
    if (i >= 0) state.events[i] = e;
    else {
      state.events.push(e);
      if (e.risk === 'critical' && !e.baseline) announce(`Dangerous. ${e.title}`);
    }
    if (state.events.length > 5000) state.events.splice(0, state.events.length - 4500);
    render();
  });
  es.addEventListener('notice', (m) => {
    const n = JSON.parse(m.data);
    toast(n.title, 7000);
    if (window.Notification && Notification.permission === 'granted') {
      try { new Notification('Harness', { body: `${n.title}. ${n.body}` }); } catch {}
    }
  });
  es.addEventListener('reset', () => { state.events = []; state.sel = null; render(); });
  es.addEventListener('settings', (m) => { state.settings = { ...state.settings, ...JSON.parse(m.data) }; render(); });
  es.addEventListener('demo', (m) => {
    const d = JSON.parse(m.data);
    toast(d.cutOff
      ? `Harness cut the upload off. The pretend attacker only got ${d.bytes} bytes.`
      : `The pretend attacker received ${d.bytes} bytes.`, 7000);
  });
}

await loadIcons();
setTheme(localGet('theme') || 'system');
if (!PANEL) mountPug($('#pug'));
connect();
setInterval(render, 10000);
