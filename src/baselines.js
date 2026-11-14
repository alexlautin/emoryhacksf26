// Saved "this is normal here" marks. One file, this computer only.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const FILE = path.join(DATA_DIR, 'baselines.json');

let items = [];
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (Array.isArray(parsed)) items = parsed;
} catch {}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function listBaselines() {
  return items.map((b) => ({ ...b }));
}

function sameMark(a, b) {
  return a.projectKey === b.projectKey && a.type === b.type && a.value === b.value;
}

export function addBaseline(entry) {
  const same = (b) => sameMark(b, entry);
  const replacing = entry.type === 'command' && entry.matchVersion === 2;
  if (replacing) {
    // An older row can store the same text and still not count. Replace it.
    const hasLive = items.some((b) => same(b) && b.matchVersion === 2);
    const hasStale = items.some((b) => same(b) && b.matchVersion !== 2);
    if (hasLive) {
      if (hasStale) {
        items = items.filter((b) => !(same(b) && b.matchVersion !== 2));
        save();
      }
      return { baselines: listBaselines(), added: false };
    }
    if (hasStale) items = items.filter((b) => !(same(b) && b.matchVersion !== 2));
  } else if (items.some(same)) {
    return { baselines: listBaselines(), added: false };
  }
  items.push(entry);
  save();
  return { baselines: listBaselines(), added: true };
}

export function removeBaseline(id) {
  const before = items.length;
  items = items.filter((b) => b.id !== id);
  if (items.length !== before) save();
  return listBaselines();
}
