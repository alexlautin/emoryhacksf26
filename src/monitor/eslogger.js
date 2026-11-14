// EXPERIMENTAL "deep mode": Apple's built-in eslogger (macOS 13+) reports every program launch
// and file open as it happens, so nothing is missed between polls. It needs sudo, and the
// terminal running Lookout needs Full Disk Access (System Settings › Privacy & Security).
// Not yet tested end to end: the default mode (polling) is what the demo uses.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { addEvent, getAgent } from '../store.js';
import { analyzeCommand, analyzePath, riskRank, shortPath } from '../rules.js';
import { agentForPid } from './processes.js';
import { truncate } from '../describe.js';

export function startEslogger() {
  console.log('[deep] starting eslogger (you may be asked for your password)…');
  const child = spawn('sudo', ['eslogger', 'exec', 'open'], { stdio: ['inherit', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const pid = d.process?.audit_token?.pid;
    const ppid = d.process?.ppid;
    const agentId = agentForPid(pid) ?? agentForPid(ppid);
    if (!agentId) return;
    const agent = getAgent(agentId);
    const ev = d.event ?? {};
    if (ev.open?.file?.path) {
      const p = ev.open.file.path;
      const r = analyzePath(p);
      if (riskRank(r.risk) < riskRank('high')) return;
      addEvent({ agentId, kind: 'file', risk: r.risk, reasons: r.reasons, title: `A program under ${agent?.label} opened ${shortPath(p)}`, detail: `${d.process?.executable?.path} (pid ${pid}) opened ${p}`, pid, deep: true });
    } else if (ev.exec) {
      const args = (ev.exec.args ?? []).join(' ');
      const r = analyzeCommand(args);
      if (riskRank(r.risk) < riskRank('medium')) return;
      addEvent({ agentId, kind: 'process', risk: r.risk, reasons: r.reasons, title: `A program under ${agent?.label} ran a risky command`, command: truncate(args, 400), detail: `pid ${pid} (deep mode)`, pid, deep: true });
    }
  });
  child.on('exit', (code) => console.log(`[deep] eslogger exited (${code}). Is Full Disk Access granted to this terminal?`));
}
