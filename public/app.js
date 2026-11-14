// Lookout dashboard. Plain JS, live updates over Server-Sent Events.
import { alertCount, computeScore, factorsFor } from './score.js';
import { bestChain, replayItems } from './timeline.js';
import { sessionTouch } from './touch.js';
import { incidentMarkdown, incidentModel, incidentPrintHtml } from './report.js';
import { canBaseline } from './baseline.js';
import { COACH_STEPS, coachCursor } from './coach.js';

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
  off: { word: 'Off', icon: 'shield-off', desc: 'Lookout only watches and warns. Agents keep running even when they do something dangerous.' },
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
  view: 'simple',
  selected: null,
  factor: null,
  showRoutine: false,
  dismissedAlert: 0,
  settings: { autoProtect: 'dangerous', menuBarDisplay: 'score' },
  shownScore: null,
  feedSeen: 0,
  ready: false,
  connected: false,
  baselines: [],
  coachOn: false,
  scrollCoach: false,
  playIndex: null,
  playAgent: null,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byUs = (who) => who === 'lookout' || who === 'seatbelt';

function localGet(key) {
  try { return localStorage.getItem(`lookout.${key}`) ?? localStorage.getItem(`seatbelt.${key}`); } catch { return null; }
}
function localSet(key, value) {
  try { localStorage.setItem(`lookout.${key}`, value); } catch {}
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

function menuBarText() {
  const mode = state.settings.menuBarDisplay ?? 'score';
  const active = liveAgents().length;
  const alerts = alertCount(state.events, [...state.agents.values()]);
  if (mode === 'icon') return 'icon only';
  if (mode === 'agents') return String(active);
  if (mode === 'alerts') return alerts ? String(alerts) : 'icon only';
  if (!state.ready) return 'the score';
  return String(computeScore(state.events).score);
}

function animateScore(target) {
  const from = state.shownScore ?? target;
  state.shownScore = target;
  const start = performance.now();
  const dur = reduceMotion || from === target ? 0 : 500;
  const step = (now) => {
    const t = dur ? Math.min(1, (now - start) / dur) : 1;
    const el = $('#score-num');
    if (el) el.textContent = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderScore() {
  const num = $('#score-num');
  const word = $('#score-level');
  const fill = $('#meter-fill');
  if (!state.ready) {
    num.textContent = '--';
    word.className = 'level-word';
    word.textContent = 'Loading';
    $('#score-blurb').textContent = 'Getting the latest activity.';
    $('#score-basis').textContent = '';
    fill.style.width = '0%';
    fill.className = 'meter-fill';
    return;
  }
  const s = computeScore(state.events);
  if (s.score !== state.shownScore) animateScore(s.score);
  word.className = `level-word ${s.level.cls}`;
  word.textContent = s.level.name;
  $('#score-blurb').textContent = s.level.blurb;
  $('#score-live').setAttribute('aria-label', `${s.score} out of 100, ${s.level.name}. ${s.level.blurb}`);
  fill.style.width = `${s.score}%`;
  fill.className = `meter-fill ${s.level.cls}`;
  const sessions = new Set(state.events.filter((e) => e.kind !== 'system').map((e) => e.agentId)).size;
  $('#score-basis').textContent = s.counted
    ? `${s.counted} action${s.counted === 1 ? '' : 's'} from ${sessions} session${sessions === 1 ? '' : 's'} since ${new Date(s.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Points fade by half every 12 hours.`
    : 'No agent activity yet. The score starts at 100.';

  const sevOf = (lost) => (lost >= 20 ? 'bad' : lost >= 8 ? 'warn' : 'note');
  setHTML($('#factors'), s.factors.map((f) => {
    const bad = f.lost > 0;
    const sev = bad ? sevOf(f.lost) : 'ok';
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
  }).join(''));
  $('#factor-clear').hidden = !state.factor;
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
  if (a.alive && a.paused) return { cls: 'paused', text: byUs(a.pausedBy) ? 'Paused by Lookout' : 'Paused by you' };
  if (!a.alive && a.endedBy) return { cls: 'ended', text: byUs(a.endedBy) ? 'Ended by Lookout' : 'Ended by you' };
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
  const sc = computeScore(eventsOf(a.id));
  const trigger = a.pausedEventId && state.events.find((e) => e.id === a.pausedEventId);
  const worst = sc.factors.filter((f) => f.lost).sort((x, y) => y.lost - x.lost)[0];
  const selected = state.selected === a.id;
  const head = `
        <header class="s-head">
          <div class="avatar" title="${esc(a.label)}">${agentLogo(a)}</div>
          <div class="s-id">
            <div class="s-name">${esc(a.label)}</div>
            <div class="s-proj" title="${esc(a.cwd || a.project)}">in ${esc(a.project)}${a.startedAt ? ` · started ${ago(a.startedAt)}` : ''}</div>
          </div>
          <div class="s-score ${sc.level.cls}" title="${sc.score} out of 100, ${esc(sc.level.name)}">
            <b>${sc.score}</b><span>/ 100</span>
          </div>
        </header>
        <div class="s-status"><span class="state-dot ${st.cls}"></span><b>${st.text}</b><span class="s-last">${esc(lastAction(a))}</span></div>
        ${a.paused ? '' : a.task ? `<div class="task"><span>Request</span> ${esc(a.task)}</div>` : ''}
        ${!a.paused && worst ? `<div class="s-worst">${icon(worst.icon)} <span>Main concern: <b>${esc(worst.name)}</b>, −${worst.lost}</span></div>` : ''}`;
  return `
    <article class="session ${st.cls} ${selected ? 'selected' : ''}" data-id="${esc(a.id)}">
      <button type="button" class="session-hit" data-select="${esc(a.id)}" aria-pressed="${selected}" aria-label="${esc(`${a.label} in ${a.project}, ${sc.score} out of 100, ${st.text}`)}">
        ${head}
      </button>
      ${a.paused ? `
        <div class="s-callout">
          <div class="s-callout-title">${icon('circle-pause')} ${byUs(a.pausedBy) ? 'Paused by Lookout' : 'Paused'}</div>
          ${a.pausedReason ? `<div class="s-callout-why">It ${esc(a.pausedReason)}.</div>` : ''}
          ${trigger?.command ? `<div class="cmd mono">${esc(trigger.command)}</div>` : ''}
          ${a.task ? `<div class="s-callout-ask">You asked it to “${esc(a.task)}”. Does this look like part of that job?</div>` : ''}
          <div class="s-actions">
            ${endButton(a, 'danger small', 'End session')}
            <button class="btn small" data-act="resume" data-id="${esc(a.id)}">Let it continue</button>
          </div>
        </div>` : ''}
      <footer class="s-foot">
        <div class="counts">
          <span><b>${a.counts.commands}</b> action${a.counts.commands === 1 ? '' : 's'}</span>
          <span><b>${a.counts.files}</b> file${a.counts.files === 1 ? '' : 's'}</span>
          <span><b>${a.counts.network}</b> connection${a.counts.network === 1 ? '' : 's'}</span>
        </div>
        <div class="s-buttons">
          ${a.alive && !a.paused ? `<button class="btn ghost small" data-act="pause" data-id="${esc(a.id)}" title="Freeze this agent and everything it started">Pause</button>` : ''}
          <button class="btn ghost small" data-act="explain" data-id="${esc(a.id)}">Explain</button>
          ${a.alive && !a.paused ? endButton(a, 'ghost small end', 'End') : ''}
        </div>
      </footer>
    </article>`;
}

function endButton(a, cls, label) {
  const on = state.confirmEnd === a.id;
  return `<button class="btn ${cls}${on ? ' confirming' : ''}" data-act="end" data-id="${esc(a.id)}" title="Stops ${esc(a.label)} and every program it started">${on ? 'Click again to end' : label}</button>`;
}

function earlierRow(a) {
  const st = sessionState(a);
  const sc = computeScore(eventsOf(a.id));
  return `
    <button class="earlier-row ${state.selected === a.id ? 'selected' : ''}" data-select="${esc(a.id)}" aria-pressed="${state.selected === a.id}">
      <span class="avatar sm">${agentLogo(a)}</span>
      <span class="e-name" title="${esc(a.cwd || a.project)}"><b>${esc(a.label)}</b> in ${esc(a.project)}</span>
      <span class="e-state ${st.cls}">${st.text}</span>
      <span class="s-score sm ${sc.level.cls}" title="${sc.score} out of 100"><b>${sc.score}</b></span>
    </button>`;
}

function renderAgents() {
  const all = [...state.agents.values()].filter((a) => a.alive || a.counts.commands > 0 || a.counts.alerts > 0);
  const byRecent = (a, b) => (b.paused - a.paused) || (b.counts.alerts - a.counts.alerts) || ((b.lastActive ?? 0) - (a.lastActive ?? 0));
  const active = all.filter((a) => a.alive).sort(byRecent);
  const earlier = all.filter((a) => !a.alive).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  $('#active-count').textContent = active.length;
  setList($('#agents'), active.map((a) => [a.id, sessionCard(a)]),
    '<p class="empty"><strong>No agents running</strong>Open Claude Code or Codex, or run the demo attack. Lookout picks it up on its own.</p>');
  $('#earlier').hidden = !earlier.length;
  $('#earlier-count').textContent = earlier.length;
  setList($('#earlier-list'), earlier.map((a) => [a.id, earlierRow(a)]), '');
  $('#agent-hint').textContent = state.selected ? 'Showing one session. Click it again to show all.' : 'Click a session to see only its activity.';
}

function isNotable(e) {
  if (state.factor) return true;
  if (state.showRoutine) return true;
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
  const tags = factorsFor(e).map((f) => `<span class="ftag">${icon(f.icon)}${esc(f.name)}</span>`).join('');
  return `
    <li class="item ${esc(e.risk)} ${e.guard ? 'guard ' + esc(e.guard) : ''}">
      <div class="tile ${e.guard ? GUARD_TONE[e.guard] : RISK_TONE[e.risk] ?? ''}">${icon(ic)}</div>
      <div>
        <div class="title">${esc(e.title)}</div>
        ${reasons.length ? `<div class="why">${reasons.length === 1 ? `${esc(sentence(reasons[0]))}.` : `<ul>${reasons.map((r) => `<li>${esc(sentence(r))}</li>`).join('')}</ul>`}</div>` : ''}
        ${e.guard && e.detail ? `<div class="why">${esc(e.detail)}</div>` : ''}
        ${e.command && (RANK[e.risk] >= 1 || e.agentReported || e.baseline) ? `<div class="cmd mono" title="${esc(e.command)}">${esc(e.command)}</div>` : ''}
        ${e.kind === 'file' && e.batch && e.detail ? `<div class="why mono">${esc(e.detail)}</div>` : ''}
        ${tags ? `<div class="ftags">${tags}</div>` : ''}
        ${canBaseline(e) ? `<div class="item-actions"><button type="button" class="link" data-base="${e.id}">Normal for this project</button></div>` : ''}
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
  setList($('#feed'), evs.map((e) => [String(e.id), feedItem(e)]), '');
  state.feedSeen = Math.max(state.feedSeen, ...evs.map((e) => e.id), 0);
  $('#feed-empty').hidden = evs.length > 0;
  const a = state.selected && state.agents.get(state.selected);
  const f = state.factor && computeScore([]).factors.find((x) => x.id === state.factor);
  $('#feed-title').textContent = f ? f.name : a ? `${a.label} in ${a.project}` : 'Activity';
  $('#feed-empty').textContent = !state.ready
    ? 'Connecting…'
    : state.factor
      ? 'Nothing in this category.'
      : 'Nothing needs your attention yet. Risky actions show up here. Turn on routine activity to see the rest.';
}

function renderTable() {
  const q = $('#q').value.toLowerCase();
  const minRisk = +$('#risk-filter').value;
  const kind = $('#kind-filter').value;
  const matched = filtered()
    .filter((e) => (RANK[e.risk] ?? 0) >= minRisk && (!kind || e.kind === kind))
    .filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q));
  const evs = matched.slice(-250).reverse();
  const note = $('#table-note');
  if (matched.length > evs.length) {
    note.hidden = false;
    note.textContent = `Showing the latest ${evs.length} of ${matched.length}. Filter to narrow this down.`;
  } else note.hidden = true;
  if (!evs.length) {
    setHTML($('#rows'), '<tr><td class="empty-cell" colspan="6">Nothing matches.</td></tr>');
    return;
  }
    const kindName = { process: 'Program', network: 'Network', file: 'File', tool: 'Agent tool', task: 'Task', system: 'System' };
    setHTML($('#rows'), evs.map((e) => {
    const a = state.agents.get(e.agentId);
    return `<tr>
      <td class="clip">${new Date(e.ts).toLocaleTimeString()}</td>
      <td>${esc(a ? `${a.label} · ${a.project}` : '—')}</td>
      <td class="clip">${esc(kindName[e.kind] || e.kind)}</td>
      <td class="clip"><span class="badge ${esc(e.risk)}">${esc(LEVEL[e.risk] || e.risk)}</span></td>
      <td class="wrap">${esc(e.title)}${e.reasons?.length ? `<div class="reasons">${e.reasons.map(esc).join(' · ')}</div>` : ''}</td>
      <td class="raw wrap">${esc(e.command ?? '')}${e.command ? '<br/>' : ''}${esc(e.detail ?? '')}</td>
    </tr>`;
  }).join(''));
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
        <h3>Lookout paused ${esc(a.label)} in ${esc(a.project)}</h3>
        ${a.pausedReason ? `<p>It ${esc(a.pausedReason)}. The agent and everything it started are frozen until you choose what happens next.</p>` : ''}
        ${paused.length > 1 ? `<div class="meta">${paused.length - 1} more session${paused.length > 2 ? 's are' : ' is'} paused.</div>` : ''}
      </div>
      <div class="alert-actions">
        ${endButton(a, 'danger small', 'End session')}
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
      ${a?.alive && !a.paused ? endButton(a, 'danger small', 'End session') : ''}
      ${a ? `<button class="btn small" data-act="explain" data-id="${esc(a.id)}">Explain</button>` : ''}
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
  const preview = $('#prefs-preview');
  if (preview) preview.textContent = `Right now the menu bar would show ${menuBarText()}.`;
  const on = document.documentElement.dataset.contrast === 'high';
  for (const id of ['#contrast', '#prefs-contrast']) {
    const b = $(id);
    if (!b) continue;
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

function latestRisk() {
  const ranked = state.events.filter((e) => e.kind !== 'system' && (RANK[e.risk] ?? 0) >= 2);
  const recent = ranked.filter((e) => Date.now() - e.ts < 15 * 60 * 1000);
  const pool = recent.length ? recent : ranked;
  return [...pool].sort((a, b) => (RANK[b.risk] - RANK[a.risk]) || (b.ts - a.ts))[0] ?? null;
}

function renderPanel() {
  const s = state.ready ? computeScore(state.events) : null;
  $('#mp-score').textContent = s ? String(s.score) : '--';
  const level = $('#mp-level');
  level.className = `mp-level ${s ? s.level.cls : ''}`;
  level.textContent = s ? s.level.name : 'Loading';
  const offline = !state.ready && $('#conn-error') && !$('#conn-error').hidden;
  let blurb = s ? s.level.blurb : offline ? 'Can’t reach Lookout. Trying again.' : 'Getting the latest activity.';
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
        <span class="mp-agent-state">${esc(st.text.replace('Paused by Lookout', 'Paused').replace('Paused by you', 'Paused'))}</span>
      </button>`;
      return [a.id, html];
    }), '');
  }

  const top = latestRisk();
  const box = $('#mp-latest');
  if (!top) {
    box.className = 'mp-latest';
    box.innerHTML = '<div class="mp-latest-title">Nothing risky.</div>';
  } else {
    const a = state.agents.get(top.agentId);
    box.className = `mp-latest ${esc(top.risk)}`;
    box.innerHTML = `<div class="mp-latest-title"><span class="mp-latest-k">${esc(LEVEL[top.risk] || top.risk)}</span> · ${esc(top.title)}</div>
      <div class="mp-latest-meta">${ago(top.ts)}${a ? ` · ${esc(a.label)}` : ''}</div>`;
  }

  const canPause = active.some((a) => !a.paused);
  const pause = $('#mp-pause');
  pause.disabled = !canPause;
  pause.textContent = active.filter((a) => !a.paused).length > 1 ? 'Pause agents' : 'Pause';
  $('#mp-open-key').textContent = `${MOD}O`;
  $('#mp-quit-key').textContent = `${MOD}Q`;
  const shown = menuBarText();
  $('#mp-preview').textContent = shown === 'icon only' ? '' : shown;
  markDisplay($('#mp-display'), state.settings.menuBarDisplay ?? 'score');
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
    renderCoach();
    renderDetail();
    if (state.view === 'simple') renderFeed();
    else renderTable();
  });
}

