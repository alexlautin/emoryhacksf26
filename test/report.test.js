import assert from 'node:assert/strict';
import test from 'node:test';
import { incidentMarkdown, incidentModel, incidentPrintHtml } from '../public/report.js';

test('the report names the score, the chain, and the decoy', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);
  const agent = { id: 'demo-1', label: 'Demo agent', project: 'victim-project', task: 'Set up this project', alive: false };
  const events = [
    { id: 1, ts: now, agentId: 'demo-1', kind: 'task', risk: 'info', title: 'You asked Demo agent' },
    {
      id: 2, ts: now + 1, agentId: 'demo-1', kind: 'process', risk: 'critical',
      title: 'A package install script looked through files',
      command: 'cat ~/.harness/bait/aws_credentials',
      reasons: ['touched a decoy secret Harness planted (~/.harness/bait/aws_credentials). No honest task needs this file'],
      steps: [
        { role: 'agent', label: 'Demo agent', pid: 1 },
        { role: 'shell', cmd: 'zsh -c npm install', pid: 2 },
        { role: 'install', cmd: 'npm install', pid: 3 },
        { role: 'shell', cmd: 'cat ~/.harness/bait/aws_credentials', pid: 4 },
      ],
    },
  ];
  const model = incidentModel({ agents: [agent], events, now, os: 'computer' });
  assert.equal(model.score.score < 100, true);
  assert.equal(model.sessions[0].chain.steps[2].name, 'Package install');
  const md = incidentMarkdown(model);
  assert.match(md, /# Harness report/);
  assert.match(md, /out of 100/);
  assert.match(md, /Demo agent -> Shell -> Package install -> Install script/);
  assert.match(md, /decoy/);
  assert.match(md, /Set up this project/);
  assert.match(md, /Save as PDF/);
  assert.doesNotMatch(md, /seamless|leverage|robust/);
});

test('print html keeps a heading between lists', () => {
  const html = incidentPrintHtml([
    '# Harness report',
    '',
    '## Score',
    '',
    '- Secrets: -45 (1 event)',
    '',
    '### Commands',
    '',
    '- `npm install`',
    '',
    '### Files',
    '',
    '- .env <b>',
  ].join('\n'));
  assert.equal((html.match(/<ul>/g) || []).length, 3);
  assert.match(html, /<h3>Commands<\/h3><ul><li>`npm install`<\/li><\/ul><h3>Files<\/h3><ul><li>\.env &lt;b&gt;<\/li><\/ul>/);
});

test('an empty report still explains itself', () => {
  const md = incidentMarkdown(incidentModel({ now: Date.UTC(2026, 5, 1) }));
  assert.match(md, /100 out of 100/);
  assert.match(md, /No sessions were recorded/);
});
