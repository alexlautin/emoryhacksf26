import { createHash } from 'node:crypto';
import { canReviewEvent } from '../public/event-review.js';

import { REASONS, KINDS, TASK_TOPICS, NOTES } from '../website/lib/review-observations.js';

function targetMentioned(task, host) {
  return typeof host === 'string' && host.length > 0 && typeof task === 'string' &&
    task.toLowerCase().split(/[^a-z0-9.:-]+/).some((part) => part.replace(/[.:]+$/, '') === host.toLowerCase());
}

export function buildReviewPreview(event, sessionEvents) {
  if (!canReviewEvent(event)) return null;
  const preceding = sessionEvents.filter((item) => item.agentId === event.agentId && item.id < event.id);
  const evidence = [];
  function add(text, eventId) {
    evidence.push({ id: evidence.length + 1, text, eventId });
  }

  const notes = [KINDS[event.kind]];
  if (event.kind === 'network') {
    if (event.trusted === false) notes.push(NOTES.unfamiliar);
    if (event.isAgentItself === false) notes.push(NOTES.child);
  }
  for (const [reason, text] of REASONS) {
    if (event.reasons?.includes(reason)) notes.push(text);
  }
  if (event.attribution === 'guess') notes.push(NOTES.uncertain);
  if (event.gate === 'ask') notes.push(NOTES.approval);
  add(notes.join(' '), event.id);

  const task = preceding.findLast((item) => item.kind === 'task');
  if (typeof task?.detail === 'string') {
    const topics = TASK_TOPICS.filter(([pattern]) => pattern.test(task.detail)).map(([, label]) => label);
    const context = topics.length ? [`The recorded task mentioned ${topics.join(', ')}.`] : [];
    if (event.kind === 'network' && event.host) {
      context.push(targetMentioned(task.detail, event.host)
        ? NOTES.named
        : NOTES.unmentioned);
    }
    if (context.length) add(context.join(' '), task.id);
  }

  const process = event.kind === 'process' ? event : event.pid == null ? null :
    preceding.findLast((item) => item.kind === 'process' && item.pid === event.pid);
  if (process?.steps?.slice(0, -1).some((step) => step.role === 'install')) {
    add(NOTES.install, process.id);
  } else if (process?.steps?.length === 2) {
    add(NOTES.direct, process.id);
  }

  const input = { localRisk: event.risk, selectedEvent: 1, observations: evidence.map(({ id, text }) => ({ id, text })) };
  const revision = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  return { input, evidence, revision };
}
