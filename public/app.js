// Seatbelt dashboard: plain JS, live updates over Server-Sent Events.
import { computeScore, factorsFor, BANDS, MIN, MAX } from './score.js';

const $ = (s) => document.querySelector(s);
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const LEVEL = { info: 'Routine', low: 'Note', medium: 'Worth a look', high: 'Risky', critical: 'Dangerous' };
const ICON = { process: 'terminal', network: 'globe', file: 'file-text', tool: 'wrench', task: 'message-square', system: 'eye' };
const GUARD_ICON = { paused: 'circle-pause', resumed: 'play', ended: 'octagon-x' };
const GUARD_TONE = { paused: 'pause', resumed: 'ok', ended: 'bad' };
const RISK_TONE = { info: '', low: 'note', medium: 'warn', high: 'bad', critical: 'bad' };
const PROTECT = {
  off: { word: 'Off', icon: 'shield-off', desc: 'Seatbelt only watches and warns. Agents keep running even when they do something dangerous.' },
  dangerous: { word: 'On', icon: 'shield-check', desc: 'Pauses a session as soon as it does something dangerous, like opening your secrets or wiping files. You decide whether it continues.' },
  risky: { word: 'Strict', icon: 'shield-alert', desc: 'Pauses a session on anything risky, including uploads to unknown servers and background changes. Expect more interruptions.' },
};

/** A Lucide icon from the /icons.svg sprite. */
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/icons.svg#${name}"/></svg>`;

