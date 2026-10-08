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

## Settings tab

Settings is a page tab, not a chat: `App.tsx` keeps it out of `tabs` (chat IDs, `harbor.tabs`) in its own state (`harbor.settings`: open, category, host) plus a `page` of `chats` or `settings`. `TabStrip` draws it after the strip (`pageTab`), outside groups, splits, drops and the fitting logic, so `tabGroups.ts`, `panes.ts`, `splits.ts` and `folding.ts` never see it. While it shows, `.pane-workspace` is `hidden` (like the groups overview), so terminals stay mounted and attached, and `setChatView` reports no chat on screen. `SettingsView.tsx` holds the category list, search (a static index in `src/shared/settingsIndex.ts`; results scroll to the element with the matching `data-setting`) and the pages; `RemoteSettings.tsx` is the remotes list and per-machine page.

Settings saves as you go through `updatePreferences(patch)`: the main process merges the given top-level sections into the latest saved preferences inside the store's write queue (`PreferencesStore.update`), so pages saving at once never overwrite each other with a stale copy. Text fields wait a short moment before saving. The file format of `preferences.json` is unchanged. Remote edits stay a draft in the renderer until Save, which writes the host list merged with the latest saved one; project changes go through `manageProjects` immediately.

## Self-update

`src/desktop/appUpdater.ts` (logic) and `appUpdateCore.ts` (pure checks, unit-tested in `tests/appUpdate.test.ts`). The Release workflow builds with `HARBOR_RELEASE_BUILD=1`, which turns the updater on; every other build has it off.

- **Channels:** releases publish as GitHub prereleases. Stable reads `harbor-update.json` from `releases/latest`, which skips prereleases until a maintainer promotes one. Beta reads the releases API and takes the manifest of the highest non-draft `v<x.y.z>` release (`betaFeed`). Either way the manifest's signature decides what is trusted. Saving a different channel in Settings triggers a check.
- **Feed:** `harbor-update.json` on the release: version, zip name, URL, size, SHA-256, release notes link, and an ed25519 signature over `harbor-update\n<version>\n<file>\n<sha256>\n<size>\n`. CI signs it with the `HARBOR_UPDATE_SIGNING_KEY` secret (`scripts/update-manifest.mjs`); the matching public key is compiled into the app.
- **Download:** only a newer, correctly signed manifest is acted on. The zip streams into `<userData>/updates/`, must match the size and SHA-256, is unpacked with `ditto`, and the app must pass `codesign --verify --deep --strict` with Harbor's bundle ID and the manifest's version. Files Harbor downloads itself carry no quarantine flag, so Gatekeeper doesn't block the update.
- **Install:** a detached bash script waits for Harbor's process to exit, moves the current bundle to `<userData>/previous-version/`, moves the new one into place (restoring the old one if that fails), and relaunches when the user asked to restart. Harbor never kills tmux or agents to update. `HARBOR_UPDATE_FEED` (the stable manifest), `HARBOR_UPDATE_RELEASES` (the beta channel's releases list) and `HARBOR_UPDATE_PUBLIC_KEY` point a release build at a test feed and key; signatures are still required.

## Usage accounting

Harbor reads saved Codex and Claude JSONL on each host through its Python bridge (no Node or ccusage installation required there). It deduplicates Codex snapshots, leading parent snapshots in forked chats, and Claude streaming chunks, and counts a Claude request copied into several transcripts (forks, background copies) once by message and request ID. Overall costs include saved chats outside Harbor and subagent logs. The chat strip covers its own transcript plus its subagents: Claude subagent and Workflow agent logs (`<session>/subagents/**/agent-*.jsonl`, or legacy `agent-*.jsonl` files with the chat's session ID) and Codex threads spawned from the chat, each priced at its own model's rates; it notes how many were included. Copies on separate hosts count on each host. Windows use usage-event timestamps; day groups use UTC.

## Open in other apps

`src/desktop/openIn.ts` detects installed apps (standard `/Applications` and `~/Applications` paths, then Spotlight by bundle ID, cached for 30 s) and turns an app plus a folder into a launch plan without running anything: `open -a <app> <folder>` for local folders, the editor's bundled CLI with a `--folder-uri` for VS Code and Cursor (`src/desktop/cursor.ts`, local or Remote-SSH), Zed's `cli ssh://…`, and for SSH folders in Terminal or iTerm2 a private, self-deleting `.command` script that runs `ssh -t` with the host's overrides and `cd -- <folder> && exec "$SHELL" -l`. Terminal opens the script directly; iTerm2 is asked through `osascript` with the script path as an argument (hence `NSAppleEventsUsageDescription` in the bundle). Folders and hosts are always separate arguments or single-quoted; the custom command gets them only through `$HARBOR_DIR` and `$HARBOR_HOST`. The choices live in `preferences.json` under `openIn` (`hidden`, `defaultApp`, `customLabel`, `customCommand`), read leniently so missing or unknown values fall back to defaults. The renderer's menus and Settings page are `src/renderer/OpenIn.tsx` and `OpenInPreferences.tsx`.
