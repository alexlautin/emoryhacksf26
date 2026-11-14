# Seatbelt

Seatbelt watches what Claude Code and Codex do on your computer, including the parts their own windows don't show, and tells you about anything risky.

Say an agent runs `npm install`. Its window shows one line and a checkmark. Underneath, a package's install script could be reading your `.env` and uploading it. Seatbelt follows the whole chain (agent, shell, npm, install script, curl) along with the files and servers involved, and can pause the agent before it finishes.

It runs locally. Nothing is sent anywhere.

## Running it

You need Node 22 or newer and pnpm.

```bash
pnpm install
pnpm start
```

Then open http://localhost:4100. Any Claude Code or Codex session already running shows up on its own. Set `PORT` to use a different port.

Works on macOS and Windows 10/11. On Windows, run it from PowerShell or Windows Terminal. It doesn't need admin rights on either system.

## Demo

Click "Run demo attack". A scripted stand-in agent is asked to set up a project in `demo/victim-project`, so it runs `npm install`. One dependency, `color-helpers`, has a malicious install script that reads `.env` and a fake AWS key, base64-encodes them, and POSTs them to a local "attacker" server on port 4199.

What you should see:

- The install script's command line names the decoy secrets, so it's flagged as Dangerous and traced back to the package rather than the agent.
- Auto-protect is set to "Dangerous only" by default. It pauses the agent and everything under it before the upload happens. You can then end the session or let it continue.
- The safety score (300 to 850, like a credit score) drops, and the factor list shows why.
- Explain writes a short summary with a local model if Ollama is running, or from the rules if it isn't.

Set Auto-protect to Off if you want to watch the attack go all the way through. The secrets are fake and the attacker server only counts bytes, so this is safe to run.

To try it with a real agent:

```bash
pnpm demo:reset
cd demo/victim-project
claude
```

Then ask it to set up and run the project. We haven't tested this with a real agent yet, so use the scripted demo when showing it to people.

## How it works

`src/monitor/processes.js` polls the process list every half second and follows every process under a `claude` or `codex` process. On macOS this uses `ps`. On Windows, one long-running PowerShell process keeps reporting `Win32_Process`.

`src/monitor/network.js` lists open connections for those processes (`lsof` on macOS, `netstat -ano` on Windows) and names the server with reverse DNS or the URL in the command.

`src/monitor/files.js` plants decoy secrets in `~/.seatbelt/bait` and notices when they're read by checking access times. It also watches the project folder, `~/.ssh`, shell startup files, and the places programs use to start at login (LaunchAgents on macOS, the Startup folder on Windows).

`src/monitor/transcripts.js` reads the session logs in `~/.claude/projects` and `~/.codex/sessions` to see what the agent was asked to do and which tools it used.

`src/rules.js` turns commands and file paths into a risk level and a short reason. It covers things like uploads, secrets, deleting your home folder, downloads piped into a shell, scheduled tasks and registry Run keys, and turning off Defender.

`src/guard.js` is Auto-protect. It pauses the whole process tree with `SIGSTOP` on macOS or `NtSuspendProcess` on Windows, and ends it with `SIGTERM`/`SIGKILL` or `taskkill /T /F`. The setting is saved in `data/settings.json`.

`public/score.js` works out the score. Everyone starts at 850. Risky events cost points in six categories, each with a cap, and the cost halves every 12 hours. The lowest possible score is 300.

The dashboard in `public/` is plain HTML and JavaScript, updated live over Server-Sent Events. Icons are from Lucide and the font is Instrument Sans, both served locally. Every event is also written to `data/events.jsonl`.

## Known limits

- Programs that start and finish in under about half a second can be missed by polling. The decoy files still catch secret reads. On macOS, `pnpm deep` uses Apple's `eslogger` to see every launch and file open, but it needs sudo and Full Disk Access, and we haven't tested it yet.
- Access times don't say which process read a file, so a decoy read is credited to the agent that was most recently active. If more than one agent is active, Seatbelt warns you but won't pause anyone over it.
- Auto-protect reacts to what it sees. It can't stop a command that finishes before the next poll. Blocking ahead of time would need a Claude Code `PreToolUse` hook.
- The Windows support hasn't been run on real Windows yet. Some things we know about:
  - Windows can't easily report a process's working folder, so an agent's project is filled in from its session log.
  - Pausing takes a second or two longer because PowerShell has to start.
  - Windows sometimes turns off last-access times, which makes decoy reads harder to catch. The command-line rules still work.
- It only knows about Claude Code and Codex. Linux isn't supported.

## What's next

- Collectors: finish and test `eslogger` mode, add a blocking Claude Code hook, and test on Windows.
- Rules: fewer false alarms, better prompts for the local model, and learning what's normal for each project.
- Dashboard: a timeline view, a menu bar or tray icon, and notifications.
- Demo: a run with a real agent, a backup video, and slides.
