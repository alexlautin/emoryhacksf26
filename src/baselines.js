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

export function addBaseline(entry) {
  const exists = items.some((b) => b.projectKey === entry.projectKey && b.type === entry.type && b.value === entry.value);
  if (!exists) {
    items.push(entry);
    save();
  }
  return { baselines: listBaselines(), added: !exists };
}

export function removeBaseline(id) {
  const before = items.length;
  items = items.filter((b) => b.id !== id);
  if (items.length !== before) save();
  return listBaselines();
}
