// Which servers are the agent and the programs it started talking to?
// Polls open connections for the processes we're tracking (lsof on macOS, netstat on Windows).
import dns from 'node:dns/promises';
import { addEvent, getAgent } from '../store.js';
import { analyzeDestination } from '../rules.js';
import { trackedPids } from './processes.js';
import { truncate } from '../describe.js';
import { listConnections } from '../platform.js';

const POLL_MS = 1000;
const seen = new Set(); // `${agentId}|${pid or root}|${ip}:${port}`
const dnsCache = new Map();
const IGNORE_PORTS = new Set([+(process.env.PORT ?? 4100)]); // Lookout's own dashboard

async function reverse(ip) {
  if (dnsCache.has(ip)) return dnsCache.get(ip);
  const p = Promise.race([
    dns.reverse(ip).then((names) => names[0] ?? null).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 800)),
  ]);
  dnsCache.set(ip, p);
  return p;
}

async function poll() {
  const tracked = trackedPids();
  if (!tracked.size) return;
  for (const { pid, ip, port } of await listConnections([...tracked.keys()])) {
    if (IGNORE_PORTS.has(port)) continue;
    const t = tracked.get(pid);
    if (!t) continue;
    const k = `${t.agentId}|${t.isRoot ? 'root' : pid}|${ip}:${port}`;
    if (seen.has(k)) continue;
    seen.add(k);
    report(t, pid, { ip, port });
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
