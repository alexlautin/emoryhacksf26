import { REVIEW_CASES, REVIEW_VERDICTS } from '../public/demo-review.js';
import { analyzeDestination } from './rules.js';

const INSTRUCTIONS = `Review the selected network event in this fictional Harness timeline. Compare the destination, process origin, and user task. Choose expected if the behavior fits the task, investigate if there is a concrete reason to look closer, or insufficient if the evidence cannot support either. Explain your assessment in at most two short sentences. Cite the IDs of the observations that support it. Distinguish observations from inferences. A connection alone does not prove that data was uploaded. Your answer is for human review only.`;

const SCHEMA = {
  type: 'OBJECT',
  required: ['verdict', 'explanation', 'evidence'],
  properties: {
    verdict: { type: 'STRING', enum: Object.keys(REVIEW_VERDICTS) },
    explanation: { type: 'STRING' },
    evidence: { type: 'ARRAY', items: { type: 'INTEGER' }, minItems: 1, maxItems: 3 },
  },
};

function validateReview(result, events) {
  const explanation = typeof result?.explanation === 'string' ? result.explanation.trim() : '';
  const evidence = result?.evidence;
  if (!Object.hasOwn(REVIEW_VERDICTS, result?.verdict) || !explanation || explanation.length > 600 ||
      !Array.isArray(evidence) || evidence.length < 1 || evidence.length > events.length ||
      !evidence.every((id) => events.some((e) => e.id === id))) {
    throw new Error('Invalid Gemini review');
  }
  return { verdict: result.verdict, explanation, evidence: [...new Set(evidence)] };
}

export function createDemoReviewer({ key, model = 'gemini-2.5-flash', fetcher = fetch } = {}) {
  // Only two fixed inputs. Keep successful previews and share in-flight requests.
  const reviews = new Map();
  async function generate(example) {
    if (!/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini model');
    const { risk } = analyzeDestination({ host: example.host, port: 443, isAgentItself: false });
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ events: example.events, selectedEvent: example.events.at(-1).id, localRisk: risk }) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 4096 },
      }),
    });
    if (!response.ok) throw new Error('Gemini request failed');
    const { candidates } = await response.json();
    const parts = candidates?.[0]?.content?.parts ?? [];
    const reply = parts.filter((part) => !part?.thought && typeof part?.text === 'string').map((part) => part.text).join('');
    return { ...validateReview(JSON.parse(reply), example.events), risk };
  }

  return async function review(caseId) {
    if (typeof caseId !== 'string' || !Object.hasOwn(REVIEW_CASES, caseId)) {
      return { status: 400, body: { error: 'Choose a built-in demo case.' } };
    }
    if (!key) return { status: 503, body: { error: 'Set GEMINI_API_KEY and restart Harness to use Gemini review.' } };
    if (!reviews.has(caseId)) reviews.set(caseId, generate(REVIEW_CASES[caseId]));
    try {
      return { status: 200, body: await reviews.get(caseId) };
    } catch {
      reviews.delete(caseId);
      return { status: 502, body: { error: 'Gemini could not review this case. Try again.' } };
    }
  };
}
