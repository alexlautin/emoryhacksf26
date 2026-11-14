// Gets everything the desktop app bundles ready, before `tauri dev` / `tauri build`:
//   src-tauri/binaries/node-<target>  this Node, which runs the Lookout server inside the app
//   src-tauri/build/app/              the server, dashboard, demo and Claude Code hook, plus just the icon and
//                                     font files it needs from node_modules
// Builds for the machine you're on. Build each platform on that platform (or in CI).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ICONS, BRANDS, LUCIDE_DIR, BRAND_DIR, FONT_FILE } from '../src/icons.js';

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
copy(path.join(ROOT, 'demo'));
copy(path.join(ROOT, 'hooks'));
for (const name of ICONS) copy(path.join(LUCIDE_DIR, `${name}.svg`));
for (const file of Object.values(BRANDS)) copy(path.join(BRAND_DIR, `${file}.svg`));
copy(FONT_FILE);
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'lookout', private: true, type: 'module' }, null, 2) + '\n');

console.log(`Staged Lookout for ${target}: Node ${process.version}, app files in ${path.relative(ROOT, OUT)}`);