const state = {
  agents: new Map(),
  events: [],
  view: 'simple',
  selected: null,
  factor: null,
  showRoutine: false,
  dismissedAlert: 0,
  settings: { autoProtect: 'dangerous' },
  shownScore: null,
  feedSeen: 0, // highest event id already shown in the feed; only newer ones animate in
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Reasons are written to follow "It …"; a few already start their own sentence. */
const sentence = (r) => (/^(this|happened)\b/.test(r) ? r[0].toUpperCase() + r.slice(1) : `It ${r}`);

const eventsOf = (id) => state.events.filter((e) => e.agentId === id);

// ---------- Score ----------
const pct = (score) => ((score - MIN) / (MAX - MIN)) * 100;

function drawScale() {
  const bands = [...BANDS].reverse(); // low to high
  $('#scale-bar').innerHTML = bands.map((b, i) => {
    const hi = bands[i + 1]?.min ?? MAX;
    return `<span class="${b.cls}" style="width:${pct(hi) - pct(b.min)}%"></span>`;
  }).join('');
  $('#scale-labels').innerHTML = bands.map((b, i) => {
    const hi = bands[i + 1]?.min ?? MAX;
    return `<span style="width:${pct(hi) - pct(b.min)}%"><b>${b.min}</b></span>`;
  }).join('');
}

function animateScore(target) {
  const from = state.shownScore ?? target;
  state.shownScore = target;
  $('#scale-marker').style.left = `${pct(target)}%`;
  const start = performance.now();
  const dur = from === target ? 0 : 700;
  const step = (now) => {
    const t = dur ? Math.min(1, (now - start) / dur) : 1;
    $('#score-num').textContent = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderScore() {
  const s = computeScore(state.events);
  if (s.score !== state.shownScore) animateScore(s.score);
  const word = $('#score-band');
  word.className = `band-word ${s.band.cls}`;
  word.textContent = s.band.name;
  $('#scale-marker').className = `scale-marker ${s.band.cls}`;
  $('#score-blurb').textContent = s.band.blurb;
  const sessions = new Set(state.events.filter((e) => e.kind !== 'system').map((e) => e.agentId)).size;
  $('#score-basis').textContent = s.counted
    ? `${s.counted} action${s.counted === 1 ? '' : 's'} from ${sessions} session${sessions === 1 ? '' : 's'} since ${new Date(s.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Points come back over about a day.`
    : 'No agent activity yet. Every score starts at 850.';

  $('#factors').innerHTML = s.factors.map((f) => {
    const bad = f.lost > 0;
    const sev = f.lost >= 100 ? 'bad' : f.lost >= 25 ? 'warn' : bad ? 'note' : 'ok';
    return `
      <li>
        <button class="factor ${sev} ${state.factor === f.id ? 'on' : ''}" data-factor="${f.id}" ${bad ? '' : 'disabled'}>
          <span class="tile ${sev}">${icon(f.icon)}</span>
          <span class="f-text">
            <span class="f-name">${esc(f.name)}</span>
            <span class="f-desc">${esc(f.desc)}</span>
          </span>
          <span class="f-impact">${esc(f.impact)}</span>
          <span class="f-result">
            ${bad
              ? `<span class="f-pts">−${f.lost}</span><span class="f-count">${f.count} event${f.count === 1 ? '' : 's'}</span>`
              : `<span class="f-ok">${icon('check')} None</span>`}
          </span>
        </button>
      </li>`;
  }).join('');
  $('#factor-clear').hidden = !state.factor;
}

// ---------- Auto-protect ----------
function renderProtect() {
  const lvl = state.settings.autoProtect ?? 'off';
  const p = PROTECT[lvl];
  $('#protect').dataset.level = lvl;
  $('#protect-state').textContent = p.word;
  $('#protect-icon').setAttribute('href', `/icons.svg#${p.icon}`);
  $('#protect-desc').textContent = p.desc;
  for (const b of document.querySelectorAll('#protect-seg button')) {
    b.classList.toggle('on', b.dataset.level === lvl);
    b.setAttribute('aria-checked', String(b.dataset.level === lvl));
  }
}

// ---------- Sessions ----------
function sessionState(a) {
  if (a.alive && a.paused) return { cls: 'paused', text: a.pausedBy === 'seatbelt' ? 'Paused by Seatbelt' : 'Paused by you' };
  if (!a.alive && a.endedBy) return { cls: 'ended', text: a.endedBy === 'seatbelt' ? 'Ended by Seatbelt' : 'Ended by you' };
  if (!a.alive) return { cls: 'done', text: 'Finished' };
  const recent = Date.now() - (a.lastActive ?? 0) < 15000;
  return { cls: recent ? 'working' : 'idle', text: recent ? 'Working' : 'Idle' };
}

function lastAction(a) {
  const e = [...eventsOf(a.id)].reverse().find((x) => x.kind !== 'system' && x.kind !== 'task');
  return e ? `${e.title} · ${ago(e.ts)}` : 'No activity yet';
}

const BRAND_KINDS = new Set(['claude', 'codex', 'gemini', 'cursor', 'copilot', 'opencode', 'amp']);

/** The agent's logo, or a generic bot icon for the demo and anything unknown. */
function agentLogo(a) {
  return BRAND_KINDS.has(a.kind)
    ? `<svg class="brand" aria-hidden="true"><use href="/icons.svg#brand-${a.kind}"/></svg>`
    : icon('bot');
}

function sessionCard(a) {
  const st = sessionState(a);
  const sc = computeScore(eventsOf(a.id));
  const trigger = a.pausedEventId && state.events.find((e) => e.id === a.pausedEventId);
  const worst = sc.factors.filter((f) => f.lost).sort((x, y) => y.lost - x.lost)[0];
  return `
    <article class="session ${st.cls} band-${sc.band.cls} ${state.selected === a.id ? 'selected' : ''}" data-id="${esc(a.id)}" tabindex="0">
      <header class="s-head">
        <div class="avatar" title="${esc(a.label)}">${agentLogo(a)}</div>
        <div class="s-id">
          <div class="s-name">${esc(a.label)}</div>
          <div class="s-proj" title="${esc(a.cwd)}">in ${esc(a.project)}${a.startedAt ? ` · started ${ago(a.startedAt)}` : ''}</div>
        </div>
        <div class="s-score ${sc.band.cls}" title="This session's safety score">
          <b>${sc.score}</b><span>${sc.band.name}</span>
        </div>
      </header>

      <div class="s-status"><span class="state-dot ${st.cls}"></span><b>${st.text}</b><span class="s-last">${esc(lastAction(a))}</span></div>

      ${a.paused ? `
        <div class="s-callout">
          <div class="s-callout-title">${icon('circle-pause')} ${a.pausedBy === 'seatbelt' ? 'Paused by Seatbelt' : 'Paused'}</div>
          ${a.pausedReason ? `<div class="s-callout-why">It ${esc(a.pausedReason)}.</div>` : ''}
          ${trigger?.command ? `<div class="cmd mono">${esc(trigger.command)}</div>` : ''}
          ${a.task ? `<div class="s-callout-ask">You asked it to “${esc(a.task)}”. Does this look like part of that job?</div>` : ''}
          <div class="s-actions">
            <button class="btn danger small" data-act="end" data-id="${esc(a.id)}">End session</button>
            <button class="btn small" data-act="resume" data-id="${esc(a.id)}">Let it continue</button>
          </div>
        </div>`
      : a.task ? `<div class="task"><span>Request</span> ${esc(a.task)}</div>` : ''}

      ${!a.paused && worst ? `<div class="s-worst">${icon(worst.icon)} <span>Main concern: <b>${esc(worst.name)}</b>, −${worst.lost}</span></div>` : ''}

      <footer class="s-foot">
        <div class="counts">
          <span><b>${a.counts.commands}</b> action${a.counts.commands === 1 ? '' : 's'}</span>
          <span><b>${a.counts.files}</b> file${a.counts.files === 1 ? '' : 's'}</span>
          <span><b>${a.counts.network}</b> connection${a.counts.network === 1 ? '' : 's'}</span>
        </div>
        <div class="s-buttons">
          ${a.alive && !a.paused ? `<button class="btn ghost small" data-act="pause" data-id="${esc(a.id)}" title="Freeze this agent and everything it started">Pause</button>` : ''}
          <button class="btn ghost small" data-act="explain" data-id="${esc(a.id)}">Explain</button>
        </div>
      </footer>
    </article>`;
}

function earlierRow(a) {
  const st = sessionState(a);
  const sc = computeScore(eventsOf(a.id));
  return `
    <button class="earlier-row ${state.selected === a.id ? 'selected' : ''}" data-id="${esc(a.id)}">
      <span class="avatar sm">${agentLogo(a)}</span>
      <span class="e-name"><b>${esc(a.label)}</b> in ${esc(a.project)}</span>
      <span class="e-state ${st.cls}">${st.text}</span>
      <span class="s-score sm ${sc.band.cls}"><b>${sc.score}</b></span>
    </button>`;
}

function renderAgents() {
  const all = [...state.agents.values()].filter((a) => a.alive || a.counts.commands > 0 || a.counts.alerts > 0);
  const byRecent = (a, b) => (b.paused - a.paused) || (b.counts.alerts - a.counts.alerts) || ((b.lastActive ?? 0) - (a.lastActive ?? 0));
  const active = all.filter((a) => a.alive).sort(byRecent);
  const earlier = all.filter((a) => !a.alive).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  $('#active-count').textContent = active.length;
  $('#agents').innerHTML = active.length
    ? active.map(sessionCard).join('')
    : '<p class="empty">No AI agents running right now. Open Claude Code or Codex and Seatbelt will pick it up automatically.</p>';
  $('#earlier').hidden = !earlier.length;
  $('#earlier-count').textContent = earlier.length;
  $('#earlier-list').innerHTML = earlier.map(earlierRow).join('');
  $('#agent-hint').textContent = state.selected ? 'Showing one session. Click it again to show all' : 'Click a session to see only its activity';
}

// ---------- Feed ----------
function isNotable(e) {
  if (state.factor) return true;
  if (state.showRoutine) return true;
  if (e.guard) return true;
  if (RANK[e.risk] >= 1) return true;
  if (e.kind === 'task' || e.agentReported) return true;
  if (e.kind === 'file' && e.batch) return true;
  if (e.kind === 'network' && !e.isAgentItself && !e.trusted) return true;
  return false;
}

function feedItem(e) {
  const a = state.agents.get(e.agentId);
  const ic = e.guard ? GUARD_ICON[e.guard] : e.bait ? 'key-round' : ICON[e.kind] ?? 'info';
  const reasons = (e.reasons ?? []).filter(Boolean);
  const tags = factorsFor(e).map((f) => `<span class="ftag">${icon(f.icon)}${esc(f.name)}</span>`).join('');
  return `
    <li class="item ${esc(e.risk)} ${e.guard ? 'guard ' + esc(e.guard) : ''} ${e.id > state.feedSeen ? 'new' : ''}">
      <div class="tile ${e.guard ? GUARD_TONE[e.guard] : RISK_TONE[e.risk] ?? ''}">${icon(ic)}</div>
      <div>
        <div class="title">${esc(e.title)}</div>
        ${reasons.length ? `<div class="why">${reasons.length === 1 ? `${esc(sentence(reasons[0]))}.` : `<ul>${reasons.map((r) => `<li>${esc(sentence(r))}</li>`).join('')}</ul>`}</div>` : ''}
        ${e.guard && e.detail ? `<div class="why">${esc(e.detail)}</div>` : ''}
        ${e.command && (RANK[e.risk] >= 1 || e.agentReported) ? `<div class="cmd mono">${esc(e.command)}</div>` : ''}
        ${e.kind === 'file' && e.batch && e.detail ? `<div class="why mono">${esc(e.detail)}</div>` : ''}
        ${tags ? `<div class="ftags">${tags}</div>` : ''}
      </div>
      <div class="when">
        ${RANK[e.risk] >= 1 ? `<span class="badge ${esc(e.risk)}">${LEVEL[e.risk]}</span>` : ''}
        <span title="${new Date(e.ts).toLocaleString()}">${ago(e.ts)}</span>
        ${a && !state.selected ? `<span class="who">${esc(a.label)} · ${esc(a.project)}</span>` : ''}
      </div>
    </li>`;
}

function filtered() {
  const ids = state.factor && new Set(computeScore(state.events).factors.find((f) => f.id === state.factor)?.events ?? []);
  return state.events
    .filter((e) => !state.selected || e.agentId === state.selected)
    .filter((e) => !ids || ids.has(e.id));
}

function renderFeed() {
  const evs = filtered().filter(isNotable).slice(-200).reverse();
  $('#feed').innerHTML = evs.map(feedItem).join('');
  state.feedSeen = Math.max(state.feedSeen, ...evs.map((e) => e.id));
  $('#feed-empty').hidden = evs.length > 0;
  const a = state.selected && state.agents.get(state.selected);
  const f = state.factor && computeScore([]).factors.find((x) => x.id === state.factor);
  $('#feed-title').textContent = f ? `${f.name}` : a ? `${a.label} in ${a.project}` : 'Activity';
}

function renderTable() {
  const q = $('#q').value.toLowerCase();
  const minRisk = +$('#risk-filter').value;
  const kind = $('#kind-filter').value;
  const evs = filtered()
    .filter((e) => (RANK[e.risk] ?? 0) >= minRisk && (!kind || e.kind === kind))
    .filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q))
    .slice(-600)
    .reverse();
  $('#rows').innerHTML = evs.map((e) => {
    const a = state.agents.get(e.agentId);
    return `<tr>
      <td>${new Date(e.ts).toLocaleTimeString()}</td>
      <td>${esc(a ? `${a.label} · ${a.project}` : '—')}</td>
      <td>${esc(e.kind)}</td>
      <td><span class="badge ${esc(e.risk)}">${esc(e.risk)}</span></td>
      <td>${esc(e.title)}${e.reasons?.length ? `<div class="reasons">${e.reasons.map(esc).join(' · ')}</div>` : ''}</td>
      <td class="raw">${esc(e.command ?? '')}${e.command ? '<br/>' : ''}${esc(e.detail ?? '')}</td>
    </tr>`;
  }).join('');
}

// ---------- Alert banner ----------
function renderAlert() {
  const el = $('#alert');
  const paused = [...state.agents.values()].filter((a) => a.alive && a.paused && a.pausedBy === 'seatbelt');
  if (paused.length) {
    const a = paused[0];
    el.className = 'alert protected';
    el.hidden = false;
    el.innerHTML = `
      <span class="tile pause">${icon('shield-check')}</span>
      <div>
        <h3>Seatbelt paused ${esc(a.label)} in ${esc(a.project)}</h3>
        ${a.pausedReason ? `<p>It ${esc(a.pausedReason)}. The agent and everything it started are frozen until you choose what happens next.</p>` : ''}
        ${paused.length > 1 ? `<div class="meta muted">${paused.length - 1} more session${paused.length > 2 ? 's are' : ' is'} paused. See below.</div>` : ''}
      </div>
      <div class="alert-actions">
        <button class="btn danger small" data-act="end" data-id="${esc(a.id)}">End session</button>
        <button class="btn small" data-act="resume" data-id="${esc(a.id)}">Let it continue</button>
      </div>`;
    return;
  }
  const recent = state.events.filter((e) => RANK[e.risk] >= 3 && e.id > state.dismissedAlert && Date.now() - e.ts < 15 * 60 * 1000);
  if (!recent.length) { el.hidden = true; return; }
  const top = recent.reduce((best, e) => (RANK[e.risk] > RANK[best.risk] || (RANK[e.risk] === RANK[best.risk] && e.id > best.id) ? e : best));
  const a = state.agents.get(top.agentId);
  el.className = `alert ${top.risk}`;
  el.hidden = false;
  el.innerHTML = `
    <span class="tile bad">${icon(top.risk === 'critical' ? 'octagon-alert' : 'triangle-alert')}</span>
    <div>
      <h3>${esc(top.title)}</h3>
      ${top.reasons?.length ? `<ul>${top.reasons.map((r) => `<li>${esc(sentence(r))}.</li>`).join('')}</ul>` : ''}
      ${a?.task ? `<div class="meta">You asked it to “${esc(a.task)}”. Does this look like part of that job?</div>` : ''}
      ${recent.length > 1 ? `<div class="meta muted">${recent.length - 1} more risky moment${recent.length > 2 ? 's' : ''} in the last 15 minutes.</div>` : ''}
    </div>
    <div class="alert-actions">
      ${a?.alive && !a.paused ? `<button class="btn danger small" data-act="end" data-id="${esc(a.id)}">End session</button>` : ''}
      ${a ? `<button class="btn small" data-act="explain" data-id="${esc(a.id)}">Explain</button>` : ''}
      <button class="btn ghost small" id="dismiss">Got it</button>
    </div>`;
  $('#dismiss').onclick = () => { state.dismissedAlert = Math.max(...recent.map((e) => e.id)); renderAlert(); };
}

let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderAlert();
    renderScore();
    renderProtect();
    renderAgents();
    if (state.view === 'simple') renderFeed();
    else renderTable();
  });
}

