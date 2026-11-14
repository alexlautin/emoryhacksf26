import { RELEASES } from '../../releases.js';
import { detectOS } from './os.js';
import { downloadPlan } from './downloads.js';

export function initDownloads() {
const root = document.querySelector('#downloads');
if (root) {
  const os = detectOS({
    ua: navigator.userAgent || '',
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    touchPoints: navigator.maxTouchPoints || 0,
    search: location.search || '',
  });
  renderDownloads(root, downloadPlan(RELEASES, os));
}

}

function renderDownloads(root, plan) {
  root.replaceChildren();

  // The "This computer" badge already says it. Keep the note for devices Harness can't run on.
  if (!plan.items.some((entry) => entry.yours)) {
    const note = document.createElement('p');
    note.className = 'os-note';
    note.textContent = plan.note;
    root.append(note);
  }

  const row = document.createElement('div');
  row.className = 'dl-row';
  for (const entry of plan.items) row.append(card(entry));
  root.append(row);
}

function card(entry) {
  const art = document.createElement('article');
  art.className = entry.yours ? 'dl is-yours' : 'dl';
  art.dataset.platform = entry.id;

  if (entry.yours) {
    const yours = document.createElement('p');
    yours.className = 'yours';
    yours.textContent = 'This computer';
    art.append(yours);
  }

  const head = document.createElement('div');
  head.className = 'dl-head';
  const title = document.createElement('h3');
  title.textContent = entry.title;
  head.append(title);

  // The fine print lives in a tooltip so the card stays short.
  const status = document.createElement('p');
  status.className = 'dl-tip';
  status.id = `status-${entry.id}`;
  status.setAttribute('role', 'tooltip');
  status.textContent = entry.status;
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'dl-info';
  info.textContent = 'i';
  info.setAttribute('aria-label', `About the ${entry.title} download`);
  info.setAttribute('aria-describedby', status.id);
  head.append(info);
  art.append(head);

  const detail = document.createElement('p');
  detail.className = 'dl-detail';
  detail.textContent = entry.detail;
  art.append(detail);
  art.append(status);
  const actions = document.createElement('div');
  actions.className = 'dl-actions';

  const control = entry.href ? document.createElement('a') : document.createElement('button');
  control.className = entry.href
    ? (entry.primary ? 'btn btn-primary' : 'btn btn-secondary')
    : 'btn btn-soon';
  control.textContent = entry.button;
  control.setAttribute('aria-describedby', status.id);

  if (entry.href) {
    control.href = entry.href;
    control.rel = 'noopener';
  } else {
    control.type = 'button';
    control.setAttribute('aria-disabled', 'true');
    control.addEventListener('click', (event) => event.preventDefault());
  }

  actions.append(control);
  art.append(actions);

  // Secondary choices sit in one text row so both cards have the same shape.
  const links = document.createElement('p');
  links.className = 'dl-links';
  if (entry.alternate) {
    const alternate = document.createElement('a');
    alternate.href = entry.alternate.href;
    alternate.textContent = 'Intel Mac version';
    alternate.title = entry.alternate.button;
    alternate.setAttribute('aria-describedby', status.id);
    links.append(alternate);
  }
  if (entry.href) {
    const help = document.createElement('a');
    help.href = entry.id === 'mac' ? '#install-mac' : '#install-windows';
    help.textContent = 'How to open →';
    links.append(help);
  }
  if (links.childElementCount) art.append(links);
  return art;
}

// The install help lives in a closed dropdown. Open it when a link points inside.
function openInstallHelp() {
  const target = location.hash && document.querySelector(location.hash);
  const guide = target && target.closest('details.install-guide');
  if (guide && !guide.open) {
    guide.open = true;
    target.scrollIntoView();
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', openInstallHelp);
  window.addEventListener('DOMContentLoaded', openInstallHelp);
}
