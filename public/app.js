// Harness dashboard. Plain JS, live updates over Server-Sent Events.
import { computeScore } from './score.js';
import { canBaseline } from './baseline.js';

const $ = (s) => document.querySelector(s);
const PANEL = document.documentElement.classList.contains('panel');
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const LEVEL = { info: 'Routine', low: 'Note', medium: 'Worth a look', high: 'Risky', critical: 'Dangerous' };
const ICON = { process: 'terminal', network: 'globe', file: 'file-text', tool: 'wrench', task: 'message-square', system: 'eye' };
const GUARD_ICON = { paused: 'circle-pause', resumed: 'play', ended: 'octagon-x' };
const GUARD_TONE = { paused: 'pause', resumed: 'ok', ended: 'bad' };
const RISK_TONE = { info: '', low: 'note', medium: 'warn', high: 'bad', critical: 'bad' };
const DISPLAYS = [
  { id: 'score', label: 'Score' },
  { id: 'icon', label: 'Icon only' },
  { id: 'agents', label: 'Agent count' },
  { id: 'alerts', label: 'Alert count' },
];
const PROTECT = {
  off: { word: 'Off', icon: 'shield-off', desc: 'Harness only watches and warns. Agents keep running even when they do something dangerous.' },
  dangerous: { word: 'On', icon: 'shield-check', desc: 'Pauses a session as soon as it does something dangerous, like opening your secrets or wiping files. You decide whether it continues.' },
  risky: { word: 'Strict', icon: 'shield-alert', desc: 'Pauses a session on anything risky, including uploads to unknown servers and background changes. Expect more interruptions.' },
};
const MOD = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#${name}"/></svg>`;

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

