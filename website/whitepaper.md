# Lookout

A local monitor for what AI coding agents run on your computer. Written against the code in this repository, November 2026.

Paths and settings use the Lookout names. A few older Seatbelt names still work if they were already set, and those are named where they matter.

## Abstract

A coding agent can show `npm install` and a checkmark while a package's install script reads a file and makes a network call. The agent's own window does not have to mention any of that. Lookout runs on the same computer, follows the process tree under a recognized agent, watches files and connections, and writes the result in plain language with a risk level.

It is a hackathon MVP from Emory Hacks. It does not inspect a package before install, it does not see inside TLS, and it does not claim a measured detection rate. There is no benchmark suite in the repo. Numbers below are the ones in the source: poll intervals, score weights, file modes. They are not performance results.

## The problem

You ask Claude Code or Codex to set up a project. npm then runs each dependency's install script as a child process. That script is ordinary code running as you. It can read `~/.ssh`, a `.env`, or anything else your user can read, and it can POST the contents somewhere. The same shape shows up with pip and uv, with `curl` piped into a shell, and with a shell command the model chose on its own.

The transcript in the agent's window is a poor record of this. It shows the tool call the model made. It does not show every child of that tool. Lookout's job is the children, the sockets, and a few files the agent should never have opened.

## Threat model

In scope, for this version:

- A recognized coding agent, or a process it started, runs a command the person did not see in the agent window.
- A package install script reads secrets, including decoy files Lookout planted, and sends them out.
- Something the agent started tries to persist: a LaunchAgent, a shell startup file, a scheduled task, a Startup-folder item, a registry Run key, a new service.
- The agent reads SSH keys, cloud credentials, `.env` files, the Mac Keychain, Windows Credential Manager, browser login stores, or similar.

Out of scope:

- Lookout does not review package source, lockfiles, or maintainer reputation before an install.
- It does not decrypt traffic. It sees a destination address and, when it can, a hostname.
- It is not a firewall. "Cutting off the network" for a compromised Claude Code session means later tool calls that look like network access are denied by the hook. An already-running curl is a different problem, handled only if auto-protect pauses the tree in time.
- Coverage is uneven. Process watching has a list of executable names. Session logs are parsed only for Claude Code and Codex. Blocking before a tool runs is a Claude Code hook, and only in folders where someone ran `pnpm protect`.
- Linux is not supported. The Windows code path exists and has not been run on a real Windows machine.
- A process that is not under a recognized agent is invisible. Renaming the agent binary is enough to fall off the list.
- This is not a defense against another user on the machine, or against a kernel exploit. The assumption is: code the agent chose to run, including a dependency's install script, running as the person.

## How Lookout observes

Six watchers start with the server in `src/server.js`. The server listens on `127.0.0.1` only. The default port is 4100 (`PORT` overrides it). The desktop build prefers 4100 because the Claude Code hook dials that port, and takes a free port if 4100 is already in use. In that case the hook cannot reach that copy.

### Processes

`src/monitor/processes.js` polls every 500 ms. On macOS that is two `ps` calls (`pid`, `ppid`, `comm`, and the full argument string). On Windows one PowerShell process stays up and prints `Win32_Process` as JSON, sleeping 400 ms between snapshots, because starting PowerShell on every poll is slow.

Lookout walks parent pointers, up to 64 steps, looking for a process it recognizes:

- `claude`, or arguments containing `@anthropic-ai/claude-code`
- `codex`, or `@openai/codex`
- `gemini`, or `@google/gemini-cli`
- `cursor-agent`, or a path containing `cursor-agent`
- `copilot`, or `@github/copilot`
- `opencode`
- `amp`, or `@sourcegraph/amp`
- the scripted demo, `demo/fake-agent.js`

Anything under that process is part of the session, except Lookout's own pid and anything under it. If Lookout itself was started from the agent, the guard refuses to stop that session, because stopping it would kill the monitor.

