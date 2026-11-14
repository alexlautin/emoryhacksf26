// The demo walkthrough. Each step after the intro waits for a real event, in order.

export const COACH_STEPS = [
  {
    id: 'intro',
    title: 'Watch the part the agent window leaves out',
    body: 'A scripted agent will be asked to set up a project. Its own log only shows npm install. One dependency runs a setup script that reads a decoy key and tries to upload it.',
  },
  {
    id: 'asked',
    title: 'The agent was asked to set the project up',
    body: 'That request is ordinary. The risky part is not the request. It is inside a package the install pulled in.',
    test(e) { return e.kind === 'task'; },
  },
  {
    id: 'script',
    title: 'The install script ran commands the agent did not type',
    body: 'Harness follows the process tree: the agent, a shell, npm, the package script, then whatever that script starts.',
    test(e) {
      if (/install script/i.test(`${e.title || ''} ${(e.reasons || []).join(' ')}`)) return true;
      const steps = e.steps || [];
      const installAt = steps.findIndex((s) => s.role === 'install');
      const rank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[e.risk] ?? 0;
      // The package install itself is not the hidden part. A later, risky step is.
      return installAt !== -1 && installAt < steps.length - 1 && rank >= 2;
    },
  },
  {
    id: 'secret',
    title: 'The script opened a decoy secret',
    body: 'Harness plants fake keys in ~/.harness/bait. A real task does not need them. Opening one drops the score.',
    test(e) { return !!(e.bait || (e.reasons || []).some((r) => /decoy secret/.test(r))); },
  },
  {
    id: 'outcome',
    title: 'This is where it stopped',
    body: 'With Auto-protect on Dangerous only, the session freezes before the upload finishes. If Auto-protect is off, the pretend server on port 4199 counts the bytes and throws them away.',
    test(e) {
      return e.guard === 'paused' || (e.kind === 'network' && /4199|attacker/.test(`${e.host || ''} ${e.title || ''} ${e.detail || ''}`));
    },
  },
];

/** Index of the latest step the events have reached, without skipping ahead. */
export function coachCursor(events) {
  let last = 0;
  for (let s = 1; s < COACH_STEPS.length; s++) {
    if ((events || []).some((e) => COACH_STEPS[s].test(e))) last = s;
    else break;
  }
  return last;
}
