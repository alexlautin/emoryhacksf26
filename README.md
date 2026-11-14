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

## Desktop app (menu bar)

Seatbelt also comes as a desktop app built with [Tauri 2](https://tauri.app): a shield in the macOS menu bar
(or the Windows system tray) that runs the same server in the background.

- Click the shield for a small panel with your score, any paused sessions, Auto-protect and each running session
  (Pause, Explain, End). "Open dashboard" opens the full dashboard in a window.
- The icon changes, and shows "1 paused" next to it, when Auto-protect pauses an agent. You also get a notification.
- Its menu has the Auto-protect level, "Protect a folder for Claude Code…" (the same as `pnpm protect`),
  "Run demo attack" and "Open at login".
- No Dock icon unless the dashboard window is open. Closing the window keeps Seatbelt watching; "Quit Seatbelt"
  stops it along with its server.

It ships its own Node, so it works on a computer without one (the demo still needs npm). It keeps its log,
settings and demo copy in `~/Library/Application Support/dev.seatbelt.monitor` (`%APPDATA%` on Windows).
It runs on port 4100 so Claude Code hooks can reach it, or on a free port if 4100 is taken
(for example by a `pnpm start` in a terminal).

To build it you need Rust (`brew install rustup`, then `rustup default stable`):

```bash
pnpm desktop          # run it in development, straight from this folder
pnpm desktop:build    # Seatbelt.app and a .dmg in src-tauri/target/release/bundle
```

Builds are for the platform you build on. The app is signed ad hoc, not with an Apple Developer ID, so macOS
warns about it when it's opened from a download: right-click the app and choose Open. If macOS says it's
damaged, run `xattr -cr /Applications/Seatbelt.app` once. Windows hasn't been built or tested yet.

## Blocking actions before they run (Claude Code)

The monitors below see what happened. Claude Code hooks let Seatbelt check each action **before** it runs:

```bash
pnpm protect path/to/your-project     # adds Seatbelt's hooks to .claude/settings.json
pnpm unprotect path/to/your-project   # removes only Seatbelt's entries
```

Restart Claude Code in that folder (or run `/hooks`) afterwards. Then every tool call goes through
`hooks/seatbelt-hook.sh` to `POST /hooks/pre-tool` and is checked with the same rules as everything else:

- Decoy secrets, saved keys and passwords, home-folder wipes: **blocked**. Claude Code is told why and not to retry.
- Uploads, downloads piped into a shell, force-pushes, startup-file changes, `sudo`: **Claude Code asks you first**,
  with Seatbelt's reason in the prompt.
- Everything else: no objection, so Claude Code's own permission prompts work as usual. Seatbelt never answers "allow".

Decoys are checked exactly here too: relative paths and wildcards (`cat ~/.seatbelt/bait/*`) that reach a decoy are
blocked. Each decoy also holds a random value unique to your computer. If that value shows up in a command or a file
the agent writes, Seatbelt blocks it. If it shows up in a tool's output, the agent has the secret: Claude is told not to
use it, and that session can't reach the network for the rest of its run.

Decisions take about 10 ms. If Seatbelt isn't running, the hook blocks every action in protected folders until
you start it (set `SEATBELT_FAIL_OPEN=1` to change that). Blocked actions never run, so Auto-protect doesn't
pause the agent over them. Tested with a real Claude Code session (v2.1.170): reading a decoy file was blocked
and Claude reported it instead of retrying.

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

`src/monitor/files.js` plants decoy secrets in `~/.seatbelt/bait` and notices when they're read by checking access times. Each decoy embeds a random marker made on first run (saved in `data/bait-markers.json`); any rule that sees a marker in a command line treats it as a decoy being used. It also watches the project folder, `~/.ssh`, shell startup files, and the places programs use to start at login (LaunchAgents on macOS, the Startup folder on Windows).

`src/monitor/transcripts.js` reads the session logs in `~/.claude/projects` and `~/.codex/sessions` to see what the agent was asked to do and which tools it used.

`src/rules.js` turns commands and file paths into a risk level and a short reason. It covers things like uploads, secrets, deleting your home folder, downloads piped into a shell, scheduled tasks and registry Run keys, and turning off Defender.

`src/guard.js` is Auto-protect. It pauses the whole process tree with `SIGSTOP` on macOS or `NtSuspendProcess` on Windows, and ends it with `SIGTERM`/`SIGKILL` or `taskkill /T /F`. The setting is saved in `data/settings.json`.

`public/score.js` works out the score. Everyone starts at 850. Risky events cost points in six categories, each with a cap, and the cost halves every 12 hours. The lowest possible score is 300.

The dashboard in `public/` is plain HTML and JavaScript, updated live over Server-Sent Events. Icons are from Lucide and the font is Instrument Sans, both served locally. Every event is also written to `data/events.jsonl`.

## Known limits

- Programs that start and finish in under about half a second can be missed by polling. The decoy files still catch secret reads. On macOS, `pnpm deep` uses Apple's `eslogger` to see every launch and file open, but it needs sudo and Full Disk Access, and we haven't tested it yet.
- Access times don't say which process read a file, so a decoy read is credited to the agent that was most recently active. If more than one agent is active, Seatbelt warns you but won't pause anyone over it.
- Auto-protect reacts to what it sees. It can't stop a command that finishes before the next poll. For Claude Code, `pnpm protect` adds a `PreToolUse` hook that blocks ahead of time; other agents only get Auto-protect.
- The Windows support hasn't been run on real Windows yet. Some things we know about:
  - Windows can't easily report a process's working folder, so an agent's project is filled in from its session log.
  - Pausing takes a second or two longer because PowerShell has to start.
  - Windows sometimes turns off last-access times, which makes decoy reads harder to catch. The command-line rules still work.
- It only knows about Claude Code and Codex. Linux isn't supported.

## What's next

- Collectors: finish and test `eslogger` mode, and test on Windows (including the hook script under Git Bash).
- Rules: fewer false alarms, better prompts for the local model, and learning what's normal for each project.
- Dashboard: a timeline view.
- Desktop app: a Developer ID signature and notarization, Windows builds, and builds in CI.
- Demo: a run with a real agent, a backup video, and slides.