// ---------- Actions ----------
async function explain(agentId) {
  const a = state.agents.get(agentId);
  $('#explain').hidden = false;
  $('#explain-title').textContent = `Summary: ${a?.label ?? 'agent'} in ${a?.project ?? ''}`;
  $('#explain-body').className = 'explain-body loading';
  $('#explain-body').textContent = 'Writing a summary…';
  $('#explain-src').textContent = '';
  $('#explain').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const r = await fetch('/api/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }) });
    const j = await r.json();
    $('#explain-body').className = 'explain-body';
    $('#explain-body').textContent = j.text;
    $('#explain-src').textContent = `Written by ${j.source}. Nothing left this computer.`;
  } catch (err) {
    $('#explain-body').textContent = `Couldn't write a summary: ${err.message}`;
  }
}

async function agentAction(action, agentId, btn) {
  if (action === 'explain') return explain(agentId);
  const a = state.agents.get(agentId);
  if (action === 'end' && !confirm(`End ${a?.label ?? 'this session'} in ${a?.project ?? ''}? It and every program it started will be stopped.`)) return;
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId, action }) });
    const j = await r.json();
    if (!r.ok) toast(j.error ?? 'That didn’t work');
    else toast({ pause: `${a.label} is paused.`, resume: `${a.label} is running again.`, end: `${a.label} was ended.` }[action]);
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

