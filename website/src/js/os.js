// Browser OS detection for the download buttons.
// iPadOS 13 and later sends a Macintosh user agent. More than one touch point
// is how we tell it apart from a Mac. A touchscreen Mac can trip that too.

const FORCED = {
  mac: { id: 'mac', kind: 'macos' },
  windows: { id: 'windows', kind: 'windows' },
  linux: { id: 'other', kind: 'linux' },
  ios: { id: 'other', kind: 'ios' },
  ipad: { id: 'other', kind: 'ipad' },
  android: { id: 'other', kind: 'android' },
  other: { id: 'other', kind: 'unknown' },
};

export function detectOS({ ua = '', platform = '', touchPoints = 0, search = '' } = {}) {
  const query = String(search).replace(/^\?/, '');
  const forced = new URLSearchParams(query).get('os');
  if (forced && FORCED[forced]) {
    return { ...FORCED[forced], forced: true };
  }

  const blob = `${platform} ${ua}`;
  if (/android/i.test(blob)) return { id: 'other', kind: 'android', forced: false };
  if (/iPhone|iPod|\biOS\b/i.test(blob)) return { id: 'other', kind: 'ios', forced: false };
  if (/iPad/.test(ua) || (touchPoints > 1 && /Mac/i.test(blob))) {
    return { id: 'other', kind: 'ipad', forced: false };
  }
  if (/Mac/i.test(blob)) return { id: 'mac', kind: 'macos', forced: false };
  if (/Win/i.test(blob)) return { id: 'windows', kind: 'windows', forced: false };
  if (/Linux|CrOS|Chrome OS|X11/i.test(blob)) return { id: 'other', kind: 'linux', forced: false };
  return { id: 'other', kind: 'unknown', forced: false };
}
