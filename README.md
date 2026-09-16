# Harbor

A macOS home for projects and persistent Codex, Claude Code, and terminal chats, on your Mac and over SSH.

Open `~/Applications/Harbor.app` or `release/mac-arm64/Harbor.app`.

## Projects and chats

Use **Add project** to choose a saved host and an existing directory. Harbor discovers that directory’s existing Codex and Claude conversations, including ones created in standalone terminals. **Refresh past chats** picks up later changes. History stays with the original agent on its host; Harbor stores its conversation ID, title, and project association.

- The **+** beside a project creates a Codex, Claude Code, or Terminal chat in that directory. **⌘ N** uses the selected project.
- Agent-generated titles appear automatically. **Right-click → Rename chat…** sets a persistent Harbor name that takes precedence over later automatic titles.
- Right-click a chat to **pin**, **rename**, **close**, **resume**, or **reconnect & resume** it.
- **Close chat**, including the tab’s **×** and a split pane’s close button, terminates that chat’s tmux session. The closed chat remains gray in its project. Closing does not delete the agent conversation.
- **Resume chat** creates a new tmux session and resumes the exact saved conversation ID. **Reconnect & resume** first closes the old tmux session, then resumes in a new one.
- A closed shell reopens as a fresh shell in the project directory; shells don’t have agent conversation history to restore.
- Conversations with an active writer outside Harbor must be closed there before resuming here. Harbor checks again at resume time.
- **Remove from sidebar…** removes only Harbor’s index entry after confirmation. Refreshing project history can discover it again.

**Quitting Harbor or closing its macOS window does not close chats.** Their tmux sessions keep running. Network reconnects reattach automatically without restarting the agent. Host reboots still stop processes; saved agent conversations can be resumed afterward.

## Keyboard and layout

- **⌘ Backspace:** delete back to the beginning of the terminal input line (Ctrl-U).
- **⌘ N:** new chat in the selected project.
- **⌘ K / ⌘ F:** search chat and project names.
- **⌘ B:** collapse/pin the sidebar. Hover over its collapsed rail to peek without resizing the terminal.
- **⌘ ,:** Preferences.
- **⌘ C / ⌘ V:** terminal copy and paste.

The terminal fills the right side below a compact tab bar. Split view displays another running chat beside it.

## Preferences

**Hosts:** only This Mac is present initially. Import selected SSH aliases or add hosts manually. Imported hosts remain editable: display name, address, username, port, identity file, and default folder. SSH config is never edited. Host profile edits apply to new projects; existing projects and chats retain their connection settings.

**Terminal:** font size/family and cursor blinking update open terminals. New launches clear inherited color-disabling variables and advertise full color. Colors and ⌘ Backspace are tested inside the actual Codex and Claude interfaces.

**Sidebar:** enable or disable hover expansion. Harbor remembers whether the sidebar is collapsed.

**Notifications:** enable desktop notifications, sound, notifications while Harbor is focused, and completion notifications. Use **Send test notification** to check macOS delivery. Allow Harbor under **System Settings → Notifications** if needed; macOS Focus rules apply. Notifications work while Harbor is running, including with its window closed.

**Agent updates:** check installed Codex and Claude versions on enabled hosts and project machines against their official npm release channels. Results distinguish current, update available, missing, and unavailable. Checks never install updates or interrupt chats. Pinned/preview release channels may differ.

## Agent integration

Each new Codex chat has a private local app-server socket on its host and the normal Codex TUI. Harbor reads the exact thread ID, title, and runtime activity through the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server). No network listener, separate account, or API key is added.

Claude launches with an explicit conversation ID and session-scoped [lifecycle hooks](https://code.claude.com/docs/en/hooks). Hooks record status and timestamps, not prompts or tool arguments. Saved names and history are read from Claude’s host-local session metadata. The normal [Claude resume command](https://code.claude.com/docs/en/sessions) restores the conversation.

Activity indicators distinguish **Working**, **Needs attention**, **Ready**, **Closed**, and **Status unavailable**. Shells only report availability. Existing pre-0.3 terminal processes remain intact; their live activity becomes available after a managed resume. When an old running terminal’s conversation ID can be identified through its process’s writer lock, Harbor links it; otherwise use its imported project-history entry. Harbor never guesses an ID from the most recently modified chat.

The host adapter is a Python standard-library script, deployed under `~/.local/share/harbor/`. It preserves agent configuration, credentials, and history. Codex sockets live in a private per-user temporary directory. Stopping a managed tmux session also stops its dedicated Codex app server.

## Requirements

- macOS on Apple Silicon for the included build (locally built and unsigned).
- tmux 3.2+, Python 3.8+, bash, and a POSIX login shell on each host.
- Installed/authenticated Codex and/or Claude Code. Tested with Codex 0.154.0 and Claude Code 2.1.263 locally / 2.1.257 on devbox. Codex’s remote-TUI/app-server interface is required for managed chats.
- Noninteractive system SSH authentication for remote machines. Configure initial host trust, keys, ProxyJump, and SSH agent outside Harbor.

History adapters are version-sensitive. An unreadable history source is reported on its project without modifying the source files. Custom `CODEX_HOME` / `CLAUDE_CONFIG_DIR` are respected when present in the host adapter’s environment.

## Development

Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
npm run build
npm start
npm test
npm run test:e2e
npm run package
```

Engine/main/preload changes require restarting the dev app. Build before UI tests. Tests use isolated indexes and their own tmux sessions; real CLI and SSH checks are opt-in:

```sh
HARBOR_TEST_AGENTS=1 HARBOR_TEST_SSH=devbox npm test
HARBOR_TEST_AGENTS=1 HARBOR_TEST_SSH=devbox npm run test:e2e
```

Live agent tests submit a short echo-only prompt in dedicated test directories. Remote test directories are created under `~/harbor-smoke-test-20260916/`. See [VALIDATION.md](VALIDATION.md).

Session/project state is stored atomically in `~/Library/Application Support/Harbor/sessions.json` (schema 2); preferences use `preferences.json`. Earlier indexes migrate without changing running tmux identities. No telemetry is added.
