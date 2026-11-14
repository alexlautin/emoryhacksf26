// pnpm protect <dir>    adds Seatbelt's blocking hooks to <dir>/.claude/settings.json
// pnpm unprotect <dir>  removes only Seatbelt's hook entries (other hooks are kept)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'hooks', 'seatbelt-hook.sh');
const MARK = '.seatbelt/seatbelt-hook.sh';

const cmd = (ev) => `"$CLAUDE_PROJECT_DIR"/${MARK} ${ev}`;
const OURS = {
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('user-prompt'), timeout: 10 }] }],
  PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('pre-tool'), timeout: 120, statusMessage: 'Seatbelt is checking this action…' }] }],
  PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('post-tool'), timeout: 30 }] }],
};

function stripOurs(hooks = {}) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = (groups ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARK)) }))
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
    console.error(`Couldn't read ${file}: ${err.message}. Fix or remove it and try again.`);
    process.exit(1);
  }
}

const [action, target = '.'] = process.argv.slice(2);
const dir = path.resolve(target);
const settingsFile = path.join(dir, '.claude', 'settings.json');

if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`Not a folder: ${dir}`);
  process.exit(1);
}

if (action === 'protect') {
  fs.mkdirSync(path.join(dir, '.seatbelt'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, MARK));
  fs.chmodSync(path.join(dir, MARK), 0o755);
  const settings = readSettings(settingsFile);
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, path.join(dir, '.seatbelt', 'settings.json.before-seatbelt'));
  const hooks = stripOurs(settings.hooks);
  for (const [event, groups] of Object.entries(OURS)) hooks[event] = [...(hooks[event] ?? []), ...groups];
  settings.hooks = hooks;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  console.log(`\n  Seatbelt now checks every Claude Code action in ${dir} before it runs.`);
  console.log('  Keep `pnpm start` running: while Seatbelt is stopped, Claude Code actions there are blocked.');
  console.log('  Restart Claude Code in that folder (or run /hooks) to pick up the change.\n');
} else if (action === 'unprotect') {
  if (fs.existsSync(settingsFile)) {
    const settings = readSettings(settingsFile);
    const hooks = stripOurs(settings.hooks);
    if (Object.keys(hooks).length) settings.hooks = hooks;
    else delete settings.hooks;
    if (Object.keys(settings).length) fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    else fs.rmSync(settingsFile);
  }
  fs.rmSync(path.join(dir, MARK), { force: true });
  console.log(`\n  Removed Seatbelt's hooks from ${dir}.\n`);
} else {
  console.error('Usage: pnpm protect <folder>   |   pnpm unprotect <folder>');
  process.exit(1);
}
