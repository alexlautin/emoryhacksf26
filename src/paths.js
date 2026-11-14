// Where Harness's files live. Running from the repo, everything is inside it.
// In the desktop app the code is read-only inside the app bundle, so the app passes
// HARNESS_DATA_DIR (SEATBELT_DATA_DIR still works) and Harness keeps its log, settings
// and demo project there instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requestedDataDir() {
  return process.env.HARNESS_DATA_DIR || process.env.LOOKOUT_DATA_DIR || process.env.SEATBELT_DATA_DIR || '';
}

// First launch after the rename: copy the old desktop folder if the new one is empty.
function migrateLegacyData(dir) {
  if (path.basename(dir) !== 'dev.harness.monitor') return;
  const old = ['dev.lookout.monitor', 'dev.seatbelt.monitor'].map(name => path.join(path.dirname(dir), name)).find(candidate => fs.existsSync(candidate));
  const hasNew = fs.existsSync(path.join(dir, 'settings.json')) || fs.existsSync(path.join(dir, 'events.jsonl'));
  if (hasNew || !old) return;
  fs.cpSync(old, dir, { recursive: true });
}

const requested = requestedDataDir();
export const SEPARATE_DATA = !!requested;
export const DATA_DIR = requested ? path.resolve(requested) : path.join(ROOT, 'data');
if (requested) migrateLegacyData(DATA_DIR);
export const DEMO_DIR = SEPARATE_DATA ? path.join(DATA_DIR, 'demo') : path.join(ROOT, 'demo');

fs.mkdirSync(DATA_DIR, { recursive: true });

/** Make sure the demo's files are somewhere writable (a copy, in the desktop app). */
export function prepareDemoDir() {
  if (!SEPARATE_DATA) return;
  const src = path.join(ROOT, 'demo');
  fs.cpSync(src, DEMO_DIR, { recursive: true, filter: (p) => !p.startsWith(path.join(src, 'victim-project')) });
}
