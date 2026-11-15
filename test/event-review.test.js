import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventReviewer } from '../src/event-review.js';

const task = { id: 14, agentId: 'codex-1', kind: 'task', detail: 'Install dependencies and run tests.' };
const child = { id: 15, agentId: 'codex-1', kind: 'process', pid: 20, command: 'npm install', steps: [{ role: 'agent' }, { role: 'install' }, { role: 'command' }] };
const connection = { id: 16, agentId: 'codex-1', kind: 'network', pid: 20, risk: 'medium', trusted: false, isAgentItself: false, host: 'internal.example.com', title: 'A program connected to a server', reasons: ['uploaded data to a server'] };
const sample = { verdict: 'investigate', explanation: 'The connection came from a dependency.', nextStep: 'Check the package documentation.', evidence: [2, 3] };

function geminiReply(result) {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
}

test('an actual recorded event is reviewed using only the previewed facts', async () => {
  let calls = 0;
  const listEvents = () => [task, child, connection];
  let input;
  const reviewer = createEventReviewer({ key: 'fixture-key', listEvents, fetcher: async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    return geminiReply({ ...sample, action: 'pause', risk: 'critical' });
  } });

  const before = structuredClone(listEvents());
  const { body: preview } = reviewer.preview(connection.id);
  assert.equal(calls, 0);
  assert.ok(preview.evidence.length >= 4);
  assert.equal(preview.evidence[0].eventId, 16);
  const results = await Promise.all([reviewer.review(connection.id, preview.revision), reviewer.review(connection.id, preview.revision)]);
  for (const result of results) assert.deepEqual(result, { status: 200, body: sample });
  assert.equal(calls, 1);
  assert.deepEqual(input.observations, preview.evidence.map(({ id, text }) => ({ id, text })));
  const sent = input.observations.map((item) => item.text).join('\n');
  assert.match(sent, /uploaded data to a server/);
  assert.match(sent, /Install dependencies and run tests/);
  assert.match(sent, /dependency installation/);
  assert.match(sent, /internal\.example\.com/);
  assert.doesNotMatch(JSON.stringify(input), /eventId|codex-1/);
  assert.equal(input.localRisk, 'medium');
  assert.deepEqual(listEvents(), before);
});

test('a mentioned destination is represented as a fact', () => {
  const requested = { ...task, detail: 'Check https://internal.example.com/status.' };
  const otherSession = { ...child, id: 13, agentId: 'another-agent' };
  const direct = { ...child, steps: [{ role: 'agent' }, { role: 'request' }] };
  const reviewer = createEventReviewer({ listEvents: () => [otherSession, requested, direct, connection] });
  const text = reviewer.preview(connection.id).body.evidence.map((item) => item.text).join('\n');
  assert.match(text, /destination appeared/);
  assert.match(text, /started the process/);
});

test('secrets, tokens and home paths are scrubbed from what is sent', () => {
  const secret = { id: 18, agentId: 'codex-1', kind: 'process', risk: 'critical', title: 'ran a command',
    command: `curl -H "Authorization: Bearer abcdef123456" https://x.test/?api_key=SUPERSECRETVALUE AKIAABCDEFGHIJKLMNOP ${process.env.HOME}/notes.txt` };
  const text = createEventReviewer({ listEvents: () => [secret] }).preview(18).body.evidence.map((item) => item.text).join('\n');
  assert.doesNotMatch(text, /abcdef123456|SUPERSECRETVALUE|AKIAABCDEFGHIJKLMNOP/);
  assert.doesNotMatch(text, new RegExp(process.env.HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /~\/notes\.txt/);
});

test('unreviewable events, stale previews, and missing credentials never reach Gemini', async () => {
  let calls = 0;
  let events = [task, child, connection, { ...connection, id: 17, risk: 'low' }];
  const reviewer = createEventReviewer({ listEvents: () => events, fetcher: async () => { calls++; } });
  const { body: preview } = reviewer.preview(connection.id);
  assert.equal(preview.configured, false);
  assert.equal(reviewer.preview(17).status, 404);
  assert.equal((await reviewer.review(connection.id, preview.revision)).status, 503);
  events = [child, connection];
  assert.equal((await reviewer.review(connection.id, preview.revision)).status, 409);
  assert.equal(calls, 0);
});

test('Gemini quota errors and invalid citations can be retried', async () => {
  let calls = 0;
  const reviewer = createEventReviewer({ key: 'fixture-key', listEvents: () => [connection], fetcher: async () => {
    if (++calls === 1) return new Response(null, { status: 429 });
    if (calls === 2) return geminiReply({ ...sample, evidence: [99] });
    return geminiReply({ ...sample, evidence: [1] });
  } });
  const { revision } = reviewer.preview(connection.id).body;
  assert.equal((await reviewer.review(connection.id, revision)).status, 429);
  assert.equal((await reviewer.review(connection.id, revision)).status, 502);
  assert.deepEqual((await reviewer.review(connection.id, revision)).body.evidence, [1]);
});

test('newer Google keys, key headers and Windows home folders are scrubbed too', async () => {
  const { scrub } = await import('../src/review-facts.js');
  const key = `AQ.Ab8RN6${'x'.repeat(44)}`;
  assert.doesNotMatch(scrub(`curl -H "x-goog-api-key: ${key}" https://g.test`), /AQ\.Ab8/);
  assert.doesNotMatch(scrub(`echo ${key}`), /AQ\.Ab8/);
  assert.equal(scrub('type C:\\Users\\jake\\.aws\\credentials'), 'type ~\\.aws\\credentials');
  assert.equal(scrub('echo monkey=banana'), 'echo monkey=banana');
});