The first poll records processes so they are not announced as news. A process that exits before the next poll can be missed. The file's own comment puts that gap at about half a second.

Shell wrappers are unwrapped in `src/describe.js` so the rule sees the command a person would recognize: `zsh -lc "..."`, `bash -c`, `cmd /c`, PowerShell `-Command`, and Claude Code's `eval '...'` form inside a longer snapshot line.

If a command at medium risk or worse has `npm`, `pnpm`, `yarn`, or `bun` install (or `pip install`, or `uv`) among its ancestors, and that install is not the immediate parent, the event says the action came from a package install script. The risk is raised to at least high. The text says the agent's window only showed the install. The direct child of `npm install` does not get that label. In the bundled demo that is the right layer: `install.js` is the direct child, and it spawns `sh -c`, which is the process that carries the decoy path and the curl.

On macOS the working directory comes from `lsof -d cwd`. On Windows `processCwd` returns null. The project name is filled in later from the session log when exactly one agent of that kind has no directory yet.

### Network

`src/monitor/network.js` polls about once a second. macOS uses `lsof -nP -i`. Windows uses `netstat -ano` for TCP and TCPv6, and keeps established, syn-sent, and close-wait rows. Lookout ignores its own dashboard port.

The hostname is taken from a URL written in the command if there is one. Otherwise it asks the system resolver with `dns.reverse`, and gives up after 800 ms. That is a lookup of an address the watched process already contacted. It is not an upload of the event log.

`analyzeDestination` in `src/rules.js` then classifies it:

- Localhost is low, or info if the socket belongs to the agent process itself. Port 4199 is the exception. The demo's stand-in attacker listens there, and that destination is high, with the reason that it is standing in for an attacker.
- A short allow list is treated as ordinary when the agent process itself is the one connecting: `anthropic.com`, `claude.ai`, `claude.com`, `openai.com`, `chatgpt.com`, `oaistatic.com`, `github.com`, `githubusercontent.com`, `npmjs.org`, `npmjs.com`, `yarnpkg.com`, `pypi.org`, `pythonhosted.org`, `apple.com`, `icloud.com`, `googleapis.com`, `google.com`, `sentry.io`, `statsig.com`, `datadoghq.com`. Subdomains count.
- Any other remote host is medium: "connected to a server Lookout doesn't recognize." The score matcher looks for that phrase.
- If the process is `npm`, `pnpm`, `yarn`, `bun`, `pip`, `uv`, `git`, `gh`, or `brew`, that medium is dropped to info and the reason is cleared. Those tools talk to registries through CDNs whose reverse names are often useless.

A connection with an empty reason list does not move the score. Ordinary localhost traffic is in that group. Port 4199 is not.

### Decoy files

On startup `src/monitor/files.js` creates `~/.lookout/bait/` with three files, mode `0600`:

- `aws_credentials`, shaped like an AWS credentials file, with a fake access key id `AKIA` plus the marker
- `passwords.txt`
- `id_ed25519_backup`, shaped like an OpenSSH private key

Each file contains a random marker, 16 bytes drawn from a 32-character alphabet, generated once and stored in `data/bait-markers.json`, also mode `0600`. Lookout will rewrite a decoy that is missing its marker, including an older file whose body still says "Seatbelt decoy". The marker already in that file is kept. It will not overwrite a file in that directory that does not already look like one of its decoys (the check looks for "Lookout decoy" or "Seatbelt decoy" in the body).

If `~/.lookout/bait` does not exist yet and `~/.seatbelt/bait` does, those files are copied once. A read of the old path still counts, and a marker that only the old file still holds is remembered.

Every 700 ms it stats the files. Before watching, it sets the access time two seconds behind the modification time, so a later read moves the access time. A change becomes a critical event. Access time does not name the process. Lookout attributes the read to the alive agent whose `lastActive` is most recent, within 15 seconds. If exactly one agent qualifies, attribution is `sole`, and auto-protect may pause it. If several qualify, attribution is `guess`: the person still gets the event, and auto-protect will not pause anyone. If no agent was active, the event says it may have been something else on the computer.

