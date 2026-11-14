// Dangerous events: a system notification on macOS. The dashboard always shows its own banner.
// The menu bar app posts the notification itself (see src/desktop.js), so this stays quiet there.
import { spawn } from 'node:child_process';
import { IS_MAC } from './platform.js';
import { IS_DESKTOP } from './desktop.js';

function appleString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function deliverNotice(notice) {
  if (!notice || IS_DESKTOP || !IS_MAC) return false;
  const script = `display notification ${appleString(notice.body)} with title "Lookout" subtitle ${appleString(notice.title)}`;
  try {
    const child = spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
