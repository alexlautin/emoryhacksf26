// Gets everything the desktop app bundles ready, before `tauri dev` / `tauri build`:
//   src-tauri/binaries/node-<target>  this Node, which runs the Harness server inside the app
//   src-tauri/build/app/              the server, dashboard, demo and Claude Code hook, plus just the icon and
//                                     font files it needs from node_modules
// Builds for the machine you're on. Build each platform on that platform (or in CI).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { iconFiles, FONT_FILE } from '../src/icons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI = path.join(ROOT, 'src-tauri');
const OUT = path.join(TAURI, 'build', 'app');

const target = process.env.TAURI_ENV_TARGET_TRIPLE
  || execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const ext = target.includes('windows') ? '.exe' : '';
const bin = path.join(TAURI, 'binaries', `node-${target}${ext}`);
fs.mkdirSync(path.dirname(bin), { recursive: true });
fs.copyFileSync(fs.realpathSync(process.execPath), bin);
fs.chmodSync(bin, 0o755);

fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to = path.relative(ROOT, from)) =>
  fs.cpSync(from, path.join(OUT, to), { recursive: true, dereference: true, filter: (p) => !p.includes(`${path.sep}victim-project`) && !p.endsWith('.DS_Store') });

copy(path.join(ROOT, 'src'));
copy(path.join(ROOT, 'public'));
// The native startup screen uses the same brand assets before the server is ready.
fs.cpSync(path.join(ROOT, 'public', 'ui'), path.join(TAURI, 'loading', 'ui'), { recursive: true });
copy(path.join(ROOT, 'demo'));
copy(path.join(ROOT, 'hooks'));
for (const file of iconFiles()) copy(file);
copy(FONT_FILE);
// Phone access draws its pairing QR code with this (no dependencies of its own).
const QR = path.dirname(fileURLToPath(import.meta.resolve('qrcode-generator')));
for (const f of ['qrcode.mjs']) copy(path.join(QR, f), path.join('node_modules', 'qrcode-generator', 'dist', f));
fs.writeFileSync(path.join(OUT, 'node_modules', 'qrcode-generator', 'package.json'), JSON.stringify({ name: 'qrcode-generator', type: 'module', exports: { import: './dist/qrcode.mjs' } }) + '\n');
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'harness', private: true, type: 'module' }, null, 2) + '\n');

console.log(`Staged Harness for ${target}: Node ${process.version}, app files in ${path.relative(ROOT, OUT)}`);
