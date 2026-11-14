// Everything that differs between macOS and Windows lives here:
// listing processes, finding a process's folder, listing network connections,
// and pausing, resuming or stopping processes.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
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

const SNAPSHOT_TIMEOUT_MS = 5000;

/**
 * Parse `ps -o pid=,ppid=,args=` (one call, so pid, parent and command line always belong to the
 * same process) plus `ps -o pid=,comm=`. The second call only supplies the program name, and it is
 * used only when it matches the command line: a pid reused between the two calls can't give one
 * process another's name.
 */
export function parseMacPs(argsOut, commOut) {
  const procs = new Map();
  for (const line of argsOut.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s*(.*?)\s*$/);
    if (!m) continue;
    const args = m[3];
    const first = args.split(/\s+/)[0] ?? '';
    procs.set(+m[1], { pid: +m[1], ppid: +m[2], comm: first, args: args || first });
  }
  for (const line of (commOut ?? '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    const p = m && procs.get(+m[1]);
    if (!p) continue;
    const comm = m[2].trim();
    const base = exeName(comm);
    if (base && p.args.toLowerCase().includes(base)) p.comm = comm;
  }
  return procs;
}

async function macProcesses() {
  const opts = { maxBuffer: 64 * 1024 * 1024, timeout: SNAPSHOT_TIMEOUT_MS };
  const [a, b] = await Promise.all([
    run('ps', ['-axww', '-o', 'pid=,ppid=,args='], opts),
    run('ps', ['-axo', 'pid=,comm='], opts).catch(() => ({ stdout: '' })),
  ]);
  return parseMacPs(a.stdout, b.stdout);
}

// On Windows, starting PowerShell for every poll is slow, so one PowerShell process keeps
// printing a JSON snapshot of all processes, separated by a marker line.
const MARK = '<<harness-snapshot>>';
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
        winLatestAt = Date.now();
        for (const w of winWaiters) w.resolve(procs);
        winWaiters = [];
      } catch {}
    }
  });
  winPs.on('error', (err) => { winLastError = err.message; });
  winPs.on('exit', (code) => {
    winPs = null;
    winRestarts++;
    winLastError = `PowerShell process lister exited (code ${code})`;
    setTimeout(startWinLister, 1000);
  });
}
let winLatestAt = 0;
let winRestarts = 0;
let winLastError = null;

/**
 * The latest snapshot from the PowerShell lister. Throws when it has stopped updating, so a
 * stuck lister shows up as a stalled monitor instead of a stale list that looks fine.
 * `fresh` waits for the next snapshot, but never longer than 5 s, so Pause can't hang.
 */
async function winProcesses({ fresh = false, timeoutMs = SNAPSHOT_TIMEOUT_MS } = {}) {
  if (!winPs) startWinLister();
  if (winLatest && !fresh) {
    if (Date.now() - winLatestAt > timeoutMs) {
      throw new Error(`Windows process list hasn't updated for ${Math.round((Date.now() - winLatestAt) / 1000)} s${winLastError ? ` (${winLastError})` : ''}`);
    }
    return winLatest;
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve: (procs) => { clearTimeout(timer); resolve(procs); } };
    const timer = setTimeout(() => {
      winWaiters = winWaiters.filter((w) => w !== waiter);
      reject(new Error(`Couldn't get a process list from Windows within ${Math.round(timeoutMs / 1000)} s${winLastError ? ` (${winLastError})` : ''}`));
    }, timeoutMs);
    winWaiters.push(waiter);
  });
}

/**
 * Every process: Map pid -> { pid, ppid, comm, args }. `fresh` waits for a new snapshot.
 * Rejects (instead of hanging) if no snapshot arrives within a few seconds.
 */
export async function listProcesses(opts) {
  if (IS_WIN) return winProcesses(opts);
  try {
    return await macProcesses();
  } catch (err) {
    if (err.killed || err.signal) throw new Error(`ps didn't answer within ${SNAPSHOT_TIMEOUT_MS / 1000} s`);
    throw err;
  }
}