function setList(el, items, emptyHTML) {
  if (!items.length) { setHTML(el, emptyHTML); return; }
  if (el.__html !== undefined) { el.__html = undefined; el.innerHTML = ''; }
  const old = new Map([...el.children].map((c) => [c.dataset.key, c]));
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
  dismissedAlert: 0,
  settings: { autoProtect: 'dangerous', menuBarDisplay: 'score' },
  feedSeen: 0,
  ready: false,
  connected: false,
  baselines: [],
  demoRunning: false,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byUs = (who) => who === 'harness' || who === 'lookout' || who === 'seatbelt';

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
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const sentence = (r) => (/^(this|happened)\b/.test(r) ? r[0].toUpperCase() + r.slice(1) : `It ${r}`);
const eventsOf = (id) => state.events.filter((e) => e.agentId === id);
const liveAgents = () => [...state.agents.values()].filter((a) => a.alive);

const HEADLINE = {
  clear: 'All good',
  steady: 'All good, a few notes',
  review: 'Worth a look',
  act: 'Needs your attention',
};

function renderScore() {
  const num = $('#score-num');
  const word = $('#score-level');
  if (!state.ready) {
    num.textContent = '--';
    word.className = 'level-word';
    word.textContent = 'Loading';
    $('#score-blurb').textContent = 'Getting the latest activity.';
    $('#meter-fill').style.width = '0%';
    return;
  }
  const s = computeScore(state.events);
  num.textContent = s.score;
  $('#meter-fill').style.width = `${s.score}%`;
  $('#meter-fill').className = `meter-fill ${s.level.cls}`;
  word.className = `level-word ${s.level.cls}`;
  word.textContent = HEADLINE[s.level.cls] ?? s.level.name;
  $('#score-blurb').textContent = s.level.blurb;
  $('#score-live').setAttribute('aria-label', `${s.score} out of 100. ${s.level.blurb}`);
}

function renderProtect() {
  const lvl = state.settings.autoProtect ?? 'off';
  const p = PROTECT[lvl] ?? PROTECT.off;
  $('#protect').dataset.level = lvl;
  $('#protect-state').textContent = p.word;
  $('#protect-icon').setAttribute('href', `#${p.icon}`);
  $('#protect-desc').textContent = p.desc;
  for (const b of document.querySelectorAll('#protect-seg button')) {
    const on = b.dataset.level === lvl;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

function sessionState(a) {
  if (a.alive && a.paused) return { cls: 'paused', text: byUs(a.pausedBy) ? 'Paused by Harness' : 'Paused by you' };
  if (!a.alive && a.endedBy) return { cls: 'ended', text: byUs(a.endedBy) ? 'Ended by Harness' : 'Ended by you' };
  if (!a.alive) return { cls: 'done', text: 'Finished' };
  const recent = Date.now() - (a.lastActive ?? 0) < 15000;
  return { cls: recent ? 'working' : 'idle', text: recent ? 'Working' : 'Idle' };
}

function lastAction(a) {
  const e = [...eventsOf(a.id)].reverse().find((x) => x.kind !== 'system' && x.kind !== 'task');
  return e ? `${e.title} · ${ago(e.ts)}` : 'No activity yet';
}

const BRAND_KINDS = new Set(['claude', 'codex', 'gemini', 'cursor', 'copilot', 'opencode', 'amp']);
function agentLogo(a) {
  return BRAND_KINDS.has(a.kind)
    ? `<svg class="brand" aria-hidden="true"><use href="#brand-${a.kind}"/></svg>`
    : icon('bot');
}

function sessionCard(a) {
  const st = sessionState(a);
  return `
    <article class="session ${st.cls}" data-id="${esc(a.id)}">
      <header class="s-head">
        <div class="avatar" title="${esc(a.label)}">${agentLogo(a)}</div>
        <div class="s-id">
          <div class="s-name">${esc(a.label)}</div>
          <div class="s-proj" title="${esc(a.cwd || a.project)}">${a.project ? `in ${esc(a.project)}` : ''}</div>
        </div>
        <div class="s-status"><span class="state-dot ${st.cls}"></span><b>${st.text}</b></div>
        ${a.alive && !a.paused ? `<div class="s-buttons">
          <button class="btn ghost small" data-act="pause" data-id="${esc(a.id)}" title="Freeze this agent and everything it started">Pause</button>
          ${endButton(a, 'ghost small end', 'Stop')}
        </div>` : ''}
        ${a.alive && a.paused ? `<div class="s-buttons">
          <button class="btn small" data-act="resume" data-id="${esc(a.id)}">Let it continue</button>
          ${endButton(a, 'ghost small end', 'Stop')}
        </div>` : ''}
      </header>
    </article>`;
}

function endButton(a, cls, label) {
  const on = state.confirmEnd === a.id;
  return `<button class="btn ${cls}${on ? ' confirming' : ''}" data-act="end" data-id="${esc(a.id)}" title="Stops ${esc(a.label)} and every program it started">${on ? 'Click again to stop' : label}</button>`;
}

function renderAgents() {
  const active = [...state.agents.values()].filter((a) => a.alive)
    .sort((a, b) => (b.paused - a.paused) || ((b.lastActive ?? 0) - (a.lastActive ?? 0)));
  setList($('#agents'), active.map((a) => [a.id, sessionCard(a)]),
    '<p class="empty"><strong>No agents running</strong>Open Claude Code or Codex and Harness picks it up on its own.<br/><button type="button" class="btn small" data-demo>Try a demo</button></p>');
}

function isNotable(e) {
  if (e.guard) return true;
  if (RANK[e.risk] >= 1) return true;
  if (e.kind === 'task' || e.agentReported) return true;
  if (e.kind === 'file' && e.batch) return true;
  if (e.kind === 'network' && !e.isAgentItself && !e.trusted) return true;
  if (e.baseline) return true;
  return false;
}

function feedItem(e) {
  const a = state.agents.get(e.agentId);
  const ic = e.guard ? GUARD_ICON[e.guard] : e.bait ? 'key-round' : ICON[e.kind] ?? 'info';
  const reasons = (e.reasons ?? []).filter(Boolean);
  return `
    <li class="item ${esc(e.risk)} ${e.guard ? 'guard ' + esc(e.guard) : ''}">
      <div class="tile ${e.guard ? GUARD_TONE[e.guard] : RISK_TONE[e.risk] ?? ''}">${icon(ic)}</div>
      <div>
        <div class="title">${esc(e.title)}</div>
        ${reasons.length ? `<div class="why">${reasons.length === 1 ? `${esc(sentence(reasons[0]))}.` : `<ul>${reasons.map((r) => `<li>${esc(sentence(r))}</li>`).join('')}</ul>`}</div>` : ''}
        ${e.guard && e.detail ? `<div class="why">${esc(e.detail)}</div>` : ''}
        ${e.command && (RANK[e.risk] >= 1 || e.agentReported || e.baseline) ? `<div class="cmd mono" title="${esc(e.command)}">${esc(e.command)}</div>` : ''}
        ${e.kind === 'file' && e.batch && e.detail ? `<div class="why mono">${esc(e.detail)}</div>` : ''}
        ${canBaseline(e) ? `<div class="item-actions"><button type="button" class="link" data-base="${e.id}">Normal for this project</button></div>` : ''}
      </div>
      <div class="when">
        ${RANK[e.risk] >= 1 ? `<span class="badge ${esc(e.risk)}">${LEVEL[e.risk]}</span>` : ''}
        <span title="${new Date(e.ts).toLocaleString()}">${ago(e.ts)}</span>
        ${a ? `<span class="who">${esc(a.label)} · ${esc(a.project)}</span>` : ''}
      </div>
    </li>`;
}

function filtered() {
  return state.events;
}

function renderFeed() {
  const evs = filtered().filter(isNotable).slice(-50).reverse();
  setList($('#feed'), evs.map((e) => [String(e.id), feedItem(e)]), '');
  $('#feed-empty').hidden = evs.length > 0;
  $('#feed-empty').textContent = state.ready ? 'Nothing needs your attention. Risky actions show up here.' : 'Connecting…';
}

function renderAlert() {
  const el = $('#alert');
  const paused = liveAgents().filter((a) => a.paused && byUs(a.pausedBy));
  if (paused.length) {
    const a = paused[0];
    el.className = 'alert protected';
    el.hidden = false;
    setHTML(el, `
      <span class="tile pause">${icon('shield-check')}</span>
      <div>
        <h3>Harness paused ${esc(a.label)} in ${esc(a.project)}</h3>
        ${a.pausedReason ? `<p>It ${esc(a.pausedReason)}. The agent and everything it started are frozen until you choose what happens next.</p>` : ''}
        ${paused.length > 1 ? `<div class="meta">${paused.length - 1} more session${paused.length > 2 ? 's are' : ' is'} paused.</div>` : ''}
      </div>
      <div class="alert-actions">
        ${endButton(a, 'danger small', 'Stop it')}
        <button class="btn small" data-act="resume" data-id="${esc(a.id)}">Let it continue</button>
      </div>`);
    return;
  }
  const recent = state.events.filter((e) => RANK[e.risk] >= 3 && e.id > state.dismissedAlert && Date.now() - e.ts < 15 * 60 * 1000);
  if (!recent.length) { el.hidden = true; return; }
  const top = recent.reduce((best, e) => (RANK[e.risk] > RANK[best.risk] || (RANK[e.risk] === RANK[best.risk] && e.id > best.id) ? e : best));
  const a = state.agents.get(top.agentId);
  el.className = `alert ${top.risk}`;
  el.hidden = false;
  setHTML(el, `
    <span class="tile bad">${icon(top.risk === 'critical' ? 'octagon-alert' : 'triangle-alert')}</span>
    <div>
      <h3>${esc(top.title)}</h3>
      ${top.reasons?.length ? `<ul>${top.reasons.map((r) => `<li>${esc(sentence(r))}.</li>`).join('')}</ul>` : ''}
      ${a?.task ? `<div class="meta">You asked it to “${esc(a.task)}”. Does this look like part of that job?</div>` : ''}
      ${recent.length > 1 ? `<div class="meta">${recent.length - 1} more risky moment${recent.length > 2 ? 's' : ''} in the last 15 minutes.</div>` : ''}
    </div>
    <div class="alert-actions">
      ${a?.alive && !a.paused ? endButton(a, 'danger small', 'Stop it') : ''}
      <button class="btn ghost small" id="dismiss">Got it</button>
    </div>`);
  $('#dismiss').onclick = () => { state.dismissedAlert = Math.max(...recent.map((e) => e.id)); renderAlert(); };
}

function markDisplay(root, mode) {
  if (!root) return;
  for (const b of root.querySelectorAll('[data-display]')) {
    const on = b.dataset.display === mode;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  }
}

function renderPrefs() {
  const mode = state.settings.menuBarDisplay ?? 'score';
  markDisplay($('#display-seg'), mode);
  const on = document.documentElement.dataset.contrast === 'high';
  {
    const b = $('#prefs-contrast');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
  }
  const list = $('#baseline-list');
  if (!list) return;
  if (!state.baselines.length) {
    list.innerHTML = '<li class="hint">Nothing is marked as normal yet.</li>';
    return;
  }
  list.innerHTML = state.baselines.map((b) => `
    <li>
      <span><b>${esc(b.project || 'Project')}</b> · ${esc(b.type === 'host' ? b.value : b.value)}</span>
      <button type="button" class="link" data-unbase="${esc(b.id)}">Remove</button>
    </li>`).join('');
}

function renderPanel() {
  const s = state.ready ? computeScore(state.events) : null;
  $('#mp-score').textContent = s ? String(s.score) : '--';
  const level = $('#mp-level');
  level.className = `mp-level ${s ? s.level.cls : ''}`;
  level.textContent = s ? (HEADLINE[s.level.cls] ?? s.level.name) : 'Loading';
  const offline = !state.ready && $('#conn-error') && !$('#conn-error').hidden;
  let blurb = s ? s.level.blurb : offline ? 'Can’t reach Harness. Trying again.' : 'Getting the latest activity.';
  if (s && !state.connected) blurb = 'Reconnecting. This may be a few seconds behind.';
  $('#mp-blurb').textContent = blurb;

  const active = liveAgents().sort((a, b) => (b.paused - a.paused) || ((b.lastActive ?? 0) - (a.lastActive ?? 0)));
  $('#mp-agent-count').textContent = String(active.length);
  if (!active.length) {
    setHTML($('#mp-agents'), '<div class="mp-empty">No agents running</div>');
  } else {
    setList($('#mp-agents'), active.map((a) => {
      const st = sessionState(a);
      const html = `<button type="button" class="mp-agent" role="menuitem" data-open title="${esc(a.cwd || a.project)}">
        <span class="mp-dot ${st.cls}"></span>
        <span class="mp-agent-name">${esc(a.label)}</span>
        <span class="mp-agent-proj">${esc(a.project)}</span>
        <span class="mp-agent-state">${esc(st.text.replace('Paused by Harness', 'Paused').replace('Paused by you', 'Paused'))}</span>
      </button>`;
      return [a.id, html];
    }), '');
  }

  const canPause = active.some((a) => !a.paused);
  const pause = $('#mp-pause');
  pause.disabled = !canPause;
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
    const h = Math.ceil($('#menu-panel').offsetHeight);
    invoke('resize_panel', { height: h }).catch(() => {});
  });
}

let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (PANEL) { renderPanel(); return; }
    renderAlert();
    renderScore();
    renderProtect();
    renderAgents();
    renderPrefs();
    renderFeed();
  });
}

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
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId, action }) });
    const j = await r.json();
    if (!r.ok) toast(j.error ?? 'That didn’t work');
    else toast({ pause: `${a?.label ?? 'Session'} is paused.`, resume: `${a?.label ?? 'Session'} is running again.`, end: `${a?.label ?? 'Session'} was ended.` }[action]);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function toast(text, ms = 5000) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

