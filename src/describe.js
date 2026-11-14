// Turns raw commands into short sentences for the simple view.
import path from 'node:path';

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish']);
const WIN_SHELLS = new Set(['cmd', 'powershell', 'pwsh']);

/** Split off the program: handles Windows' quoted paths ("C:\Program Files\Git\bin\bash.exe" -c ...). */
function splitExe(args) {
  const m = args.match(/^"([^"]+)"\s*(.*)$/s) ?? args.match(/^(\S+)\s*(.*)$/s);
  if (!m) return { exe: '', rest: '' };
  return { exe: m[1].split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase(), rest: m[2] };
}

const unquote = (s) => s.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1').trim();

/**
 * Pull the command a person would recognize out of a process's arguments.
 * Claude Code wraps commands as: zsh -c "source snapshot ... && eval '<cmd>' < /dev/null && pwd ..."
 * Codex wraps them as: zsh -lc "<cmd>". On Windows: bash.exe -c, cmd /c, powershell -Command.
 */
export function extractCommand(args) {
  const evalMatch = args.match(/\beval '((?:[^']|'\\'')*)'/);
  if (evalMatch) return evalMatch[1].replaceAll(`'\\''`, `'`).trim();

  const { exe, rest } = splitExe(args);
  if (SHELLS.has(exe)) {
    const m = rest.match(/(?:^|\s)-[a-z]*c[a-z]*\s+([\s\S]*)$/);
    if (m) return unquote(m[1]);
  }
  if (WIN_SHELLS.has(exe)) {
    const m = exe === 'cmd' ? rest.match(/(?:^|\s)\/[cCkK]\s+([\s\S]*)$/) : rest.match(/(?:^|\s)-(?:c|command)\s+([\s\S]*)$/i);
    if (m) return unquote(m[1]);
  }
  // Shorten the program to its name: /usr/bin/git status -> git status
  return [exe, rest].filter(Boolean).join(' ').trim();
}

const VERBS = [
  [/^(git|gh)\b/, 'used Git'],
  [/^(npm|pnpm|yarn|bun|npx|pnpx)\s+(i|install|add|ci)\b/, 'installed packages'],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|build|test)\b/, 'started the app or its tests'],
  [/^(npm|pnpm|yarn|bun|npx|pnpx)\b/, 'ran the package manager'],
  [/^(pip3?|uv|poetry)\b/, 'managed Python packages'],
  [/^(node|deno|tsx|ts-node)\b/, 'ran a JavaScript program'],
  [/^(python3?|uv run)\b/, 'ran a Python program'],
  [/^(curl|wget|http|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i, 'made a web request'],
  [/^(rg|grep|find|fd|ls|cat|head|tail|sed|awk|wc|tree|stat|file|dir|type|Get-ChildItem|Get-Content|Select-String)\b/i, 'looked through files'],
  [/^(rm|trash|rmdir|rd|del|Remove-Item)\b/i, 'deleted files'],
  [/^(mkdir|touch|cp|mv|ln)\b/, 'organized files'],
  [/^(sh|bash|zsh|cmd|powershell|pwsh)\b/i, 'ran a shell script'],
  [/^(open)\b/, 'opened an app or file'],
  [/^(ps|lsof|top|kill|pkill|tasklist|taskkill|Get-Process|Stop-Process)\b/i, 'checked running programs'],
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
