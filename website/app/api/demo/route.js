import { SCENARIOS, SYSTEM_PROMPT, RESPONSE_SCHEMA, validateEvents } from '../../../lib/demo.js';
export const runtime = 'nodejs';
export const maxDuration = 30;
const cache = new Map();
const pending = new Map();
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function generate(scenario, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid model configuration');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: SCENARIOS[scenario].prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, maxOutputTokens: 4000, temperature: 0.7 },
    }),
  });
  if (!response.ok) throw new Error('Gemini unavailable');
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
  return validateEvents(JSON.parse(text).events);
}
export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== (request.headers.get('host') || new URL(request.url).host)) return json({ error: 'Use the demo from this website.' }, 403);
    } catch { return json({ error: 'Use the demo from this website.' }, 403); }
  }
  if (Number(request.headers.get('content-length')) > 1024) return json({ error: 'Request is too large.' }, 413);
  let body;
  try { const raw = await request.text(); if (raw.length > 1024) return json({ error: 'Request is too large.' }, 413); body = JSON.parse(raw); }
  catch { return json({ error: 'Choose a demo scenario.' }, 400); }
  if (!Object.hasOwn(SCENARIOS, body?.scenario ?? '')) return json({ error: 'Choose a demo scenario.' }, 400);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: 'The browser demo is not available yet. Please try again later.' }, 503);
  const scenario = body.scenario;
  const hit = cache.get(scenario);
  if (hit && hit.expires > Date.now()) return json({ events: hit.events, source: 'Gemini', cached: true });
  try {
    if (!pending.has(scenario)) {
      const work = generate(scenario, key).then(events => { cache.set(scenario, { events, expires: Date.now() + 3600000 }); return events; });
      pending.set(scenario, work);
    }
    const events = await pending.get(scenario);
    return json({ events, source: 'Gemini', cached: false });
  } catch { return json({ error: 'Gemini could not prepare this simulation. Please try again shortly.' }, 502); }
  finally { pending.delete(scenario); }
}
