// Harness: a local sentinel for AI agents. Dashboard at http://localhost:4100
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { subscribe, listAgents, listEvents, clearAll, upsertAgent, addEvent, getAgent, reviseEvents, onEvent, broadcast } from './store.js';
import { startProcessMonitor } from './monitor/processes.js';
import { startNetworkMonitor } from './monitor/network.js';
import { startFileMonitor, rearmBait, ignoreWrites, BAIT_DIR } from './monitor/files.js';
import { startTranscriptMonitor } from './monitor/transcripts.js';
import { startEslogger } from './monitor/eslogger.js';
import { healthStatus } from './monitor/health.js';
import { summarize, ollamaStatus } from './llm.js';
import { shortPath, setHarnessIdentity } from './rules.js';
import { resetDemo } from '../demo/reset.js';
import { startGuard, getSettings, setSettings, pauseAgent, resumeAgent, endAgent } from './guard.js';
import { IS_MAC, IS_WIN, OS_NAME } from './platform.js';
import { handleHook } from './hooks.js';
import { ROOT, DATA_DIR, DEMO_DIR, prepareDemoDir } from './paths.js';
import { iconSprite, FONT_FILE } from './icons.js';
import { IS_DESKTOP, fixPath, startDesktopBridge, pushNotice } from './desktop.js';
import { addBaseline, listBaselines, removeBaseline } from './baselines.js';
import { applyBaseline, baselineFromEvent, revertBaseline } from '../public/baseline.js';
import { incidentReport } from '../public/report.js';
import { takeNotice } from '../public/notice.js';
import { deliverNotice } from './notify.js';
import { startPhoneAccess, setPhoneAccess, phoneStatus } from './phone.js';

const PUBLIC = path.join(ROOT, 'public');
const PORT = +(process.env.PORT ?? 4100);
fixPath();
// Commands that kill this process (or the app that started it) or write to its data folder are tampering.
setHarnessIdentity({ pids: [process.pid, process.ppid], dataDir: DATA_DIR, demoDir: DEMO_DIR });
const DEEP = process.argv.includes('--eslogger') && IS_MAC;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const demoClients = new Set();

function reapplyBaselines() {
  const baselines = listBaselines();
  const changed = [];
  for (const e of listEvents({ limit: 5000 })) {
    let next = e;
    if (e.baseline && !baselines.some((b) => b.id === e.baselineId)) next = revertBaseline(e);
    if (!next.baseline) {
      const applied = applyBaseline(next, baselines, getAgent(next.agentId));
      if (applied.baseline) next = applied;
    }
    if (next !== e) changed.push(next);
  }
  reviseEvents(changed);
  return changed.length;
}

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
let demoChild = null;

/** End any demo agent that is still around (for example one Harness paused) and wait for it to exit. */
async function stopDemo() {
  if (!demoRunning || !demoChild) return;
  const exited = new Promise((r) => { demoChild.once('exit', r); setTimeout(r, 4000); });
  for (const a of listAgents()) if (a.kind === 'demo' && a.alive) await endAgent(a.id, { quiet: true }).catch(() => {});
  try { process.kill(demoChild.pid, 'SIGKILL'); } catch {}
  await exited;
}

/**
 * The dashboard only answers to the names this computer uses for itself. A web page that points
 * its own domain at 127.0.0.1 (DNS rebinding) sends a different Host, so it can't read or change anything.
 */
