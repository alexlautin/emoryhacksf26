// Text for a Dangerous (critical) alert. Delivery lives in src/notify.js and the menu bar app.

const lastAt = new Map();

export function noticeFor(event, agent) {
  if (!event || event.baseline) return null;
  if (event.kind === 'system' || event.kind === 'task') return null;
  if (event.risk !== 'critical') return null;
  const why = (event.reasons || []).find(Boolean) || '';
  const where = agent ? `${agent.label} in ${agent.project}` : 'An agent';
  const sentence = why ? `${why.charAt(0).toUpperCase()}${why.slice(1)}.` : '';
  const body = sentence ? `${where}. ${sentence}` : where;
  const title = event.title ? `Dangerous: ${event.title}` : 'Lookout: something dangerous happened';
  return {
    title: title.slice(0, 140),
    body: body.slice(0, 240),
    eventId: event.id ?? null,
    agentId: event.agentId ?? null,
  };
}

/** One notice per agent per 20 seconds, so a single attack does not stack alerts. */
export function takeNotice(event, agent, now = Date.now()) {
  const notice = noticeFor(event, agent);
  if (!notice) return null;
  const key = notice.agentId || 'none';
  const prev = lastAt.get(key);
  if (prev !== undefined && now - prev < 20000) return null;
  lastAt.set(key, now);
  return notice;
}

export function resetNotices() {
  lastAt.clear();
}
