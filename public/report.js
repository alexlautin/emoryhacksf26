// A report someone can download or print. Same facts as the dashboard, in one file.
import { computeScore } from './score.js';
import { bestChain } from './timeline.js';
import { sessionTouch } from './touch.js';

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const LEVEL = { info: 'Routine', low: 'Note', medium: 'Worth a look', high: 'Risky', critical: 'Dangerous' };

function notable(events) {
  return events
    .filter((e) => e.guard || e.kind === 'task' || e.bait || e.hook || (e.kind !== 'system' && (RANK[e.risk] ?? 0) >= 1))
    .slice()
    .sort((a, b) => (a.ts - b.ts) || ((a.id ?? 0) - (b.id ?? 0)));
}

function clip(list, n) {
  if (list.length <= n) return { items: list, more: 0 };
  return { items: list.slice(0, n), more: list.length - n };
}

export function incidentModel({ agents = [], events = [], now = Date.now(), os = '' } = {}) {
  const score = computeScore(events, now);
  const sessions = agents.map((agent) => {
    const mine = events.filter((e) => e.agentId === agent.id);
    const touch = sessionTouch(agent, events);
    return {
      agent,
      touch: {
        ...touch,
        commands: clip(touch.commands, 40),
        files: clip(touch.files, 40),
        hosts: clip(touch.hosts, 20),
      },
      chain: bestChain(mine),
      events: clip(notable(mine), 40),
    };
  });
  return { generated: new Date(now).toISOString(), os, score, sessions, empty: sessions.length === 0 };
}

function bullet(text) {
  return `- ${text}`;
}

export function incidentMarkdown(model) {
  const lines = [];
  lines.push('# Harness report');
  lines.push('');
  lines.push(`Written ${model.generated}${model.os ? ` on this ${model.os}` : ''}. Harness did not send this anywhere.`);
  lines.push('');
  lines.push('## Score');
  lines.push('');
  lines.push(`${model.score.score} out of 100 (${model.score.level.name}). ${model.score.level.blurb}`);
  const used = model.score.factors.filter((f) => f.lost > 0);
  if (used.length) {
    lines.push('');
    for (const f of used) lines.push(bullet(`${f.name}: -${f.lost} (${f.count} event${f.count === 1 ? '' : 's'})`));
  }
  if (!model.sessions.length) {
    lines.push('');
    lines.push('No sessions were recorded.');
  }
  for (const s of model.sessions) {
    const a = s.agent;
    lines.push('');
    lines.push(`## ${a.label} in ${a.project || 'an unknown folder'}`);
    lines.push('');
    lines.push(s.touch.headline);
    if (a.task) {
      lines.push('');
      lines.push(`You asked: "${a.task}"`);
    }
    if (s.chain) {
      lines.push('');
      lines.push('How it happened:');
      lines.push('');
      lines.push(s.chain.steps.map((step) => step.name).join(' -> '));
      const detailed = s.chain.steps.filter((step) => step.cmd);
      if (detailed.length) {
        lines.push('');
        for (const step of detailed) lines.push(bullet(`${step.name}: \`${step.cmd}\``));
      }
    }
    const lists = [
      ['Commands', s.touch.commands, (c) => `\`${c.command}\`${c.baseline ? ' (marked normal for this project)' : ''}`],
      ['Files', s.touch.files, (f) => `${f.path}${f.bait ? ' (decoy)' : ''}`],
      ['Servers', s.touch.hosts, (h) => `${h.host}${h.trusted ? ' (known)' : ''}`],
    ];
    for (const [title, group, fmt] of lists) {
      if (!group.items.length) continue;
      lines.push('');
      lines.push(`### ${title}`);
      lines.push('');
      for (const item of group.items) lines.push(bullet(fmt(item)));
      if (group.more) lines.push(bullet(`and ${group.more} more`));
    }
    if (s.events.items.length) {
      lines.push('');
      lines.push('### What Harness flagged');
      lines.push('');
      for (const e of s.events.items) {
        const when = new Date(e.ts).toISOString();
        const level = LEVEL[e.risk] || e.risk;
        const why = (e.reasons || []).filter((r) => !/marked as normal for this project/.test(r)).slice(0, 2).join('; ');
        lines.push(bullet(`${when} ${level}: ${e.title}${why ? `. ${why}` : ''}`));
      }
      if (s.events.more) lines.push(bullet(`and ${s.events.more} more`));
    }
  }
  lines.push('');
  lines.push('## Limits');
  lines.push('');
  lines.push('Harness checks the process list about twice a second. A program that starts and exits faster than that can be missed. When a decoy file is read, the file system does not say which process read it, so Harness credits the agent that was active.');
  lines.push('');
  lines.push('This is a Markdown file. To get a PDF, open the dashboard report and choose Save as PDF in the print dialog.');
  lines.push('');
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Print view of a report. Each run of bullets is its own list, so a heading between them stays a heading. */
export function incidentPrintHtml(markdown) {
  const blocks = [];
  let items = [];
  const flush = () => {
    if (!items.length) return;
    blocks.push(`<ul>${items.join('')}</ul>`);
    items = [];
  };
  for (const line of String(markdown ?? '').split('\n')) {
    if (line.startsWith('- ')) {
      items.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    flush();
    if (line.startsWith('### ')) blocks.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    else if (line.startsWith('## ')) blocks.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) blocks.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    else if (line.trim()) blocks.push(`<p>${escapeHtml(line)}</p>`);
  }
  flush();
  return blocks.join('');
}

export function incidentReport(input) {
  return incidentMarkdown(incidentModel(input));
}
