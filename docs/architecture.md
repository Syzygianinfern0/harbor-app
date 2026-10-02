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

History adapters are version-sensitive. An unreadable history source is reported on its project without modifying the source files. Custom `CODEX_HOME` / `CLAUDE_CONFIG_DIR` are respected when present in the host adapter’s environment.

## State and storage

Session/project state is stored atomically in `~/Library/Application Support/Harbor/sessions.json` (schema 2); preferences use `preferences.json`. Earlier indexes migrate without changing running tmux identities. No telemetry is added. Chats run on the `tmux -L harbor` socket on each host; `HARBOR_DATA_DIR` and `HARBOR_TMUX_SOCKET` point Harbor at another profile and socket (used by tests and `npm run dev:sandbox`).

Tab groups, folding, colors and layout switches are kept in the app's local storage (`harbor.tabGroups`).

## Usage accounting

Harbor reads saved Codex and Claude JSONL on each host through its Python bridge (no Node or ccusage installation required there). It deduplicates Codex snapshots, leading parent snapshots in forked chats, and Claude streaming chunks, and counts a Claude request copied into several transcripts (forks, background copies) once by message and request ID. Overall costs include saved chats outside Harbor and subagent logs. The chat strip covers its own transcript plus its subagents: Claude subagent and Workflow agent logs (`<session>/subagents/**/agent-*.jsonl`, or legacy `agent-*.jsonl` files with the chat's session ID) and Codex threads spawned from the chat, each priced at its own model's rates; it notes how many were included. Copies on separate hosts count on each host. Windows use usage-event timestamps; day groups use UTC.
