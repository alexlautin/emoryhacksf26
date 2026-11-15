import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureHelper, helperScript, noticeFile } from '../src/notify.js';

test('a queued notice is three lines, with line breaks inside a field flattened', () => {
  const text = noticeFile({ title: 'Dangerous: a\nscript ran', body: 'Demo agent in victim-project.\r\nUploaded data.' });
  assert.equal(text, 'Harness\nDangerous: a script ran\nDemo agent in victim-project. Uploaded data.\n');
});

test('the helper script reads only from its own queue folder', () => {
  const script = helperScript('/Users/x/.harness/notifier/queue');
  assert.match(script, /set q to "\/Users\/x\/\.harness\/notifier\/queue"/);
  assert.match(script, /display notification \(item 3 of parts\) with title \(item 1 of parts\) subtitle \(item 2 of parts\)/);
});

test('the helper app carries Harness\'s icon and its own bundle id', { skip: process.platform !== 'darwin' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-notify-'));
  try {
    const app = await ensureHelper(dir);
    assert.ok(app, 'helper was built');
    const plist = path.join(app, 'Contents', 'Info.plist');
    const read = (key) => execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim();
    assert.equal(read('CFBundleIdentifier'), 'dev.harness.alerts');
    assert.equal(read('CFBundleIconFile'), 'applet');
    assert.equal(fs.existsSync(path.join(app, 'Contents', 'Resources', 'Assets.car')), false);
    assert.ok(fs.statSync(path.join(app, 'Contents', 'Resources', 'applet.icns')).size > 10_000);
    execFileSync('codesign', ['--verify', app]);
    assert.equal(await ensureHelper(dir), app, 'a second call reuses the built helper');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