async function setDisplay(mode) {
  if (!DISPLAYS.some((d) => d.id === mode)) return;
  const prev = state.settings.menuBarDisplay;
  state.settings = { ...state.settings, menuBarDisplay: mode };
  render();
  try {
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ menuBarDisplay: mode }) });
    if (!r.ok) throw new Error('save failed');
  } catch {
    state.settings = { ...state.settings, menuBarDisplay: prev };
    render();
    toast('Couldn’t save the menu bar setting');
  }
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
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: a.id, action: 'pause' }) });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error ?? 'Could not pause');
      return;
    }
  }
  toast(live.length === 1 ? `${live[0].label} is paused.` : `Paused ${live.length} agents.`);
}

function setContrast(on) {
  if (on) document.documentElement.dataset.contrast = 'high';
  else delete document.documentElement.dataset.contrast;
  localSet('contrast', on ? '1' : '0');
  render();
}

function announce(text) {
  const el = $('#announce');
  if (!el) return;
  el.textContent = '';
  el.textContent = text;
}

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) { e.stopPropagation(); agentAction(act.dataset.act, act.dataset.id, act); return; }
  const base = e.target.closest('[data-base]');
  if (base) { e.stopPropagation(); markNormal(+base.dataset.base); return; }
  const unbase = e.target.closest('[data-unbase]');
  if (unbase) { e.stopPropagation(); unmarkNormal(unbase.dataset.unbase); return; }
});

