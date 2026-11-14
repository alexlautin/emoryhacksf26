// Turns raw commands into short, plain-English sentences for the simple view.
import path from 'node:path';

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish']);

/**
 * Pull the command a person would recognize out of a process's arguments.
 * Claude Code wraps commands as: zsh -c "source snapshot ... && eval '<cmd>' < /dev/null && pwd ..."
 * Codex wraps them as: zsh -lc "<cmd>".
 */
export function extractCommand(args) {
  const evalMatch = args.match(/\beval '((?:[^']|'\\'')*)'/);
  if (evalMatch) return evalMatch[1].replaceAll(`'\\''`, `'`).trim();

  const parts = args.split(' ');
  const exe = path.basename(parts[0] || '');
  if (SHELLS.has(exe)) {
    const i = parts.findIndex((p, idx) => idx > 0 && /^-[a-z]*c[a-z]*$/.test(p));
    if (i > 0) return parts.slice(i + 1).join(' ').replace(/^["']|["']$/g, '').trim();
  }
  // Shorten the executable to its name: /usr/bin/git status -> git status
  return [exe, ...parts.slice(1)].join(' ').trim();
}

const VERBS = [
  [/^(git|gh)\b/, 'used Git'],
  [/^(npm|pnpm|yarn|bun|npx|pnpx)\s+(i|install|add|ci)\b/, 'installed packages'],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|build|test)\b/, 'started the app or its tests'],
  [/^(npm|pnpm|yarn|bun|npx|pnpx)\b/, 'ran the package manager'],
  [/^(pip3?|uv|poetry)\b/, 'managed Python packages'],
  [/^(node|deno|tsx|ts-node)\b/, 'ran a JavaScript program'],
  [/^(python3?|uv run)\b/, 'ran a Python program'],
  [/^(curl|wget|http)\b/, 'made a web request'],
  [/^(rg|grep|find|fd|ls|cat|head|tail|sed|awk|wc|tree|stat|file)\b/, 'looked through files'],
  [/^(rm|trash|rmdir)\b/, 'deleted files'],
  [/^(mkdir|touch|cp|mv|ln)\b/, 'organized files'],
  [/^(sh|bash|zsh)\b/, 'ran a shell script'],
  [/^(open)\b/, 'opened an app or file'],
  [/^(ps|lsof|top|kill|pkill)\b/, 'checked running programs'],
  [/^(make|cargo|go|swift|xcodebuild|tsc|vite|next)\b/, 'built the code'],
];

export function friendlyCommand(cmd) {
  const c = cmd.trim();
  for (const [re, verb] of VERBS) if (re.test(c)) return verb;
  return 'ran a command';
}

export function truncate(s, n = 140) {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ');
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

export const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex', demo: 'Demo agent' };
