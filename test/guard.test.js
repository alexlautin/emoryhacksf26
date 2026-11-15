import assert from 'node:assert/strict';
import test from 'node:test';
import { sortLeftovers } from '../src/guard.js';

test('an agent the last Harness left frozen is shown as paused again, others are forgotten', () => {
  const left = new Map([
    [100, { pids: [100, 101], reason: 'opened a decoy secret', since: 1 }], // still frozen
    [200, { pids: [200], reason: 'uploaded data', since: 2 }], // someone resumed it
    [300, { pids: [300], reason: 'deleted a folder', since: 3 }], // not found yet
  ]);
  const agents = [
    { id: 'claude-100', pid: 100, alive: true },
    { id: 'codex-200', pid: 200, alive: true },
    { id: 'claude-999', pid: 999, alive: true },
  ];
  const { adopt, drop } = sortLeftovers(left, agents, new Set([100]));
  assert.deepEqual(adopt.map(({ agent, rootPid, entry }) => [agent.id, rootPid, entry.reason]), [['claude-100', 100, 'opened a decoy secret']]);
  assert.deepEqual(drop, [200]);
});

test('an agent that already finished is not adopted', () => {
  const left = new Map([[100, { pids: [100], reason: 'x', since: 1 }]]);
  const { adopt, drop } = sortLeftovers(left, [{ id: 'claude-100', pid: 100, alive: false }], new Set([100]));
  assert.deepEqual(adopt, []);
  assert.deepEqual(drop, []);
});