async function markNormal(eventId) {
  const r = await fetch('/api/baseline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Could not save that'); return; }
  state.baselines = j.baselines || state.baselines;
  toast('Saved. Harness will treat that as normal in this project. It stays in the log.');
  render();
}

async function unmarkNormal(id) {
  const r = await fetch('/api/baseline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', id }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Could not remove that'); return; }
  state.baselines = j.baselines || [];
  toast('Removed. Those actions count toward the score again.');
  render();
}

$('#protect-seg').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const prev = state.settings.autoProtect;
  state.settings = { ...state.settings, autoProtect: b.dataset.level };
  renderProtect();
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoProtect: b.dataset.level }) });
  if (!r.ok) { state.settings = { ...state.settings, autoProtect: prev }; renderProtect(); toast('Couldn’t change auto-protect'); }
});

$('#display-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-display]');
  if (b) setDisplay(b.dataset.display);
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-demo]')) { $('#prefs').close?.(); runDemo(); }
});
async function runDemo() {
  if (state.demoRunning) return;
  state.demoRunning = true;
  try {
    const r = await fetch('/api/demo/run', { method: 'POST' });
    if (!r.ok) toast((await r.json()).error ?? 'Could not start the demo');
    else toast('A pretend agent was asked to set up this project.');
  } catch {
    toast('Could not start the demo');
  }
  setTimeout(() => { state.demoRunning = false; }, 15000);
}

