// Claude Code hooks: Seatbelt sees each tool call BEFORE it runs and can block it.
// Docs: https://code.claude.com/docs/en/hooks
//
// hooks/seatbelt-hook.sh forwards Claude Code's hook JSON here and prints our answer.
//   PreToolUse  -> { hookSpecificOutput: { permissionDecision: 'deny' | 'ask', permissionDecisionReason } }
//                  We never answer 'allow': allowed actions return {} so Claude Code's own
//                  permission prompts still apply. Seatbelt only adds restrictions.
//   UserPromptSubmit -> remembers the task for this session.
//   PostToolUse -> notes when you approved an "ask" in the terminal.
import path from 'node:path';
import { addEvent, listAgents } from './store.js';
import { analyzeCommand, analyzePath, riskRank, shortPath } from './rules.js';
import { truncate } from './describe.js';

/** tool_use ids Seatbelt already recorded from a hook, so the transcript monitor doesn't log them twice. */
export const gatedToolUses = new Map(); // tool_use_id -> 'deny' | 'ask'
const sessions = new Map(); // session_id -> { task, projectDir }

function agentFor(cwd) {
  const live = listAgents().filter((a) => a.kind === 'claude' && a.alive);
  const exact = live.filter((a) => cwd && (a.cwd === cwd || cwd.startsWith(a.cwd + path.sep)));
  const pool = exact.length ? exact : live.length === 1 ? live : [];
  pool.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  return pool[0] ?? null;
}

/** `rm -rf` on folders inside the project is everyday cleanup (dist, node_modules). */
function rmOnlyInside(cmd, projectDir) {
  if (!projectDir) return false;
  const targets = [...cmd.matchAll(/\brm\s+-[a-zA-Z]+\s+([^;&|]+)/g)].flatMap((m) => m[1].trim().split(/\s+/));
  return targets.length > 0 && targets.every((t) => {
    const clean = t.replace(/^['"]|['"]$/g, '');
    if (/^(~|\$HOME|\$\{HOME\})/.test(clean)) return false;
    return path.resolve(projectDir, clean).startsWith(projectDir + path.sep);
  });
}

/** What the tool call would do, as { risk, reasons, what } using the existing rules. */
export function assess(tool, input, projectDir) {
  const p = input.file_path || input.notebook_path || input.path;
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    const r = analyzeCommand(cmd);
    if (rmOnlyInside(cmd, projectDir)) {
      const i = r.reasons.indexOf('deleted a folder and everything inside it');
      if (i !== -1) r.reasons.splice(i, 1);
      if (!r.reasons.length) r.risk = 'info';
    }
    return { ...r, what: `run \`${truncate(cmd, 120)}\`` };
  }
  if (['Read', 'NotebookRead', 'Grep', 'Glob', 'LS'].includes(tool) && p) {
    return { ...analyzePath(p), what: `${tool === 'Read' || tool === 'NotebookRead' ? 'read' : 'search'} ${shortPath(p)}` };
  }
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) && p) {
    return { ...analyzePath(p, { write: true, projectDir }), what: `change ${shortPath(p)}` };
  }
  return { risk: 'info', reasons: [], what: tool };
}

/**
 * Risk -> decision.
 *   critical, or high involving a secret          -> deny (no honest task needs it)
 *   other high and medium (uploads, sudo, persistence, force-push...) -> ask
 *   low and info                                   -> no objection
 */
const SECRET_RE = /decoy secret|accessed |Keychain|saved passwords|scrambled secret/;

export function decide({ risk, reasons }) {
  const secret = reasons.some((r) => SECRET_RE.test(r));
  if (risk === 'critical' || (risk === 'high' && secret)) return 'deny';
  if (riskRank(risk) >= riskRank('medium')) return 'ask';
  return null;
}

export function handleHook(event, payload, headerProject) {
  const sessionId = payload.session_id ?? 'unknown';
  const cwd = payload.cwd ?? '';
  const projectDir = headerProject || cwd;
  const s = sessions.get(sessionId) ?? { task: null, projectDir };
  sessions.set(sessionId, s);

  if (event === 'user-prompt') {
    if (payload.prompt) s.task = String(payload.prompt).slice(0, 2000);
    return {};
  }

  if (event === 'post-tool') {
    const id = payload.tool_use_id;
    if (id && gatedToolUses.get(id) === 'ask') {
      gatedToolUses.set(id, 'approved');
      const agent = agentFor(cwd);
      addEvent({
        agentId: agent?.id ?? null, kind: 'tool', risk: 'info', hook: true,
        title: `You approved it in the terminal: ${agent?.label ?? 'Claude Code'} went ahead`,
        detail: `${payload.tool_name} ${truncate(JSON.stringify(payload.tool_input ?? {}), 200)}`, tool: payload.tool_name,
      });
    }
    return {};
  }

  if (event !== 'pre-tool') return {};

  const tool = payload.tool_name ?? '';
  const input = payload.tool_input ?? {};
  const t0 = performance.now();
  const r = assess(tool, input, projectDir);
  const decision = decide(r);
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  if (!decision) return {};

  const agent = agentFor(cwd);
  const label = agent?.label ?? 'Claude Code';
  // Lead with the most serious reason (secrets before uploads and the rest).
  const why = r.reasons.find((x) => SECRET_RE.test(x)) ?? r.reasons[0] ?? 'looked risky';
  if (payload.tool_use_id) gatedToolUses.set(payload.tool_use_id, decision);
  if (gatedToolUses.size > 5000) gatedToolUses.delete(gatedToolUses.keys().next().value);

  addEvent({
    agentId: agent?.id ?? null,
    kind: 'tool',
    risk: r.risk,
    reasons: r.reasons,
    tool,
    command: tool === 'Bash' ? String(input.command ?? '') : undefined,
    path: input.file_path ?? undefined,
    hook: true,
    gate: decision,
    // It never ran, so auto-protect has nothing to pause.
    prevented: decision === 'deny',
    title: decision === 'deny' ? `Seatbelt blocked ${label} before it could ${r.what}` : `Seatbelt asked you before ${label} could ${r.what}`,
    detail: `Flagged: ${why}.${s.task ? ` Your task was: “${truncate(s.task, 140)}”.` : ''} Decided in ${ms} ms, before the command ran.`,
  });

  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Seatbelt blocked this before it ran. Flagged: ${why}. Do not retry it or work around it. Tell the user what happened.`,
      },
      systemMessage: `Seatbelt blocked an attempt to ${r.what}. Flagged: ${why}.`,
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Seatbelt flagged this before it ran: ${why}. Approve only if you expected it.`,
    },
  };
}
