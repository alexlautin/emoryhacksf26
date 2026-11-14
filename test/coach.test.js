import assert from 'node:assert/strict';
import test from 'node:test';
import { COACH_STEPS, coachCursor } from '../public/coach.js';

const task = { kind: 'task', title: 'You asked' };
const script = { kind: 'process', risk: 'high', title: 'A package install script made a web request', reasons: ['this came from a package install script'] };
const secret = { kind: 'file', risk: 'critical', bait: true, reasons: ['opened a decoy secret Harness planted'] };
const paused = { kind: 'system', risk: 'info', guard: 'paused' };

test('the walkthrough has five steps and starts on the intro', () => {
  assert.equal(COACH_STEPS.length, 5);
  assert.equal(coachCursor([]), 0);
});

test('steps move forward only when the earlier ones have happened', () => {
  assert.equal(coachCursor([script, secret]), 0);
  assert.equal(coachCursor([task]), 1);
  assert.equal(coachCursor([task, script]), 2);
  assert.equal(coachCursor([task, script, secret]), 3);
  assert.equal(coachCursor([task, script, secret, paused]), 4);
});

test('a risky step under npm counts even if the title does not say install script', () => {
  const child = {
    kind: 'process', risk: 'high', title: 'A program made a web request',
    steps: [{ role: 'agent' }, { role: 'shell' }, { role: 'install' }, { role: 'command' }],
  };
  assert.equal(coachCursor([task, child]), 2);
  const npmItself = { kind: 'process', risk: 'low', title: 'installed packages', steps: [{ role: 'agent' }, { role: 'install' }] };
  assert.equal(coachCursor([task, npmItself]), 1);
});

test('a network hit on the pretend attacker can close the walkthrough', () => {
  const upload = { kind: 'network', host: '127.0.0.1', title: 'talked to the pretend attacker server', detail: 'pid 9 → 127.0.0.1:4199' };
  assert.equal(coachCursor([task, script, secret, upload]), 4);
});