$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  state.events = [];
  state.dismissedAlert = 0;
  load();
};


$('#prefs-contrast').onclick = () => setContrast(document.documentElement.dataset.contrast !== 'high');
$('#prefs-notify').onclick = async () => {
  if (!('Notification' in window)) { toast('This browser does not show system alerts.'); return; }
  const perm = await Notification.requestPermission();
  toast(perm === 'granted' ? 'Browser alerts are on for Dangerous events.' : 'Browser alerts stay off.');
};
$('#prefs-open').onclick = () => {
  const d = $('#prefs');
  if (typeof d.showModal === 'function') d.showModal();
  d.querySelector('[aria-checked="true"]')?.focus();
};
$('#prefs').addEventListener('click', (e) => { if (e.target === $('#prefs')) $('#prefs').close(); });

$('#mp-open').onclick = openDashboard;
$('#mp-quit').onclick = quitApp;
$('#mp-pause').onclick = () => pauseAll();
$('#mp-agents').addEventListener('click', (e) => { if (e.target.closest('[data-open]')) openDashboard(); });

document.addEventListener('keydown', (e) => {
  if (!PANEL) return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); openDashboard(); }
  if (meta && e.key.toLowerCase() === 'q') { e.preventDefault(); quitApp(); }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...document.querySelectorAll('#menu-panel [role="menuitem"], #menu-panel [role="menuitemradio"]')].filter((el) => !el.disabled);
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement);
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[i === -1 ? 0 : next].focus();
});

async function load() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error(`status ${r.status}`);
    const s = await r.json();
    state.agents = new Map(s.agents.map((a) => [a.id, a]));
    state.events = s.events;
    if (s.settings) state.settings = { ...state.settings, ...s.settings };
    if (s.baselines) state.baselines = s.baselines;
    state.ready = true;
    $('#conn-error').hidden = true;
    render();
  } catch {
    $('#conn-error').hidden = false;
    $('#live').classList.remove('on');
    $('#live-text').textContent = 'Reconnecting';
    render();
  }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => {
    state.connected = true;
    $('#live').classList.add('on');
    $('#live-text').textContent = 'Live';
    $('#conn-error').hidden = true;
    load();
  };
  es.onerror = () => {
    state.connected = false;
    $('#live').classList.remove('on');
    $('#live-text').textContent = 'Reconnecting';
    if (state.ready) $('#conn-error').hidden = false;
    if (PANEL) render();
  };
  es.addEventListener('agent', (m) => {
    const a = JSON.parse(m.data);
    state.agents.set(a.id, a);
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
  es.addEventListener('reset', () => { state.events = []; render(); });
  es.addEventListener('settings', (m) => { state.settings = { ...state.settings, ...JSON.parse(m.data) }; render(); });
  es.addEventListener('demo', (m) => {
    const d = JSON.parse(m.data);
    toast(d.cutOff
      ? `Harness cut the upload off. The pretend attacker only got ${d.bytes} bytes.`
      : `The pretend attacker received ${d.bytes} bytes.`, 7000);
  });
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
$('#theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (b) setTheme(b.dataset.theme);
});

await loadIcons();
setTheme(localGet('theme') || 'system');
connect();
setInterval(render, 10000);

if (PANEL) {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  const btn = $('#open-dash');
  btn.hidden = !invoke;
  btn.addEventListener('click', openDashboard);
}