async function explain(agentId) {
  const a = state.agents.get(agentId);
  const box = $('#explain');
  box.hidden = false;
  $('#explain-title').textContent = `Summary: ${a?.label ?? 'agent'} in ${a?.project ?? ''}`;
  $('#explain-body').className = 'explain-body loading';
  $('#explain-body').textContent = 'Writing a summary…';
  $('#explain-src').textContent = '';
  box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  try {
    const r = await fetch('/api/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }) });
    const j = await r.json();
    $('#explain-body').className = 'explain-body';
    $('#explain-body').textContent = j.text;
    $('#explain-src').textContent = `Written by ${j.source}. Nothing left this computer.`;
  } catch (err) {
    $('#explain-body').className = 'explain-body';
    $('#explain-body').textContent = `Couldn’t write a summary: ${err.message}`;
  }
}

async function agentAction(action, agentId, btn) {
  if (action === 'explain') return explain(agentId);
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

function setView(v) {
  state.view = v;
  $('#view-simple').classList.toggle('on', v === 'simple');
  $('#view-advanced').classList.toggle('on', v === 'advanced');
  $('#view-simple').setAttribute('aria-selected', String(v === 'simple'));
  $('#view-advanced').setAttribute('aria-selected', String(v === 'advanced'));
  $('#simple').hidden = v !== 'simple';
  $('#advanced').hidden = v !== 'advanced';
  localSet('view', v);
  render();
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
  else toast('Quit from the Lookout menu bar app.');
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

function reportScope() {
  const agents = [...state.agents.values()].filter((a) => !state.selected || a.id === state.selected);
  const events = state.events.filter((e) => !state.selected || e.agentId === state.selected);
  return { agents, events };
}

function stopPlay() {
  clearInterval(state.playTimer);
  state.playTimer = null;
}

function renderDetail() {
  const box = $('#detail');
  if (!box || PANEL) return;
  const agent = state.selected && state.agents.get(state.selected);
  if (!agent) { box.hidden = true; stopPlay(); return; }
  box.hidden = false;
  const mine = eventsOf(agent.id);
  const touch = sessionTouch(agent, state.events);
  const chain = bestChain(mine);
  $('#detail-title').textContent = `${agent.label} in ${agent.project}`;
  $('#detail-touch').textContent = touch.headline;
  const playing = state.playAgent === agent.id && state.playIndex !== null;
  if (!chain) {
    $('#detail-chain').innerHTML = '';
    $('#detail-chain-note').textContent = 'No process chain yet. Lookout checks about twice a second, so a program that starts and exits faster than that can be missed. File and network events still show up below.';
    $('#detail-play').hidden = true;
  } else {
    $('#detail-play').hidden = false;
    const steps = chain.steps.map((s, i) => {
      const dim = playing && i > state.playIndex;
      const on = playing && i === state.playIndex;
      const shownCmd = s.cmd && s.cmd.length > 90 ? `${s.cmd.slice(0, 89)}…` : s.cmd;
      const cmd = shownCmd ? `<span class="chain-cmd mono" title="${esc(s.cmd)}">${esc(shownCmd)}</span>` : '';
      return `<li class="chain-step ${esc(i === chain.steps.length - 1 ? chain.risk : '')} ${dim ? 'dim' : ''} ${on ? 'on' : ''}"><span class="chain-name">${esc(s.name)}</span>${cmd}</li>`;
    }).join('');
    $('#detail-chain').innerHTML = `<ol class="chain" aria-label="How it happened">${steps}</ol>`;
    $('#detail-chain-note').textContent = playing && reduceMotion
      ? 'Animation is off because this system asked for less motion. The whole chain is shown.'
      : 'Each box is a program the one before it started.';
  }
  const list = (title, items) => items.length
    ? `<div><h3>${title}</h3><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`
    : '';
  $('#detail-lists').innerHTML = [
    list('Commands', touch.commands.map((c) => c.command + (c.baseline ? ' (normal for this project)' : ''))),
    list('Files', touch.files.map((f) => f.path + (f.bait ? ' (decoy)' : ''))),
    list('Servers', touch.hosts.map((h) => h.host + (h.trusted ? ' (known)' : ''))),
  ].join('');
  const replay = replayItems(mine).slice(-12);
  $('#detail-replay').innerHTML = replay.map((e) => `<li><time datetime="${new Date(e.ts).toISOString()}">${esc(ago(e.ts))}</time><span>${esc(e.title)}</span></li>`).join('');
}

function renderCoach() {
  const el = $('#coach');
  if (!el || PANEL) return;
  if (!state.coachOn) { el.hidden = true; return; }
  const cursor = coachCursor(state.events);
  const step = COACH_STEPS[cursor];
  el.hidden = false;
  $('#coach-count').textContent = `${cursor + 1} of ${COACH_STEPS.length}`;
  $('#coach-title').textContent = step.title;
  $('#coach-body').textContent = step.body;
  const note = $('#coach-note');
  note.textContent = cursor > 0 ? 'This follows what is already on the page. Reset if you want to watch it from the start.' : '';
  $('#coach-start').hidden = cursor > 0;
  if (state.scrollCoach) {
    state.scrollCoach = false;
    // The section was hidden until this paint. Scroll on the next frame, after it has a box.
    requestAnimationFrame(() => revealCoach(el));
  }
}

function revealCoach(el) {
  const bar = Math.ceil($('.top')?.getBoundingClientRect().height || 0);
  const rect = el.getBoundingClientRect();
  const gap = 12;
  if (rect.top >= bar + gap && rect.bottom <= window.innerHeight - 8) return;
  const y = rect.top + window.scrollY - bar - gap;
  window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
}

function openCoach() {
  state.coachOn = true;
  state.scrollCoach = true;
  if (!state.selected) {
    const demo = [...state.agents.values()].find((a) => a.kind === 'demo');
    if (demo) state.selected = demo.id;
  }
  render();
}

function downloadReport() {
  const md = incidentMarkdown(incidentModel(reportScope()));
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.selected ? 'lookout-session.md' : 'lookout-report.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function printReport() {
  const model = incidentModel(reportScope());
  const md = incidentMarkdown(model);
  $('#print-root').innerHTML = incidentPrintHtml(md);
  document.body.classList.add('printing');
  window.print();
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

$('#view-simple').onclick = () => setView('simple');
$('#view-advanced').onclick = () => setView('advanced');
$('#show-routine').onchange = (e) => { state.showRoutine = e.target.checked; render(); };
for (const id of ['#q', '#risk-filter', '#kind-filter']) $(id).addEventListener('input', render);
$('#explain-close').onclick = () => ($('#explain').hidden = true);

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) { e.stopPropagation(); agentAction(act.dataset.act, act.dataset.id, act); return; }
  const base = e.target.closest('[data-base]');
  if (base) { e.stopPropagation(); markNormal(+base.dataset.base); return; }
  const unbase = e.target.closest('[data-unbase]');
  if (unbase) { e.stopPropagation(); unmarkNormal(unbase.dataset.unbase); return; }
  const sel = e.target.closest('[data-select]');
  if (sel?.dataset.select) {
    state.selected = state.selected === sel.dataset.select ? null : sel.dataset.select;
    state.playIndex = null;
    stopPlay();
    render();
  }
});

async function markNormal(eventId) {
  const r = await fetch('/api/baseline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Could not save that'); return; }
  state.baselines = j.baselines || state.baselines;
  toast('Saved. Lookout will treat that as normal in this project. It stays in the log.');
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

$('#factors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-factor]');
  if (!b || b.disabled) return;
  state.factor = state.factor === b.dataset.factor ? null : b.dataset.factor;
  render();
  if (state.factor) $(state.view === 'simple' ? '#simple' : '#advanced').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
});
$('#factor-clear').onclick = () => { state.factor = null; render(); };

