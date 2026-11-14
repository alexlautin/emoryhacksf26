// Seatbelt dashboard: plain JS, live updates over Server-Sent Events.
const $ = (s) => document.querySelector(s);
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const LEVEL = { info: 'Routine', low: 'Note', medium: 'Worth a look', high: 'Risky', critical: 'Dangerous' };
const ICON = { process: '⚙️', network: '🌐', file: '📄', tool: '🛠️', task: '💬', system: '👁️' };

const state = {
  agents: new Map(),
  events: [],
  view: 'simple',
  selected: null,
  showRoutine: false,
  dismissedAlert: 0,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function agentStatus(a) {
  const evs = state.events.filter((e) => e.agentId === a.id);
  const worst = evs.reduce((m, e) => Math.max(m, RANK[e.risk] ?? 0), 0);
  if (worst >= 4) return { cls: 'danger', text: '⛔ Stop and check this agent' };
  if (a.score < 60 || worst >= 3) return { cls: 'danger', text: '⚠️ Needs your attention' };
  if (a.score < 90 || worst >= 2) return { cls: 'warn', text: '👀 Worth a look' };
  return { cls: 'ok', text: '✓ Looks normal' };
}

function scoreColor(score) {
  if (score >= 90) return 'var(--ok)';
  if (score >= 60) return 'var(--med)';
  return 'var(--high)';
}

function visibleAgents() {
  return [...state.agents.values()]
    .filter((a) => a.alive || a.counts.commands > 0 || a.counts.alerts > 0)
    .sort((a, b) => (b.counts.alerts - a.counts.alerts) || (a.alive === b.alive ? 0 : a.alive ? -1 : 1) || ((b.lastActive ?? 0) - (a.lastActive ?? 0)));
}

function renderAgents() {
  const list = visibleAgents();
  $('#agents').innerHTML = list.length ? list.map((a) => {
    const st = agentStatus(a);
    const C = 2 * Math.PI * 22;
    const off = C * (1 - a.score / 100);
    const initial = a.kind === 'claude' ? 'C' : a.kind === 'codex' ? '>_' : 'D';
    return `
      <button class="agent ${st.cls} ${state.selected === a.id ? 'selected' : ''} ${a.alive ? '' : 'dead'}" data-id="${esc(a.id)}">
        <div class="agent-top">
          <div class="avatar ${esc(a.kind)}">${initial}</div>
          <div class="agent-id">
            <div class="agent-name">${esc(a.label)}${a.alive ? '' : ' <span class="muted small">(finished)</span>'}</div>
            <div class="agent-proj" title="${esc(a.cwd)}">in ${esc(a.project)}</div>
          </div>
          <div class="score" title="Safety score">
            <svg viewBox="0 0 52 52"><circle class="track" cx="26" cy="26" r="22"/><circle class="val" cx="26" cy="26" r="22" stroke="${scoreColor(a.score)}" stroke-dasharray="${C}" stroke-dashoffset="${off}"/></svg>
            <span>${a.score}</span>
          </div>
        </div>
        <div class="status ${st.cls}">${st.text}</div>
        ${a.task ? `<div class="task">Your request: “${esc(a.task)}”</div>` : ''}
        <div class="agent-foot">
          <div class="counts">
            <span><b>${a.counts.commands}</b> actions</span>
            <span><b>${a.counts.files}</b> file events</span>
            <span><b>${a.counts.network}</b> connections</span>
          </div>
          <span class="btn ghost small explain-btn" data-id="${esc(a.id)}" role="button">Explain</span>
        </div>
      </button>`;
  }).join('') : '<p class="empty">No AI agents running right now. Open Claude Code or Codex and Seatbelt will pick it up automatically.</p>';
  $('#agent-hint').textContent = state.selected ? 'Showing one agent. Click it again to show all' : 'Click one to see only its activity';
}

function renderTotals() {
  const alive = [...state.agents.values()].filter((a) => a.alive).length;
  const cmds = state.events.filter((e) => e.kind === 'process' || e.kind === 'tool').length;
  const files = state.events.filter((e) => e.kind === 'file' && e.batch).reduce((n, e) => n + (e.files?.length ?? 0), 0);
  const alerts = state.events.filter((e) => RANK[e.risk] >= 3).length;
  $('#totals').innerHTML = `
    <div class="stat"><div class="n">${alive}</div><div class="l">AI agents being watched</div></div>
    <div class="stat"><div class="n">${cmds}</div><div class="l">Actions seen</div></div>
    <div class="stat"><div class="n">${files}</div><div class="l">Project files changed</div></div>
    <div class="stat ${alerts ? 'bad' : ''}"><div class="n">${alerts}</div><div class="l">Risky moments</div></div>`;
}

function isNotable(e) {
  if (state.showRoutine) return true;
  if (RANK[e.risk] >= 1) return true;
  if (e.kind === 'task' || e.agentReported) return true;
  if (e.kind === 'file' && e.batch) return true;
  if (e.kind === 'network' && !e.isAgentItself && !e.trusted) return true;
  return false;
}

function feedItem(e) {
  const a = state.agents.get(e.agentId);
  const icon = e.bait ? '🪤' : ICON[e.kind] ?? '•';
  const reasons = (e.reasons ?? []).filter(Boolean);
  return `
    <li class="item ${esc(e.risk)}">
      <div class="ic">${icon}</div>
      <div>
        <div class="title">${esc(e.title)}</div>
        ${reasons.length ? `<div class="why">${reasons.length === 1 ? `Why it matters: it ${esc(reasons[0])}.` : `<ul>${reasons.map((r) => `<li>It ${esc(r)}</li>`).join('')}</ul>`}</div>` : ''}
        ${e.command && (RANK[e.risk] >= 1 || e.agentReported) ? `<div class="cmd mono">${esc(e.command)}</div>` : ''}
        ${e.kind === 'file' && e.batch && e.detail ? `<div class="why mono">${esc(e.detail)}</div>` : ''}
      </div>
      <div class="when">
        ${RANK[e.risk] >= 1 ? `<span class="badge ${esc(e.risk)}">${LEVEL[e.risk]}</span><br/>` : ''}
        <span title="${new Date(e.ts).toLocaleString()}">${ago(e.ts)}</span>
        ${a && !state.selected ? `<div class="who">${esc(a.label)} · ${esc(a.project)}</div>` : ''}
      </div>
    </li>`;
}

function renderFeed() {
  const evs = state.events
    .filter((e) => !state.selected || e.agentId === state.selected)
    .filter(isNotable)
    .slice(-200)
    .reverse();
  $('#feed').innerHTML = evs.map(feedItem).join('');
  $('#feed-empty').hidden = evs.length > 0;
  const a = state.selected && state.agents.get(state.selected);
  $('#feed-title').textContent = a ? `What ${a.label} is doing in ${a.project}` : "What's happening";
}

function renderTable() {
  const q = $('#q').value.toLowerCase();
  const minRisk = +$('#risk-filter').value;
  const kind = $('#kind-filter').value;
  const evs = state.events
    .filter((e) => !state.selected || e.agentId === state.selected)
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

function renderAlert() {
  const recent = state.events.filter((e) => RANK[e.risk] >= 3 && e.id > state.dismissedAlert && Date.now() - e.ts < 15 * 60 * 1000);
  const el = $('#alert');
  if (!recent.length) { el.hidden = true; return; }
  const top = recent.reduce((best, e) => (RANK[e.risk] > RANK[best.risk] || (RANK[e.risk] === RANK[best.risk] && e.id > best.id) ? e : best));
  const a = state.agents.get(top.agentId);
  el.className = `alert ${top.risk}`;
  el.hidden = false;
  el.innerHTML = `
    <div class="icon">${top.risk === 'critical' ? '⛔' : '⚠️'}</div>
    <div>
      <h3>${esc(top.title)}</h3>
      ${top.reasons?.length ? `<ul>${top.reasons.map((r) => `<li>It ${esc(r)}.</li>`).join('')}</ul>` : ''}
      ${a?.task ? `<div class="meta muted">You asked it to: “${esc(a.task)}”. Does this look like part of that job?</div>` : ''}
      ${recent.length > 1 ? `<div class="meta muted">${recent.length - 1} more risky moment${recent.length > 2 ? 's' : ''} in the last 15 minutes. See the feed below.</div>` : ''}
    </div>
    <div style="display:grid;gap:8px">
      ${a ? `<button class="btn small" data-explain="${esc(a.id)}">Explain</button>` : ''}
      <button class="btn ghost small" id="dismiss">Got it</button>
    </div>`;
  $('#dismiss').onclick = () => { state.dismissedAlert = Math.max(...recent.map((e) => e.id)); renderAlert(); };
  el.querySelector('[data-explain]')?.addEventListener('click', (ev) => explain(ev.currentTarget.dataset.explain));
}

let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderAlert();
    renderTotals();
    renderAgents();
    if (state.view === 'simple') renderFeed();
    else renderTable();
  });
}

