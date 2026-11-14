// Is each monitor actually working? Every monitor reports when a check succeeds or fails, so the
// dashboard and menu bar can say "Process watch stalled for 30 s" instead of a green "Clear"
// while nothing is being checked.
const monitors = new Map(); // name -> { name, label, stallMs, startedAt, lastOk, lastError, lastErrorAt, down }

/** stallMs: how long without a success before the monitor counts as stalled (Infinity: never). */
export function registerMonitor(name, { label = name, stallMs = 10000, now = Date.now() } = {}) {
  const prev = monitors.get(name);
  monitors.set(name, { lastOk: null, lastError: null, lastErrorAt: null, down: false, ...prev, name, label, stallMs, startedAt: prev?.startedAt ?? now });
}

export function monitorOk(name, now = Date.now()) {
  const m = monitors.get(name);
  if (!m) return;
  m.lastOk = now;
  m.down = false;
}

/** A failed check. `down` marks the monitor as not running at all (for example eslogger exited). */
export function monitorFailed(name, err, { down = false, now = Date.now() } = {}) {
  const m = monitors.get(name);
  if (!m) return;
  m.lastError = String(err?.message ?? err ?? 'unknown error');
  m.lastErrorAt = now;
  if (down) m.down = true;
}

export function unregisterMonitor(name) {
  monitors.delete(name);
}

function describe(m, now) {
  const since = m.lastOk ?? m.startedAt;
  const quietMs = now - since;
  let state = 'ok';
  if (m.down) state = 'down';
  else if (quietMs > m.stallMs) state = m.lastOk === null ? 'not-started' : 'stalled';
  const secs = Math.round(quietMs / 1000);
  const message = state === 'ok' ? null
    : state === 'down' ? `${m.label} stopped${m.lastError ? `: ${m.lastError}` : ''}`
      : state === 'not-started' ? `${m.label} hasn't worked since Harness started (${secs} s)${m.lastError ? `: ${m.lastError}` : ''}`
        : `${m.label} stalled for ${secs} s${m.lastError ? `: ${m.lastError}` : ''}`;
  return { name: m.name, label: m.label, state, lastOk: m.lastOk, lastError: m.lastError, lastErrorAt: m.lastErrorAt, message };
}

/** Every monitor's state, for /api/state and the dashboard. */
export function healthStatus(now = Date.now()) {
  return [...monitors.values()].map((m) => describe(m, now));
}

/** Only the monitors that aren't working. Empty when everything is fine. */
export function degradedMonitors(now = Date.now()) {
  return healthStatus(now).filter((m) => m.state !== 'ok');
}

/** For tests. */
export function resetHealth() {
  monitors.clear();
}
