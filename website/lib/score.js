// Harness's safety score: a plain number from 0 to 100.
// Everyone starts at 100. Worrying actions cost points in a few categories,
// each with a cap, and a cost halves every 12 hours. The number is clamped to 0-100.

export const MIN = 0;
export const MAX = 100;
const HALF_LIFE_MS = 12 * 60 * 60 * 1000;
const ALERT_WINDOW_MS = 15 * 60 * 1000;
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

// Short status words for the number. These are not a credit-score scale.
export const LEVELS = [
  { min: 90, name: 'Clear', cls: 'clear', blurb: 'Nothing concerning so far.' },
  { min: 70, name: 'Steady', cls: 'steady', blurb: 'A few things worth knowing. Nothing serious.' },
  { min: 40, name: 'Review', cls: 'review', blurb: 'Some activity is worth a look.' },
  { min: 0, name: 'Act', cls: 'act', blurb: 'Something dangerous happened. Look at it now.' },
];

export const FACTORS = [
  {
    id: 'secrets', icon: 'key-round', name: 'Passwords and secrets', impact: 'High impact',
    desc: 'Opening keys, passwords, or the decoy files Harness planted',
    test: /decoy secret|SSH keys|AWS cloud|\.env file|Keychain|Windows passwords|saved logins|access tokens|terminal history|messages or email|scrambled secret/i,
    cost: { critical: 45, high: 20, medium: 10, low: 2 }, cap: 70,
  },
  {
    id: 'uploads', icon: 'upload', name: 'Sending data out', impact: 'High impact',
    desc: 'Uploading files or data to servers on the internet',
    test: /uploaded data|attacker|raw network connection|copied files to another computer/i,
    cost: { critical: 35, high: 24, medium: 10, low: 2 }, cap: 55,
  },
  {
    id: 'persistence', icon: 'eye-off', name: 'Hidden background changes', impact: 'High impact',
    desc: 'Setting something up to keep running after a restart',
    test: /run automatically|startup file/i,
    cost: { critical: 30, high: 18, medium: 8, low: 2 }, cap: 45,
  },
  {
    id: 'commands', icon: 'square-terminal', name: 'Risky commands', impact: 'Medium impact',
    desc: 'Deleting folders, asking for admin, or controlling other apps',
    test: /delete|renamed \d+ files|administrator|AppleScript|force-pushed|screenshot|downloaded a script|Defender|encoded|safety checks/i,
    cost: { critical: 25, high: 12, medium: 5, low: 1 }, cap: 35,
  },
  {
    id: 'servers', icon: 'globe', name: 'Unknown servers', impact: 'Medium impact',
    desc: 'Connecting to a server Harness doesn’t recognize',
    test: /server (Harness|Lookout|Seatbelt) doesn't recognize/i,
    cost: { critical: 10, high: 7, medium: 3, low: 1 }, cap: 15,
  },
  {
    id: 'installs', icon: 'package', name: 'New software', impact: 'Low impact',
    desc: 'Package installs can run their own setup code',
    test: /installed packages/i,
    cost: { critical: 3, high: 2, medium: 1, low: 1 }, cap: 6,
  },
];

export function levelFor(score) {
  const s = Math.max(MIN, Math.min(MAX, score));
  return LEVELS.find((l) => s >= l.min) ?? LEVELS[LEVELS.length - 1];
}

/** Which factors one event counts against. */
export function factorsFor(e) {
  if (e.kind === 'system' || e.kind === 'task') return [];
  const reasons = (e.reasons ?? []).join(' · ');
  if (!reasons) return [];
  return FACTORS.filter((f) => f.test.test(reasons));
}

/**
 * Score a list of events.
 * Returns { score, level, factors: [{ ...factor, count, lost, events }], counted, since }.
 */
export function computeScore(events, now = Date.now()) {
  const totals = new Map(FACTORS.map((f) => [f.id, { lost: 0, count: 0, events: [] }]));
  let counted = 0;
  let since = null;
  for (const e of events) {
    if (e.kind === 'system') continue;
    counted++;
    since = since === null ? e.ts : Math.min(since, e.ts);
    for (const f of factorsFor(e)) {
      const t = totals.get(f.id);
      const fade = 0.5 ** (Math.max(0, now - e.ts) / HALF_LIFE_MS);
      t.lost += (f.cost[e.risk] ?? 0) * fade;
      t.count++;
      t.events.push(e.id);
    }
  }
  const factors = FACTORS.map((f) => {
    const t = totals.get(f.id);
    return { ...f, count: t.count, lost: Math.round(Math.min(f.cap, t.lost)), events: t.events };
  });
  const lost = factors.reduce((n, f) => n + f.lost, 0);
  const score = Math.max(MIN, Math.min(MAX, Math.round(MAX - lost)));
  return { score, level: levelFor(score), factors, counted, since };
}

/** Paused sessions plus high and critical events from the last 15 minutes. */
export function alertCount(events, agents = [], now = Date.now()) {
  const paused = agents.filter((a) => a.alive && a.paused).length;
  const recent = events.filter((e) => e.kind !== 'system' && (RANK[e.risk] ?? 0) >= 3 && now - e.ts < ALERT_WINDOW_MS).length;
  return paused + recent;
}
