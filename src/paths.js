// Where Seatbelt's files live. Running from the repo, everything is inside it.
// In the desktop app the code is read-only inside the app bundle, so the app passes
// SEATBELT_DATA_DIR and Seatbelt keeps its log, settings and demo project there instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEPARATE_DATA = !!process.env.SEATBELT_DATA_DIR;
export const DATA_DIR = SEPARATE_DATA ? path.resolve(process.env.SEATBELT_DATA_DIR) : path.join(ROOT, 'data');
export const DEMO_DIR = SEPARATE_DATA ? path.join(DATA_DIR, 'demo') : path.join(ROOT, 'demo');

fs.mkdirSync(DATA_DIR, { recursive: true });

/** Make sure the demo's files are somewhere writable (a copy, in the desktop app). */
export function prepareDemoDir() {
  if (!SEPARATE_DATA) return;
  const src = path.join(ROOT, 'demo');
  fs.cpSync(src, DEMO_DIR, { recursive: true, filter: (p) => !p.startsWith(path.join(src, 'victim-project')) });
}
