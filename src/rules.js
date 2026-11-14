// Rules that turn raw activity into risk levels and short reasons.
// Ordered from most to least severe. Each rule: { test, risk, reason }.
import os from 'node:os';

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

// Decoy secrets planted by Lookout (filled in by files.js at startup).
export const baitPaths = new Set();
// marker string -> decoy path. Each decoy holds a unique random value; seeing it anywhere else
// (a command, a file write, an upload, tool output) means its contents were read and are moving.
export const baitMarkers = new Map();

/** Decoys whose unique marker appears in this text. */
export function markerHits(text) {
  if (!text || !baitMarkers.size) return [];
  const hits = [];
  for (const [marker, p] of baitMarkers) if (text.includes(marker) && !hits.includes(p)) hits.push(p);
  return hits;
}

// Paths are matched with either slash, so the same rules work on macOS and Windows.
export const SENSITIVE = [
  { re: /\.ssh([\\/]|\b)/, what: 'your SSH keys (used to log into servers and GitHub)' },
  { re: /\.aws([\\/]|\b)/, what: 'your AWS cloud credentials' },
  { re: /(^|[\\/\s'"=])\.env(\.[\w-]+)?($|[\s'"])/, what: 'a .env file (where apps keep passwords and API keys)' },
  { re: /Library[\\/]Keychains|security\s+(find|dump)-\w+/, what: "your Mac's Keychain (saved passwords)" },
  { re: /cmdkey(\.exe)?\s+\/list|vaultcmd|Get-StoredCredential|Microsoft[\\/](Credentials|Protect|Vault)\b/i, what: 'your saved Windows passwords (Credential Manager)' },
  { re: /(Chrome|Chromium|BraveSoftware|Arc|Edge)[\\/].*(Cookies|Login Data|Local State)|Safari[\\/]|Firefox[\\/]Profiles|Cookies\.binarycookies/i, what: "your browser's saved logins and cookies" },
  { re: /\.git-credentials|\.netrc|\.npmrc|\.pypirc|\.docker[\\/]config\.json|\.kube[\\/]config|gh[\\/]hosts\.yml/, what: 'saved access tokens for developer tools' },
  { re: /\.(zsh|bash)_history|ConsoleHost_history\.txt/i, what: 'your terminal history (can contain passwords)' },
  { re: /Library[\\/](Messages|Mail)\b/, what: 'your messages or email' },
];

const PS_WEB = String.raw`(Invoke-WebRequest|Invoke-RestMethod|\biwr|\birm)\b`;

const COMMAND_RULES = [
  { re: /\brm\s+-[a-zA-Z]*(rf|fr)[a-zA-Z]*\s+(~|\/|\$HOME)(\s|\/?$|\/\*)/, risk: 'critical', reason: 'tried to delete your whole home folder or disk' },
  { re: /Remove-Item\b[^;|]*-Recurse[^;|]*\s(~|\$HOME|\$env:USERPROFILE|C:\\?)(\s|\\?\*?$|;)|\b(rd|rmdir)\s+\/s\b[^;&|]*\s(C:\\?|%USERPROFILE%)(\s|$)/i, risk: 'critical', reason: 'tried to delete your whole home folder or disk' },
  { re: /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)/, risk: 'critical', reason: 'tried to pull saved passwords out of your Keychain' },
  { re: /\bcurl\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bwget\b[^|;&]*\|\s*(ba|z)?sh\b/, risk: 'high', reason: 'downloaded a script from the internet and ran it immediately' },
  { re: new RegExp(String.raw`(${PS_WEB}|DownloadString)[^;]*\|\s*(iex|Invoke-Expression)\b|\b(iex|Invoke-Expression)\b[^;]*(${PS_WEB}|DownloadString)`, 'i'), risk: 'high', reason: 'downloaded a script from the internet and ran it immediately' },
  { re: /\bcurl\b[^;&|]*(\s-d\b|\s--data|\s-F\b|\s--form|\s-T\b|\s--upload-file|-X\s*(POST|PUT))/, risk: 'high', reason: 'uploaded data to a server' },
  { re: /\bwget\b[^;&|]*--post-(data|file)/, risk: 'high', reason: 'uploaded data to a server' },
  { re: new RegExp(String.raw`${PS_WEB}[^;|]*(-Method\s+(Post|Put)|-InFile|-Body)|\.Upload(File|String|Data)\(`, 'i'), risk: 'high', reason: 'uploaded data to a server' },
  { re: /(^|[\s;&|(])(nc|ncat|netcat|socat)(\.exe)?\s|Net\.Sockets\.TcpClient/i, risk: 'high', reason: 'opened a raw network connection (a common way to sneak data out)' },
  { re: /launchctl\s+(load|bootstrap|submit|enable)|LaunchAgents|LaunchDaemons|(^|[\s;&|])crontab\s/, risk: 'high', reason: 'set something up to run automatically in the background, even after a restart' },
  { re: /schtasks(\.exe)?\s+\/create|Register-ScheduledTask|\breg(\.exe)?\s+add\b[^;&|]*\\(Run|RunOnce)\b|CurrentVersion\\Run|Start Menu\\Programs\\Startup|\bsc(\.exe)?\s+create\b|New-Service\b/i, risk: 'high', reason: 'set something up to run automatically in the background, even after a restart' },
  { re: />>?\s*\S*\.(zshrc|bashrc|zprofile|bash_profile|profile)\b/, risk: 'high', reason: 'changed your terminal startup file (runs every time you open a terminal)' },
  { re: /(>>?|Add-Content|Set-Content|Out-File)[^;|]*\$PROFILE\b/i, risk: 'high', reason: 'changed your PowerShell startup file (runs every time you open PowerShell)' },
  { re: /Set-MpPreference\b[^;|]*-Disable|Add-MpPreference\b[^;|]*-Exclusion/i, risk: 'high', reason: 'tried to switch off or get around Windows Defender' },
  { re: /\s-(e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i, risk: 'high', reason: 'ran a scrambled (encoded) PowerShell command, which hides what it does' },
  { re: /\bscreencapture\b|CopyFromScreen/, risk: 'high', reason: 'took a screenshot of your screen' },
  { re: /\bscp\s|\brsync\b[^;&|]*\s\S+:/, risk: 'medium', reason: 'copied files to another computer' },
  { re: /(^|[\s;&|])sudo\s|-Verb\s+RunAs\b|(^|[\s;&|])runas(\.exe)?\s/i, risk: 'medium', reason: 'asked for administrator access' },
  { re: /\bosascript\b/, risk: 'medium', reason: 'controlled other apps using AppleScript' },
  { re: /Set-ExecutionPolicy\s+(Bypass|Unrestricted)/i, risk: 'medium', reason: 'turned off PowerShell script safety checks' },
  { re: /\brm\s+-[a-zA-Z]*(rf|fr)|Remove-Item\b[^;|]*-Recurse|\b(rd|rmdir)\s+\/s\b/i, risk: 'medium', reason: 'deleted a folder and everything inside it' },
  { re: /\bgit\s+push\b[^;&|]*(--force|-f\b)/, risk: 'medium', reason: 'force-pushed code, which can overwrite history on GitHub' },
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install)\b|\b(winget|choco|scoop)\s+install\b/, risk: 'low', reason: 'installed packages (packages can run their own setup code)' },
  { re: /\bgit\s+push\b/, risk: 'low', reason: 'pushed code to GitHub' },
  { re: /\bchmod\s+(\+x|[0-7]*7[0-7]*\s)/, risk: 'low', reason: 'made a file runnable or open to everyone' },
];

export function maxRisk(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

export function riskRank(r) {
  return RANK[r] ?? 0;
}

function expandHome(s) {
  return s
    .replace(/\$env:USERPROFILE|%USERPROFILE%|\$HOME/gi, HOME)
    .replace(/(^|[\s'"=])~(?=[\\/])/g, `$1${HOME}`);
}

/** Windows paths can use either slash and any letter case; compare them in one form. */
const norm = (s) => (IS_WIN ? s.replaceAll('\\', '/').toLowerCase() : s);

/** Which sensitive things does a command line or path mention? */
export function sensitiveHits(text) {
  const expanded = norm(expandHome(text));
  const hits = [];
  for (const p of baitPaths) {
    if (expanded.includes(norm(p)) || expanded.includes(norm(p.replace(HOME, '~')))) {
      hits.push({ risk: 'critical', reason: `touched a decoy secret Lookout planted (${shortPath(p)}). No honest task needs this file` });
    }
  }
  for (const p of markerHits(text)) {
    hits.push({ risk: 'critical', reason: `used the contents of a decoy secret (${shortPath(p)}). Only that file holds this value, so the agent read it and is passing it on` });
  }
  for (const s of SENSITIVE) {
    if (s.re.test(expanded) && !hits.some((h) => h.what === s.what)) {
      hits.push({ risk: 'high', what: s.what, reason: `accessed ${s.what}` });
    }
  }
  // A bait .env also matches the generic .env rule; keep only the stronger signal.
  if (hits.some((h) => h.risk === 'critical')) return hits.filter((h) => h.risk === 'critical' || !/\.env/.test(h.what ?? ''));
  return hits;
}

/** Analyze one command line. Returns { risk, reasons }. */
export function analyzeCommand(cmd) {
  let risk = 'info';
  const reasons = [];
  for (const r of COMMAND_RULES) {
    if (r.re.test(cmd)) {
      risk = maxRisk(risk, r.risk);
      if (!reasons.includes(r.reason)) reasons.push(r.reason);
    }
  }
  // Sending data to a program on this same computer (a local dev server) is usually fine.
  // Port 4199 is the demo's pretend attacker, so it's treated as if it were far away.
  if (reasons.includes('uploaded data to a server')) {
    const urls = [
      ...[...cmd.matchAll(/https?:\/\/([^\/\s'"]+)/g)].map((m) => m[1]),
      ...[...cmd.matchAll(/(?:^|\s)((?:localhost|127\.0\.0\.1)(?::\d+)?)(?=[\/\s'"]|$)/g)].map((m) => m[1]),
    ];
    if (urls.length && urls.every((u) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u) && !u.endsWith(':4199'))) {
      reasons.splice(reasons.indexOf('uploaded data to a server'), 1, 'sent data to a program on this computer');
      risk = reasons.length > 1 ? risk : 'low';
    }
  }
  const hits = sensitiveHits(cmd);
  for (const h of hits) {
    risk = maxRisk(risk, h.risk);
    reasons.push(h.reason);
  }
  if (/base64|openssl\s+enc|\bxxd\b|certutil(\.exe)?\s+-encode/i.test(cmd) && hits.length) {
    risk = maxRisk(risk, 'high');
    reasons.push('scrambled secret data so it would be harder to spot');
  }
  return { risk, reasons };
}

/** Analyze a file path an agent read or changed. */
export function analyzePath(p, { write = false, projectDir = null } = {}) {
  let risk = 'info';
  const reasons = [];
  for (const h of sensitiveHits(p)) {
    risk = maxRisk(risk, h.risk);
    reasons.push(h.reason);
  }
  if (write && /Library[\\/]Launch(Agents|Daemons)[\\/]|Start Menu[\\/]Programs[\\/]Startup[\\/]/i.test(p)) {
    risk = maxRisk(risk, 'high');
    reasons.push('added something that will run automatically every time you log in');
  }
  if (write && /[\\/](\.(zshrc|bashrc|zprofile|bash_profile|profile)|\w*profile\.ps1)$/i.test(p)) {
    risk = maxRisk(risk, 'high');
    reasons.push('changed your terminal startup file');
  }
  if (write && projectDir && !norm(p).startsWith(norm(projectDir)) && risk === 'info') {
    risk = 'low';
    reasons.push('changed a file outside the project it was working on');
  }
  return { risk, reasons };
}

const TRUSTED_HOSTS = [
  'anthropic.com', 'claude.ai', 'claude.com', 'openai.com', 'chatgpt.com', 'oaistatic.com',
  'github.com', 'githubusercontent.com', 'npmjs.org', 'npmjs.com', 'yarnpkg.com',
  'pypi.org', 'pythonhosted.org', 'apple.com', 'icloud.com', 'googleapis.com', 'google.com',
  'sentry.io', 'statsig.com', 'datadoghq.com',
];

/** Classify a network destination. */
export function analyzeDestination({ host, ip, port, isAgentItself }) {
  const name = host || ip;
  if (/^(127\.|::1$|localhost$|\[::1\])/.test(ip || '') || host === 'localhost') {
    if (port === 4199) {
      return { risk: 'high', where: 'the pretend attacker server (demo, port 4199)', trusted: false, local: true, reasons: ['sent data to a server that is standing in for an attacker in this demo'] };
    }
    return { risk: isAgentItself ? 'info' : 'low', where: `a program on this computer (port ${port})`, trusted: false, local: true, reasons: [] };
  }
  const trusted = !!host && TRUSTED_HOSTS.some((t) => host === t || host.endsWith('.' + t));
  if (isAgentItself || trusted) {
    return { risk: 'info', where: name, trusted, local: false, reasons: [] };
  }
  return { risk: 'medium', where: name, trusted: false, local: false, reasons: [`connected to a server Lookout doesn't recognize (${name}:${port})`] };
}

export function shortPath(p) {
  return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}
