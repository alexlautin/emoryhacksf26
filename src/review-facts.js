import { createHash } from 'node:crypto';
import os from 'node:os';
import { canReviewEvent } from '../public/event-review.js';

const HOME = os.homedir();

/** Make text safe to show and send: home paths shortened, obvious secrets and long tokens hidden, length capped. */
export function scrub(text, max = 400) {
  if (typeof text !== 'string') return '';
  let out = text.split(HOME).join('~')
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '~')
    .replace(/\/var\/folders\/[^\s"']+/g, '<temp file>')
    .replace(/(authorization:\s*)(bearer\s+)?\S+/gi, '$1[hidden]')
    .replace(/\b(AKIA|ASIA|AIza|ghp_|gho_|github_pat_|sk-|xox[bap]-)[A-Za-z0-9_\-.]{8,}/g, '[hidden key]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|key)=)[^\s&"']+/gi, '$1[hidden]')
    .replace(/(?<![\w/.~-])[A-Za-z0-9+_-]{40,}={0,2}(?![\w/.-])/g, '[hidden]')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

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

  add(`${KINDS[event.kind]} Harness's local rating is ${event.risk}. Harness's own summary: "${scrub(event.title, 220)}".`, event.id);

  // Why Harness rated it this way: its own rules, in plain words.
  const reasons = (event.reasons ?? []).map((r) => scrub(r, 260)).filter(Boolean);
  if (reasons.length) add(`Harness's rules flagged this for: ${reasons.join('; ')}.`, event.id);

  // What actually ran, touched or connected.
  if (event.command) add(`The command was: ${scrub(event.command, 450)}`, event.id);
  if (event.kind === 'file' && event.path) {
    add(`The file was ${scrub(event.path, 200)}.${event.bait ? ' It is a decoy secret Harness planted on purpose; no legitimate task reads it.' : ''}`, event.id);
  }
  if (event.kind === 'network') {
    const facts = [`The connection went to ${scrub(String(event.host ?? 'an unknown host'), 120)}${event.trusted === false ? ', which Harness did not recognize' : ''}.`];
    if (event.isAgentItself === false) facts.push('A child process made the connection, not the agent itself.');
    facts.push('The connection record has no payload, so what was sent is unknown.');
    add(facts.join(' '), event.id);
  }
  for (const reason of event.reasons ?? []) {
    if (REASONS.has(reason)) add(REASONS.get(reason), event.id);
  }
  if (event.attribution === 'guess') add('Attribution to the agent is uncertain.', event.id);
  if (event.gate === 'ask') add('The local hook requested user approval before the action.', event.id);

  const task = preceding.findLast((item) => item.kind === 'task');
  if (typeof task?.detail === 'string') {
    const topics = TASK_TOPICS.filter(([pattern]) => pattern.test(task.detail)).map(([, label]) => label);
    const context = [`The task the user gave the agent was: "${scrub(task.detail, 300)}".`];
    if (topics.length) context.push(`It mentioned ${topics.join(', ')}.`);
    if (event.kind === 'network' && event.host) {
      context.push(targetMentioned(task.detail, event.host)
        ? 'The destination appeared in the recorded task. A mention alone does not establish authorization.'
        : 'The destination was absent from the recorded task.');
    }
    add(context.join(' '), task.id);
  }

  const process = event.kind === 'process' ? event : event.pid == null ? null :
    preceding.findLast((item) => item.kind === 'process' && item.pid === event.pid);
  if (process?.steps?.slice(0, -1).some((step) => step.role === 'install')) {
    const chain = process.steps.map((step) => scrub(step.cmd ?? step.label ?? step.role, 60)).join(' → ');
    add(`Harness traced the process to a dependency installation. Chain: ${chain}.`, process.id);
  } else if (process?.steps?.length === 2) {
    add('The process tree shows the agent directly started the process.', process.id);
  }

  const input = { localRisk: event.risk, selectedEvent: 1, observations: evidence.map(({ id, text }) => ({ id, text })) };
  const revision = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  return { input, evidence, revision };
}