$('#protect-seg').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const prev = state.settings.autoProtect;
  state.settings = { ...state.settings, autoProtect: b.dataset.level };
  renderProtect();
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoProtect: b.dataset.level }) });
  if (!r.ok) { state.settings = { ...state.settings, autoProtect: prev }; renderProtect(); toast('Couldn’t change auto-protect'); }
});

for (const root of ['#display-seg', '#mp-display']) {
  $(root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-display]');
    if (b) setDisplay(b.dataset.display);
  });
}

$('#demo').onclick = runDemo;
$('#mp-demo').onclick = runDemo;
async function runDemo() {
  const buttons = ['#demo', '#mp-demo'].map((sel) => $(sel)).filter(Boolean);
  if (buttons.some((b) => b.disabled)) return;
  for (const b of buttons) {
    b.disabled = true;
    b.textContent = 'Demo running';
  }
  const r = await fetch('/api/demo/run', { method: 'POST' });
  if (!r.ok) toast((await r.json()).error ?? 'Could not start the demo');
  else toast('A pretend agent was asked to set up this project.');
  setTimeout(() => {
    for (const b of buttons) {
      b.disabled = false;
      b.textContent = 'Run demo attack';
    }
  }, 15000);
}

$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  state.events = [];
  state.dismissedAlert = 0;
  state.factor = null;
  state.shownScore = null;
  state.playIndex = null;
  stopPlay();
  $('#explain').hidden = true;
  load();
};