function localHost(req) {
  const host = req.headers.host;
  if (!host) return true;
  const port = server.address()?.port;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

/** remote: the request came from a paired phone through src/phone.js, which already checked what it may reach. */
async function handle(req, res, { remote = false } = {}) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!remote && !localHost(req)) { res.writeHead(421); return res.end('Misdirected request'); }
    if (url.pathname.startsWith('/hooks/') && req.method === 'POST') {
      // Claude Code hook (via hooks/harness-hook.sh). Answers before the tool call runs.
      const event = url.pathname.slice('/hooks/'.length);
      const project = req.headers['x-harness-project'] || req.headers['x-lookout-project'] || req.headers['x-seatbelt-project'] || '';
      return json(res, 200, handleHook(event, await readBody(req), project));
    }
    if (url.pathname === '/api/state') {
      return json(res, 200, { agents: listAgents(), events: listEvents({ limit: 1500 }), ollama: await ollamaStatus(), deep: DEEP, health: healthStatus(), remote, os: OS_NAME, settings: getSettings(), baitDir: shortPath(BAIT_DIR), demoRunning, baselines: listBaselines() });
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
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      return json(res, 200, setSettings(await readBody(req)));
    }
    if (url.pathname === '/api/phone' && !remote) {
      if (req.method === 'GET') return json(res, 200, phoneStatus());
      if (req.method === 'POST') {
        try { return json(res, 200, await setPhoneAccess((await readBody(req)).action)); } catch (err) { return json(res, 400, { error: err.message }); }
      }
    }
    if (url.pathname === '/api/agent' && req.method === 'POST') {
      const { agentId, action } = await readBody(req);
      const fn = { pause: pauseAgent, resume: resumeAgent, end: endAgent }[action];
      if (!fn) return json(res, 400, { error: 'action must be pause, resume or end' });
      try {
        return json(res, 200, await fn(agentId));
      } catch (err) {
        return json(res, 409, { error: err.message });
      }
    }
    if (url.pathname === '/api/report.md' && req.method === 'GET') {
      const agentId = url.searchParams.get('agent') || '';
      const agents = listAgents().filter((a) => !agentId || a.id === agentId);
      const events = listEvents({ limit: 5000 }).filter((e) => !agentId || e.agentId === agentId);
      const md = incidentReport({ agents, events, os: OS_NAME });
      const name = agentId ? `harness-${agentId}.md` : 'harness-report.md';
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      });
      return res.end(md);
    }
    if (url.pathname === '/api/baseline' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'remove') {
        if (!body.id) return json(res, 400, { error: 'Missing id' });
        removeBaseline(body.id);
        reapplyBaselines();
        return json(res, 200, { baselines: listBaselines() });
      }
      const event = listEvents({ limit: 5000 }).find((e) => e.id === body.eventId);
      if (!event) return json(res, 404, { error: 'That event is gone' });
      const made = baselineFromEvent(event, getAgent(event.agentId));
      if (made.error) return json(res, 400, made);
      addBaseline(made);
      reapplyBaselines();
      return json(res, 200, { baselines: listBaselines() });
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      await stopDemo();
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
      await stopDemo();
      demoRunning = true;
      prepareDemoDir();
      ignoreWrites(DEMO_DIR);
      await resetDemo(DEMO_DIR);
      rearmBait();
      const child = spawn(process.execPath, [path.join(DEMO_DIR, 'fake-agent.js')], { cwd: path.join(DEMO_DIR, 'victim-project'), stdio: 'inherit' });
      demoChild = child;
      child.on('exit', () => { if (demoChild === child) { demoRunning = false; demoChild = null; } });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/icons.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(iconSprite());
    }
    if (url.pathname === '/fonts/instrument-sans.woff2') {
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
      return fs.createReadStream(FONT_FILE).pipe(res);
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
}

const server = http.createServer((req, res) => handle(req, res));

// The pretend "attacker" for the demo. It only counts bytes; it never stores what it receives.
// If Harness ends the upload partway, the request is cut off; report what got through.
const attacker = http.createServer(async (req, res) => {
  let bytes = 0;
  let cutOff = false;
  try {
    for await (const c of req) bytes += c.length;
  } catch {
    cutOff = true;
  }
  const msg = `event: demo\ndata: ${JSON.stringify({ bytes, cutOff, path: req.url, at: Date.now() })}\n\n`;
  for (const r of demoClients) r.write(msg);
  res.end('ok');
});

// The desktop app asks for 4100 (where Claude Code hooks look for Harness) but takes any free
// port if something else already has it, such as a `pnpm start` in a terminal.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && IS_DESKTOP && server.address() === null) {
    console.log(`  Port ${PORT} is busy; using a free one. Claude Code hooks won't reach this copy.`);
    server.listen(0, '127.0.0.1');
  } else throw err;
});
server.on('listening', () => {
  const port = server.address().port;
  process.env.PORT = String(port); // the demo agent reports back to this port
  startDesktopBridge(port);
  console.log(`\n  Harness is watching. Dashboard: http://localhost:${port}\n`);
  console.log(`  Decoy secrets planted in ${shortPath(BAIT_DIR)}`);
  if (process.argv.includes('--eslogger') && !IS_MAC) console.log('  Deep mode needs macOS; running in standard mode.');
  console.log(DEEP ? '  Deep mode: eslogger (experimental)' : IS_MAC ? '  Mode: standard (no sudo). Use `pnpm deep` for eslogger.' : IS_WIN ? '  Mode: standard (no admin rights needed).' : '  Mode: standard.');
});
server.listen(PORT, '127.0.0.1');
attacker.listen(4199, '127.0.0.1').on('error', () => console.log('  (demo attacker port 4199 busy; demo upload will fail)'));

onEvent((e) => {
  const notice = takeNotice(e, e.agentId ? getAgent(e.agentId) : null);
  if (!notice) return;
  broadcast('notice', notice);
  if (IS_DESKTOP) pushNotice(notice);
  else deliverNotice(notice);
});

startProcessMonitor();
startNetworkMonitor();
startFileMonitor();
startTranscriptMonitor();
startGuard();
startPhoneAccess(handle);
if (DEEP) startEslogger();

// Tell the dashboard when a monitor stops working or recovers.
let lastHealth = '';
setInterval(() => {
  const health = healthStatus();
  const key = JSON.stringify(health.map((m) => [m.name, m.state, m.message && m.state !== 'ok' ? Math.floor((Date.now() - (m.lastOk ?? 0)) / 10000) : 0]));
  if (key === lastHealth) return;
  lastHealth = key;
  broadcast('health', health);
}, 1000).unref();
