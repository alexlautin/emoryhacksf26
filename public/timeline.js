// Turns a process tree into the chain a person can read:
// agent -> shell -> package install -> install script -> curl.
// The monitors store `steps` on each process event. This file only arranges them.

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install)\b/;
const REQUEST = /\b(curl|wget|nc|ncat|netcat|socat)\b|Invoke-WebRequest|\biwr\b|\birm\b/;

export function commandRole(cmd, { shell = false } = {}) {
  const c = String(cmd ?? '').trim();
  const install = INSTALL.test(c);
  // A shell whose line is `npm install` is the wrapper. The npm process itself is the install.
  if (shell && install) return 'shell';
  if (install) return 'install';
  if (REQUEST.test(c)) return 'request';
  if (shell) return 'shell';
  return 'command';
}

/** Short name for one step, once we know whether it sits under a package install. */
export function stepName(role, { label = '', afterInstall = false } = {}) {
  if (role === 'agent') return label || 'Agent';
  if (role === 'install') return 'Package install';
  if (role === 'request') return 'Network request';
  if (afterInstall && role === 'shell') return 'Install script';
  if (afterInstall && role === 'command') return 'Package script';
  if (role === 'shell') return 'Shell';
  return 'Program';
}

export function presentSteps(steps) {
  const installAt = steps.findIndex((s) => s.role === 'install');
  const named = steps.map((s, i) => {
    const afterInstall = installAt !== -1 && i > installAt;
    return { ...s, name: stepName(s.role, { label: s.label, afterInstall }) };
  });
  // npm often shows the same line twice, once in the shell and once in the child.
  const collapsed = [];
  for (const step of named) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && step.cmd && prev.cmd === step.cmd) continue;
    collapsed.push(step);
  }
  return collapsed;
}

/**
 * Build the ordered steps for one new process.
 * `ancestors` is nearest parent first, and does not include the agent or the process itself.
 */
export function chainSteps({ agentLabel, rootPid, ancestors = [], current }) {
  const steps = [{ pid: rootPid, role: 'agent', label: agentLabel || 'Agent' }];
  for (const a of [...ancestors].reverse()) {
    steps.push({
      pid: a.pid,
      role: commandRole(a.cmd, { shell: !!a.shell }),
      cmd: a.cmd || '',
      label: a.label || '',
    });
  }
  if (current) {
    steps.push({
      pid: current.pid,
      role: commandRole(current.cmd, { shell: !!current.shell }),
      cmd: current.cmd || '',
      label: current.label || '',
    });
  }
  return steps;
}

/** The chain worth showing: the riskiest process, then the longest trail. */
export function bestChain(events) {
  const candidates = (events || []).filter((e) => Array.isArray(e.steps) && e.steps.length >= 2);
  if (!candidates.length) return null;
  candidates.sort((a, b) => ((RANK[b.risk] ?? 0) - (RANK[a.risk] ?? 0)) || (b.steps.length - a.steps.length) || ((b.ts ?? 0) - (a.ts ?? 0)));
  const top = candidates[0];
  return {
    eventId: top.id,
    risk: top.risk,
    command: top.command || '',
    steps: presentSteps(top.steps),
  };
}

/** Events worth walking through, oldest first. Routine process noise stays out. */
export function replayItems(events) {
  return (events || [])
    .filter((e) => {
      if (e.guard || e.kind === 'task' || e.bait || e.hook || e.agentReported) return true;
      if (e.kind === 'file' && e.batch) return true;
      if (e.kind === 'system') return false;
      return (RANK[e.risk] ?? 0) >= 1;
    })
    .slice()
    .sort((a, b) => (a.ts - b.ts) || ((a.id ?? 0) - (b.id ?? 0)));
}
