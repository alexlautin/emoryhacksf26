// pnpm protect <dir>    adds Harness's blocking hooks to <dir>/.claude/settings.json
// pnpm unprotect <dir>  removes only Harness's hook entries (other hooks are kept)
// Entries installed before the rename (.seatbelt/seatbelt-hook.sh) are removed too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'hooks', 'harness-hook.sh');
const MARK = '.harness/harness-hook.sh';
const MARKS = [MARK, '.lookout/lookout-hook.sh', '.seatbelt/seatbelt-hook.sh'];

const cmd = (ev) => `"$CLAUDE_PROJECT_DIR"/${MARK} ${ev}`;
const OURS = {
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('user-prompt'), timeout: 10 }] }],
  PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('pre-tool'), timeout: 120, statusMessage: 'Harness is checking this action…' }] }],
  PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('post-tool'), timeout: 30 }] }],
};

function isOurs(command) {
  const c = String(command ?? '');
  return MARKS.some((m) => c.includes(m));
}

function stripOurs(hooks = {}) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = (groups ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h.command)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) out[event] = kept;
  }
  return out;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Couldn't read ${file}: ${err.message}. Fix or remove it and try again.`);
  }
}

function folder(target) {
  const dir = path.resolve(target);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a folder: ${dir}`);
  return dir;
}

function removeHookFiles(dir) {
  fs.rmSync(path.join(dir, MARK), { force: true });
  for (const mark of MARKS.slice(1)) fs.rmSync(path.join(dir, mark), { force: true });
}

/** Add Harness's hooks to <dir>/.claude/settings.json (keeps everything else, saves a backup). */
export function protect(target) {
  const dir = folder(target);
  const settingsFile = path.join(dir, '.claude', 'settings.json');
  const settings = readSettings(settingsFile);
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, MARK));
  fs.chmodSync(path.join(dir, MARK), 0o755);
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, path.join(dir, '.harness', 'settings.json.before-harness'));
  const hooks = stripOurs(settings.hooks);
  for (const [event, groups] of Object.entries(OURS)) hooks[event] = [...(hooks[event] ?? []), ...groups];
  settings.hooks = hooks;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  for (const mark of MARKS.slice(1)) fs.rmSync(path.join(dir, mark), { force: true });
  return dir;
}

/** Remove only Harness's hook entries from <dir>, including ones from before the rename. */
export function unprotect(target) {
  const dir = folder(target);
  const settingsFile = path.join(dir, '.claude', 'settings.json');
  if (fs.existsSync(settingsFile)) {
    const settings = readSettings(settingsFile);
    const hooks = stripOurs(settings.hooks);
    if (Object.keys(hooks).length) settings.hooks = hooks;
    else delete settings.hooks;
    if (Object.keys(settings).length) fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    else fs.rmSync(settingsFile);
  }
  removeHookFiles(dir);
  return dir;
}

/** Whether <dir> has Harness's hooks (or the pre-rename ones). */
export function isProtected(target) {
  try {
    const settings = readSettings(path.join(path.resolve(target), '.claude', 'settings.json'));
    return isOurs(JSON.stringify(settings.hooks ?? {}));
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, target = '.'] = process.argv.slice(2);
  try {
    if (action === 'protect') {
      const dir = protect(target);
      console.log(`\n  Harness now checks every Claude Code action in ${dir} before it runs.`);
      console.log('  Keep `pnpm start` running: while Harness is stopped, Claude Code actions there are blocked.');
      console.log('  Restart Claude Code in that folder (or run /hooks) to pick up the change.\n');
    } else if (action === 'unprotect') {
      console.log(`\n  Removed Harness's hooks from ${unprotect(target)}.\n`);
    } else {
      console.error('Usage: pnpm protect <folder>   |   pnpm unprotect <folder>');
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
