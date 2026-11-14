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
import { startGuard, getSettings, setSettings, pauseAgent, resumeAgent, endAgent } from './guard.js';
import { IS_MAC, OS_NAME } from './platform.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = +(process.env.PORT ?? 4100);
const DEEP = process.argv.includes('--eslogger') && IS_MAC;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const demoClients = new Set();

// Icons: a small SVG sprite served as /icons.svg. UI icons from Lucide (lucide-static, ISC license);
// agent logos from Lobe Icons (@lobehub/icons-static-svg, MIT), as `brand-<agent kind>`.
const ICONS = [
  'terminal', 'square-terminal', 'globe', 'file', 'file-text', 'wrench', 'message-square', 'eye', 'eye-off',
  'key-round', 'upload', 'package', 'pause', 'play', 'octagon-x', 'octagon-alert', 'triangle-alert', 'circle-pause',
  'shield', 'shield-check', 'shield-off', 'shield-alert', 'sun', 'moon', 'monitor', 'check', 'info', 'x', 'bot',
];
const BRANDS = {
  claude: 'claudecode', codex: 'codex', gemini: 'geminicli', cursor: 'cursor',
  copilot: 'githubcopilot', opencode: 'opencode', amp: 'amp',
};
let sprite = null;
function iconSprite() {
  if (sprite) return sprite;
  const dir = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
  const symbols = ICONS.map((name) => {
    const svg = fs.readFileSync(path.join(dir, `${name}.svg`), 'utf8');
    const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).trim();
    return `<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`;
  });
  const brandDir = path.join(ROOT, 'node_modules', '@lobehub', 'icons-static-svg', 'icons');
  for (const [kind, file] of Object.entries(BRANDS)) {
    const svg = fs.readFileSync(path.join(brandDir, `${file}.svg`), 'utf8').replace(/<title>.*?<\/title>/, '');
    const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).trim();
    symbols.push(`<symbol id="brand-${kind}" viewBox="0 0 24 24"><g fill="currentColor" fill-rule="evenodd">${inner}</g></symbol>`);
  }
  sprite = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
  return sprite;
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

/** End any demo agent that is still around (for example one Seatbelt paused) and wait for it to exit. */
async function stopDemo() {
  if (!demoRunning || !demoChild) return;
  const exited = new Promise((r) => { demoChild.once('exit', r); setTimeout(r, 4000); });
  for (const a of listAgents()) if (a.kind === 'demo' && a.alive) await endAgent(a.id, { quiet: true }).catch(() => {});
  try { process.kill(demoChild.pid, 'SIGKILL'); } catch {}
  await exited;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/state') {
      return json(res, 200, { agents: listAgents(), events: listEvents({ limit: 1500 }), ollama: await ollamaStatus(), deep: DEEP, os: OS_NAME, settings: getSettings(), baitDir: shortPath(BAIT_DIR), demoRunning });
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
      ignoreWrites(path.join(ROOT, 'demo'));
      await resetDemo();
      rearmBait();
      const child = spawn(process.execPath, [path.join(ROOT, 'demo', 'fake-agent.js')], { cwd: path.join(ROOT, 'demo', 'victim-project'), stdio: 'inherit' });
      demoChild = child;
      child.on('exit', () => { if (demoChild === child) { demoRunning = false; demoChild = null; } });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/icons.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(iconSprite());
    }
    if (url.pathname === '/fonts/instrument-sans.woff2') {
      const font = path.join(ROOT, 'node_modules', '@fontsource-variable', 'instrument-sans', 'files', 'instrument-sans-latin-wght-normal.woff2');
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
      return fs.createReadStream(font).pipe(res);
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
// If Seatbelt ends the upload partway, the request is cut off; report what got through.
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Seatbelt is watching. Dashboard: http://localhost:${PORT}\n`);
  console.log(`  Decoy secrets planted in ${shortPath(BAIT_DIR)}`);
  if (process.argv.includes('--eslogger') && !IS_MAC) console.log('  Deep mode needs macOS; running in standard mode.');
  console.log(DEEP ? '  Deep mode: eslogger (experimental)' : IS_MAC ? '  Mode: standard (no sudo). Use `pnpm deep` for eslogger.' : '  Mode: standard (no admin rights needed).');
});
attacker.listen(4199, '127.0.0.1').on('error', () => console.log('  (demo attacker port 4199 busy; demo upload will fail)'));

startProcessMonitor();
startNetworkMonitor();
startFileMonitor();
startTranscriptMonitor();
startGuard();
if (DEEP) startEslogger();
