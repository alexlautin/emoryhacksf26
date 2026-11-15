# About Harness

What Harness is, how it works, what it can and can't do, and where it falls short. Written against the code in this repository, November 2026.

## At a glance

Harness is a hackathon project from Emory Hacks ([see it on Devpost](https://devpost.com/software/harness-1rhedk)). It runs on your computer, follows every process an AI coding agent starts, watches a few files and connections, and turns what it sees into a plain-language risk level and a score from 0 to 100.

- **What it is.** A local monitor with a dashboard on `127.0.0.1`. No account, no telemetry.
- **What it isn't.** Not a firewall, not a package scanner, and not a sandbox. It sees destinations, not the contents of encrypted traffic.
- **What we haven't measured.** There is no benchmark or false-positive study in the repo. Every number below is a setting in the source (a poll interval, a score weight), not a performance result.

## The problem

You ask Claude Code or Codex to set up a project. npm then runs each dependency's install script as a child process. That script is ordinary code running as you. It can read `~/.ssh`, a `.env`, or anything else you can read, and it can send the contents somewhere.

The agent's window only shows the tool call the model made, such as `npm install` and a checkmark. It doesn't show the children of that call. Harness watches the children, the connections, and a few files no honest task should open.

## Threat model

In scope:

- An agent, or a process it started, runs something you didn't see in the agent's window.
- An install script reads secrets, including decoy files Harness planted, and sends them out.
- Something the agent started tries to outlast the session: a LaunchAgent, a shell startup file, a scheduled task, a Startup item, a registry Run key, a new service.
- The agent reads SSH keys, cloud credentials, `.env` files, the Keychain, Windows Credential Manager, browser logins or similar.

Out of scope:

- Reviewing a package before you install it.
- Reading encrypted traffic. Harness sees an address and, when it can, a hostname.
- Being a firewall. An already-running `curl` is only stopped if auto-protect pauses it in time.
- Another user on the machine, or a kernel exploit. The assumption is code the agent chose to run, running as you.
- Linux. Windows builds exist but have had limited interactive testing.

## What it watches

Everything below runs on your computer, and the server listens on `127.0.0.1` only.

### Processes

Harness checks the process list every 500 ms and walks each process's parents (up to 64 steps) looking for a recognized agent: Claude Code, Codex, Antigravity, Cursor, Copilot, opencode or Amp. Anything under one belongs to that session. Shell wrappers like `zsh -lc "..."` are unwrapped so rules see the real command.

If a risky command has a package install somewhere above it, Harness says it came from an install script and raises the risk to at least high. A process that starts and exits between two checks, about half a second, can be missed.

### Network

About once a second Harness lists open connections for the watched processes. Hosts on a short allow list (Anthropic, OpenAI, GitHub, npm, PyPI, Apple, Google and a few more) are ordinary when the agent itself connects. Any other remote host is "a server Harness doesn't recognize". Package managers talking to registries are not flagged. The hostname comes from the command line or a reverse DNS lookup of an address the process already contacted.

### Decoy files

On startup Harness creates three fake secrets in `~/.harness/bait/`: an AWS credentials file, a passwords file and an SSH key. Each holds a random marker unique to your computer, and each is readable only by you (mode `0600`).

Every 700 ms Harness checks whether a decoy was read. A read is a critical event. A marker showing up in a command, a tool input or a file the agent writes is critical too. Access times don't say which process read the file, so Harness blames the most recently active agent within 15 seconds. If exactly one agent qualifies, auto-protect may pause it. If several do, you still get the event, but nothing is paused.

### Files and sessions

- **Project edits.** For each live agent working under your home folder, Harness watches the folder for changes. Edits inside `node_modules` are counted, not scanned.
- **Startup places.** Shell startup files, LaunchAgents, the Windows Startup folder and `~/.ssh` are watched too. A change counts only if an agent was active in the last 10 seconds.
- **Session logs.** For Claude Code and Codex, Harness reads the session logs for prompts, file reads and edits, web fetches and connector calls. The other agents are recognized by process name only.

### Deep mode

`pnpm deep` adds macOS's `eslogger` for finer file and process events. It needs `sudo` and Full Disk Access, and it hasn't been tested end to end.

## Rules and the score

Rules are an ordered list of patterns and path checks. Each event gets one of five levels: info, low, medium, high or critical. The dashboard calls them Routine, Note, Worth a look, Risky and Dangerous.

- **Critical:** `rm -rf` aimed at your home folder or disk, pulling passwords out of the Keychain, and any decoy path or marker.
- **High:** downloading a script straight into a shell, uploads with `curl` or `wget`, raw sockets (`nc`, `socat`), persistence (LaunchAgents, cron, scheduled tasks, startup files, services), encoded PowerShell, screen capture, and scrambling secrets with `base64`.
- **Medium:** `sudo`, `scp` or `rsync` to a remote host, AppleScript, a force-push, and a recursive delete that isn't the whole disk.
- **Low:** installing packages, a normal `git push`, and making a file executable.
- **Sensitive paths:** SSH keys, cloud credentials, `.env` files, the Keychain, browser logins, developer tokens, shell history, and Messages or Mail score high, or critical if they're decoys.

### The score

Everyone starts at 100. Each event can cost points in up to six groups, and the cost depends on its risk level:

- **Passwords and secrets.** Cap 70. Critical 45, high 20, medium 10, low 2.
- **Sending data out.** Cap 55. Critical 35, high 24, medium 10, low 2.
- **Hidden background changes.** Cap 45. Critical 30, high 18, medium 8, low 2.
- **Risky commands.** Cap 35. Critical 25, high 12, medium 5, low 1.
- **Unknown servers.** Cap 15. Critical 10, high 7, medium 3, low 1.
- **New software.** Cap 6. Critical 3, high 2, medium 1, low 1.

Every cost halves each 12 hours. Each group is limited to its cap, and the score is 100 minus the capped totals, rounded and kept between 0 and 100:

```
score = 100 − Σ min(cap, Σ cost × 0.5^(age ÷ 12h))
```

Labels: 90 and up is Clear, 70 Steady, 40 Review, below 40 Act.

Worked example, from the scripted demo. The install costs 1 in New software. The install script is one critical command that names a decoy and runs `curl -X POST`, so it lands in Passwords and secrets (45) and Sending data out (35). That's 81 points off, for a score of 19 (Act). The 19 is arithmetic, not a measured detection rate.

## Acting on a finding

### Auto-protect

Three settings: off, dangerous only (the default), and risky and dangerous. A qualifying event freezes the agent and everything under it. On macOS that is `SIGSTOP`, and on Windows `NtSuspendProcess`. Nothing is killed. You can resume it, or end it, which sends `SIGTERM` and then `SIGKILL` after 1.5 seconds.

Auto-protect skips the event when attribution is a guess, when a hook already blocked the action, and when it is off. It also won't act if Harness itself was started under that agent. The pause lands after the check that saw the event, so a command that finished inside that gap isn't stopped.

### The Claude Code hook

`pnpm protect <folder>` installs a hook for Claude Code in a folder you choose. Before each tool runs, the hook asks Harness's rules:

- **Critical, or high with a secret involved:** denied. Claude is told not to retry or work around it.
- **Other high, and medium:** Claude Code asks you first, with the reason attached.
- **Low and info:** no objection. Claude Code's own prompts still apply.

Paths and wildcards that resolve to a decoy, such as `cat ~/.harness/bait/*`, are denied too. If Harness isn't running, the hook blocks tool calls by default. Set `HARNESS_FAIL_OPEN=1` to allow them instead. A denied action is stored as prevented, so auto-protect doesn't pause over it.

After a tool runs, if its output contains a decoy marker, Harness marks that session compromised. Later tool calls that look like network access are denied until Harness restarts. This is a flag in memory, not a packet filter.

The hook works for Claude Code only. Other agents get the process watcher and auto-protect.

### From your phone

Phone access is off by default. Turn it on in **Settings → Phone access** and scan the QR code. The phone opens the same dashboard in its browser, with no app or account. It sees the score, your agents and what happened, and can pause, resume or end an agent. It can't change settings, mark anything as normal, reset activity or run the demo.

When it's on, Harness opens a second port (4101, or `HARNESS_PHONE_PORT`) on your network address, and every request has to carry the key from the QR code. **Unpair phones** makes a new key and signs every phone out. **Turn off** closes the port. Plain Wi-Fi traffic isn't encrypted, so use it only on a network you trust. On school or public Wi-Fi, put [Tailscale](https://tailscale.com) on both devices; Harness puts the Tailscale address in the QR code, and the connection is encrypted.

## Uninstalling

Harness puts a few things outside its own app folder, so removing it properly takes more than deleting the app:

- **Claude Code hooks** in every folder you protected (`.claude/settings.json` and `.harness/harness-hook.sh`). This is the one that matters. While Harness isn't running the hook blocks Claude Code's tool calls, so a leftover hook stops Claude Code working in that folder.
- **Decoy files** in `~/.harness/bait`, and in the equivalent folders from the earlier Lookout and Seatbelt names.
- **A login item**, if you turned on "Open at login", plus the app's settings, event history and caches.

In the desktop app, choose **Uninstall Harness…** from the menu bar or tray menu. After you confirm, it removes the hooks from every protected folder, deletes the decoys, settings, history and login item, then moves the app to the Trash on a Mac or runs its uninstaller on Windows. If any hook can't be removed it stops and leaves the app installed, so you can try again. Uninstalling from Windows Settings also stops Harness and cleans up the hooks, and asks before going ahead if it couldn't.

Harness remembers the folders it protects. For ones protected by an older version, and when the app is already gone, `pnpm uninstall-harness` in the repository scans your home folder (six levels deep) for the hooks and removes them. Add `--dry-run` to see what it would change first. A folder outside your home folder that Harness has no record of won't be found.

## Privacy

- The monitor and dashboard are served from `127.0.0.1`. If you turn on phone access, a second port opens on your network address and needs the key from the QR code.
- Every event is appended to a file on your disk (`data/events.jsonl`, or the app's data folder in the desktop build).
- Harness has no account, license check, or telemetry. The monitor can use reverse DNS to name a connection it observed.
- Summaries are optional. They come from Ollama on your computer, and any model with "cloud" in its name is skipped. With no local model, Harness builds a shorter summary straight from the rules.
- Decoy markers are specific to your computer. They aren't credentials for anything, but seeing one in a command means a decoy was read.

**Review with Gemini** can assess a **Medium**, **High** or **Critical** event when you configure an API key. Harness shows exactly what it will send, and sends it to Google only after you press the button. That includes the command, the destination, the file path and the task you gave the agent, with home folders shortened and tokens or passwords hidden. File contents are never sent. Gemini provides an advisory assessment, and Harness applies its rules locally. The browser demo asks Gemini to write a fictional session from the scenario you choose.

## Known limits

We listed these from the code and the README, and softened none of them:

- Processes that live under about half a second can be missed. The first poll doesn't report anything already running.
- Decoy reads are attributed to the most recently active agent. With two agents active the event is a guess, and nothing is paused.
- A decoy read that leaves no command line and no access-time change is invisible. Windows sometimes disables access times.
- File watching sees changes, not ordinary reads. Only the decoys are checked for reads.
- Deep mode is macOS only, needs `sudo`, and isn't tested end to end.
- Session logs cover Claude Code and Codex only. The blocking hook is Claude Code only, and only in folders where you ran `pnpm protect`.
- An agent whose binary doesn't match the name list isn't watched. Renaming the binary is enough to drop off.
- Windows has no easy working-directory lookup, pausing waits on PowerShell to start, and the hook is a POSIX shell script.
- The desktop app is signed ad hoc and not notarized, so macOS warns on first open. Windows installers are unsigned and may trigger SmartScreen.
- Markers are plain substrings. A collision with unrelated text is possible but unlikely, and we haven't measured it.

## What's next

- Finish and test deep mode, and test Windows on real machines, including the hook under Git Bash.
- Extend blocking before a command runs beyond Claude Code.
- Read session logs for Antigravity, Cursor, Copilot, opencode and Amp, not just Claude Code and Codex.
- Fewer false alarms, and some idea of what's normal for a project. None of that learning exists yet.
- A timeline on the dashboard.
- A Developer ID signature, notarization, Windows code signing and broader install testing.

There are no dates on any of it.

## The scripted demo

`demo/packages/color-helpers/install.js` stands in for a malicious install script. It prints a harmless line, then one shell script reads the project's `.env` and the decoy AWS file, base64-encodes them, and `curl -X POST`s them to `127.0.0.1:4199`. That local server counts bytes and throws them away. Short sleeps give the half-second check time to see the process.

With auto-protect at its default, the critical decoy event pauses the tree before the upload finishes. Turn auto-protect off and the upload runs to the end. `pnpm demo:reset` rebuilds the victim project. We recommend using the scripted demo when showing Harness, since a run with a real agent hasn't been tested.