function setView(v) {
  state.view = v;
  $('#view-simple').classList.toggle('on', v === 'simple');
  $('#view-advanced').classList.toggle('on', v === 'advanced');
  $('#simple').hidden = v !== 'simple';
  $('#advanced').hidden = v !== 'advanced';
  try { localStorage.setItem('seatbelt.view', v); } catch {}
  render();
}

// ---------- Wiring ----------
$('#view-simple').onclick = () => setView('simple');
$('#view-advanced').onclick = () => setView('advanced');
$('#show-routine').onchange = (e) => { state.showRoutine = e.target.checked; render(); };
for (const id of ['#q', '#risk-filter', '#kind-filter']) $(id).addEventListener('input', render);
$('#explain-close').onclick = () => ($('#explain').hidden = true);

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) { e.stopPropagation(); agentAction(act.dataset.act, act.dataset.id, act); return; }
  const card = e.target.closest('.session, .earlier-row');
  if (card) {
    state.selected = state.selected === card.dataset.id ? null : card.dataset.id;
    render();
  }
});
$('#agents').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('session')) e.target.click();
});

$('#factors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-factor]');
  if (!b || b.disabled) return;
  state.factor = state.factor === b.dataset.factor ? null : b.dataset.factor;
  render();
  if (state.factor) $(state.view === 'simple' ? '#simple' : '#advanced').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#factor-clear').onclick = () => { state.factor = null; render(); };

