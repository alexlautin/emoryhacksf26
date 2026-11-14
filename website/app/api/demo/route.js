import { SCENARIOS, validateEvents } from '../../../lib/demo.js';
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
      systemInstruction: { parts: [{ text: `Create a fictional coding-agent activity trace for an educational Lookout demo. Output JSON only: {"events":[{"title":"short step","command":"illustrative command","explanation":"plain English","risk":"info|low|medium|high|critical","reasons":["classification reason"]}]}. Use 3-8 events in chronological order, starting with a routine command. Never execute commands. Use fake files and example.invalid for destinations. For installs use risk low and reason "installed packages". A credential upload is ONE critical event with reasons "touched a decoy secret" and "uploaded data". Do not split the credential read into a separate event. The prior install plus this event should score 19. End with a separate upload-completion event so auto-protect can stop before completion. For persistence use high and reason "run automatically". Safe commands have risk info and empty reasons. Do not claim this is an actual monitored session.` }] },
      contents: [{ role: 'user', parts: [{ text: SCENARIOS[scenario] }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        // A valid trace is at most 8 events of 600-character fields. Flash also spends this budget on thinking, which cuts the JSON off.
        maxOutputTokens: 16384,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!response.ok) throw new Error('Gemini unavailable');
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('') : '';
  if (!text || data.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('Incomplete model reply');
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