The demo project's `.env` is also treated as bait while the file exists, with the fixed marker `DECOY-NOT-REAL`.

The same markers are matched as plain substrings. A marker in a command line, in a non-bash tool input, or in a file the agent writes, is critical: the reason says the agent read the decoy and is passing the value on. A marker in Claude Code tool output is handled by the hook, described below. Markers are not hashed. A collision with unrelated text is possible and would look like a hit. The markers are long, which makes that unlikely, and the code does not measure it.

Windows sometimes disables last-access time updates. The README says so, and the file header repeats it. Command-line rules still apply when the path or the marker is visible in the arguments. A read that does not show up in a command line and does not bump the access time is invisible to this check.

### Other files

For each live agent whose working directory is under the home folder, and is not the home folder itself and not the disk root, Lookout calls `fs.watch` with `recursive: true`. New agents are picked up every 2 seconds. Events are batched and flushed every 2.5 seconds. `.git`, `.DS_Store`, `.next`, `dist`, `build`, `.turbo`, and `.cache` are ignored, as is Lookout's own data directory and the bait files. Changes inside `node_modules` or `.venv` are counted in the summary line and kept out of the sensitive-path pass.

A write outside the project directory, when nothing else matched, is low: "changed a file outside the project it was working on." Editing a `.env` inside the project is held at low even if the generic `.env` rule wanted high. The comment in the code calls that "normal-ish."

Separate non-recursive watches sit on sensitive directories from `src/platform.js`. On macOS: `~/Library/LaunchAgents`, `~/.ssh`, and dotfiles in the home folder matching `.zshrc`, `.bashrc`, `.zprofile`, `.bash_profile`, `.profile`, `.zshenv`. On Windows: the per-user Startup folder, `~/.ssh`, `Documents/PowerShell`, `Documents/WindowsPowerShell`, and `.bashrc`, `.bash_profile`, `.profile` in the home folder. `known_hosts` is ignored because ssh rewrites it. If no agent was active in the last 10 seconds, the change is dropped, on the assumption it was the person.

`fs.watch` is not a complete audit. It batches, it misses some platforms' edge cases (the code does not try to paper over them), and it does not see reads of ordinary project files. Only the decoys are polled for reads.

### Transcripts