$('#protect-seg').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const prev = state.settings.autoProtect;
  state.settings.autoProtect = b.dataset.level;
  renderProtect();
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoProtect: b.dataset.level }) });
  if (!r.ok) { state.settings.autoProtect = prev; renderProtect(); toast('Couldn’t change auto-protect'); }
});

$('#demo').onclick = async () => {
  const b = $('#demo');
  b.disabled = true;
  b.textContent = 'Demo running';
  const r = await fetch('/api/demo/run', { method: 'POST' });
  if (!r.ok) toast((await r.json()).error ?? 'Could not start the demo');
  else toast('A pretend agent was asked to “set up this project”.');
  setTimeout(() => { b.disabled = false; b.textContent = 'Run demo attack'; }, 15000);
};
$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  state.events = [];
  state.dismissedAlert = 0;
  state.factor = null;
  $('#explain').hidden = true;
  load();
};

async function load() {
  const s = await (await fetch('/api/state')).json();
  state.agents = new Map(s.agents.map((a) => [a.id, a]));
  state.events = s.events;
  if (s.settings) state.settings = s.settings;
  $('#bait-dir').textContent = s.baitDir;
  $('#mode').textContent = `${s.os === 'Mac' ? 'Running on macOS. ' : s.os === 'Windows' ? 'Running on Windows. ' : ''}${s.deep ? 'Deep mode (eslogger).' : 'Standard mode (no admin access needed).'} ${s.ollama.available ? `Summaries by a local AI model (${s.ollama.model}).` : 'Local AI not running; summaries use built-in rules.'}`;
  render();
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#live').classList.add('on'); $('#live-text').textContent = 'Live'; load(); };
  es.onerror = () => { $('#live').classList.remove('on'); $('#live-text').textContent = 'Reconnecting'; };
  es.addEventListener('agent', (m) => { const a = JSON.parse(m.data); state.agents.set(a.id, a); render(); });
  es.addEventListener('event', (m) => { state.events.push(JSON.parse(m.data)); if (state.events.length > 3000) state.events.splice(0, 500); render(); });
  es.addEventListener('reset', () => { state.events = []; render(); });
  es.addEventListener('settings', (m) => { state.settings = JSON.parse(m.data); render(); });
  es.addEventListener('demo', (m) => {
    const d = JSON.parse(m.data);
    toast(d.cutOff
      ? `Seatbelt cut the upload off. The pretend attacker only got ${d.bytes} bytes.`
      : `The pretend attacker server just received ${d.bytes} bytes of your data.`, 7000);
  });
}

// ---------- Theme ----------
function setTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  for (const b of document.querySelectorAll('#theme-seg button')) {
    b.classList.toggle('on', b.dataset.theme === t);
    b.setAttribute('aria-checked', String(b.dataset.theme === t));
  }
  try { localStorage.setItem('seatbelt.theme', t); } catch {}
}
$('#theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (b) setTheme(b.dataset.theme);
});
let savedTheme = 'system';
try { savedTheme = localStorage.getItem('seatbelt.theme') ?? 'system'; } catch {}
setTheme(savedTheme);

drawScale();
try { const v = localStorage.getItem('seatbelt.view'); if (v) setView(v); } catch {}
connect();
setInterval(render, 10000); // refresh "x seconds ago"
