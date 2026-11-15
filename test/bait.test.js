import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareBait, markerIn, classifyBaitChange } from '../src/monitor/files.js';
import { baitMarkers, baitPaths } from '../src/rules.js';

const OLD = 'ABCDEFGHIJKLMNOP';
const NEW = 'QRSTUVWXYZ234567';

function seatbeltAws(marker) {
  return `# Seatbelt decoy. These keys are fake and do nothing.\n[default]\naws_access_key_id = AKIA${marker}\naws_secret_access_key = sb-decoy/${marker}${marker.toLowerCase().slice(0, 12)}\n`;
}

function harnessAws(marker) {
  return `# Harness decoy. These keys are fake and do nothing.\n[default]\naws_access_key_id = AKIA${marker}\naws_secret_access_key = lk-decoy/${marker}${marker.toLowerCase().slice(0, 12)}\n`;
}

function fresh() {
  baitMarkers.clear();
  baitPaths.clear();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-bait-'));
  return {
    root,
    baitDir: path.join(root, 'harness'),
    legacyDir: path.join(root, 'seatbelt'),
    markersFile: path.join(root, 'data', 'bait-markers.json'),
  };
}

test('markerIn reads the value out of each decoy shape', () => {
  assert.equal(markerIn(seatbeltAws(OLD)), OLD);
  assert.equal(markerIn(`Seatbelt decoy file. Nothing real here.\nbank: ${OLD}-decoy\n`), OLD);
  const key = `-----BEGIN OPENSSH PRIVATE KEY-----\n${Buffer.from(`Seatbelt decoy key. Not real. ${OLD}`).toString('base64')}\n${OLD}\n-----END OPENSSH PRIVATE KEY-----\n`;
  assert.equal(markerIn(key), OLD);
  assert.equal(markerIn('not a decoy\naws_access_key_id = AKIAnotourformat\n'), null);
});

test('a copied Seatbelt decoy keeps its marker when the markers file is empty', () => {
  const dirs = fresh();
  fs.mkdirSync(dirs.legacyDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.legacyDir, 'aws_credentials'), seatbeltAws(OLD));
  prepareBait(dirs);
  const rewritten = fs.readFileSync(path.join(dirs.baitDir, 'aws_credentials'), 'utf8');
  assert.match(rewritten, /Harness decoy/);
  assert.equal(rewritten.includes(OLD), true);
  assert.equal(rewritten.includes('Seatbelt'), false);
  assert.equal(baitMarkers.get(OLD), path.join(dirs.baitDir, 'aws_credentials'));
  assert.equal(baitPaths.has(path.join(dirs.legacyDir, 'aws_credentials')), true);
  const saved = JSON.parse(fs.readFileSync(dirs.markersFile, 'utf8'));
  assert.equal(saved.aws_credentials, OLD);
});

test('an old marker still counts after the new file was given a different one', () => {
  const dirs = fresh();
  fs.mkdirSync(dirs.baitDir, { recursive: true });
  fs.mkdirSync(dirs.legacyDir, { recursive: true });
  fs.mkdirSync(path.dirname(dirs.markersFile), { recursive: true });
  fs.writeFileSync(path.join(dirs.baitDir, 'aws_credentials'), harnessAws(NEW));
  fs.writeFileSync(path.join(dirs.legacyDir, 'aws_credentials'), seatbeltAws(OLD));
  fs.writeFileSync(dirs.markersFile, JSON.stringify({ aws_credentials: NEW }));
  prepareBait(dirs);
  assert.equal(baitMarkers.get(NEW), path.join(dirs.baitDir, 'aws_credentials'));
  assert.equal(baitMarkers.get(OLD), path.join(dirs.legacyDir, 'aws_credentials'));
  assert.equal(fs.readFileSync(path.join(dirs.baitDir, 'aws_credentials'), 'utf8').includes(NEW), true);
});

test('a file in the old folder that is not our decoy does not add a marker', () => {
  const dirs = fresh();
  fs.mkdirSync(dirs.legacyDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.legacyDir, 'aws_credentials'), `real keys\naws_access_key_id = AKIA${OLD}\n`);
  prepareBait(dirs);
  assert.equal(baitMarkers.has(OLD), false);
});

test('Lookout decoys migrate to Harness while both legacy folders remain monitored', () => {
  const dirs = fresh();
  const lookout = path.join(dirs.root, 'lookout');
  fs.mkdirSync(lookout);
  fs.mkdirSync(dirs.legacyDir);
  fs.writeFileSync(path.join(lookout, 'aws_credentials'), harnessAws(NEW).replace('Harness decoy', 'Lookout decoy'));
  fs.writeFileSync(path.join(dirs.legacyDir, 'aws_credentials'), seatbeltAws(OLD));
  prepareBait({ ...dirs, legacyDirs: [lookout, dirs.legacyDir] });
  const migrated = fs.readFileSync(path.join(dirs.baitDir, 'aws_credentials'), 'utf8');
  assert.match(migrated, /Harness decoy/);
  assert.ok(migrated.includes(NEW));
  assert.equal(baitMarkers.get(OLD), path.join(dirs.legacyDir, 'aws_credentials'));
  assert.ok(baitPaths.has(path.join(lookout, 'aws_credentials')));
});

test('a decoy read is still reported when another Harness copy re-armed the file first', () => {
  const mtimeMs = 1_000_000;
  // This copy armed the file to 997_500 and nothing changed.
  assert.equal(classifyBaitChange({ atimeMs: 997_500, mtimeMs, last: 997_500 }), null);
  // Someone read it: the access time moved past the modified time.
  assert.deepEqual(classifyBaitChange({ atimeMs: 1_500_000, mtimeMs, last: 997_500 }), { kind: 'read', readAt: 1_500_000 });
  // Another copy saw the read first and re-armed to 997_222, noting it.
  const shared = { readAt: 1_500_000, armedTo: 997_222 };
  assert.deepEqual(classifyBaitChange({ atimeMs: 997_222, mtimeMs, last: 997_500, shared }), { kind: 'read', readAt: 1_500_000, rearmed: true });
  // ...but not twice, and not when the other copy only armed it (for example while starting up).
  assert.deepEqual(classifyBaitChange({ atimeMs: 997_222, mtimeMs, last: 997_500, shared, lastReported: 1_500_000 }), { kind: 'armed' });
  assert.deepEqual(classifyBaitChange({ atimeMs: 997_111, mtimeMs, last: 997_500, shared }), { kind: 'armed' });
  // Windows does not arm; any change is a read.
  assert.deepEqual(classifyBaitChange({ atimeMs: 997_111, mtimeMs, last: 997_500, win32: true }), { kind: 'read', readAt: 997_111 });
});

test("Harness reading its own decoy doesn't look like a read to other copies", { skip: process.platform === 'win32' }, async () => {
  const { readOwnDecoy } = await import('../src/monitor/files.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-own-'));
  const p = path.join(dir, 'passwords.txt');
  fs.writeFileSync(p, 'Harness decoy file. Nothing real here.\n');
  const armed = new Date(fs.statSync(p).mtimeMs - 2500);
  fs.utimesSync(p, armed, fs.statSync(p).mtime);
  const before = fs.statSync(p).atimeMs;
  assert.match(readOwnDecoy(p), /Harness decoy/);
  assert.equal(fs.statSync(p).atimeMs, before);
  assert.equal(readOwnDecoy(path.join(dir, 'missing')), null);
});