`src/monitor/transcripts.js` tails Claude Code logs in `~/.claude/projects/<folder>/<session>.jsonl` and Codex logs in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` for today and yesterday. It discovers files every 3 seconds and reads new bytes every second, at most 8 MB per file per pass. Files that already existed when Lookout started are tailed from the end. After startup, a Claude log that has not been modified in the last 6 hours is not added.

From those lines it records the person's prompt, file reads and edits, web fetch and search, and MCP connector calls. Shell commands in the transcript are skipped, because the process monitor sees the process that actually ran. Tool calls the Claude hook already recorded are skipped too, so they are not logged twice.

Codex edits are parsed out of `apply_patch` text: lines like `*** Update File: path`, plus the add and delete forms. Other tool calls become an info event with the tool name.

Gemini, Cursor, Copilot, opencode, and Amp are on the process list only. There is no transcript parser and no pre-tool hook for them.

### Deep mode

`pnpm deep` starts the server with `--eslogger`. On macOS that runs `sudo eslogger exec open` and reads JSON lines from stdout. A file open is reported only when the path rules say high or critical. An exec is reported only at medium or above. It needs sudo, and the terminal needs Full Disk Access. The source file says this path is not tested end to end. The normal pollers still run beside it. On Windows and Linux the flag is ignored, and the server prints that deep mode needs macOS.

Deep mode does not close the attribution gap for decoys by itself. The decoy poll is still access time. An `open` event from eslogger is a separate event, and only if the path scores high or above.

## Rules

`src/rules.js` is an ordered list of regular expressions plus path checks. Levels are `info`, `low`, `medium`, `high`, and `critical`. The dashboard labels them Routine, Note, Worth a look, Risky, and Dangerous.

Commands that hit critical:

- `rm -rf` (either flag order) aimed at `~`, `/`, `$HOME`, or the Windows equivalents (`Remove-Item -Recurse` and `rd /s` against the profile or `C:\`)
- `security find-generic-password`, `find-internet-password`, or `dump-keychain`
- a decoy path or a decoy marker anywhere in the text

High includes:

- `curl` or `wget` piped into `sh`, `bash`, or `zsh`, and the PowerShell forms that pipe `Invoke-WebRequest` or `DownloadString` into `Invoke-Expression`
- uploads: `curl -d`, `--data`, `-F`, `--form`, `-T`, `--upload-file`, `-X POST`, `-X PUT`; `wget --post-data` or `--post-file`; PowerShell `-Method Post` or `Put`, `-InFile`, `-Body`, and `.UploadFile`
- `nc`, `ncat`, `netcat`, `socat`, or `Net.Sockets.TcpClient`
- `launchctl load|bootstrap|submit|enable`, a path containing `LaunchAgents` or `LaunchDaemons`, `crontab`, `schtasks /create`, `Register-ScheduledTask`, `reg add` of a Run or RunOnce key, the Startup folder, `sc create`, `New-Service`
- appending to `.zshrc`, `.bashrc`, `.zprofile`, `.bash_profile`, `.profile`, or writing the PowerShell `$PROFILE`
- `Set-MpPreference` with `-Disable`, or `Add-MpPreference` with `-Exclusion`
- a long encoded PowerShell command (`-enc` and the related flags, with a base64-looking payload of at least 20 characters)
- `screencapture` or `CopyFromScreen`
- `base64`, `openssl enc`, `xxd`, or `certutil -encode` together with a sensitive hit, which adds the reason "scrambled secret data so it would be harder to spot"

Medium includes `scp` and `rsync` to a remote host, `sudo`, PowerShell `-Verb RunAs`, `runas`, `osascript`, `Set-ExecutionPolicy Bypass` or `Unrestricted`, a recursive delete that is not the whole-disk case, and `git push --force`.

Low includes package installs (`npm`, `pnpm`, `yarn`, `bun`, `pip`, `uv`, `winget`, `choco`, `scoop`), a normal `git push`, and `chmod` that adds execute or a world-writable mode.

A POST whose URLs are all localhost is rewritten to "sent data to a program on this computer" and dropped to low, unless one of them is port 4199, which stays an upload. If other reasons are still attached, the higher risk remains.

Sensitive paths score high, or critical when they are decoys. The list covers `.ssh`, `.aws`, `.env` and `.env.*`, Keychain paths and `security find-*` / `dump-*`, Windows Credential Manager commands, Chrome, Chromium, Brave, Arc, Edge, Safari, and Firefox login or cookie stores, `.git-credentials`, `.netrc`, `.npmrc`, `.pypirc`, Docker's `config.json`, kubeconfig, `gh/hosts.yml`, shell history, and `~/Library/Messages` and `Mail`.

The hook and the process poller share `analyzeCommand` and `analyzePath`. They do not share every special case. The hook ignores a recursive delete whose targets all stay inside the project directory. The process poller still records that command as medium. At the default auto-protect setting, medium does not pause anything.

## The score

`public/score.js`. The score is a plain number from 0 to 100. A session with nothing to deduct is 100. Costs fade, and a quiet stretch brings the number back up. It is not a separate scale with its own range.

Each event can count against every factor whose test matches the joined reason text. The point cost depends on the event's risk level, then fades by half every 12 hours (`0.5 ** (age / 12 hours)`). The cap is applied after the faded costs are summed, per factor. The score is 100 minus the sum of the capped factors, rounded, and clamped to 0 through 100.

The factors, the cap, and the cost before fade:

- Passwords and secrets. Cap 70. Critical 45, high 20, medium 10, low 2. Matches decoy, SSH, AWS, `.env`, Keychain, Windows passwords, saved logins, access tokens, terminal history, mail or messages, and scrambled secrets.
- Sending data out. Cap 55. Critical 35, high 24, medium 10, low 2. Matches uploads, the demo attacker reason, raw connections, and copies to another computer.
- Hidden background changes. Cap 45. Critical 30, high 18, medium 8, low 2. Matches "run automatically" and "startup file".
- Risky commands. Cap 35. Critical 25, high 12, medium 5, low 1. Matches deletes, administrator, AppleScript, force-push, screenshot, downloaded script, Defender, encoded commands, and safety checks.
- Unknown servers. Cap 15. Critical 10, high 7, medium 3, low 1. Matches the unrecognized-server reason, which names Lookout.
- New software. Cap 6. Critical 3, high 2, medium 1, low 1. Matches "installed packages".

A new rule only affects the score if its reason text hits one of those tests. System lines are skipped. Task lines (the prompt the person typed) do not match a factor, so they add no points.

Labels, from `LEVELS`: Clear from 90 ("Nothing concerning so far"), Steady from 70 ("A few things worth knowing. Nothing serious."), Review from 40 ("Some activity is worth a look."), Act from 0 ("Something dangerous happened. Look at it now."). The label is a name for the number. It is not a second score.

One event with several reasons can land in more than one factor. The scripted demo is the worked example. The package install is low and matches New software, which costs 1. The install script is one critical command. Its reasons match Passwords and secrets (45) and Sending data out (35), because the same line names the decoy and a `curl -X POST`. Those three costs are 81, so the score is 19, which is Act. If the connection to port 4199 is recorded as its own event, that reason also matches Sending data out, at the high cost of 24. The uploads cap is 55, so the total can reach the floor of 0. With auto-protect at the default, the pause is meant to land before that connection opens, which is the path that stays at 19.

The repo does not contain an evaluation of false positives or of how hard the score is to game. This note does not invent one. The 19 is the arithmetic of those costs, not a measured detection rate.

## Acting on a finding

### Auto-protect

`src/guard.js`. Three settings, stored in `data/settings.json`: `off`, `dangerous` (the default, critical only), and `risky` (high and critical).

A qualifying event pauses the agent and every process under it. On macOS that is `SIGSTOP`, the root pid first, then the rest, then a second snapshot for anything that appeared in between. On Windows it is `NtSuspendProcess` through a short PowerShell command that calls ntdll. Resume is `SIGCONT` or `NtResumeProcess`, children first, so a process does not wake up to find its helpers still frozen. End is `SIGTERM` (and a `SIGCONT`, because a stopped process will not act on the term signal until it runs), then `SIGKILL` after 1.5 seconds. On Windows, end is `taskkill /T /F`.

The guard skips the event when attribution is `guess`, when a hook already blocked the action (`prevented`), when auto-protect is off, when the event is a system or task line, or when the agent is already paused or dead. It also refuses when Lookout's own process sits under that agent.

Pausing happens after the poll that saw the event. A command that finished inside the gap is not stopped by this path. A false alarm costs a click to resume. That is the trade the code comment states, and it is only true if the pause landed.

### The Claude Code hook

`pnpm protect <folder>` copies `hooks/lookout-hook.sh` into `<folder>/.lookout/` and adds three hooks to `<folder>/.claude/settings.json`: UserPromptSubmit, PreToolUse on every tool, and PostToolUse on every tool. Other hooks in that file are kept. If a settings file already exists, a copy is saved as `.lookout/settings.json.before-lookout`. `pnpm unprotect` removes entries whose command contains `.lookout/lookout-hook.sh`, and also ones installed before the rename (`.seatbelt/seatbelt-hook.sh`), then deletes the copied script.

The shell script POSTs Claude Code's hook JSON to `http://127.0.0.1:$LOOKOUT_PORT/hooks/<event>` (port 4100 if unset), with a timeout of 110 seconds. `SEATBELT_PORT` is used when `LOOKOUT_PORT` is not set. PreToolUse's own hook timeout in the settings file is 120 seconds. The request header is `X-Lookout-Project`.

