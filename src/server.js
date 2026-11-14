// Seatbelt: a local sentinel for AI agents. Dashboard at http://localhost:4100
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { subscribe, listAgents, listEvents, clearAll, upsertAgent, addEvent } from './store.js';
import { startProcessMonitor } from './monitor/processes.js';
import { startNetworkMonitor } from './monitor/network.js';
import { startFileMonitor, rearmBait, ignoreWrites, BAIT_DIR } from './monitor/files.js';
import { startTranscriptMonitor } from './monitor/transcripts.js';
import { startEslogger } from './monitor/eslogger.js';
import { summarize, ollamaStatus } from './llm.js';
import { shortPath } from './rules.js';
import { resetDemo } from '../demo/reset.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = +(process.env.PORT ?? 4100);
const DEEP = process.argv.includes('--eslogger');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const demoClients = new Set();

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

let demoRunning = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/state') {
      return json(res, 200, { agents: listAgents(), events: listEvents({ limit: 1500 }), ollama: await ollamaStatus(), deep: DEEP, baitDir: shortPath(BAIT_DIR), demoRunning });
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      subscribe(res);
      demoClients.add(res);
      res.on('close', () => demoClients.delete(res));
      return;
    }
    if (url.pathname === '/api/summary' && req.method === 'POST') {
      const { agentId } = await readBody(req);
      return json(res, 200, await summarize(agentId));
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      clearAll();
      rearmBait();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/demo/step' && req.method === 'POST') {
      // The scripted demo agent reports what its own window would show (real agents: read from their logs).
      const { pid, task, command, title } = await readBody(req);
      const agent = listAgents().find((a) => a.pid === pid && a.kind === 'demo');
      if (!agent) return json(res, 404, { error: 'demo agent not registered yet' });
      if (task) {
        upsertAgent({ id: agent.id, task });
        addEvent({ agentId: agent.id, kind: 'task', risk: 'info', title: `You asked ${agent.label}: “${task}”`, detail: task });
      } else {
        addEvent({ agentId: agent.id, kind: 'tool', risk: 'info', title: title ?? `${agent.label} ran a command`, command, detail: "what the agent's own window showed", agentReported: true });
      }
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/demo/run' && req.method === 'POST') {
      if (demoRunning) return json(res, 409, { error: 'Demo already running' });
      demoRunning = true;
      ignoreWrites(path.join(ROOT, 'demo'));
      await resetDemo();
      rearmBait();
      const child = spawn(process.execPath, [path.join(ROOT, 'demo', 'fake-agent.js')], { cwd: path.join(ROOT, 'demo', 'victim-project'), stdio: 'inherit' });
      child.on('exit', () => { demoRunning = false; });
      return json(res, 200, { ok: true });
    }
    // Static files
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
});

// The pretend "attacker" for the demo. It only counts bytes; it never stores what it receives.
const attacker = http.createServer(async (req, res) => {
  let bytes = 0;
  for await (const c of req) bytes += c.length;
  const msg = `event: demo\ndata: ${JSON.stringify({ bytes, path: req.url, at: Date.now() })}\n\n`;
  for (const r of demoClients) r.write(msg);
  res.end('ok');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Seatbelt is watching. Dashboard: http://localhost:${PORT}\n`);
  console.log(`  Decoy secrets planted in ${shortPath(BAIT_DIR)}`);
  console.log(DEEP ? '  Deep mode: eslogger (experimental)' : '  Mode: standard (no sudo). Use `pnpm deep` for eslogger.');
});
attacker.listen(4199, '127.0.0.1').on('error', () => console.log('  (demo attacker port 4199 busy; demo upload will fail)'));

startProcessMonitor();
startNetworkMonitor();
startFileMonitor();
startTranscriptMonitor();
if (DEEP) startEslogger();