/**
 * The folder a process is working in. macOS: lsof. Windows has no simple way to ask, so this
 * returns null and the agent's folder is filled in later from its own session log.
 */
export async function processCwd(pid) {
  if (IS_WIN) return null;
  if (process.platform === 'linux') {
    try { return fs.realpathSync(`/proc/${pid}/cwd`); } catch { return null; }
  }
  try {
    const { stdout } = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = stdout.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

// ---------- network ----------

/**
 * lsof and netstat exit non-zero for ordinary reasons (a pid ended, nothing matched), and their
 * output is still good then. A missing program, a timeout or a crash is a real failure: throw it,
 * so the network monitor reports itself as broken instead of quietly finding nothing.
 */
export function listerOutput(err, name) {
  if (typeof err.code === 'string') throw new Error(`${name} couldn't run (${err.code})`);
  if (err.killed || err.signal) throw new Error(`${name} didn't finish in time`);
  return err.stdout ?? '';
}

/** Open TCP connections owned by the given pids: [{ pid, ip, port }]. */
export async function listConnections(pids) {
  if (!pids.length) return [];
  const want = new Set(pids);
  const out = [];
  if (IS_WIN) {
    const opts = { maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 10000 };
    let stdout = '';
    try { ({ stdout } = await run('netstat', ['-ano', '-p', 'TCP'], opts)); } catch (err) { stdout = listerOutput(err, 'netstat'); }
    let v6 = '';
    try { ({ stdout: v6 } = await run('netstat', ['-ano', '-p', 'TCPv6'], opts)); } catch {}
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
    ({ stdout } = await run('lsof', ['-nP', '-i', '-a', '-p', pids.join(','), '-F', 'pn'], { maxBuffer: 16 * 1024 * 1024, timeout: 10000 }));
  } catch (err) {
    stdout = listerOutput(err, 'lsof'); // lsof exits 1 if some pids already ended
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

const NT = `Add-Type -Namespace Harness -Name Nt -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'`;

async function winEach(pids, call) {
  const script = `${NT}; foreach ($id in @(${pids.join(',')})) { try { $p = [Diagnostics.Process]::GetProcessById($id); [Harness.Nt]::${call}($p.Handle) | Out-Null } catch {} }`;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 15000 });
  } catch (err) {
    if (err.killed || err.signal) throw new Error('Windows took too long to pause or resume those programs. Try again.');
    throw err;
  }
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

// Shared by both: credentials, files that redirect package installs or make git run programs,
// and Claude Code's own settings (where Harness's hooks live).
const COMMON_DIRS = [
  { dir: path.join(HOME, '.ssh') },
  { dir: path.join(HOME, '.aws') },
  { dir: path.join(HOME, '.docker'), only: /^config\.json$/ },
  { dir: path.join(HOME, '.claude'), only: /^settings(\.local)?\.json$/ },
];

/**
 * Places where a change means something will start on its own, credentials are being changed,
 * or installs and git are being redirected. `only` limits a folder to some file names;
 * `recursive` also watches subfolders.
 */
export const SENSITIVE_DIRS = IS_WIN
  ? [
      { dir: path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') },
      { dir: path.join(HOME, 'Documents', 'PowerShell') },
      { dir: path.join(HOME, 'Documents', 'WindowsPowerShell') },
      { dir: HOME, only: /^\.(bashrc|bash_profile|profile|gitconfig|npmrc|pypirc)$/ },
      ...COMMON_DIRS,
    ]
  : [
      { dir: path.join(HOME, 'Library', 'LaunchAgents') },
      { dir: HOME, only: /^\.(zshrc|bashrc|zprofile|bash_profile|profile|zshenv|gitconfig|npmrc|pypirc)$/ },
      { dir: path.join(HOME, '.config', 'fish'), recursive: true },
      ...COMMON_DIRS,
    ];
