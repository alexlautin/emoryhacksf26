export const REASONS = new Map([
  ['copied files to another computer', 'The command matched a remote file copy pattern.'],
  ['asked for administrator access', 'The command requested administrator privileges.'],
  ['controlled other apps using AppleScript', 'The command used AppleScript to control apps.'],
  ['turned off PowerShell script safety checks', 'The command lowered PowerShell script restrictions.'],
  ['deleted a folder and everything inside it', 'The command matched recursive directory deletion.'],
  ['force-pushed code, which can overwrite history on GitHub', 'The command matched a Git force-push.'],
  ['changed a file outside the project it was working on', 'A file change was outside the project.'],
]);

export const KINDS = {
  process: 'Harness observed an agent process.',
  tool: 'Harness recorded an agent tool action.',
  network: 'Harness observed a network connection. The connection record has no payload.',
  file: 'Harness observed a file event.',
};

export const TASK_TOPICS = [
  [/\b(install|dependencies|packages)\b/i, 'dependency setup'],
  [/\b(tests?|testing|test suite)\b/i, 'testing'],
  [/\b(delete|remove|clean up|cleanup)\b/i, 'cleanup'],
  [/\b(rebase|rewrite history|force[- ]push)\b/i, 'Git history changes'],
  [/\b(deploy|staging|health check)\b/i, 'deployment or service checks'],
];

export const NOTES = {
  "unfamiliar": "Harness did not recognize the destination.",
  "child": "A child process made the connection.",
  "uncertain": "Attribution to the agent is uncertain.",
  "approval": "The local hook requested user approval before the action.",
  "named": "The destination appeared in the recorded task. A mention alone does not establish authorization.",
  "unmentioned": "The destination was absent from the recorded task.",
  "install": "Harness traced the process to a dependency installation.",
  "direct": "The process tree shows the agent directly started the process."
};

// The endpoint accepts only exact combinations of the local vocabulary.
const eventNotes = [NOTES.unfamiliar, NOTES.child, ...REASONS.values(), NOTES.uncertain, NOTES.approval];

function isAllowedEvent(text) {
  const kind = Object.values(KINDS).find((prefix) => text === prefix || text.startsWith(prefix + ' '));
  if (!kind) return false;
  if (text === kind) return true;
  const notes = text.slice(kind.length + 1).split(/(?<=\.) /);
  let previous = -1;
  for (const note of notes) {
    const index = eventNotes.indexOf(note);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

const allowedTaskNotes = new Set();
for (let mask = 0; mask < 2 ** TASK_TOPICS.length; mask++) {
  const topics = TASK_TOPICS.filter((_, index) => mask & (1 << index)).map(([, topic]) => topic);
  const text = topics.length ? `The recorded task mentioned ${topics.join(', ')}.` : '';
  for (const destination of ['', NOTES.named, NOTES.unmentioned]) {
    if (text || destination) allowedTaskNotes.add([text, destination].filter(Boolean).join(' '));
  }
}
const allowedProcessNotes = new Set([NOTES.install, NOTES.direct]);

export function safeReviewInput(input) {
  if (input?.localRisk !== 'medium' || input?.selectedEvent !== 1 || !Array.isArray(input.observations) ||
      input.observations.length < 1 || input.observations.length > 3) return null;
  const observations = input.observations.map((item, index) => {
    if (item?.id !== index + 1 || typeof item.text !== 'string') return null;
    return { id: item.id, text: item.text };
  });
  if (observations.some((item) => !item) || !isAllowedEvent(observations[0].text)) return null;
  const [, taskOrProcess, process] = observations;
  if (process ? !allowedTaskNotes.has(taskOrProcess.text) || !allowedProcessNotes.has(process.text)
    : taskOrProcess && !allowedTaskNotes.has(taskOrProcess.text) && !allowedProcessNotes.has(taskOrProcess.text)) return null;
  return { localRisk: 'medium', selectedEvent: 1, observations };
}
