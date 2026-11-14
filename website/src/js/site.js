import { RELEASES } from '/releases.js';
import { detectOS } from '/js/os.js';
import { downloadPlan } from '/js/downloads.js';

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

function renderDownloads(root, plan) {
  root.replaceChildren();

  const note = document.createElement('p');
  note.className = 'os-note';
  note.textContent = plan.note;
  root.append(note);

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

  const title = document.createElement('h3');
  title.textContent = entry.title;
  art.append(title);

  const detail = document.createElement('p');
  detail.className = 'dl-detail';
  detail.textContent = entry.detail;
  art.append(detail);

  const status = document.createElement('p');
  status.className = 'dl-status';
  status.id = `status-${entry.id}`;
  status.textContent = entry.status;

  const control = entry.href ? document.createElement('a') : document.createElement('button');
  control.className = entry.href
    ? (entry.primary ? 'btn btn-primary' : 'btn btn-secondary')
    : 'btn btn-soon';
  control.textContent = entry.button;
  control.setAttribute('aria-describedby', status.id);

  if (entry.href) {
    control.href = entry.href;
    control.rel = 'noopener';
    if (entry.action === 'placeholder') control.target = '_blank';
  } else {
    control.type = 'button';
    control.setAttribute('aria-disabled', 'true');
    control.addEventListener('click', (event) => event.preventDefault());
  }

  art.append(control, status);
  return art;
}