$('#coach-open').onclick = () => openCoach();
$('#coach-close').onclick = () => { state.coachOn = false; render(); };
$('#coach-start').onclick = () => runDemo();
$('#detail-play').onclick = () => {
  const agent = state.agents.get(state.selected);
  const chain = agent && bestChain(eventsOf(agent.id));
  if (!chain) return;
  stopPlay();
  if (reduceMotion) { state.playAgent = agent.id; state.playIndex = chain.steps.length - 1; render(); return; }
  state.playAgent = agent.id;
  state.playIndex = 0;
  render();
  state.playTimer = setInterval(() => {
    state.playIndex += 1;
    if (state.playIndex >= chain.steps.length) {
      state.playIndex = chain.steps.length - 1;
      stopPlay();
    }
    render();
  }, 700);
};
$('#detail-md').onclick = () => downloadReport();
$('#detail-print').onclick = () => printReport();
window.addEventListener('afterprint', () => document.body.classList.remove('printing'));

$('#contrast').onclick = () => setContrast(document.documentElement.dataset.contrast !== 'high');
$('#prefs-contrast').onclick = () => setContrast(document.documentElement.dataset.contrast !== 'high');
$('#prefs-notify').onclick = async () => {
  if (!('Notification' in window)) { toast('This browser does not show system alerts.'); return; }
  const perm = await Notification.requestPermission();
  toast(perm === 'granted' ? 'Browser alerts are on for Dangerous events.' : 'Browser alerts stay off.');
};
function showHelp() {
  const d = $('#help');
  if (d && !d.open) d.showModal();
}
$('#help-open').onclick = () => showHelp();
$('#intro-skip').onclick = () => localSet('intro', '1');
$('#intro-demo').onclick = () => {
  localSet('intro', '1');
  $('#intro').close();
  openCoach();
  runDemo();
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

function typingTarget(e) {
  const t = e.target;
  return t && (t.matches?.('input, textarea, select') || t.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  if (!PANEL && !typingTarget(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === '?') { e.preventDefault(); showHelp(); }
    else if (e.key === '1') setView('simple');
    else if (e.key === '2') setView('advanced');
    else if (e.key === 'd' || e.key === 'D') runDemo();
    else if (e.key === 'w' || e.key === 'W') openCoach();
    else if (e.key === '/') { e.preventDefault(); setView('advanced'); $('#q').focus(); }
    else if (e.key === 'Escape') {
      if ($('#intro')?.open) $('#intro').close();
      else if ($('#help')?.open) $('#help').close();
      else if ($('#prefs')?.open) $('#prefs').close();
      else if (state.coachOn) { state.coachOn = false; render(); }
      else if (state.selected) { state.selected = null; render(); }
    }
  }
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
    $('#bait-dir').textContent = s.baitDir;
    const place = s.os === 'Mac' ? 'Running on macOS. ' : s.os === 'Windows' ? 'Running on Windows. ' : '';
    const mode = s.deep ? 'Deep mode (eslogger).' : 'Standard mode.';
    const model = s.ollama?.available
      ? `Summaries use a local model (${s.ollama.model}).`
      : 'No local model is running, so summaries use the built-in rules.';
    $('#mode').textContent = `${place}${mode} ${model}`;
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
    const prev = state.agents.get(a.id);
    state.agents.set(a.id, a);
    if (prev?.alive && !a.alive && (state.coachOn || !state.selected || state.selected === a.id)) state.selected = a.id;
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
      try { new Notification('Lookout', { body: `${n.title}. ${n.body}` }); } catch {}
    }
  });
  es.addEventListener('reset', () => { state.events = []; state.shownScore = null; render(); });
  es.addEventListener('settings', (m) => { state.settings = { ...state.settings, ...JSON.parse(m.data) }; render(); });
  es.addEventListener('demo', (m) => {
    const d = JSON.parse(m.data);
    toast(d.cutOff
      ? `Lookout cut the upload off. The pretend attacker only got ${d.bytes} bytes.`
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
const savedView = localGet('view');
if (savedView === 'simple' || savedView === 'advanced') setView(savedView);
connect();
setInterval(render, 10000);

if (PANEL) {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  const btn = $('#open-dash');
  btn.hidden = !invoke;
  btn.addEventListener('click', openDashboard);
} else if (localGet('intro') !== '1') {
  const intro = $('#intro');
  intro.addEventListener('close', () => localSet('intro', '1'));
  if (typeof intro.showModal === 'function') intro.showModal();
}
