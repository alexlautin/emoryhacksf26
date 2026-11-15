import { generateReview } from '../../../lib/gemini-review.js';
import { safeReviewInput } from '../../../lib/review-observations.js';

export const runtime = 'nodejs';
export const maxDuration = 20;

const WINDOW = 60_000;
const attempts = new Map();
const reviews = new Map();
let windowEnds = 0;
let total = 0;

function allowRequest(address) {
  const now = Date.now();
  if (now >= windowEnds) {
    attempts.clear();
    total = 0;
    windowEnds = now + WINDOW;
  }
  const count = attempts.get(address) ?? 0;
  if (count >= 6 || total >= 30) return false;
  attempts.set(address, count + 1);
  total++;
  return true;
}

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request) {
  if (request.headers.get('content-type') !== 'application/json' || Number(request.headers.get('content-length')) > 4096) {
    return reply({ error: 'Expected a small JSON review.' }, 400);
  }
  let input;
  try {
    const body = await request.text();
    if (body.length <= 4096) input = safeReviewInput(JSON.parse(body));
  } catch {}
  if (!input) return reply({ error: 'Invalid event observations.' }, 400);

  const key = process.env.HARNESS_REVIEW_GEMINI_API_KEY?.trim();
  if (!key) return reply({ error: 'Hosted Gemini review is unavailable.' }, 503);

  // Vercel supplies this header. The app does not send a device identifier.
  if (!allowRequest(request.headers.get('x-vercel-forwarded-for') || 'unknown')) {
    return reply({ error: 'Review limit reached. Try again later.' }, 429);
  }

  // Reuse results for identical, sanitized inputs. This cache and the throttle
  // apply to a warm instance. The Gemini project quota caps usage across instances.
  const id = JSON.stringify(input);
  const cached = reviews.get(id);
  if (cached?.expires > Date.now()) {
    const result = await cached.request;
    return reply(result.body, result.status);
  }
  if (reviews.size >= 128) reviews.delete(reviews.keys().next().value);
  const entry = {
    expires: Date.now() + 10 * WINDOW,
    request: generateReview(input, { key, model: process.env.HARNESS_REVIEW_GEMINI_MODEL || undefined })
      .catch(() => ({ status: 502, body: { error: 'Gemini could not review this event.' } })),
  };
  reviews.set(id, entry);
  const result = await entry.request;
  if (result.status !== 200 && reviews.get(id) === entry) reviews.delete(id);
  return reply(result.body, result.status);
}