If the POST fails and the event is `pre-tool`, the script exits 2, which tells Claude Code to block the tool, unless `LOOKOUT_FAIL_OPEN=1`. `SEATBELT_FAIL_OPEN` still works if the Lookout variable is unset. The message tells the person to start the monitor. Other hook events fail open: if Lookout is down, the prompt and the post-tool notice are simply skipped.

For a tool call that does reach Lookout, `src/hooks.js` decides:

- critical, or high with a secret-related reason: deny. Claude is told not to retry and not to work around it, and to tell the user.
- other high, and any medium: ask. The reason is included. Lookout does not return "allow". An empty JSON object means Claude Code's own permission prompts still apply.
- low and info: no objection, same empty object.

"Secret-related" is a regex over the reason text: decoy, "accessed ", Keychain, saved passwords, scrambled secret, and the network-cutoff phrase.

Relative paths and wildcards that resolve to a decoy are denied even when the plain substring check would miss them. `cat ~/.lookout/bait/*` is the case the code calls out. The Glob tool is checked the same way. `rm -rf` whose targets all stay inside the project is not treated as a recursive delete.

The check's duration is written onto the event in milliseconds. The README records one session of Claude Code 2.1.170 where reading a decoy was blocked, and says decisions took about 10 ms. That figure is the README's report of one try. It is not a constant in the code, and there is no suite that re-measures it.

