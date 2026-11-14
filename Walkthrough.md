# Engineering walkthrough

Harness is a local Node.js service that observes AI coding-agent activity, classifies it with deterministic rules, streams an event feed to a browser dashboard, and can interrupt a running agent. Claude Code has an additional hook integration that evaluates selected actions before execution. The desktop app embeds the same service; it is not a second monitoring implementation.

This guide is for engineers onboarding to the repository. It describes the runtime flow, the main boundaries between modules, and where to make and test changes.

## 1. Repository layout and runtime boundaries

- [`src/`](src) is the Node.js service: monitors, risk rules, event storage, HTTP endpoints, hooks, and desktop bridge.
- [`public/`](public) is a static HTML/CSS/JavaScript dashboard. It consumes the service API and Server-Sent Events (SSE); there is no frontend build step.
- [`hooks/`](hooks) contains the shell forwarder installed into a Claude Code project.
- [`src-tauri/`](src-tauri) is the Tauri 2 native shell. It starts and communicates with the Node service through [`src/desktop.js`](src/desktop.js).
- [`demo/`](demo) contains a deterministic stand-in agent and a deliberately unsafe sample package used to exercise detection end-to-end.
- [`test/`](test) contains Node's built-in test-runner tests.
- [`website/`](website) is a separate Next.js site and simulation. It is not part of the local monitor's runtime.
- [`data/`](data) is the default writable data directory when running from the repository. The desktop build supplies a separate writable location.

The application uses native Node APIs and ES modules (`"type": "module"` in [`package.json`](package.json)). Node 22 or newer and pnpm are the expected development environment. The key commands are `pnpm start`, `pnpm test`, `pnpm protect <folder>`, `pnpm unprotect <folder>`, and `pnpm demo:reset`.

## 2. Startup and service composition

[`src/server.js`](src/server.js) is the composition root:

1. It resolves runtime paths and platform flags, then creates the HTTP server.
2. It exposes JSON endpoints, an SSE stream, and static assets from `public/`.
3. It listens on loopback (port 4100 by default), starts the desktop bridge if present, and reports the selected port to the demo child.
4. It starts the process, network, file, transcript, and Auto-protect loops. `pnpm deep` additionally enables the experimental macOS `eslogger` collector.

The HTTP API is intentionally implemented with Node's `http` module rather than a web framework. `/api/state` supplies the initial view; `/api/stream` publishes incremental state; other routes handle settings, agent controls, reports, baselines, and the demo. When changing a route, check how the dashboard calls it and whether its state change must also be broadcast.

## 3. Event lifecycle: from observation to UI

The central data path is:

```text
monitor or hook → classify → addEvent() → store / score / persistence / listeners
                                                 ↓
                                       SSE → public dashboard
                                                 ↓
                                      Auto-protect listener
```

Monitors create event objects with a `kind`, optional `agentId`, `risk`, human-readable `title` and `reasons`, plus source-specific context such as `command`, `path`, `host`, process IDs, or process-chain `steps`. This is a shared convention rather than a separately declared schema; inspect existing events in the relevant monitor before adding fields.

[`src/store.js`](src/store.js) owns the in-memory agent map and event list. `addEvent()` applies project baselines, assigns an ID and timestamp, updates counters and score, appends JSONL to `data/events.jsonl`, broadcasts the event, and invokes registered listeners. The in-memory list is capped at 5,000 events. The log is append-only, but this code does not restore the full in-memory session state from it on startup.

The dashboard gets a state snapshot and then applies SSE messages. [`public/app.js`](public/app.js) coordinates the UI; related presentation and behavior are split across files such as [`public/timeline.js`](public/timeline.js), [`public/score.js`](public/score.js), [`public/report.js`](public/report.js), and [`public/styles.css`](public/styles.css). Keep server event shape and browser rendering in sync.

## 4. Collectors and attribution

Each collector reports a different slice of behavior:

- [`src/monitor/processes.js`](src/monitor/processes.js) polls process state every 500 ms, identifies agent roots, follows descendants, and reports new child processes with their ancestry. Its process recognizer includes Claude Code, Codex, Gemini CLI, Cursor Agent, Copilot, OpenCode, and Amp patterns. Polling can miss short-lived processes.
- [`src/monitor/network.js`](src/monitor/network.js) polls tracked PIDs for connections, resolves a hostname where possible, and emits newly observed destinations.
- [`src/monitor/files.js`](src/monitor/files.js) prepares decoy files, checks access times, batches project file changes, and watches selected sensitive locations. Access-time evidence cannot identify the reading process; the event's `attribution` records uncertainty.
- [`src/monitor/transcripts.js`](src/monitor/transcripts.js) tails Claude Code and Codex JSONL session logs for prompts, tool calls, and context unavailable from process inspection. This support is narrower than process recognition.
- [`src/monitor/eslogger.js`](src/monitor/eslogger.js) is an optional macOS collector and should be treated as experimental.

