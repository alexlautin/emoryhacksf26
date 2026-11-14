import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { RELEASES } from './releases.js';
import { detectOS } from './src/js/os.js';
import { downloadPlan } from './src/js/downloads.js';
import { renderMarkdown } from './src/markdown.mjs';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

test('macOS is highlighted and points at the placeholder, Windows does not link', () => {
  const os = detectOS({ ua: MAC_UA, platform: 'MacIntel', touchPoints: 0 });
  assert.equal(os.id, 'mac');
  assert.equal(os.forced, false);
  const plan = downloadPlan(RELEASES, os);
  assert.match(plan.note, /Mac/);
  assert.deepEqual(plan.items.map((item) => item.id), ['mac', 'windows']);
  const mac = plan.items[0];
  const win = plan.items[1];
  assert.equal(mac.yours, true);
  assert.equal(mac.action, 'placeholder');
  assert.equal(mac.href, RELEASES.macos.url);
  assert.equal(mac.primary, true);
  assert.match(mac.status, /Placeholder/);
  assert.equal(win.yours, false);
  assert.equal(win.href, null);
  assert.equal(win.action, 'soon');
  assert.equal(win.button, 'Coming soon');
  assert.match(win.status, /no desktop build/i);
});

test('Windows is highlighted, ordered first, and stays disabled', () => {
  const os = detectOS({ ua: WIN_UA, platform: 'Win32', touchPoints: 0 });
  assert.equal(os.id, 'windows');
  const plan = downloadPlan(RELEASES, os);
  assert.match(plan.note, /Windows/);
  assert.deepEqual(plan.items.map((item) => item.id), ['windows', 'mac']);
  assert.equal(plan.items[0].yours, true);
  assert.equal(plan.items[0].href, null);
  assert.equal(plan.items[1].yours, false);
  assert.equal(plan.items[1].primary, true);
  assert.equal(plan.items[1].href, RELEASES.macos.url);
});

test('Linux, Android, and iPhone do not claim a desktop match', () => {
  const linux = downloadPlan(RELEASES, detectOS({ ua: LINUX_UA, platform: 'Linux x86_64' }));
  assert.match(linux.note, /Linux/);
  assert.equal(linux.items.every((item) => item.yours === false), true);

  const android = detectOS({ ua: ANDROID_UA, platform: 'Linux armv8l' });
  assert.equal(android.kind, 'android');
  assert.match(downloadPlan(RELEASES, android).note, /Android/);

  const iphone = detectOS({ ua: IPHONE_UA, platform: 'iPhone' });
  assert.equal(iphone.kind, 'ios');
  assert.match(downloadPlan(RELEASES, iphone).note, /iPhone/);
});

test('a touchscreen Macintosh UA is treated as an iPad, a Mac with no touch is not', () => {
  const ipad = detectOS({ ua: MAC_UA, platform: 'MacIntel', touchPoints: 5 });
  assert.equal(ipad.kind, 'ipad');
  const mac = detectOS({ ua: MAC_UA, platform: 'MacIntel', touchPoints: 0 });
  assert.equal(mac.kind, 'macos');
});

test('?os= overrides the browser, and a half-set Windows url still does not link', () => {
  const forced = detectOS({ ua: LINUX_UA, platform: 'Linux', search: '?os=windows' });
  assert.equal(forced.forced, true);
  assert.equal(forced.id, 'windows');
  const plan = downloadPlan(RELEASES, forced);
  assert.match(plan.note, /Preview/);
  assert.equal(plan.items[0].href, null);

  const edited = {
    macos: { url: 'http://example.com/Lookout.dmg', published: true, comingSoon: false },
    windows: {
      url: 'https://example.com/Lookout-setup.exe',
      published: true,
      comingSoon: true,
    },
  };
  const macPlan = downloadPlan(edited, { id: 'mac', kind: 'macos', forced: false });
  assert.equal(macPlan.items[0].href, null);
  assert.equal(macPlan.items[1].href, null);

  const ready = downloadPlan({
    macos: { url: 'https://example.com/Lookout.dmg', published: true, comingSoon: false },
    windows: { url: 'javascript:alert(1)', published: true, comingSoon: false },
  }, { id: 'windows', kind: 'windows', forced: false });
  assert.equal(ready.items[0].action, 'soon');
  assert.equal(ready.items[0].href, null);
  assert.equal(ready.items[1].action, 'download');
  assert.equal(ready.items[1].href, 'https://example.com/Lookout.dmg');
});

test('markdown escapes html, keeps safe links, and slugs headings', () => {
  const html = renderMarkdown([
    '# The problem',
    '',
    'See <script>alert(1)</script> and `rm -rf ~`.',
    '',
    'Read [the rules](https://example.com/rules) and [home](/#how).',
    '',
    'Skip [this](javascript:alert(1)).',
    '',
    '- one `AKIA` marker',
    '- two',
    '',
    '```',
    'curl -X POST',
    '```',
  ].join('\n'));
  assert.match(html, /<h1 id="the-problem">/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>rm -rf ~<\/code>/);
  assert.match(html, /href="https:\/\/example.com\/rules"/);
  assert.match(html, /href="\/#how"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<li>one <code>AKIA<\/code> marker<\/li>/);
  assert.match(html, /<pre><code>curl -X POST<\/code><\/pre>/);
});

test('the white paper renders the sections the site links to', () => {
  const md = fs.readFileSync(new URL('./whitepaper.md', import.meta.url), 'utf8');
  const html = renderMarkdown(md);
  for (const id of ['the-problem', 'threat-model', 'how-harness-observes', 'rules', 'the-score', 'acting-on-a-finding', 'privacy', 'known-limits', 'roadmap']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /0 to 100/);
  assert.match(html, /~\/\.lookout\/bait/);
});

test('fragment jumps leave room for the sticky header', () => {
  const css = fs.readFileSync(new URL('./src/site.css', import.meta.url), 'utf8');
  assert.match(css, /scroll-padding-top:\s*calc\(var\(--nav-h\) \+ 16px\)/);
  assert.match(css, /--nav-h:\s*68px/);
});