A denied action is stored with `prevented`, so auto-protect does not also pause over it. The action never ran.

PostToolUse has a second check. If the tool's output contains a decoy marker, the session is marked compromised in memory. Claude is told not to use or send the value. Later tool calls from that session that look like network access (curl, wget, nc, ssh, scp, WebFetch, WebSearch, and a handful of other client names) are denied. This is not a packet filter. The flag lives in a `Map` in the Lookout process. A restart clears it.

The hook is Claude Code only. Codex and the other recognized agents only get the pollers and auto-protect.

## Privacy

The HTTP server binds to `127.0.0.1`. The dashboard is static files from `public/` plus server-sent events. Every event is also appended to `data/events.jsonl`. When the desktop app is packaged, it sets `LOOKOUT_DATA_DIR` to Tauri's app data directory. The identifier in `src-tauri/tauri.conf.json` is `dev.lookout.monitor`, so that folder is `~/Library/Application Support/dev.lookout.monitor` on macOS and the matching folder under `%APPDATA%` on Windows. `SEATBELT_DATA_DIR` is read when `LOOKOUT_DATA_DIR` is not set. If the new desktop folder is empty and `dev.seatbelt.monitor` is still beside it, those files are copied once. Running `tauri dev` does not set the variable, and uses the repo `data` directory like `pnpm start`.

Summaries are optional and local. `src/llm.js` calls Ollama at `http://127.0.0.1:11434` unless `OLLAMA_HOST` is set. It asks `/api/tags`, drops any model whose name contains `cloud`, and uses the first remaining model unless `LOOKOUT_MODEL` is set. `SEATBELT_MODEL` is the fallback when `LOOKOUT_MODEL` is unset. The prompt is the session: the task, counts, and up to 25 notable events. It asks for 3 to 5 sentences and a verdict line. If Ollama is down, times out (60 seconds), or returns an empty reply, a shorter summary is built from the same facts with no model. Think-tags in a reply are stripped.

