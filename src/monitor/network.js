// Which servers are the agent and the programs it started talking to?
// Polls `lsof -i` for the processes we're tracking. No sudo needed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dns from 'node:dns/promises';
import { addEvent, getAgent } from '../store.js';
import { analyzeDestination } from '../rules.js';
import { trackedPids } from './processes.js';
import { truncate } from '../describe.js';

const run = promisify(execFile);
const POLL_MS = 1000;
const seen = new Set(); // `${agentId}|${pid or root}|${ip}:${port}`
const dnsCache = new Map();
const IGNORE_PORTS = new Set([4100]); // Seatbelt's own dashboard

async function reverse(ip) {
  if (dnsCache.has(ip)) return dnsCache.get(ip);
  const p = Promise.race([
    dns.reverse(ip).then((names) => names[0] ?? null).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 800)),
  ]);
  dnsCache.set(ip, p);
  return p;
}

function parseRemote(n) {
  // n looks like 192.168.1.5:50123->140.82.112.3:443  or [::1]:50000->[::1]:4199
  const m = n.match(/->(\[[^\]]+\]|[^:]+):(\d+)$/);
  if (!m) return null;
  return { ip: m[1].replace(/^\[|\]$/g, ''), port: +m[2] };
}

async function poll() {
  const tracked = trackedPids();
  if (!tracked.size) return;
  let stdout = '';
  try {
    ({ stdout } = await run('lsof', ['-nP', '-i', '-a', '-p', [...tracked.keys()].join(','), '-F', 'pn'], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    stdout = err.stdout ?? ''; // lsof exits 1 if some pids already ended
  }
  let pid = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = +line.slice(1);
    else if (line.startsWith('n') && pid) {
      const remote = parseRemote(line.slice(1));
      if (!remote || IGNORE_PORTS.has(remote.port)) continue;
      const t = tracked.get(pid);
      if (!t) continue;
      const k = `${t.agentId}|${t.isRoot ? 'root' : pid}|${remote.ip}:${remote.port}`;
      if (seen.has(k)) continue;
      seen.add(k);
      report(t, pid, remote);
    }
  }
}

async function report(t, pid, { ip, port }) {
  const agent = getAgent(t.agentId);
  if (!agent) return;
  // Prefer the hostname written in the command (curl https://example.com) over reverse DNS.
  const fromCmd = t.cmd?.match(/https?:\/\/([^/:\s'"]+)/)?.[1];
  const host = fromCmd ?? (await reverse(ip));
  const d = analyzeDestination({ host, ip, port, isAgentItself: t.isRoot });
  // Package managers and git talk to registries and GitHub through CDNs whose IPs have no useful name.
  if (!d.local && d.risk === 'medium' && /^(npm|pnpm|yarn|bun|pip3?|uv|git|gh|brew)\b/.test(t.cmd ?? '')) {
    d.risk = 'info';
    d.reasons = [];
  }
  const who = t.isRoot ? agent.label : `a program ${agent.label} started (${truncate(t.cmd, 40)})`;
  addEvent({
    agentId: t.agentId,
    kind: 'network',
    risk: d.risk,
    reasons: d.reasons,
    title: d.local ? `${capital(who)} connected to ${d.where}` : `${capital(who)} talked to ${d.where}`,
    detail: `pid ${pid} → ${ip}:${port}${host ? ` (${host})` : ''}`,
    pid,
    host: host ?? ip,
    trusted: d.trusted,
    isAgentItself: t.isRoot,
  });
}

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function startNetworkMonitor() {
  const loop = async () => {
    try {
      await poll();
    } catch (err) {
      console.error('[network]', err.message);
    }
    setTimeout(loop, POLL_MS);
  };
  loop();
}
