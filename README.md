# Harness

[![CI](https://github.com/alexlautin/harness/actions/workflows/ci.yml/badge.svg)](https://github.com/alexlautin/harness/actions/workflows/ci.yml)

Harness watches what Claude Code and Codex do on your computer, including the parts their own windows don't show, and tells you about anything risky.

Say an agent runs `npm install`. Its window shows one line and a checkmark. Underneath, a package's install script could be reading your `.env` and uploading it. Harness follows the whole chain (agent, shell, npm, install script, curl) along with the files and servers involved, and can pause the agent before it finishes.

It runs locally. Nothing is sent anywhere.

## Download

Get the [latest release](https://github.com/alexlautin/harness/releases/latest): a DMG for Apple silicon or Intel Macs, or a 64-bit installer for Windows 10/11. Node is included. See the release notes for first-open instructions for these unsigned preview builds.

### First open on macOS

This free preview is signed ad hoc, without an Apple Developer ID, and is not notarized by Apple. macOS may block the first open with **“Harness” Not Opened** and say Apple could not verify it is free of malware.

1. Choose the DMG for your Mac: Apple menu → About This Mac shows **Chip** for Apple silicon or **Processor** for Intel.
2. Open the DMG, drag Harness to **Applications**, then open it from Applications.
3. If that warning appears, click **Done**. Go to **System Settings → Privacy & Security**, scroll to the message about Harness, and click **Open Anyway**.
4. Authenticate if asked and confirm **Open**. Harness appears in the **menu bar**; click its icon to open the dashboard.

Only approve a build you intentionally downloaded from this project's release. macOS saves approval for this copy; a new download may require approval again. If Open Anyway is missing, try launching the app again and return to Privacy & Security. On older macOS versions, use **System Preferences → Security & Privacy → General**. Organization-managed Macs may require administrator help. See [Apple's instructions](https://support.apple.com/102445).

If macOS reports the app as damaged or containing malware, download a fresh copy from the official release. If the message persists, [report it](https://github.com/alexlautin/harness/issues) with your macOS version and the exact wording. Do not disable Gatekeeper or clear security attributes as a routine installation step.

Each release includes `SHA256SUMS.txt`. On macOS, run `shasum -a 256` followed by the downloaded DMG's path; on Windows, use `Get-FileHash` followed by the installer's path in PowerShell. Quote paths containing spaces. Compare the hash with the entry for that filename in the same release. A match verifies the published file, not its safety.

## Running it

You need Node 22 or newer and pnpm.

```bash
pnpm install
pnpm start
```

Then open http://localhost:4100. Any Claude Code or Codex session already running shows up on its own. Set `PORT` to use a different port.

Works on macOS and Windows 10/11. On Windows, run it from PowerShell or Windows Terminal. It doesn't need admin rights on either system.

`pnpm test` runs the scoring and rules tests.

## Desktop app (menu bar)

Harness also comes as a desktop app built with [Tauri 2](https://tauri.app): an icon in the macOS menu bar (or the Windows system tray) that runs the same server in the background.

Click the icon for a small menu:

- The score, out of 100, and a one-word status (Clear, Steady, Review, Act).
- Agents that are running, and the latest risky thing.
- Open Dashboard, Pause, Run demo attack, and Quit.
- A setting for what the menu bar item itself shows: the score, the icon only, the number of agents, or the alert count. The choice is saved in `data/settings.json` (`menuBarDisplay`).

The same choice is in Preferences on the dashboard. Right-click the icon (or the system menu) for Auto-protect, protecting a folder, and Open at login.

The icon switches when something needs you. No Dock icon unless the dashboard window is open. Closing the window keeps Harness watching. Quit Harness stops it, and its server.

It ships its own Node, so it works on a computer without one (the demo still needs npm). It keeps its log, settings and demo copy in `~/Library/Application Support/dev.harness.monitor` (`%APPDATA%` on Windows). If that folder is empty and the old `dev.lookout.monitor` or `dev.seatbelt.monitor` folder is still next to it, Harness copies those files over once. It runs on port 4100 so Claude Code hooks can reach it, or on a free port if 4100 is taken (for example by a `pnpm start` in a terminal).

To build it you need Rust (`brew install rustup`, then `rustup default stable`):

```bash
pnpm desktop          # run it in development, straight from this folder
pnpm desktop:build    # Harness.app and a .dmg in src-tauri/target/release/bundle
```

The app icon, the menu bar icons, the DMG window and the Windows installer art are all made from the brand pug (`public/ui/pug.png`) by `python3 scripts/make-icons.py` (needs Pillow). Run it again after changing the pug; it overwrites the files in `src-tauri/icons`.

Builds are for the platform you build on. Downloaded Mac builds use the approval steps under **First open on macOS** above. GitHub Actions builds native installers for Apple silicon, Intel Macs, and Windows x64. Windows installers are unsigned and may trigger SmartScreen; interactive testing on personal Windows machines is still limited.

## Phone access

Settings → **Phone access** → **Turn on** shows a QR code. Scan it with your phone to open the dashboard there. A paired phone sees the score, your agents and what happened, and can pause, resume or stop an agent. It can't change settings, mark things as normal, reset activity or run the demo. Those stay on the computer.

It's off by default. When it's on, Harness opens a second port (4101, or `HARNESS_PHONE_PORT`) on your network address. Each request has to carry the key from the QR code. **Unpair phones** makes a new key and signs every phone out, and **Turn off** closes the port. The normal dashboard on 127.0.0.1 is unchanged.

Over plain Wi-Fi the traffic isn't encrypted, so use it only on a network you trust. For school or public Wi-Fi, which usually blocks devices from reaching each other, install [Tailscale](https://tailscale.com) on this computer and on your phone, signed in to the same account. When Harness sees a Tailscale address it puts that in the QR code instead. The connection is then encrypted and works on any network.

## Blocking actions before they run (Claude Code)

The monitors below see what happened. Claude Code hooks let Harness check each action **before** it runs:

```bash
pnpm protect path/to/your-project     # adds Harness's hooks to .claude/settings.json
pnpm unprotect path/to/your-project   # removes only Harness's entries
```

Restart Claude Code in that folder (or run `/hooks`) afterwards. Then every tool call goes through `hooks/harness-hook.sh` to `POST /hooks/pre-tool` and is checked with the same rules as everything else:

- Decoy secrets, saved keys and passwords, home-folder wipes: **blocked**. Claude Code is told why and not to retry.
- Uploads, downloads piped into a shell, force-pushes, startup-file changes, `sudo`: **Claude Code asks you first**, with Harness's reason in the prompt.
- Everything else: no objection, so Claude Code's own permission prompts work as usual. Harness never answers "allow".

Decoys are checked here too: relative paths and wildcards (`cat ~/.harness/bait/*`) that reach a decoy are blocked. Each decoy also holds a random value unique to your computer. If that value shows up in a command or a file the agent writes, Harness blocks it. If it shows up in a tool's output, the agent has the secret: Claude is told not to use it, and that session can't reach the network for the rest of its run.

`pnpm unprotect` also removes hooks installed before the rename (`.lookout/lookout-hook.sh` or `.seatbelt/seatbelt-hook.sh`). The old script in this repo forwards to the new one. `HARNESS_PORT` and `HARNESS_FAIL_OPEN` are the hook's settings. `LOOKOUT_PORT` / `LOOKOUT_FAIL_OPEN` and `SEATBELT_PORT` / `SEATBELT_FAIL_OPEN` still work if those are what you already set.

Decisions take about 10 ms. If Harness isn't running, the hook blocks every action in protected folders until you start it (set `HARNESS_FAIL_OPEN=1` to change that). Blocked actions never run, so Auto-protect doesn't pause the agent over them. Tested with a real Claude Code session (v2.1.170): reading a decoy file was blocked and Claude reported it instead of retrying.

## Demo

Click "Run demo attack". A scripted stand-in agent is asked to set up a project in `demo/victim-project`, so it runs `npm install`. One dependency, `color-helpers`, has a malicious install script that reads `.env` and a fake AWS key, base64-encodes them, and POSTs them to a local "attacker" server on port 4199.

What you should see:

- The install script's command line names the decoy secrets, so it's flagged as Dangerous and traced back to the package rather than the agent.
- Auto-protect is set to "Dangerous only" by default. It pauses the agent and everything under it before the upload happens. You can then end the session or let it continue.
- The safety score, out of 100, drops, and the factor list shows why.
- Explain writes a short summary with a local model if Ollama is running, or from the rules if it isn't. Set `HARNESS_MODEL` to pick the model (`LOOKOUT_MODEL` and `SEATBELT_MODEL` still work).

Set Auto-protect to Off if you want to watch the attack go all the way through. The secrets are fake and the attacker server only counts bytes, so this is safe to run.

When the demo starts, the window opens the demo agent's process tree, so you can watch the install script appear under `npm install`, read the decoy, and get paused (or finish the upload, if Auto-protect is off).

To try it with a real agent:

```bash
pnpm demo:reset
cd demo/victim-project
claude
```

Then ask it to set up and run the project. We haven't tested this with a real agent yet, so use the scripted demo when showing it to people.

## Review with Gemini

Select a **Worth a look** event in **Activity**, **Alerts**, or an agent’s session, then click **Review with Gemini**. Harness previews the observations it will send. After you click **Send for review**, Gemini assesses the event, cites observations, and suggests a check. Harness’s local rules still control scores, blocking, and pausing.

The review shares what Harness saw: its own rating and the reasons for it, the command, the destination or file path, the task you gave the agent, and how the process was started. Home folders are shortened and tokens or passwords are hidden, and the dialog shows exactly what will be sent before you press the button. File contents are never sent. Save your key to `~/.harness/gemini-key` (or set `GEMINI_API_KEY`). See [Google’s Gemini API terms](https://ai.google.dev/gemini-api/terms) for how Google may use free-tier requests.

Set `GEMINI_API_KEY` in the environment you use to launch Harness, then run `pnpm start` or `pnpm desktop`. If you’re using an installed build, launch its executable from that environment. `GEMINI_MODEL` overrides the default `gemini-3.5-flash-lite`. Standard text requests on this model are available within the Gemini Developer API’s [free-tier quota](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite).

## How it works

`src/monitor/processes.js` polls the process list every half second and follows every process under a `claude` or `codex` process. On macOS this uses `ps`. On Windows, one long-running PowerShell process keeps reporting `Win32_Process`.

`src/monitor/network.js` lists open connections for those processes (`lsof` on macOS, `netstat -ano` on Windows) and names the server with reverse DNS or the URL in the command.

`src/monitor/files.js` plants decoy secrets in `~/.harness/bait` and notices when they're read by checking access times. If `~/.lookout/bait` or `~/.seatbelt/bait` is still there from before the rename, those files are copied over once and a read of the old path still counts. The random value inside an old decoy is kept, so a command that already contains it still counts. Each decoy embeds a random marker made on first run (saved in `data/bait-markers.json`); any rule that sees a marker in a command line treats it as a decoy being used. It also watches the project folder, `~/.ssh`, shell startup files, and the places programs use to start at login (LaunchAgents on macOS, the Startup folder on Windows).

`src/monitor/transcripts.js` reads the session logs in `~/.claude/projects` and `~/.codex/sessions` to see what the agent was asked to do and which tools it used.

`src/rules.js` turns commands and file paths into a risk level and a short reason. It covers things like uploads, secrets, deleting your home folder, downloads piped into a shell, scheduled tasks and registry Run keys, and turning off Defender.

`src/guard.js` is Auto-protect. It pauses the whole process tree with `SIGSTOP` on macOS or `NtSuspendProcess` on Windows, and ends it with `SIGTERM`/`SIGKILL` or `taskkill /T /F`. The setting is saved in `data/settings.json`, along with the menu bar display choice.

`public/score.js` works out the score. Everyone starts at 100. Risky events cost points in six categories, each with a cap, and the cost halves every 12 hours. The score stays between 0 and 100. Clear, Steady, Review and Act are short labels for that number, not a separate scale.

The dashboard in `public/` is plain HTML and JavaScript, updated live over Server-Sent Events. It is laid out like a desktop app: a sidebar, a list in the middle, and a details panel on the right. It uses the system font (SF on macOS, Segoe UI on Windows), follows the system's light or dark mode, and has no build step. Icons are from Lucide and agent logos from Lobe Icons, both served locally. The landing page shares the brand foundations in `public/ui/`; open `/ui/index.html` for the visual kit, or read [the usage guide](public/ui/README.md). Every event is also written to `data/events.jsonl`.

The sidebar lists **Home**, **Activity** (everything worth noting), **Alerts** (the risky moments), each agent with its logo and a status dot, and the safety score. Home is the summary: the score and what cost points, how many agents are running, alerts today, how often Harness stepped in, your agents with a Pause button each, the latest things worth a look, and the last hour of activity. **Clear finished** takes sessions that have ended off the list; their activity stays in the log and still counts toward the score. Above the score sits the Harness pug, the same art as the landing page. It reacts to how things are going through posture: asleep (head down, slow breaths, z's) when no agents are running, relaxed or prancing when the score is clear, standing tall when something is worth a look, crouched and trembling when something dangerous happened, and braced and barking while Harness has an agent paused, uneasy when a monitor stops working, and head down when the dashboard loses contact with Harness. It startles when the score drops, hops when it recovers or when clicked, perks up when a new agent starts, nods when one finishes, and barks when Harness blocks an action before it runs. `public/pug.js` keeps the art untouched: it moves the whole image, plus the head as its own layer for nods and tilts, frame by frame. If the system asks for less motion it holds each pose.

Select an agent to see what ran under it. **Processes** is a tree: the agent, the commands it typed, and everything those started, such as an `npm install` and the install script a package ran on its own. Rows say what happened in plain words ("A package's setup script", "Opened a decoy secret") and give a verdict. **Files**, **Network** and **Activity** show the files it touched, the servers it contacted, and the timeline. Selecting a row fills the details panel: who started it, why it matters, and the exact command. With no row selected, the panel sums up the session, with **Pause**, **End Session**, **Explain** and **Report**.

**Commands** in the toolbar (or C) switches every list from plain language to the exact commands and process IDs, for people who want to see them. When Harness pauses an agent, or the demo starts, the window goes to that session and selects the process that triggered the pause. Keys: ↑ and ↓ move through the list, ← and → fold and unfold the tree, / searches, D runs the demo, Esc clears the selection.

**Report** downloads a Markdown file of one session; **Download Report** on Home covers everything. A low or medium row has **Normal for this project** in its details. Command marks match the complete command exactly, including paths and arguments. Saving that mark means the same command, or the same unknown server, no longer changes the score for that project. It stays in the log. Harness will not do this for a decoy read, or for anything Risky or Dangerous, and it does not learn these marks on its own. They are listed in Settings, and removing one puts the points back. The file is `data/baselines.json`.

**Higher contrast** in Settings switches to a black and white theme and underlines verdicts and score words, so color is not the only signal. The score has a text label for screen readers, and a new Dangerous event is announced. In the macOS app the sidebar runs up under the window buttons; on Windows the window keeps its standard title bar.

A Dangerous event also raises a banner across the top of the window. On a Mac, `pnpm start` posts a system notification as well. The menu bar app posts one through the system. A second Dangerous event for the same agent within 20 seconds does not add another notification. Browser alerts stay off until you allow them in Settings.

## Known limits

- Programs that start and finish in under about half a second can be missed by polling. The decoy files still catch secret reads. On macOS, `pnpm deep` uses Apple's `eslogger` to see every launch and file open, but it needs sudo and Full Disk Access, and we haven't tested it yet.
- Access times don't say which process read a file, so a decoy read is credited to the agent that was most recently active. If more than one agent is active, Harness warns you but won't pause anyone over it.
- Auto-protect reacts to what it sees. It can't stop a command that finishes before the next poll. For Claude Code, `pnpm protect` adds a `PreToolUse` hook that blocks ahead of time; other agents only get Auto-protect.
- Windows builds run in GitHub Actions; broader interactive testing is still needed. Known limits:
  - Windows can't easily report a process's working folder, so an agent's project is filled in from its session log.
  - Pausing takes a second or two longer because PowerShell has to start.
  - Windows sometimes turns off last-access times, which makes decoy reads harder to catch. The command-line rules still work.
- It only knows about Claude Code and Codex. Linux isn't supported. Process listing happens to use `ps` there too, which is enough for the scripted demo, but that isn't a promise.

## What's next

- Collectors: finish and test `eslogger` mode, and test on Windows (including the hook script under Git Bash).
- Rules: better prompts for the local model, and learning what's normal for a project without asking you to mark each command.
- Dashboard: the chain view is in. A saved recording of a real agent is not.
- Desktop app: a Developer ID signature, notarization, Windows code signing, and broader installation testing.
- Demo: a run with a real agent, a backup video, and slides.

Product site, white paper, and Gemini browser simulation: [website/](website/). The Next.js site targets Vercel; the simulation uses a server-side Gemini API key and never executes commands.

## Publishing a release

Keep the versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` aligned. Push a matching `vX.Y.Z` tag to run `.github/workflows/release.yml`. It tests and builds on native Apple silicon, Intel Mac, and Windows runners, then publishes all installers and SHA-256 checksums together after every build succeeds. A manual workflow run builds artifacts without publishing. Update `website/releases.js` only after the release assets exist.
