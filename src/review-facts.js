import { createHash } from 'node:crypto';
import { canReviewEvent } from '../public/event-review.js';

const REASONS = new Map([
  ['copied files to another computer', 'The command matched a remote file copy pattern.'],
  ['asked for administrator access', 'The command requested administrator privileges.'],
  ['controlled other apps using AppleScript', 'The command used AppleScript to control apps.'],
  ['turned off PowerShell script safety checks', 'The command lowered PowerShell script restrictions.'],
  ['deleted a folder and everything inside it', 'The command matched recursive directory deletion.'],
  ['force-pushed code, which can overwrite history on GitHub', 'The command matched a Git force-push.'],
  ['changed a file outside the project it was working on', 'A file change was outside the project.'],
]);

const KINDS = {
  process: 'Harness observed an agent process.',
  tool: 'Harness recorded an agent tool action.',
  network: 'Harness observed a network connection. The connection record has no payload.',
  file: 'Harness observed a file event.',
};

const TASK_TOPICS = [
  [/\b(install|dependencies|packages)\b/i, 'dependency setup'],
  [/\b(tests?|testing|test suite)\b/i, 'testing'],
  [/\b(delete|remove|clean up|cleanup)\b/i, 'cleanup'],
  [/\b(rebase|rewrite history|force[- ]push)\b/i, 'Git history changes'],
  [/\b(deploy|staging|health check)\b/i, 'deployment or service checks'],
];

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
    if (event.trusted === false) notes.push('Harness did not recognize the destination.');
    if (event.isAgentItself === false) notes.push('A child process made the connection.');
  }
  for (const reason of event.reasons ?? []) {
    if (REASONS.has(reason)) notes.push(REASONS.get(reason));
  }
  if (event.attribution === 'guess') notes.push('Attribution to the agent is uncertain.');
  if (event.gate === 'ask') notes.push('The local hook requested user approval before the action.');
  add(notes.join(' '), event.id);

  const task = preceding.findLast((item) => item.kind === 'task');
  if (typeof task?.detail === 'string') {
    const topics = TASK_TOPICS.filter(([pattern]) => pattern.test(task.detail)).map(([, label]) => label);
    const context = topics.length ? [`The recorded task mentioned ${topics.join(', ')}.`] : [];
    if (event.kind === 'network' && event.host) {
      context.push(targetMentioned(task.detail, event.host)
        ? 'The destination appeared in the recorded task. A mention alone does not establish authorization.'
        : 'The destination was absent from the recorded task.');
    }
    if (context.length) add(context.join(' '), task.id);
  }

  const process = event.kind === 'process' ? event : event.pid == null ? null :
    preceding.findLast((item) => item.kind === 'process' && item.pid === event.pid);
  if (process?.steps?.slice(0, -1).some((step) => step.role === 'install')) {
    add('Harness traced the process to a dependency installation.', process.id);
  } else if (process?.steps?.length === 2) {
    add('The process tree shows the agent directly started the process.', process.id);
  }

  const input = { localRisk: event.risk, selectedEvent: 1, observations: evidence.map(({ id, text }) => ({ id, text })) };
  const revision = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  return { input, evidence, revision };
}
