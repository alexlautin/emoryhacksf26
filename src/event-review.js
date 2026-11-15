import { generateReview, validateReview } from '../website/lib/gemini-review.js';
import { buildReviewPreview } from './review-facts.js';

export function createEventReviewer({ key, model, hostedUrl, listEvents, fetcher = fetch }) {
  const pending = new Map();

  function preview(eventId) {
    if (!Number.isSafeInteger(eventId) || eventId < 1) return null;
    const events = listEvents({ limit: 5000 });
    return buildReviewPreview(events.find((event) => event.id === eventId), events);
  }

  async function generate(input) {
    if (key) return generateReview(input, { key, model, fetcher });
    const response = await fetcher(hostedUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(16000),
      body: JSON.stringify(input),
    });
    if (response.status === 503) return { status: 503, body: { error: 'Hosted Gemini review is unavailable.' } };
    if (response.status === 429) return { status: 429, body: { error: 'The hosted Gemini review limit was reached. Try again later.' } };
    if (!response.ok) throw new Error('Hosted review failed');
    return { status: 200, body: validateReview(await response.json(), input.observations) };
  }

  const unavailable = { status: 404, body: { error: 'This event is unavailable for Gemini review.' } };
  return {
    preview(eventId) {
      const data = preview(eventId);
      if (!data) return unavailable;
      const { revision, evidence } = data;
      return { status: 200, body: { revision, evidence, configured: !!(key || hostedUrl) } };
    },
    async review(eventId, revision) {
      const data = preview(eventId);
      if (!data) return unavailable;
      if (revision !== data.revision) return { status: 409, body: { error: 'The evidence changed. Reopen the review to see the current preview.' } };
      if (!key && !hostedUrl) return { status: 503, body: { error: 'Gemini review is unavailable.' } };
      if (pending.has(revision)) return pending.get(revision);
      if (pending.size >= 3) return { status: 429, body: { error: 'Wait for a review to finish and try again.' } };
      const request = generate(data.input)
        .catch(() => ({ status: 502, body: { error: 'Gemini could not review this event. Try again.' } }))
        .finally(() => pending.delete(revision));
      pending.set(revision, request);
      return request;
    },
  };
}
