import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoReviewer } from '../src/demo-review.js';
import { REVIEW_CASES } from '../public/demo-review.js';

function geminiReply(result) {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
}

test('Gemini reviews the two built-in timelines with the same local risk rating', async () => {
  let calls = 0;
  const review = createDemoReviewer({ key: 'fixture-key', fetcher: async (url, options) => {
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.contents[0].parts[0].text);
    const caseId = Object.keys(REVIEW_CASES)[calls++];
    assert.deepEqual(input, { events: REVIEW_CASES[caseId].events, selectedEvent: 3, localRisk: 'medium' });
    return geminiReply({ verdict: caseId === 'staging' ? 'expected' : 'investigate', explanation: 'The process origin matters.', evidence: [1, 3], action: 'pause' });
  } });

  const [staging, duplicate] = await Promise.all([review('staging'), review('staging')]);
  assert.deepEqual(staging, { status: 200, body: { verdict: 'expected', explanation: 'The process origin matters.', evidence: [1, 3], risk: 'medium' } });
  assert.deepEqual(duplicate, staging);
  const install = await review('install');
  assert.equal(install.status, 200);
  assert.equal(install.body.risk, 'medium');
  assert.equal(install.body.verdict, 'investigate');
  assert.equal(calls, 2);
});

test('unknown cases and missing credentials never reach Google', async () => {
  let calls = 0;
  const review = createDemoReviewer({ fetcher: async () => { calls++; } });
  assert.equal((await review('constructor')).status, 400);
  assert.equal((await review({ event: 'private log' })).status, 400);
  assert.equal((await review('install')).status, 503);
  assert.equal(calls, 0);
});

test('an invalid citation is rejected and can be retried', async () => {
  let calls = 0;
  const review = createDemoReviewer({ key: 'fixture-key', fetcher: async () => geminiReply({
    verdict: 'insufficient', explanation: 'The evidence does not establish a transfer.', evidence: [++calls === 1 ? 99 : 3],
  }) });
  assert.equal((await review('install')).status, 502);
  assert.deepEqual((await review('install')).body.evidence, [3]);
});
