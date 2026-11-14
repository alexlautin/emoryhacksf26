import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareBait, markerIn } from '../src/monitor/files.js';
import { baitMarkers, baitPaths } from '../src/rules.js';

const OLD = 'ABCDEFGHIJKLMNOP';
const NEW = 'QRSTUVWXYZ234567';

function seatbeltAws(marker) {
  return `# Seatbelt decoy. These keys are fake and do nothing.\n[default]\naws_access_key_id = AKIA${marker}\naws_secret_access_key = sb-decoy/${marker}${marker.toLowerCase().slice(0, 12)}\n`;
}

function lookoutAws(marker) {
  return `# Lookout decoy. These keys are fake and do nothing.\n[default]\naws_access_key_id = AKIA${marker}\naws_secret_access_key = lk-decoy/${marker}${marker.toLowerCase().slice(0, 12)}\n`;
}

function fresh() {
  baitMarkers.clear();
  baitPaths.clear();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-bait-'));
  return {
    root,
    baitDir: path.join(root, 'lookout'),
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
  assert.match(rewritten, /Lookout decoy/);
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
  fs.writeFileSync(path.join(dirs.baitDir, 'aws_credentials'), lookoutAws(NEW));
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
