import assert from 'node:assert/strict';
import test from 'node:test';
import { alertCount, computeScore, levelFor, MIN, MAX } from '../public/score.js';

const now = Date.UTC(2026, 5, 1, 12, 0, 0);
const HALF = 12 * 60 * 60 * 1000;

function ev(id, reasons, risk = 'critical', extra = {}) {
  return { id, ts: now, kind: 'process', risk, reasons, ...extra };
}

const secret = (id, ts = now) => ev(id, ['touched a decoy secret Lookout planted (~/.lookout/bait/aws_credentials). No honest task needs this file'], 'critical', { ts });

test('a quiet computer scores 100', () => {
  const s = computeScore([], now);
  assert.equal(s.score, 100);
  assert.equal(s.level.name, 'Clear');
  assert.equal(s.counted, 0);
  assert.ok(s.factors.every((f) => f.lost === 0));
});

test('one decoy read drops the score by that factor’s critical cost', () => {
  const s = computeScore([secret(1)], now);
  assert.equal(s.score, 55);
  assert.equal(s.level.name, 'Review');
  assert.equal(s.factors.find((f) => f.id === 'secrets').lost, 45);
  assert.equal(s.factors.find((f) => f.id === 'uploads').lost, 0);
});

test('the cost halves after 12 hours', () => {
  const s = computeScore([secret(1, now - HALF)], now);
  assert.equal(s.factors.find((f) => f.id === 'secrets').lost, 23);
  assert.equal(s.score, 77);
});

test('a day-old event costs about a quarter', () => {
  const s = computeScore([secret(1, now - 2 * HALF)], now);
  assert.equal(s.factors.find((f) => f.id === 'secrets').lost, 11);
  assert.equal(s.score, 89);
  assert.equal(s.level.name, 'Steady');
});

test('a factor stops at its cap', () => {
  const events = Array.from({ length: 8 }, (_, i) => secret(i + 1));
  const s = computeScore(events, now);
  assert.equal(s.factors.find((f) => f.id === 'secrets').lost, 70);
  assert.equal(s.score, 30);
});

test('enough different problems clamp the score at 0', () => {
  const events = [
    secret(1),
    ev(2, ['uploaded data to a server']),
    ev(3, ['set something up to run automatically in the background, even after a restart']),
    ev(4, ['tried to delete your whole home folder or disk']),
    ev(5, ["connected to a server Lookout doesn't recognize (evil.example:443)"]),
    ev(6, ['installed packages (packages can run their own setup code)'], 'low'),
    secret(7),
    ev(8, ['uploaded data to a server']),
  ];
  const s = computeScore(events, now);
  assert.equal(s.score, MIN);
  assert.equal(s.level.name, 'Act');
  assert.ok(s.score >= MIN && s.score <= MAX);
});

test('system notes and tasks do not cost points', () => {
  const events = [
    { id: 1, ts: now, kind: 'system', risk: 'critical', reasons: ['touched a decoy secret'] },
    { id: 2, ts: now, kind: 'task', risk: 'critical', reasons: ['touched a decoy secret'] },
    { id: 3, ts: now, kind: 'process', risk: 'info', reasons: [] },
  ];
  const s = computeScore(events, now);
  assert.equal(s.score, 100);
  assert.equal(s.counted, 2);
});

test('a package install is a small cost', () => {
  const s = computeScore([ev(1, ['installed packages (packages can run their own setup code)'], 'low')], now);
  assert.equal(s.score, 99);
  assert.equal(s.level.name, 'Clear');
});

test('level boundaries', () => {
  assert.equal(levelFor(100).name, 'Clear');
  assert.equal(levelFor(90).name, 'Clear');
  assert.equal(levelFor(89).name, 'Steady');
  assert.equal(levelFor(70).name, 'Steady');
  assert.equal(levelFor(69).name, 'Review');
  assert.equal(levelFor(40).name, 'Review');
  assert.equal(levelFor(39).name, 'Act');
  assert.equal(levelFor(0).name, 'Act');
  assert.equal(levelFor(-20).name, 'Act');
  assert.equal(levelFor(140).name, 'Clear');
});

test('alert count is paused sessions plus recent high and critical events', () => {
  const agents = [{ alive: true, paused: true }, { alive: true, paused: false }, { alive: false, paused: true }];
  const events = [
    { kind: 'process', risk: 'critical', ts: now - 1000 },
    { kind: 'process', risk: 'high', ts: now - 1000 },
    { kind: 'process', risk: 'medium', ts: now - 1000 },
    { kind: 'process', risk: 'critical', ts: now - 16 * 60 * 1000 },
    { kind: 'system', risk: 'critical', ts: now - 1000 },
  ];
  assert.equal(alertCount(events, agents, now), 3);
  assert.equal(alertCount([], [], now), 0);
});
