// Everything that differs between macOS and Windows lives here:
// listing processes, finding a process's folder, listing network connections,
// and pausing, resuming or stopping processes.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const OS_NAME = IS_WIN ? 'Windows' : IS_MAC ? 'Mac' : 'computer';

/** "claude", "codex.exe", "/usr/bin/zsh", "C:\\...\\bash.exe" -> "claude", "codex", "zsh", "bash" */
export function exeName(p) {
  const base = (p ?? '').split(/[\\/]/).pop() ?? '';
  return base.replace(/\.exe$/i, '').toLowerCase();
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'powershell', 'pwsh']);
export const isShell = (comm) => SHELLS.has(exeName(comm));

// ---------- processes ----------

async function macProcesses() {
  const opts = { maxBuffer: 64 * 1024 * 1024 };
  const [a, b] = await Promise.all([
    run('ps', ['-axo', 'pid=,ppid=,comm='], opts),
    run('ps', ['-axww', '-o', 'pid=,args='], opts),
  ]);
  const procs = new Map();
  for (const line of a.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) procs.set(+m[1], { pid: +m[1], ppid: +m[2], comm: m[3], args: m[3] });
  }
  for (const line of b.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m && procs.has(+m[1])) procs.get(+m[1]).args = m[2];
  }
  return procs;
}

// On Windows, starting PowerShell for every poll is slow, so one PowerShell process keeps
// printing a JSON snapshot of all processes, separated by a marker line.
const MARK = '<<seatbelt-snapshot>>';
let winLatest = null;
let winWaiters = [];
let winPs = null;

function startWinLister() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress
  '${MARK}'
  Start-Sleep -Milliseconds 400
}`;
  winPs = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
  let buf = '';
  winPs.stdout.setEncoding('utf8');
  winPs.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf(MARK)) !== -1) {
      const json = buf.slice(0, i).trim();
      buf = buf.slice(i + MARK.length);
      try {
        const list = [].concat(JSON.parse(json));
        const procs = new Map();
        for (const p of list) {
          procs.set(p.ProcessId, { pid: p.ProcessId, ppid: p.ParentProcessId, comm: p.Name ?? '', args: p.CommandLine || p.Name || '' });
        }
        winLatest = procs;
        for (const w of winWaiters) w(procs);
        winWaiters = [];
      } catch {}
    }
  });
  winPs.on('exit', () => { winPs = null; setTimeout(startWinLister, 1000); });
}

async function winProcesses({ fresh = false } = {}) {
  if (!winPs) startWinLister();
  if (winLatest && !fresh) return winLatest;
  return new Promise((resolve) => winWaiters.push(resolve));
}

/** Every process: Map pid -> { pid, ppid, comm, args }. `fresh` waits for a new snapshot. */
export function listProcesses(opts) {
  return IS_WIN ? winProcesses(opts) : macProcesses();
}

/**
 * The folder a process is working in. macOS: lsof. Windows has no simple way to ask, so this
 * returns null and the agent's folder is filled in later from its own session log.
 */
export async function processCwd(pid) {
  if (IS_WIN) return null;
  try {
    const { stdout } = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = stdout.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

// ---------- network ----------

/** Open TCP connections owned by the given pids: [{ pid, ip, port }]. */
export async function listConnections(pids) {
  if (!pids.length) return [];
  const want = new Set(pids);
  const out = [];
  if (IS_WIN) {
    let stdout = '';
    try { ({ stdout } = await run('netstat', ['-ano', '-p', 'TCP'], { maxBuffer: 16 * 1024 * 1024, windowsHide: true })); } catch (err) { stdout = err.stdout ?? ''; }
    let v6 = '';
    try { ({ stdout: v6 } = await run('netstat', ['-ano', '-p', 'TCPv6'], { maxBuffer: 16 * 1024 * 1024, windowsHide: true })); } catch {}
    for (const line of (stdout + '\n' + v6).split(/\r?\n/)) {
      // TCP    192.168.1.5:50123    140.82.112.3:443    ESTABLISHED    1234
      const m = line.trim().match(/^TCP\s+\S+\s+(\[[^\]]+\]|[\d.]+):(\d+)\s+(ESTABLISHED|SYN_SENT|CLOSE_WAIT)\s+(\d+)$/i);
      if (!m || !want.has(+m[4])) continue;
      out.push({ pid: +m[4], ip: m[1].replace(/^\[|\]$/g, ''), port: +m[2] });
    }
    return out;
  }
  let stdout = '';
  try {
    ({ stdout } = await run('lsof', ['-nP', '-i', '-a', '-p', pids.join(','), '-F', 'pn'], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    stdout = err.stdout ?? ''; // lsof exits 1 if some pids already ended
  }
  let pid = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = +line.slice(1);
    else if (line.startsWith('n') && pid && want.has(pid)) {
      // 192.168.1.5:50123->140.82.112.3:443  or  [::1]:50000->[::1]:4199
      const m = line.match(/->(\[[^\]]+\]|[^:]+):(\d+)$/);
      if (m) out.push({ pid, ip: m[1].replace(/^\[|\]$/g, ''), port: +m[2] });
    }
  }
  return out;
}

// ---------- pause / resume / stop ----------

const NT = `Add-Type -Namespace Seatbelt -Name Nt -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'`;

async function winEach(pids, call) {
  const script = `${NT}; foreach ($id in @(${pids.join(',')})) { try { $p = [Diagnostics.Process]::GetProcessById($id); [Seatbelt.Nt]::${call}($p.Handle) | Out-Null } catch {} }`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
}

function sendSignal(pids, sig) {
  for (const pid of pids) {
    try { process.kill(pid, sig); } catch {}
  }
}

/** Freeze processes in place. They can be resumed later. */
export async function suspend(pids) {
  if (!pids.length) return;
  if (IS_WIN) return winEach(pids, 'NtSuspendProcess');
  sendSignal(pids, 'SIGSTOP');
}

export async function resume(pids) {
  if (!pids.length) return;
  if (IS_WIN) return winEach(pids, 'NtResumeProcess');
  sendSignal(pids, 'SIGCONT');
}

/** Ask processes to quit (`force`: kill them outright). Works on frozen processes too. */
export async function terminate(pids, { force = false } = {}) {
  if (!pids.length) return;
  if (IS_WIN) {
    const args = pids.flatMap((p) => ['/PID', String(p)]);
    try { await run('taskkill', [...args, '/T', '/F'], { windowsHide: true }); } catch {}
    return;
  }
  sendSignal(pids, force ? 'SIGKILL' : 'SIGTERM');
  if (!force) sendSignal(pids, 'SIGCONT'); // a stopped process only acts on SIGTERM once it runs again
}

// ---------- places worth watching ----------

const HOME = os.homedir();
const APPDATA = process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming');

/** Folders where a new file means something will start on its own, plus SSH and shell startup files. */
export const SENSITIVE_DIRS = IS_WIN
  ? [
      { dir: path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') },
      { dir: path.join(HOME, '.ssh') },
      { dir: path.join(HOME, 'Documents', 'PowerShell') },
      { dir: path.join(HOME, 'Documents', 'WindowsPowerShell') },
      { dir: HOME, only: /^\.(bashrc|bash_profile|profile)$/ },
    ]
  : [
      { dir: path.join(HOME, 'Library', 'LaunchAgents') },
      { dir: path.join(HOME, '.ssh') },
      { dir: HOME, only: /^\.(zshrc|bashrc|zprofile|bash_profile|profile|zshenv)$/ },
    ];
