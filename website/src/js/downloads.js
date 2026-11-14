// Turns releases.js plus a detected OS into button labels.
// No DOM in here, so the tests can import it under plain Node.

const NOTES = {
  macos: 'This computer is a Mac.',
  windows: 'This computer runs Windows. The app build is not ready.',
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
  if (spec.comingSoon || !href) {
    return { ...base, href: null, action: 'soon', button: 'Coming soon', status: spec.soon };
  }
  if (!spec.published) {
    return { ...base, href, action: 'placeholder', button: spec.button, status: spec.placeholder };
  }
  return { ...base, href, action: 'download', button: spec.button, status: spec.ready };
}

export function downloadPlan(releases, os) {
  const mac = item({
    id: 'mac',
    title: 'macOS',
    detail: 'macOS 12 or later',
    yours: os.id === 'mac',
    url: releases.macos?.url,
    published: releases.macos?.published === true,
    comingSoon: releases.macos?.comingSoon === true,
    button: 'Download for Mac',
    soon: 'No Mac build is configured in releases.js.',
    placeholder: 'Placeholder link: the Mac build is not published yet. Until it is, build it from the source on GitHub.',
    ready: 'macOS 12 or later. The app is signed ad hoc, so the first open takes a right-click, then Open.',
  });
  const win = item({
    id: 'windows',
    title: 'Windows',
    detail: 'Desktop build not ready',
    yours: os.id === 'windows',
    url: releases.windows?.url,
    published: releases.windows?.published === true,
    // Missing flag stays "coming soon". Set comingSoon: false on purpose to link a file.
    comingSoon: releases.windows?.comingSoon !== false,
    button: 'Download for Windows',
    soon: 'The monitor has a Windows code path. There is no desktop build, and it has not been run on a real Windows machine.',
    placeholder: 'Placeholder. No Windows installer is hosted at this address yet.',
    ready: 'Windows 10 or 11.',
  });

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
