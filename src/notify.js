// Dangerous events: a system notification on macOS. The dashboard always shows its own banner.
// The menu bar app posts the notification itself (see src/desktop.js), so this stays quiet there.
//
// From the command line, a plain `osascript -e 'display notification ...'` shows up as Script Editor
// with a blank icon. So the first notice builds a tiny helper app, "Harness Alerts", in
// ~/.harness/notifier with Harness's icon. Each notice is written to its queue folder and the helper
// is opened in the background; it shows everything queued and quits. If the helper can't be built,
// notices fall back to plain osascript.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { IS_MAC } from './platform.js';
import { IS_DESKTOP } from './desktop.js';

const run = promisify(execFile);
const HELPER_VERSION = '1';
const HELPER_ID = 'dev.harness.alerts';
const ICON = new URL('./assets/alert-icon.png', import.meta.url);
export const NOTIFIER_DIR = path.join(os.homedir(), '.harness', 'notifier');

function appleString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The applet: show every queued notice (3 lines: title, subtitle, body), oldest first, then delete it. */
export function helperScript(queueDir) {
  return `on run
  showQueued()
end run
on reopen
  showQueued()
end reopen
on showQueued()
  set q to ${appleString(queueDir)}
  set names to paragraphs of (do shell script "ls " & quoted form of q & " 2>/dev/null | grep '\\\\.txt$' | sort || true")
  repeat with n in names
    if (n as text) is not "" then
      set p to q & "/" & n
      try
        set parts to paragraphs of (read (POSIX file p) as «class utf8»)
        display notification (item 3 of parts) with title (item 1 of parts) subtitle (item 2 of parts)
      end try
      do shell script "rm -f " & quoted form of p
      delay 0.3
    end if
  end repeat
end showQueued`;
}

/** One line per field: a notice's text never contains a line break the applet would split on. */
export function noticeFile(notice) {
  const line = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return `Harness\n${line(notice.title)}\n${line(notice.body)}\n`;
}

let building = null;

/** Build (or rebuild after an update) the helper app. Resolves to its path, or null if it can't be built. */
export function ensureHelper(dir = NOTIFIER_DIR) {
  building ??= buildHelper(dir).catch(() => null).finally(() => { building = null; });
  return building;
}

async function buildHelper(dir) {
  const app = path.join(dir, 'Harness Alerts.app');
  const queue = path.join(dir, 'queue');
  const stamp = path.join(app, 'Contents', 'harness-version');
  fs.mkdirSync(queue, { recursive: true });
  try {
    if (fs.readFileSync(stamp, 'utf8') === HELPER_VERSION) return app;
  } catch {}
  const tmp = path.join(dir, `build-${process.pid}.app`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    await run('osacompile', ['-o', tmp, '-e', helperScript(queue)]);
    const res = path.join(tmp, 'Contents', 'Resources');
    const plist = path.join(tmp, 'Contents', 'Info.plist');
    // Use only our icon: drop the compiled asset catalog, which carries the stock applet icon.
    fs.rmSync(path.join(res, 'Assets.car'), { force: true });
    await run('sips', ['-s', 'format', 'icns', fileUrlPath(ICON), '--out', path.join(res, 'applet.icns')]);
    await run('plutil', ['-remove', 'CFBundleIconName', plist]).catch(() => {});
    await run('plutil', ['-replace', 'CFBundleIdentifier', '-string', HELPER_ID, plist]);
    await run('plutil', ['-replace', 'CFBundleName', '-string', 'Harness Alerts', plist]);
    await run('plutil', ['-replace', 'LSUIElement', '-bool', 'YES', plist]); // no Dock icon while it runs
    fs.writeFileSync(path.join(tmp, 'Contents', 'harness-version'), HELPER_VERSION);
    await run('codesign', ['--force', '--deep', '--sign', '-', tmp]);
    fs.rmSync(app, { recursive: true, force: true });
    fs.renameSync(tmp, app);
    return app;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function fileUrlPath(url) {
  return decodeURIComponent(url.pathname);
}

function plainNotice(notice) {
  const script = `display notification ${appleString(notice.body)} with title "Harness" subtitle ${appleString(notice.title)}`;
  try {
    const child = spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

let seq = 0;

async function helperNotice(notice, dir) {
  const app = await ensureHelper(dir);
  if (!app) return plainNotice(notice);
  const name = `${Date.now()}-${process.pid}-${String(seq++).padStart(4, '0')}.txt`;
  const queue = path.join(dir, 'queue');
  fs.writeFileSync(path.join(queue, `.${name}`), noticeFile(notice));
  fs.renameSync(path.join(queue, `.${name}`), path.join(queue, name)); // the applet never reads a half-written file
  try {
    await run('open', ['-g', app]);
    return true;
  } catch {
    fs.rmSync(path.join(queue, name), { force: true });
    return plainNotice(notice);
  }
}

export function deliverNotice(notice, { dir = NOTIFIER_DIR } = {}) {
  if (!notice || IS_DESKTOP || !IS_MAC) return false;
  helperNotice(notice, dir).catch(() => plainNotice(notice));
  return true;
}
