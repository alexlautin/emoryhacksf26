import test from 'node:test';
import assert from 'node:assert/strict';
import { replayState, validateEvents } from './demo.js';
import { POST } from '../app/api/demo/route.js';
const events = validateEvents([
 { title:'Install',command:'npm install',explanation:'Installs a dependency.',risk:'low',reasons:['installed packages'] },
 { title:'Script',command:'illustrative upload',explanation:'Reads a fake credential.',risk:'critical',reasons:['touched a decoy secret','uploaded data'] },
 { title:'Completed',command:'upload complete',explanation:'Data arrived.',risk:'info',reasons:[] },
]);
test('auto-protect stops at the first critical event and scores the canonical demo at 19',()=>{ const s=replayState(events,3,true); assert.equal(s.events.length,2);assert.equal(s.paused,true);assert.equal(s.score,19);assert.equal(replayState(events,3,false).events.length,3); });
test('rejects unbounded or malformed model output',()=>{assert.throws(()=>validateEvents([]));assert.throws(()=>validateEvents(events.map(e=>({...e,risk:'safe'}))));assert.throws(()=>validateEvents(events.map(e=>({...e,command:'x'.repeat(601)}))));});
test('API rejects unsupported scenarios and unconfigured credentials',async()=>{ const req=scenario=>new Request('http://localhost/api/demo',{method:'POST',body:JSON.stringify({scenario})});assert.equal((await POST(req('unknown'))).status,400);const key=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;try{assert.equal((await POST(req('install'))).status,503);}finally{if(key)process.env.GEMINI_API_KEY=key;} });
test('API rejects cross-origin requests',async()=>{const response=await POST(new Request('http://localhost/api/demo',{method:'POST',headers:{origin:'https://elsewhere.invalid'},body:'{}'}));assert.equal(response.status,403);});

test('API validates Gemini output, forwards credentials only upstream, and reuses cached sessions', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only-key';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
    assert.equal(options.headers['x-goog-api-key'], 'test-only-key');
    const sent = JSON.parse(options.body);
    assert.equal(sent.generationConfig.maxOutputTokens, 16384);
    assert.equal(sent.generationConfig.thinkingConfig.thinkingBudget, 0);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }] });
  };
  try {
    const request = () => new Request('http://localhost/api/demo', { method: 'POST', headers: { origin: 'http://127.0.0.1:4173', host: '127.0.0.1:4173' }, body: JSON.stringify({ scenario: 'install' }) });
    const first = await POST(request());
    assert.equal(first.status, 200);
    const data = await first.json();
    assert.equal(data.source, 'Gemini');
    assert.equal(data.events.length, 3);
    assert.equal((await (await POST(request())).json()).cached, true);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(data).includes('test-only-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('a thought-only Gemini reply is rejected and a thought plus JSON is kept', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only-key';
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    if (prompt.includes('hidden login')) return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'planning the trace' }] } }] });
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'planning' }, { text: JSON.stringify({ events }) }] } }] });
  };
  const ask = (scenario) => POST(new Request('http://localhost/api/demo', { method: 'POST', headers: { origin: 'http://127.0.0.1:4173', host: '127.0.0.1:4173' }, body: JSON.stringify({ scenario }) }));
  try {
    const kept = await ask('clean');
    assert.equal(kept.status, 200);
    assert.equal((await kept.json()).events.length, 3);
    assert.equal((await ask('persistence')).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