Lookout has no account, no license check, and no telemetry call in the source. The outbound lookup it makes on its own is reverse DNS, described above. The demo attacker listens on `127.0.0.1:4199` and counts bytes. It does not forward them.

Decoy files and the marker file are mode `0600`. The markers are specific to that machine. They are still secrets in the sense that seeing one in a command means the file was read. They are not credentials for anything.

## Known limits

Collected from the code and the README, not softened:

- Polling misses processes that live less than about half a second. The first poll does not report processes that were already running.
- Decoy reads are attributed to the most recently active agent. With two agents active, the event is a guess and auto-protect will not act. With none active, the event is explicit about that.
- Access times can be disabled, especially on Windows. A read that leaves no command line and no atime change is missed.
- `fs.watch` batches project edits and does not see ordinary reads. Sensitive-directory watches are not recursive, except the project watch, which is.
- Deep mode is untested, macOS only, needs sudo and Full Disk Access, and still drops low-risk opens.
- Transcripts cover Claude Code and Codex only, and only bytes appended after the monitor started. Codex history is today and yesterday.
- The blocking hook is opt-in per folder and Claude Code only. Other agents get a report and, if auto-protect is on, a pause after the fact.
- An agent binary that does not match the name list is not watched.
- The compromised-session flag is memory only.
- Windows support has not been run on real Windows. Known gaps called out in the README: no easy working directory, pausing waits on PowerShell to start, and last-access times may be off. The hook script is a POSIX shell script. The README lists "the hook script under Git Bash" as unfinished testing.
- The desktop app is signed ad hoc (`signingIdentity` is `-` in the Tauri config), not with a Developer ID, and it is not notarized. macOS warns on first open of a downloaded build. There is no published Windows app build. The bundle targets include `nsis`, and nobody has produced that installer as a tested release.

## Roadmap

The README's "What's next" list matches what is unfinished in the tree. Restated here so this note and that list do not diverge in spirit:

- Finish and test `eslogger` mode. Run the Windows path on a real machine, including the hook under Git Bash.
- The blocking hook is the way to catch a command before it runs. Today that exists for Claude Code only. Extending that idea is future work. It is not in the code for other agents.
- Fewer false alarms, better prompts for the local model, and some notion of what is normal for a project. None of that learning is implemented.
- A timeline on the dashboard.
- A Developer ID signature, notarization, Windows builds, and builds in CI.

No dates. The demo README is also honest about its own gap: use the scripted demo when showing the project, because a run with a real agent had not been tested.

## What the demo actually does

`demo/packages/color-helpers/install.js` is a stand-in for a malicious install script. It logs a harmless line about color tables, then runs one shell script. On macOS and Linux the script sleeps 1.5 seconds, concatenates the project's `.env` and `~/.lookout/bait/aws_credentials`, base64-encodes them into a temp file, sleeps 1 second, and `curl -X POST`s that file to `http://127.0.0.1:4199/collect` with `--limit-rate 120`. Then it deletes the temp file. If the Lookout bait file is missing and `~/.seatbelt/bait/aws_credentials` is still there, the script reads that older file instead. The Windows branch is the same steps in PowerShell. The sleeps are there so the half-second poll can see the process. The comment at the top of the file says so.

The server on 4199 counts bytes and discards them. If the upload is cut off mid-body, it still reports how many bytes arrived. The secrets are fake. The demo `.env` carries the marker `DECOY-NOT-REAL`.

With auto-protect at the default, the critical decoy event is supposed to pause the tree. That depends on the poll seeing the shell before the script finishes, which is why the sleeps are there. Set auto-protect to off and the upload runs through. The dashboard's "Run demo attack" button starts this. `pnpm demo:reset` rebuilds the victim project.

That is the chain the product site describes: agent, shell, npm, install script, curl. In this particular demo the read and the curl share one shell process, so the rules see both on one command line, and the socket shows up as a second event.
