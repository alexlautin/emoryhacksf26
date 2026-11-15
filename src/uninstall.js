// Takes back everything Harness put on this computer, so removing the app leaves nothing behind.
//   node src/uninstall.js            clean up (also what the app's "Uninstall Harness…" and the Windows uninstaller run)
//   node src/uninstall.js --dry-run  only list what it would change
//
// What Harness puts outside its own app and data folder:
//   - Claude Code hooks in every folder you protected (<folder>/.claude/settings.json + .harness/harness-hook.sh).
//     These matter most: the hook blocks Claude Code's tool calls when Harness isn't running, so leaving
//     one behind would stop Claude Code working in that folder.
//   - Decoy secrets in ~/.harness/bait (and the same folders from the Lookout / Seatbelt names).
// The app itself (login item, data folder, the app bundle) is removed by the desktop shell, see src-tauri.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unprotect, isProtected, protectedFolders } from './protect.js';

const HOME = os.homedir();
const HOOK_FILES = ['.harness/harness-hook.sh', '.lookout/lookout-hook.sh', '.seatbelt/seatbelt-hook.sh'];
const HOME_DIRS = ['.harness', '.lookout', '.seatbelt'].map((name) => path.join(HOME, name));
// Folders that are never someone's project, or are too big to be worth walking.
const SKIP = new Set(['node_modules', 'Library', 'AppData', 'Applications', 'Movies', 'Music', 'Pictures', '.Trash', '.git', '.cache', '.npm', '.pnpm-store', '.cargo', '.rustup', '.docker', '.local', '.nvm', 'OneDrive']);
const MAX_DEPTH = 6;
const MAX_DIRS = 40000;

/**
 * The desktop app keeps its list of protected folders in its own data folder. The command line and the
 * Windows uninstaller don't run with HARNESS_DATA_DIR set, so look in the app's folders (and the pre-rename ones) too.
 */
function desktopRegistries() {
  const bases = process.platform === 'darwin' ? [path.join(HOME, 'Library', 'Application Support')]
    : process.platform === 'win32' ? [process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming')]
    : [process.env.XDG_DATA_HOME ?? path.join(HOME, '.local', 'share')];
  return bases.flatMap((base) => ['dev.harness.monitor', 'dev.lookout.monitor', 'dev.seatbelt.monitor'].map((id) => path.join(base, id, 'protected-folders.json')));
}

function recordedFolders() {
  return [...new Set([protectedFolders(), ...desktopRegistries().map((file) => protectedFolders(file))].flat())];
}

function hasHook(dir) {
  return HOOK_FILES.some((f) => fs.existsSync(path.join(dir, f))) || isProtected(dir);
}

/** Folders with Harness's Claude Code hooks: the ones Harness remembers, plus a look through your home folder. */
export function findHookFolders({ roots = [HOME], extra = recordedFolders() } = {}) {
  const found = new Set();
  for (const dir of extra) if (fs.existsSync(dir) && hasHook(dir)) found.add(path.resolve(dir));

  let visited = 0;
  const queue = roots.map((dir) => [dir, 0]);
  while (queue.length && visited < MAX_DIRS) {
    const [dir, depth] = queue.shift();
    visited++;
    if (hasHook(dir)) found.add(path.resolve(dir));
    if (depth >= MAX_DEPTH) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || SKIP.has(e.name)) continue;
      queue.push([path.join(dir, e.name), depth + 1]);
    }
  }
  return [...found].sort();
}

/** What an uninstall would change, without changing anything. */
export function planUninstall({ homeDirs = HOME_DIRS, ...options } = {}) {
  return {
    hookFolders: findHookFolders(options),
    homeDirs: homeDirs.filter((dir) => fs.existsSync(dir)),
  };
}

/**
 * Remove Harness's hooks from every protected folder, then its decoy files.
 * `onFolder(dir)` runs just before a folder is changed, so a running Harness can ignore the edit.
 */
export function uninstallCleanup({ dryRun = false, onFolder, ...options } = {}) {
  const plan = planUninstall(options);
  const result = { ...plan, removedHooks: [], failed: [], dryRun };
  if (dryRun) return result;

  for (const dir of plan.hookFolders) {
    try {
      onFolder?.(dir);
      unprotect(dir);
      result.removedHooks.push(dir);
    } catch (err) {
      result.failed.push({ dir, error: err.message, kind: 'hook' });
    }
  }
  for (const dir of plan.homeDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) { result.failed.push({ dir, error: err.message, kind: 'decoy' }); }
  }
  return result;
}

export function describeResult(r) {
  const lines = [];
  const verb = r.dryRun ? 'Would remove' : 'Removed';
  const hooks = r.dryRun ? r.hookFolders : r.removedHooks;
  lines.push(hooks.length ? `${verb} Claude Code hooks from ${hooks.length} folder${hooks.length === 1 ? '' : 's'}:` : 'No Claude Code hooks found.');
  for (const dir of hooks) lines.push(`  ${dir}`);
  if (r.homeDirs.length) lines.push(`${verb} decoy files: ${r.homeDirs.join(', ')}`);
  for (const f of r.failed) lines.push(`Could not clean ${f.dir}: ${f.error}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = uninstallCleanup({ dryRun: process.argv.includes('--dry-run') });
  if (!process.argv.includes('--quiet')) console.log(describeResult(result));
  // 1: some hooks are still in place. 2: hooks are gone but a decoy folder couldn't be deleted. The Windows uninstaller relies on this.
  process.exit(result.failed.some((f) => f.kind === 'hook') ? 1 : result.failed.length ? 2 : 0);
}