async function explain(agentId) {
  const a = state.agents.get(agentId);
  $('#explain').hidden = false;
  $('#explain-title').textContent = `What ${a?.label ?? 'the agent'} did in ${a?.project ?? ''}, in plain English`;
  $('#explain-body').className = 'explain-body loading';
  $('#explain-body').textContent = 'Reading the activity and writing a summary on this Mac…';
  $('#explain-src').textContent = '';
  $('#explain').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const r = await fetch('/api/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }) });
    const j = await r.json();
    $('#explain-body').className = 'explain-body';
    $('#explain-body').textContent = j.text;
    $('#explain-src').textContent = `Written by ${j.source}. Nothing was sent off this Mac.`;
  } catch (err) {
    $('#explain-body').textContent = `Couldn't write a summary: ${err.message}`;
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

// ---- events ----
$('#view-simple').onclick = () => setView('simple');
$('#view-advanced').onclick = () => setView('advanced');
$('#show-routine').onchange = (e) => { state.showRoutine = e.target.checked; render(); };
for (const id of ['#q', '#risk-filter', '#kind-filter']) $(id).addEventListener('input', render);
$('#explain-close').onclick = () => ($('#explain').hidden = true);
$('#agents').addEventListener('click', (e) => {
  const ex = e.target.closest('.explain-btn');
  if (ex) { e.stopPropagation(); explain(ex.dataset.id); return; }
  const card = e.target.closest('.agent');
  if (!card) return;
  state.selected = state.selected === card.dataset.id ? null : card.dataset.id;
  render();
});
$('#demo').onclick = async () => {
  const b = $('#demo');
  b.disabled = true;
  b.textContent = 'Demo running…';
  const r = await fetch('/api/demo/run', { method: 'POST' });
  if (!r.ok) toast((await r.json()).error ?? 'Could not start the demo');
  else toast('A pretend AI agent was asked to “set up this project”. Watch what happens…');
  setTimeout(() => { b.disabled = false; b.textContent = 'Run demo attack'; }, 15000);
};
$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  state.events = [];
  state.dismissedAlert = 0;
  $('#explain').hidden = true;
  load();
};

async function load() {
  const s = await (await fetch('/api/state')).json();
  state.agents = new Map(s.agents.map((a) => [a.id, a]));
  state.events = s.events;
  $('#bait-dir').textContent = s.baitDir;
  $('#mode').textContent = `${s.deep ? 'Deep mode (eslogger).' : 'Standard mode (no admin access needed).'} ${s.ollama.available ? `Summaries by a local AI model (${s.ollama.model}).` : 'Local AI not running; summaries use built-in rules.'}`;
  render();
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#live').classList.add('on'); $('#live-text').textContent = 'Watching live'; load(); };
  es.onerror = () => { $('#live').classList.remove('on'); $('#live-text').textContent = 'Reconnecting…'; };
  es.addEventListener('agent', (m) => { const a = JSON.parse(m.data); state.agents.set(a.id, a); render(); });
  es.addEventListener('event', (m) => { state.events.push(JSON.parse(m.data)); if (state.events.length > 3000) state.events.splice(0, 500); render(); });
  es.addEventListener('reset', () => { state.events = []; render(); });
  es.addEventListener('demo', (m) => { const d = JSON.parse(m.data); toast(`🏴‍☠️ The pretend attacker server just received ${d.bytes} bytes of your data.`, 7000); });
}

try { const v = localStorage.getItem('seatbelt.view'); if (v) setView(v); } catch {}
connect();
setInterval(render, 10000); // refresh "x seconds ago"
