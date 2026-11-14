import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isProtected, protect, unprotect } from '../src/protect.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-protect-'));
}

test('protect installs the Harness hook and unprotect removes it', () => {
  const dir = tempDir();
  protect(dir);
  assert.equal(isProtected(dir), true);
  assert.equal(fs.existsSync(path.join(dir, '.harness', 'harness-hook.sh')), true);
  const settings = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  assert.match(settings, /harness-hook\.sh/);
  assert.doesNotMatch(settings, /seatbelt/);
  unprotect(dir);
  assert.equal(isProtected(dir), false);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false);
});

for (const legacyName of ['seatbelt', 'lookout']) {
test(`protect replaces a ${legacyName} hook and leaves other hooks alone`, () => {
  const dir = tempDir();
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR"/.${legacyName}/${legacyName}-hook.sh pre-tool`, timeout: 120 }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, `.${legacyName}`), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, `.${legacyName}`, `${legacyName}-hook.sh`), '#!/bin/sh\n');

  protect(dir);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const flat = JSON.stringify(after);
  assert.match(flat, /harness-hook\.sh/);
  assert.doesNotMatch(flat, /seatbelt-hook|lookout-hook/);
  assert.match(flat, /keep-me/);
  assert.equal(fs.existsSync(path.join(dir, `.${legacyName}`, `${legacyName}-hook.sh`)), false);
  assert.equal(isProtected(dir), true);
});

test(`unprotect removes a ${legacyName} hook and keeps other hooks`, () => {
  const dir = tempDir();
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR"/.${legacyName}/${legacyName}-hook.sh pre-tool` }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, `.${legacyName}`), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(dir, `.${legacyName}`, `${legacyName}-hook.sh`), '#!/bin/sh\n');

  assert.equal(isProtected(dir), true);
  unprotect(dir);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.match(JSON.stringify(after), /keep-me/);
  assert.doesNotMatch(JSON.stringify(after), /seatbelt|lookout/);
  assert.equal(isProtected(dir), false);
  assert.equal(fs.existsSync(path.join(dir, `.${legacyName}`, `${legacyName}-hook.sh`)), false);
});

}
