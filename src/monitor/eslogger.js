// EXPERIMENTAL "deep mode": Apple's built-in eslogger (macOS 13+) reports every program launch
// and file open as it happens, so nothing is missed between polls. It needs sudo, and the
// terminal running Harness needs Full Disk Access (System Settings › Privacy & Security).
//
// Deep mode keeps its own process-to-agent map from fork and exec events, so a process too quick
// for polling is still tied to its agent. Program launches go through the same path as polling
// (recordExec), so they are described and scored the same way and never reported twice.
// If eslogger exits, it is started again with a growing delay.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { addEvent, getAgent } from '../store.js';
import { analyzePath, riskRank, shortPath } from '../rules.js';
import { agentForPid, recordExec } from './processes.js';
import { registerMonitor, monitorOk, monitorFailed } from './health.js';

const MAX_PIDS = 20000;

/**
 * The event handling, separate from eslogger itself so it can be tested.
 * `lookup` is the polling monitor's pid -> agent map; `exec` reports a program launch.
 */
export function createDeepTracker({ lookup = agentForPid, exec = recordExec, report = addEvent, agentOf = getAgent } = {}) {
  const owners = new Map(); // pid -> agentId, learned from fork and exec events

  const ownerOf = (pid) => (pid ? owners.get(pid) ?? lookup(pid) ?? null : null);
  const remember = (pid, agentId) => {
    if (!pid || !agentId) return;
    owners.delete(pid);
    owners.set(pid, agentId);
    if (owners.size > MAX_PIDS) owners.delete(owners.keys().next().value);
  };

  function handle(d) {
    const ev = d?.event ?? {};
    const pid = d?.process?.audit_token?.pid;
    const ppid = d?.process?.ppid;

    if (ev.fork) {
      const child = ev.fork.child?.audit_token?.pid;
      remember(child, ownerOf(pid));
      return;
    }
    if (ev.exit) {
      owners.delete(pid);
      return;
    }
    if (ev.exec) {
      // exec keeps the pid; the new program inherits whoever owned the old one.
      const target = ev.exec.target ?? {};
      const execPid = target.audit_token?.pid ?? pid;
      const agentId = ownerOf(execPid) ?? ownerOf(ppid) ?? ownerOf(target.ppid);
      if (!agentId) return;
      remember(execPid, agentId);
      const args = (ev.exec.args ?? []).join(' ');
      exec({ pid: execPid, ppid: target.ppid ?? ppid, comm: target.executable?.path ?? '', args, agentId });
      return;
    }
    if (ev.open?.file?.path) {
      const agentId = ownerOf(pid) ?? ownerOf(ppid);
      if (!agentId) return;
      const p = ev.open.file.path;
      const r = analyzePath(p);
      if (riskRank(r.risk) < riskRank('high')) return;
      const agent = agentOf(agentId);
      report({ agentId, kind: 'file', risk: r.risk, reasons: r.reasons, title: `A program under ${agent?.label ?? 'an agent'} opened ${shortPath(p)}`, detail: `${d.process?.executable?.path} (pid ${pid}) opened ${p}`, pid, path: p, deep: true });
    }
  }

  return { handle, owners };
}

export function startEslogger({ minDelayMs = 1000, maxDelayMs = 60000 } = {}) {
  registerMonitor('eslogger', { label: 'Deep mode (eslogger)', stallMs: Infinity });
  const tracker = createDeepTracker();
  let delay = minDelayMs;

  const launch = () => {
    console.log('[deep] starting eslogger (you may be asked for your password)…');
    const startedAt = Date.now();
    const child = spawn('sudo', ['eslogger', 'fork', 'exec', 'exit', 'open'], { stdio: ['inherit', 'pipe', 'inherit'] });
    monitorOk('eslogger');
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let d;
      try { d = JSON.parse(line); } catch { return; }
      monitorOk('eslogger');
      try { tracker.handle(d); } catch (err) { console.error('[deep]', err.message); }
    });
    const restart = (why) => {
      monitorFailed('eslogger', why, { down: true });
      // A run that lasted a minute was healthy: start over from the short delay.
      if (Date.now() - startedAt > 60000) delay = minDelayMs;
      console.log(`[deep] eslogger stopped (${why}). Starting it again in ${Math.round(delay / 1000)} s. Is Full Disk Access granted to this terminal?`);
      setTimeout(launch, delay).unref?.();
      delay = Math.min(maxDelayMs, delay * 2);
    };
    let done = false;
    child.on('error', (err) => { if (!done) { done = true; restart(err.message); } });
    child.on('exit', (code, signal) => { if (!done) { done = true; restart(`exit ${code ?? signal}`); } });
  };
  launch();
}
