// Turns releases.js plus a detected OS into button labels.
// No DOM in here, so the tests can import it under plain Node.

const NOTES = {
  macos: 'This computer is a Mac.',
  windows: 'This computer runs Windows.',
  linux: 'This computer runs Linux. Harness does not support Linux.',
  ios: 'This is an iPhone. Harness is a desktop app.',
  ipad: 'This is an iPad. Harness is a desktop app.',
  android: 'This is an Android device. Harness is a desktop app.',
  unknown: 'This does not look like macOS or Windows.',
};

const PREVIEW = {
  macos: 'Preview of the macOS buttons. This browser was not used.',
  windows: 'Preview of the Windows buttons. This browser was not used.',
  linux: 'Preview of the Linux note. This browser was not used.',
  ios: 'Preview of the iPhone note. This browser was not used.',
  ipad: 'Preview of the iPad note. This browser was not used.',
  android: 'Preview of the Android note. This browser was not used.',
  unknown: 'Preview of an unknown system. This browser was not used.',
};

function cleanUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https:\/\/[^\s]+$/i.test(trimmed)) return null;
  return trimmed;
}

function item(spec) {
  const href = cleanUrl(spec.url);
  const base = {
    id: spec.id,
    title: spec.title,
    detail: spec.detail,
    yours: spec.yours,
    primary: false,
  };
  // comingSoon wins even if a url was filled in, so a half-edited config
  // cannot link Windows at a file that is not there.
  if (spec.comingSoon || !spec.published || !href) {
    return { ...base, href: null, action: 'soon', button: 'Coming soon', status: spec.soon };
  }
  return { ...base, href, action: 'download', button: spec.button, status: spec.ready };
}

export function downloadPlan(releases, os) {
  const mac = item({
    id: 'mac',
    title: 'macOS',
    detail: 'macOS 12 or later · Apple silicon or Intel',
    yours: os.id === 'mac',
    url: releases.macos?.url,
    published: releases.macos?.published === true,
    comingSoon: releases.macos?.comingSoon === true,
    button: 'Download for Apple silicon',
    soon: 'No Mac build is configured in releases.js.',
    ready: 'This free preview is not notarized by Apple. If macOS blocks it, use Open Anyway in System Settings → Privacy & Security. First-open steps are below.',
  });
  const win = item({
    id: 'windows',
    title: 'Windows',
    detail: 'Windows 10 or 11 · 64-bit installer',
    yours: os.id === 'windows',
    url: releases.windows?.url,
    published: releases.windows?.published === true,
    // Missing flag stays "coming soon". Set comingSoon: false on purpose to link a file.
    comingSoon: releases.windows?.comingSoon !== false,
    button: 'Download for Windows',
    soon: 'The Windows installer is not published yet.',
    ready: 'Run the installer. Node is included. This preview is unsigned, so Windows SmartScreen may ask you to confirm the publisher.',
  });

  if (mac.action === 'download') {
    const href = cleanUrl(releases.macos?.intelUrl);
    if (href) mac.alternate = { href, button: 'Download for Intel Mac' };
  }

  const items = os.id === 'windows' ? [win, mac] : [mac, win];
  const yoursHasLink = items.some((entry) => entry.yours && entry.href);
  let gavePrimary = false;
  for (const entry of items) {
    const want = Boolean(entry.href) && (entry.yours || !yoursHasLink);
    entry.primary = want && !gavePrimary;
    if (entry.primary) gavePrimary = true;
  }

  const kind = NOTES[os.kind] ? os.kind : 'unknown';
  const note = os.forced ? PREVIEW[kind] : NOTES[kind];
  return { note, items };
}
