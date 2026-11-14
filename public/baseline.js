// A person can mark a low or medium action as normal for one project.
// Lookout does not learn this by itself, and it will not hide a decoy read or anything critical.

const SECRET = /decoy secret|Keychain|whole home folder|saved passwords|scrambled secret/;

export function fingerprint(command) {
  let s = String(command ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(/(?:\/Users\/|\/home\/)[^/\s'"]+/g, '~');
  s = s.replace(/[A-Za-z]:\\Users\\[^\\\s'"]+/gi, '~');
  // Filesystem paths only. A URL's slashes are not a path.
  s = s.replace(/(^|[\s'"`=])(?:~|\/)[^\s'"]+/g, '$1<path>');
  s = s.replace(/\b\d{5,}\b/g, '<n>');
  if (s.length > 180) s = `${s.slice(0, 179)}…`;
  return s;
}

export function projectKey(agent) {
  if (agent?.cwd) return `cwd:${agent.cwd}`;
  if (agent?.project) return `name:${agent.project}`;
  return '';
}

/** The command or server this event would be remembered as. Null if there is nothing to remember. */
export function baselineValue(event) {
  if (!event) return null;
  if (event.kind === 'network' && event.host && !event.trusted) return { type: 'host', value: String(event.host).toLowerCase() };
  if (event.command && event.kind !== 'network') {
    const value = fingerprint(event.command);
    return value ? { type: 'command', value } : null;
  }
  return null;
}

export function canBaseline(event) {
  if (!event || event.kind === 'system' || event.kind === 'task') return false;
  if (event.baseline || event.bait || event.prevented) return false;
  if (event.risk !== 'low' && event.risk !== 'medium') return false;
  if ((event.reasons || []).some((r) => SECRET.test(r))) return false;
  return !!baselineValue(event);
}

export function matchesBaseline(baseline, event, agent) {
  if (!baseline || !agent || baseline.projectKey !== projectKey(agent)) return false;
  const v = baselineValue(event.baseline ? { ...event, kind: event.kind, command: event.command, host: event.host } : event);
  if (!v) return false;
  return baseline.type === v.type && baseline.value === v.value;
}

export function baselineFromEvent(event, agent, now = Date.now()) {
  if (!canBaseline(event)) {
    return { error: 'Lookout will not hide that. Decoy reads and anything marked Dangerous or Risky stay flagged.' };
  }
  const key = projectKey(agent);
  if (!key) return { error: 'This session has no project folder, so there is nowhere to save the exception.' };
  const v = baselineValue(event);
  return {
    id: `b-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    projectKey: key,
    project: agent.project || agent.cwd,
    type: v.type,
    value: v.value,
    createdAt: now,
  };
}

export function applyBaseline(event, baselines, agent) {
  if (!event || event.baseline || !canBaseline(event)) return event;
  const hit = (baselines || []).find((b) => matchesBaseline(b, event, agent));
  if (!hit) return event;
  return {
    ...event,
    originalRisk: event.risk,
    risk: 'info',
    baseline: true,
    baselineId: hit.id,
    reasons: [...(event.reasons || []), 'this was marked as normal for this project, so it stays in the log and no longer changes the score'],
  };
}

export function revertBaseline(event) {
  if (!event?.baseline) return event;
  const reasons = (event.reasons || []).filter((r) => !/marked as normal for this project/.test(r));
  const risk = event.originalRisk || 'info';
  const next = { ...event, risk, reasons };
  delete next.baseline;
  delete next.baselineId;
  delete next.originalRisk;
  return next;
}
