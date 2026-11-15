import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phone-'));
process.env.HARNESS_DATA_DIR = dir;
process.env.HARNESS_PHONE_PORT = '0';
const phone = await import('../src/phone.js');

test('a phone can watch and pause, but not change settings or reach the hooks', () => {
  const ok = [['GET', '/'], ['GET', '/app.js'], ['GET', '/api/state'], ['GET', '/api/stream'], ['POST', '/api/agent'], ['POST', '/api/summary'], ['GET', '/api/report.md']];
  const no = [['POST', '/api/settings'], ['POST', '/api/baseline'], ['POST', '/api/reset'], ['POST', '/api/demo/run'], ['POST', '/api/demo/step'], ['GET', '/api/review'], ['POST', '/api/review'],
    ['GET', '/api/phone'], ['POST', '/api/phone'], ['POST', '/hooks/pre-tool'], ['POST', '/'], ['DELETE', '/api/state']];
  for (const [m, p] of ok) assert.equal(phone.phoneAllows(m, p), true, `${m} ${p}`);
  for (const [m, p] of no) assert.equal(phone.phoneAllows(m, p), false, `${m} ${p}`);
});

test('keys must match exactly', () => {
  assert.equal(phone.keyMatches('abc', 'abc'), true);
  assert.equal(phone.keyMatches('abd', 'abc'), false);
  assert.equal(phone.keyMatches('ab', 'abc'), false);
  assert.equal(phone.keyMatches('', ''), false);
  assert.equal(phone.keyMatches(undefined, 'abc'), false);
  assert.equal(phone.readCookie('a=1; harness_phone=xyz; b=2'), 'xyz');
  assert.equal(phone.readCookie(undefined), '');
});

test('Wi-Fi addresses come first; loopback, link-local and public addresses are skipped', () => {
  const list = phone.lanAddresses({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    utun4: [{ family: 'IPv4', address: '100.64.1.2', internal: false }, { family: 'IPv4', address: '10.8.0.2', internal: false }],
    en0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    en5: [{ family: 'IPv4', address: '169.254.3.3', internal: false }],
  });
  assert.deepEqual(list.map((a) => a.address), ['100.64.1.2', '192.168.1.20', '10.8.0.2']);
  assert.equal(list[0].kind, 'tailscale');
});

test('a Tailscale address comes before Wi-Fi, and other 100.x addresses are still rejected', () => {
  const list = phone.lanAddresses({
    en0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }, { family: 'IPv4', address: '100.70.0.9', internal: false }],
    utun3: [{ family: 'IPv4', address: '100.101.1.2', internal: false }, { family: 'IPv4', address: '100.0.0.1', internal: false }],
    utun7: [{ family: 'IPv4', address: '100.128.0.1', internal: false }],
  });
  assert.deepEqual(list, [
    { name: 'utun3', address: '100.101.1.2', kind: 'tailscale' },
    { name: 'en0', address: '192.168.1.5', kind: 'wifi' },
  ]);
});

test('pairing: no cookie is refused, the key signs a phone in, and unpairing signs it out', async (t) => {
  const handled = [];
  await phone.startPhoneAccess((req, res, opts) => { handled.push([req.method, req.url, opts.remote]); res.end('{}'); });
  const status = await phone.setPhoneAccess('enable');
  t.after(() => phone.setPhoneAccess('disable'));
  assert.equal(status.enabled, true);
  assert.equal(status.running, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'phone.json'), 'utf8'));
  assert.ok(saved.key.length >= 40);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'phone.json')).mode & 0o077, 0);

  const base = `http://127.0.0.1:${status.port}`;
  const origin = { origin: base };

  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/pair');

  const pair = (key, headers = origin) => fetch(`${base}/pair`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ key }) });
  assert.equal((await pair('wrong')).status, 401);
  assert.equal((await pair(saved.key, { origin: 'http://evil.example' })).status, 403);
  const good = await pair(saved.key);
  assert.equal(good.status, 200);
  const cookie = good.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const jar = { cookie: cookie.split(';')[0] };

  assert.equal((await fetch(`${base}/api/state`, { headers: jar })).status, 200);
  assert.deepEqual(handled.at(-1), ['GET', '/api/state', true]);
  assert.equal((await fetch(`${base}/api/settings`, { method: 'POST', headers: { ...jar, ...origin } })).status, 403);
  assert.equal((await fetch(`${base}/hooks/pre-tool`, { method: 'POST', headers: { ...jar, ...origin } })).status, 403);
  assert.equal((await fetch(`${base}/api/agent`, { method: 'POST', headers: { ...jar, origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/agent`, { method: 'POST', headers: { ...jar, ...origin } })).status, 200);

  // Unpairing also cuts open connections (a live stream would otherwise keep going), so reconnect once.
  await phone.setPhoneAccess('reset');
  const after = await fetch(`${base}/api/state`, { headers: jar }).catch(() => fetch(`${base}/api/state`, { headers: jar }));
  assert.equal(after.status, 401);
});

test('writes from other websites are refused, Harness itself and tools without an Origin are not', async () => {
  const { crossSiteWrite } = await import('../src/phone.js');
  const req = (method, origin, host = '127.0.0.1:4100') => ({ method, headers: { host, ...(origin === undefined ? {} : { origin }) } });
  assert.equal(crossSiteWrite(req('POST', 'https://evil.example')), true);
  assert.equal(crossSiteWrite(req('POST', 'null')), true);
  assert.equal(crossSiteWrite(req('POST', 'http://localhost:4100')), true); // different host string than the request's
  assert.equal(crossSiteWrite(req('POST', 'http://127.0.0.1:4100')), false);
  assert.equal(crossSiteWrite(req('POST', undefined)), false); // CLI, hook script, demo agent
  assert.equal(crossSiteWrite(req('GET', 'https://evil.example')), false);
});
