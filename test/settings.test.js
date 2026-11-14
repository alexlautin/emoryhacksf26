import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-settings-'));
process.env.HARNESS_DATA_DIR = dir;

test('menu bar display is saved, and a bad value is rejected', async () => {
  const { getSettings, setSettings } = await import('../src/guard.js');
  assert.equal(getSettings().menuBarDisplay, 'score');
  assert.equal(getSettings().autoProtect, 'dangerous');
  const next = setSettings({ menuBarDisplay: 'alerts' });
  assert.equal(next.menuBarDisplay, 'alerts');
  assert.equal(next.autoProtect, 'dangerous');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(saved.menuBarDisplay, 'alerts');
  assert.throws(() => setSettings({ menuBarDisplay: 'credit' }), /menuBarDisplay/);
  assert.equal(getSettings().menuBarDisplay, 'alerts');
  assert.throws(() => setSettings({ autoProtect: 'always' }), /autoProtect/);
});
