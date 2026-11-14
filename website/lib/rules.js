// The command rules from the desktop monitor (src/rules.js in the repo root), without the parts
// that need a real computer. The browser demo runs every generated command through these, so the
// risk levels on screen come from the same rules the app uses, not from the model that wrote the story.
// Keep the two files in sync when a rule changes.

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

// The demo's stand-in for the decoy files the app plants on first run.
export const BAIT = /\.harness[\\/]bait[\\/][\w.-]+/;

const SENSITIVE = [
  { re: /\.ssh([\\/]|\b)/, what: 'your SSH keys (used to log into servers and GitHub)' },
  { re: /\.aws([\\/]|\b)/, what: 'your AWS cloud credentials' },
  { re: /(^|[\\/\s'"=])\.env(\.[\w-]+)?($|[\s'"])/, what: 'a .env file (where apps keep passwords and API keys)' },
  { re: /Library[\\/]Keychains|security\s+(find|dump)-\w+/, what: "your Mac's Keychain (saved passwords)" },
  { re: /(Chrome|Chromium|BraveSoftware|Arc|Edge)[\\/].*(Cookies|Login Data|Local State)|Safari[\\/]|Firefox[\\/]Profiles|Cookies\.binarycookies/i, what: "your browser's saved logins and cookies" },
  { re: /\.git-credentials|\.netrc|\.npmrc|\.pypirc|\.docker[\\/]config\.json|\.kube[\\/]config|gh[\\/]hosts\.yml/, what: 'saved access tokens for developer tools' },
  { re: /\.(zsh|bash)_history/i, what: 'your terminal history (can contain passwords)' },
  { re: /Library[\\/](Messages|Mail)\b/, what: 'your messages or email' },
];

const COMMAND_RULES = [
  { re: /\brm\s+-[a-zA-Z]*(rf|fr)[a-zA-Z]*\s+(~|\/|\$HOME)(\s|\/?$|\/\*)/, risk: 'critical', reason: 'tried to delete your whole home folder or disk' },
  { re: /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)/, risk: 'critical', reason: 'tried to pull saved passwords out of your Keychain' },
  { re: /\bcurl\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bwget\b[^|;&]*\|\s*(ba|z)?sh\b/, risk: 'high', reason: 'downloaded a script from the internet and ran it immediately' },
  { re: /\bcurl\b[^;&|]*(\s-d\b|\s--data|\s-F\b|\s--form|\s-T\b|\s--upload-file|-X\s*(POST|PUT))/, risk: 'high', reason: 'uploaded data to a server' },
  { re: /\bwget\b[^;&|]*--post-(data|file)/, risk: 'high', reason: 'uploaded data to a server' },
  { re: /(^|[\s;&|(])(nc|ncat|netcat|socat)\s/i, risk: 'high', reason: 'opened a raw network connection (a common way to sneak data out)' },
  { re: /launchctl\s+(load|bootstrap|submit|enable)|LaunchAgents|LaunchDaemons|(^|[\s;&|])crontab\s/, risk: 'high', reason: 'set something up to run automatically in the background, even after a restart' },
  { re: />>?\s*\S*\.(zshrc|bashrc|zprofile|bash_profile|profile)\b/, risk: 'high', reason: 'changed your terminal startup file (runs every time you open a terminal)' },
  { re: /\bscreencapture\b/, risk: 'high', reason: 'took a screenshot of your screen' },
  { re: /\bscp\s|\brsync\b[^;&|]*\s\S+:/, risk: 'medium', reason: 'copied files to another computer' },
  { re: /(^|[\s;&|])sudo\s/i, risk: 'medium', reason: 'asked for administrator access' },
  { re: /\bosascript\b/, risk: 'medium', reason: 'controlled other apps using AppleScript' },
  { re: /\brm\s+-[a-zA-Z]*(rf|fr)/i, risk: 'medium', reason: 'deleted a folder and everything inside it' },
  { re: /\bgit\s+push\b[^;&|]*(--force|-f\b)/, risk: 'medium', reason: 'force-pushed code, which can overwrite history on GitHub' },
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install)\b/, risk: 'low', reason: 'installed packages (packages can run their own setup code)' },
  { re: /\bgit\s+push\b/, risk: 'low', reason: 'pushed code to GitHub' },
  { re: /\bchmod\s+(\+x|[0-7]*7[0-7]*\s)/, risk: 'low', reason: 'made a file runnable or open to everyone' },
];

export const maxRisk = (a, b) => (RANK[a] >= RANK[b] ? a : b);

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
  if (reasons.includes('uploaded data to a server')) {
    const hosts = [...cmd.matchAll(/https?:\/\/([^\/\s'"]+)/g)].map((m) => m[1]);
    if (hosts.length && hosts.every((u) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u))) {
      reasons.splice(reasons.indexOf('uploaded data to a server'), 1, 'sent data to a program on this computer');
      risk = reasons.length > 1 ? risk : 'low';
    }
  }
  const bait = cmd.match(BAIT);
  let secret = false;
  if (bait) {
    secret = true;
    risk = 'critical';
    reasons.push(`touched a decoy secret Harness planted (~/${bait[0]}). No honest task needs this file`);
  }
  for (const s of SENSITIVE) {
    if (!s.re.test(cmd)) continue;
    // A decoy is the stronger signal; don't also report the generic .env or .aws match next to it.
    if (bait && /\.env|AWS/.test(s.what)) continue;
    secret = true;
    risk = maxRisk(risk, 'high');
    reasons.push(`accessed ${s.what}`);
  }
  if (secret && /base64|openssl\s+enc|\bxxd\b/i.test(cmd)) {
    risk = maxRisk(risk, 'high');
    reasons.push('scrambled secret data so it would be harder to spot');
  }
  return { risk, reasons };
}
