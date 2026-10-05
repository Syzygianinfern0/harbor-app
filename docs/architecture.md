# How Harbor works

Harbor is an Electron app with a UI-agnostic Node engine. Every chat is a tmux session on its own machine (your Mac or an SSH host); Harbor only attaches to it, so quitting Harbor, losing the network or closing the lid never stops an agent.

## Layout

- `src/engine/` — tmux, SSH (system `ssh`, honoring `~/.ssh/config`), persistence, agent status, history and usage. No Electron or React.
- `src/desktop/` — Electron main process and preload (IPC to the engine).
- `src/renderer/` — the React UI, with xterm.js terminals.
- `src/shared/` — types and pure logic shared by the engine and UI.
- `src/bridge/harbor_bridge.py` — the host adapter, deployed to each host.

## Agent integration

Each new Codex chat has a private local app-server socket on its host and the normal Codex TUI. Harbor reads the exact thread ID, title, and runtime activity through the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server). No network listener, separate account, or API key is added.

Claude launches with an explicit conversation ID and session-scoped [lifecycle hooks](https://code.claude.com/docs/en/hooks). Hooks record status and timestamps, not prompts or tool arguments. Saved names and history are read from Claude’s host-local session metadata. The normal [Claude resume command](https://code.claude.com/docs/en/sessions) restores the conversation.

Sidebar and tab icons distinguish **Starting**, **Working**, **Needs input or approval**, **Waiting on background work**, **Turn finished — waiting for next prompt**, **Ready**, **Agent error**, **Closed**, **Status unavailable**, and **Running elsewhere**. Turn finished means an observed turn ended and the agent is now idle; it does not certify that the task succeeded. Codex uses runtime thread status and approval/input flags; Claude uses prompt, tool, permission, question, elicitation, stop, and failure hooks. Claude idle reminders preserve completion instead of falsely requesting input. **Waiting on background work** (hourglass) means the turn ended while background work is still running; hover it to see what. For Claude, that's background shells, monitors or background agents listed in the `Stop` hook's `background_tasks`. Claude resumes by itself when they report back, and the chat shows finished only after the final turn (no completion notification before that). If a shell-only wait loses its processes without Claude waking up, Harbor clears the wait after about 10 seconds. For Codex, it's background terminals from the app-server's `thread/backgroundTerminals/list`. Codex doesn't start a new turn when they exit, so the chat moves to **Turn finished** once the terminals end. Updated bridge mappings apply to newly launched or resumed agents. Shells only report availability. Existing pre-0.3 terminal processes remain intact; their live activity becomes available after a managed resume. When an old running terminal’s conversation ID can be identified through its process’s writer lock, Harbor links it; otherwise use its imported project-history entry. Harbor never guesses an ID from the most recently modified chat.

The host adapter is a Python standard-library script, deployed under `~/.local/share/harbor/`. It preserves agent configuration, credentials, and history. Codex sockets live in a private per-user temporary directory. Stopping a managed tmux session also stops its dedicated Codex app server.

The engine polls tmux status and agent metadata every 2.5 seconds, separately for each host, so a slow host never delays status, notifications or closing on the others. When a host stops answering (for example, you are off the VPN), polling backs off from it: first 5 seconds, doubling up to 30 seconds. Its chats show as unreachable. Any successful command or terminal attach to the host resets the backoff. So does **Refresh Chats and Status** or waking the Mac, which also poll the host right away.

History adapters are version-sensitive. An unreadable history source is reported on its project without modifying the source files. Custom `CODEX_HOME` / `CLAUDE_CONFIG_DIR` are respected when present in the host adapter’s environment.

## State and storage

Session/project state is stored atomically in `~/Library/Application Support/Harbor/sessions.json` (schema 2); preferences use `preferences.json`. Earlier indexes migrate without changing running tmux identities. No telemetry is added. Chats run on the `tmux -L harbor` socket on each host; `HARBOR_DATA_DIR` and `HARBOR_TMUX_SOCKET` point Harbor at another profile and socket (used by tests and `npm run dev:sandbox`). Pull request preview builds (`HARBOR_PREVIEW_BUILD=1`, `npm run package:preview`) run as **Harbor Preview**: a separate bundle ID and app name, so their own profile (`~/Library/Application Support/Harbor Preview`) and single-instance lock, the `harbor-preview` tmux socket by default, and the updater off.

Tab groups, folding, colors and layout switches are kept in the app's local storage (`harbor.tabGroups`).

## Self-update

`src/desktop/appUpdater.ts` (logic) and `appUpdateCore.ts` (pure checks, unit-tested in `tests/appUpdate.test.ts`). The Release workflow builds with `HARBOR_RELEASE_BUILD=1`, which turns the updater on; every other build has it off.

- **Channels:** releases publish as GitHub prereleases. Stable reads `harbor-update.json` from `releases/latest`, which skips prereleases until a maintainer promotes one. Beta reads the releases API and takes the manifest of the highest non-draft `v<x.y.z>` release (`betaFeed`). Either way the manifest's signature decides what is trusted. Saving a different channel in Preferences triggers a check.
- **Feed:** `harbor-update.json` on the release: version, zip name, URL, size, SHA-256, release notes link, and an ed25519 signature over `harbor-update\n<version>\n<file>\n<sha256>\n<size>\n`. CI signs it with the `HARBOR_UPDATE_SIGNING_KEY` secret (`scripts/update-manifest.mjs`); the matching public key is compiled into the app.
- **Download:** only a newer, correctly signed manifest is acted on. The zip streams into `<userData>/updates/`, must match the size and SHA-256, is unpacked with `ditto`, and the app must pass `codesign --verify --deep --strict` with Harbor's bundle ID and the manifest's version. Files Harbor downloads itself carry no quarantine flag, so Gatekeeper doesn't block the update.
- **Install:** a detached bash script waits for Harbor's process to exit, moves the current bundle to `<userData>/previous-version/`, moves the new one into place (restoring the old one if that fails), and relaunches when the user asked to restart. Harbor never kills tmux or agents to update. `HARBOR_UPDATE_FEED` (the stable manifest), `HARBOR_UPDATE_RELEASES` (the beta channel's releases list) and `HARBOR_UPDATE_PUBLIC_KEY` point a release build at a test feed and key; signatures are still required.

## Usage accounting

Harbor reads saved Codex and Claude JSONL on each host through its Python bridge (no Node or ccusage installation required there). It deduplicates Codex snapshots, leading parent snapshots in forked chats, and Claude streaming chunks, and counts a Claude request copied into several transcripts (forks, background copies) once by message and request ID. Overall costs include saved chats outside Harbor and subagent logs. The chat strip covers its own transcript plus its subagents: Claude subagent and Workflow agent logs (`<session>/subagents/**/agent-*.jsonl`, or legacy `agent-*.jsonl` files with the chat's session ID) and Codex threads spawned from the chat, each priced at its own model's rates; it notes how many were included. Copies on separate hosts count on each host. Windows use usage-event timestamps; day groups use UTC.
