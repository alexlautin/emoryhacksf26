import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventReviewer } from '../src/event-review.js';

const task = { id: 14, agentId: 'codex-1', kind: 'task', detail: 'Install dependencies and run tests. PRIVATE_TASK_TEXT.' };
const child = { id: 15, agentId: 'codex-1', kind: 'process', pid: 20, command: 'PRIVATE_COMMAND', steps: [{ role: 'agent' }, { role: 'install' }, { role: 'command' }] };
const connection = { id: 16, agentId: 'codex-1', kind: 'network', pid: 20, risk: 'medium', trusted: false, isAgentItself: false, host: 'internal.example.com', title: 'PRIVATE_TITLE' };
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
  assert.deepEqual(preview.evidence.map(({ eventId }) => eventId), [16, 14, 15]);
  const results = await Promise.all([reviewer.review(connection.id, preview.revision), reviewer.review(connection.id, preview.revision)]);
  for (const result of results) assert.deepEqual(result, { status: 200, body: sample });
  assert.equal(calls, 1);
  assert.deepEqual(input.observations, preview.evidence.map(({ id, text }) => ({ id, text })));
  assert.match(input.observations[1].text, /dependency setup, testing/);
  assert.match(input.observations[2].text, /dependency installation/);
  assert.doesNotMatch(JSON.stringify(input), /PRIVATE_|internal\.example\.com|eventId|codex-1/);
  assert.equal(input.localRisk, 'medium');
  assert.deepEqual(listEvents(), before);
});

test('a mentioned destination is represented as a fact without forwarding its name', () => {
  const requested = { ...task, detail: 'Check https://internal.example.com/status.' };
  const otherSession = { ...child, id: 13, agentId: 'another-agent' };
  const direct = { ...child, steps: [{ role: 'agent' }, { role: 'request' }] };
  const reviewer = createEventReviewer({ listEvents: () => [otherSession, requested, direct, connection] });
  const { evidence } = reviewer.preview(connection.id).body;
  assert.match(evidence[1].text, /destination appeared/);
  assert.match(evidence[2].text, /started the process/);
  assert.doesNotMatch(JSON.stringify(evidence), /internal\.example\.com/);
});

test('unreviewable events, stale previews, and missing credentials never reach Gemini', async () => {
  let calls = 0;
  let events = [task, child, connection, { ...connection, id: 17, risk: 'critical' }];
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

test('the desktop can request review from the hosted service without a Gemini key', async () => {
  const hostedUrl = 'https://getharness.vercel.app/api/event-review';
  const reviewer = createEventReviewer({ hostedUrl, listEvents: () => [task, child, connection], fetcher: async (url, options) => {
    assert.equal(url, hostedUrl);
    assert.equal(options.headers['x-goog-api-key'], undefined);
    assert.doesNotMatch(options.body, /codex-1|internal\.example\.com|PRIVATE_|eventId/);
    return Response.json(sample);
  } });
  const { body: preview } = reviewer.preview(connection.id);
  assert.equal(preview.configured, true);
  assert.deepEqual(await reviewer.review(connection.id, preview.revision), { status: 200, body: sample });
});
