import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isProtected, protect, unprotect } from '../src/protect.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lookout-protect-'));
}

test('protect installs the Lookout hook and unprotect removes it', () => {
  const dir = tempDir();
  protect(dir);
  assert.equal(isProtected(dir), true);
  assert.equal(fs.existsSync(path.join(dir, '.lookout', 'lookout-hook.sh')), true);
  const settings = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  assert.match(settings, /lookout-hook\.sh/);
  assert.doesNotMatch(settings, /seatbelt/);
  unprotect(dir);
  assert.equal(isProtected(dir), false);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false);
});

test('protect replaces a pre-rename hook and leaves other hooks alone', () => {
  const dir = tempDir();
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.seatbelt/seatbelt-hook.sh pre-tool', timeout: 120 }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.seatbelt'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, '.seatbelt', 'seatbelt-hook.sh'), '#!/bin/sh\n');

  protect(dir);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const flat = JSON.stringify(after);
  assert.match(flat, /lookout-hook\.sh/);
  assert.doesNotMatch(flat, /seatbelt-hook/);
  assert.match(flat, /keep-me/);
  assert.equal(fs.existsSync(path.join(dir, '.seatbelt', 'seatbelt-hook.sh')), false);
  assert.equal(isProtected(dir), true);
});

test('unprotect removes a pre-rename hook and keeps other hooks', () => {
  const dir = tempDir();
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.seatbelt/seatbelt-hook.sh pre-tool' }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.seatbelt'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(dir, '.seatbelt', 'seatbelt-hook.sh'), '#!/bin/sh\n');

  assert.equal(isProtected(dir), true);
  unprotect(dir);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.match(JSON.stringify(after), /keep-me/);
  assert.doesNotMatch(JSON.stringify(after), /seatbelt/);
  assert.equal(isProtected(dir), false);
  assert.equal(fs.existsSync(path.join(dir, '.seatbelt', 'seatbelt-hook.sh')), false);
});
