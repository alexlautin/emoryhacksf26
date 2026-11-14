import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isProtected, protect } from '../src/protect.js';
import { findHookFolders, uninstallCleanup } from '../src/uninstall.js';

process.env.HARNESS_PROTECTED_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-registry-')), 'protected-folders.json');

// Every call passes its own roots, extra and homeDirs, so a test never looks at or removes anything real.
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-uninstall-'));
const sandbox = (root) => ({ roots: [root], extra: [], homeDirs: [] });

test('uninstall finds protected folders by scanning, even ones Harness never recorded', () => {
  const root = tempDir();
  const project = path.join(root, 'work', 'app');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(root, 'work', 'plain'), { recursive: true });
  protect(project);
  assert.deepEqual(findHookFolders({ roots: [root], extra: [] }), [project]);
});

test("uninstall removes hooks but keeps the folder's other Claude Code settings", () => {
  const root = tempDir();
  const project = path.join(root, 'app');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  protect(project);
  const touched = [];
  const result = uninstallCleanup({ ...sandbox(root), onFolder: (d) => touched.push(d) });
  assert.deepEqual(result.removedHooks, [project]);
  assert.deepEqual(touched, [project]);
  assert.equal(isProtected(project), false);
  assert.equal(fs.existsSync(path.join(project, '.harness', 'harness-hook.sh')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.json'), 'utf8')), { permissions: { allow: ['Bash(ls)'] } });
});

test('uninstall removes the decoy folders it is given', () => {
  const root = tempDir();
  const bait = path.join(root, '.harness');
  fs.mkdirSync(path.join(bait, 'bait'), { recursive: true });
  const result = uninstallCleanup({ ...sandbox(root), homeDirs: [bait] });
  assert.deepEqual(result.homeDirs, [bait]);
  assert.equal(fs.existsSync(bait), false);
});

test('a dry run changes nothing', () => {
  const root = tempDir();
  const project = path.join(root, 'app');
  fs.mkdirSync(project);
  protect(project);
  const result = uninstallCleanup({ ...sandbox(root), dryRun: true });
  assert.deepEqual(result.hookFolders, [project]);
  assert.equal(isProtected(project), true);
});