Platform process and connection operations are centralized in [`src/platform.js`](src/platform.js). When modifying a collector, preserve the distinction between an observed fact and an inferred attribution. In particular, [`src/guard.js`](src/guard.js) will not auto-pause an agent when an event is attributed as a guess.

## 5. Risk rules, scoring, and automated response

[`src/rules.js`](src/rules.js) is the shared classifier for commands, paths, and network destinations. It returns a risk level (`info`, `low`, `medium`, `high`, or `critical`) and reasons. Decoy paths and random markers are registered at runtime by the file monitor and recognized by the same rules module.

[`public/score.js`](public/score.js) maps event reasons and risk levels to capped score factors with time decay. Baselines live in [`src/baselines.js`](src/baselines.js) and [`public/baseline.js`](public/baseline.js): they affect scoring for eligible project activity, not whether the original event is retained. The server reapplies baselines when they change.

Auto-protect subscribes to store events in [`src/guard.js`](src/guard.js). Depending on settings, it pauses an agent's process tree on qualifying risk. It skips system/task events, events already prevented by a hook, and uncertain attribution. Process suspension and termination are delegated to platform helpers. Since this is reactive, a command may have completed before a monitor sees it.

## 6. Pre-tool hooks are a separate enforcement path

[`src/protect.js`](src/protect.js) installs or removes Harness entries in a project's `.claude/settings.json`, preserving unrelated hooks. The copied [`hooks/harness-hook.sh`](hooks/harness-hook.sh) posts Claude Code hook JSON to the local service. [`src/hooks.js`](src/hooks.js) assesses `PreToolUse`, records prompts from `UserPromptSubmit`, and checks output from `PostToolUse`.

The hook decision contract is deliberately restrictive: critical events and high-risk secret access are denied; other medium-or-higher risks ask for approval; lower-risk actions return no objection so Claude Code's own permission handling remains active. Harness does not return an allow decision. Hook-originated events are marked as prevented when denied, and tool-use IDs are tracked so transcript ingestion does not duplicate them.

The hook is not equivalent to Auto-protect: it checks supported Claude Code tool calls before execution, whereas monitors observe process and system activity across recognized agents. If changing hook behavior, keep the shell forwarder's fail-open/closed behavior, endpoint response format, event attribution, and duplicate suppression consistent.

## 7. Data, settings, and local integrations

[`src/paths.js`](src/paths.js) selects `ROOT/data` for repository runs and a configurable data directory for desktop runs. It also places a writable copy of demo files in the desktop data directory. Settings are persisted as JSON by the guard; events are appended as JSONL; decoy markers are stored separately so the same machine-specific values can be recognized across runs.

Session explanations are implemented in [`src/llm.js`](src/llm.js). If a local Ollama model is available, Harness asks it to summarize selected event facts; otherwise it creates a rules-based summary. The model endpoint defaults to loopback. Keep that local-only boundary explicit if changing summary behavior.

The desktop bridge uses line-delimited JSON on stdin/stdout, with `@@harness `-prefixed messages from Node to Tauri. The Tauri application and its permissions/configuration are under [`src-tauri/`](src-tauri). The browser dashboard can also run independently against the Node server.

## 8. Develop and validate changes

Install dependencies and run the local service with:

```bash
pnpm install
pnpm start
```

Tests use Node's built-in runner. Run the full suite with `pnpm test`, or a focused test file directly, for example:

```bash
node --test test/rules.test.js
```

Tests commonly exercise pure modules with temporary directories or fixture inputs. Follow that pattern: prefer testing rule and transformation behavior without starting live monitors or touching the user's home directory. For collector, route, or UI changes, add or update focused coverage for the changed behavior and check the end-to-end demo when the change affects the event pipeline.

The demo is also a useful integration fixture: `/api/demo/run` resets the sample project, launches `demo/fake-agent.js`, and its package install script simulates reading fake secrets and sending data to a local counting endpoint. It does not use real credentials. The frontend and demo are served from the local service, not the separate `website/` application.

## 9. Engineering constraints and known limitations

- Process and network visibility is polling-based; brief activity may be missed.
- File access times can reveal a decoy read but not the exact reader. Some Windows configurations do not update access times reliably.
- Claude Code and Codex transcript readers do not imply transcript support for every process-recognized agent.
- Rules are pattern-based signals, not a complete security boundary. Do not represent an unflagged event as proven safe.
- Process control and file observation are OS-specific. Review [`src/platform.js`](src/platform.js), [`README.md`](README.md), and existing tests before changing cross-platform behavior.
- `eslogger` is experimental and macOS-only; desktop builds and Windows behavior have platform-specific validation gaps described in the README.

For a first contribution, trace one event end-to-end: find its collector, inspect the event passed to `addEvent()`, follow any rule or score behavior, then find how it is rendered or acted on. That path usually identifies the smallest module and focused test to change.
