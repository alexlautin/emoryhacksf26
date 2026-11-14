# Seatbelt (MVP)

**A local sentinel for AI agents.** Seatbelt watches what Claude Code and Codex *actually do* on your Mac, including what their own windows never show you, and explains it in plain English.

When an agent runs `npm install`, its window shows one green checkmark. Behind that, a package's install script might read your secrets and upload them. Seatbelt sees the whole chain: agent → shell → npm → install script → `curl`, plus the files and servers involved.

## Run it

Needs macOS and Node 22+. There are no dependencies to install.

```bash
pnpm start          # or: node src/server.js
```

Open **http://localhost:4100**. Any Claude Code or Codex session already running on the Mac shows up automatically.

## The demo (about 30 seconds)

Press **Run demo attack** in the dashboard. A scripted stand-in agent is asked to *"Set up this project and get it running"*. It runs `npm install` in `demo/victim-project`, and one dependency (`color-helpers`) has a malicious install script. Seatbelt catches it four ways:

1. **Decoy secrets**: the script opens the planted `.env` and fake AWS keys → *Dangerous*.
2. **Command line**: `cat … | base64`, then `curl -X POST` → flagged and traced to *"a package's install script, not the agent itself"*.
3. **Network**: a connection to the pretend attacker server → *Risky*.
4. **Safety score** drops to 0, and **Explain** writes a plain-English summary using a local model.

Everything in the demo is harmless. The secrets are fake, and the "attacker" is a local server on port 4199 that only counts bytes.

### With a real agent

```bash
pnpm demo:reset
cd demo/victim-project && claude     # or: codex
```

Ask it to *"set up and run this project"*. *(Not tested yet with a real agent; the scripted version is the reliable one for judging.)*

## How it works

| Piece | File | How |
|---|---|---|
| Agent and process tree | `src/monitor/processes.js` | Polls `ps` every 0.5 s and follows every process under a `claude` / `codex` process |
| Network | `src/monitor/network.js` | `lsof -i` on those processes; names servers with reverse DNS or the command's URL |
| Files | `src/monitor/files.js` | Decoy secrets in `~/.seatbelt/bait` (reads detected by access time); project changes with `fs.watch`; watches login items, `~/.ssh` and shell startup files |
| What the agent was asked and did | `src/monitor/transcripts.js` | Tails `~/.claude/projects/**.jsonl` and `~/.codex/sessions/**.jsonl` for tasks, file reads and edits, web and connector use |
| Rules | `src/rules.js` | Sensitive paths, uploads, persistence, `rm -rf`, `sudo`, and similar → risk level + plain-English reason |
| Summaries | `src/llm.js` | Ollama on this Mac (first local model found, or `SEATBELT_MODEL`); falls back to rule-based text |
| Dashboard | `public/` | Plain HTML/JS, live over Server-Sent Events. Simple and Advanced views |

Events are also appended to `data/events.jsonl`.

## Known limits (be upfront in the pitch)

- **Polling misses very short programs** (under ~0.5 s). The decoy files still catch secret reads. `pnpm deep` turns on Apple's `eslogger` (sudo + Full Disk Access) to see every launch and file open. **Deep mode is written but untested.**
- **A decoy read is credited to the most recently active agent**, since access times don't say which process read the file.
- **Watch only, no blocking.** Next step: a Claude Code `PreToolUse` hook for an optional blocking mode.
- macOS only. Claude Code and Codex only.

## Ideas for splitting the work

- **Collectors:** test and finish `eslogger` deep mode, add a Claude Code blocking hook
- **Rules and summaries:** fewer false alarms, better local-model prompts, per-agent "normal behavior" baselines
- **Dashboard:** timeline view, menu-bar icon, notifications
- **Demo and pitch:** a real-agent demo run, backup video, slides
