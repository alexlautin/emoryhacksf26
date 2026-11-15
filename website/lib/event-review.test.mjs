import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../app/api/event-review/route.js';
import { KINDS, NOTES } from './review-observations.js';

const input = { localRisk: 'medium', selectedEvent: 1, observations: [
  { id: 1, text: [KINDS.network, NOTES.unfamiliar, NOTES.child].join(' ') },
  { id: 2, text: NOTES.install },
] };

const post = (body) => POST(new Request('https://getharness.vercel.app/api/event-review', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}));

test('hosted review rejects arbitrary text and limits repeated Gemini requests', async (t) => {
  const originalKey = process.env.HARNESS_REVIEW_GEMINI_API_KEY;
  const originalModel = process.env.HARNESS_REVIEW_GEMINI_MODEL;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    if (originalKey === undefined) delete process.env.HARNESS_REVIEW_GEMINI_API_KEY;
    else process.env.HARNESS_REVIEW_GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.HARNESS_REVIEW_GEMINI_MODEL;
    else process.env.HARNESS_REVIEW_GEMINI_MODEL = originalModel;
    globalThis.fetch = originalFetch;
  });
  delete process.env.HARNESS_REVIEW_GEMINI_API_KEY;
  delete process.env.HARNESS_REVIEW_GEMINI_MODEL;
  assert.equal((await post(input)).status, 503);

  process.env.HARNESS_REVIEW_GEMINI_API_KEY = 'test-only-key';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
    const sent = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    assert.deepEqual(sent, input);
    const result = { verdict: 'investigate', explanation: 'A dependency made the connection.', nextStep: 'Check the package documentation.', evidence: [1, 2] };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
  };
  assert.equal((await post({ ...input, observations: [{ id: 1, text: 'arbitrary text' }] })).status, 400);
  assert.equal(calls, 0);
  const review = await post({ ...input, privateNote: 'ignored' });
  assert.equal(review.status, 200);
  assert.equal((await review.json()).verdict, 'investigate');
  for (let i = 0; i < 5; i++) assert.equal((await post(input)).status, 200);
  assert.equal((await post(input)).status, 429);
  assert.equal(calls, 1);
});
