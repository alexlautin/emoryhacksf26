import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionTouch } from '../public/touch.js';

const agent = { id: 'demo-1', label: 'Demo agent', project: 'victim-project', alive: false, paused: false };

test('a finished attack names commands, the decoy, and the server', () => {
  const touch = sessionTouch(agent, [
    { agentId: 'demo-1', kind: 'tool', command: 'npm install', risk: 'low' },
    { agentId: 'demo-1', kind: 'process', command: 'npm install', risk: 'low' },
    { agentId: 'demo-1', kind: 'file', path: '/tmp/project/.env', bait: false, risk: 'low' },
    { agentId: 'demo-1', kind: 'file', path: '/home/me/.lookout/bait/aws_credentials', bait: true, risk: 'critical', reasons: ['opened a decoy secret Lookout planted'] },
    { agentId: 'demo-1', kind: 'network', host: '127.0.0.1', risk: 'high', title: 'talked to the pretend attacker' },
    { agentId: 'other', kind: 'process', command: 'git status', risk: 'info' },
  ]);
  assert.equal(touch.commands.length, 1);
  assert.equal(touch.files.length, 2);
  assert.equal(touch.hosts.length, 1);
  assert.equal(touch.decoyCount, 1);
  assert.match(touch.headline, /Demo agent in victim-project ran 1 command, touched 2 files, contacted 1 server/);
  assert.match(touch.headline, /opened a decoy secret/);
  assert.match(touch.headline, /session has finished/);
});

test('a quiet finished session says so', () => {
  const touch = sessionTouch({ ...agent, alive: true }, [
    { agentId: 'demo-1', kind: 'task', risk: 'info', title: 'asked' },
  ]);
  assert.match(touch.headline, /left no record/);
  assert.match(touch.headline, /did not open a decoy secret/);
  assert.equal(touch.finished, false);
});

test('a blocked hook is counted once', () => {
  const touch = sessionTouch(agent, [
    { agentId: 'demo-1', kind: 'tool', risk: 'critical', prevented: true, gate: 'deny', title: 'Lookout blocked it' },
  ]);
  assert.equal(touch.blocked.length, 1);
  assert.match(touch.headline, /blocked 1 action/);
});
