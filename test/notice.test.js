import assert from 'node:assert/strict';
import test from 'node:test';
import { noticeFor, resetNotices, takeNotice } from '../public/notice.js';

const agent = { id: 'demo-1', label: 'Demo agent', project: 'victim-project' };

test('only a critical event becomes a Dangerous notice', () => {
  assert.equal(noticeFor({ risk: 'high', kind: 'process', title: 'uploaded' }, agent), null);
  assert.equal(noticeFor({ risk: 'critical', kind: 'system', title: 'paused' }, agent), null);
  assert.equal(noticeFor({ risk: 'critical', kind: 'file', title: 'opened a key', baseline: true }, agent), null);
  const n = noticeFor({
    id: 3, risk: 'critical', kind: 'file', agentId: 'demo-1', title: 'Something opened a decoy secret: aws_credentials',
    reasons: ['opened a decoy secret Lookout planted on purpose'],
  }, agent);
  assert.match(n.title, /^Dangerous:/);
  assert.match(n.body, /Demo agent in victim-project/);
  assert.match(n.body, /Opened a decoy secret/);
});

test('a second critical event for the same agent is held for 20 seconds', () => {
  resetNotices();
  const e = { id: 1, risk: 'critical', kind: 'file', agentId: 'demo-1', title: 'opened a decoy', reasons: ['opened a decoy secret'] };
  assert.ok(takeNotice(e, agent, 1000));
  assert.equal(takeNotice({ ...e, id: 2 }, agent, 5000), null);
  assert.ok(takeNotice({ ...e, id: 3, agentId: 'other' }, { ...agent, id: 'other' }, 5000));
  assert.ok(takeNotice({ ...e, id: 4 }, agent, 1000 + 20000));
});
