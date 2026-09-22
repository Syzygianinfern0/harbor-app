# Harbor

A macOS home for projects and persistent Codex, Claude Code, and terminal chats, on your Mac and over SSH.

Open `~/Applications/Harbor.app` or `release/mac-arm64/Harbor.app`.

## Projects and chats

Use **Add project** to choose a saved host and an existing directory. The directory field offers a VS Code-style folder quick pick on both your Mac and saved SSH hosts: type a partial path to filter, click a folder to enter it, or use ↑/↓ and Tab/Enter. **Use this folder** confirms the current directory. Home, parent-folder (Alt+↑), hidden-folder, and local macOS picker controls are available above the list. Harbor discovers that directory’s existing Codex and Claude conversations, including ones created in standalone terminals. **Refresh past chats** picks up later changes. History stays with the original agent on its host; Harbor stores its conversation ID, title, and project association.

- The **+** beside a project creates a Codex, Claude Code, or Terminal chat in that directory. **⌘ N** uses the selected project.
- Agent-generated titles appear automatically. **Right-click → Rename chat…** sets a persistent Harbor name that takes precedence over later automatic titles.
- Right-click a chat to **pin**, **rename**, **close**, **resume**, or **reconnect & resume** it.
- **Close chat** (⌘ W), including the tab’s **×** and a split pane’s close button, asks for confirmation before stopping a live session, then terminates that chat’s tmux session. The closed chat remains gray in its project. Closing does not delete the agent conversation.
- **Resume chat** creates a new tmux session and resumes the exact saved conversation ID. **Reconnect & resume** first closes the old tmux session, then resumes in a new one.
- A closed shell reopens as a fresh shell in the project directory; shells don’t have agent conversation history to restore.
- Conversations with an active writer outside Harbor must be closed there before resuming here. Harbor checks again at resume time.
- **Remove from sidebar…** removes only Harbor’s index entry after confirmation. Refreshing project history can discover it again.

**Quitting Harbor or closing its macOS window does not close chats.** Their tmux sessions keep running. Network reconnects reattach automatically without restarting the agent. Host reboots still stop processes; saved agent conversations can be resumed afterward.

Right-click a project and choose **Open in Cursor** to open its directory locally or through Cursor Remote-SSH. Harbor preserves the project’s saved SSH connection, including username, port, hostname, and identity-file overrides.

## Keyboard and layout

- **⌘ Backspace:** delete back to the beginning of the terminal input line (Ctrl-U).
- **⌘ Left / ⌘ Right:** move to the beginning / end of the terminal input line (Ctrl-A / Ctrl-E).
- **⌘ N / ⌘ T:** new chat in the selected project.
- **⌘ K / ⌘ F:** search chat and project names.
- **⌘ B:** collapse/pin the sidebar. Hover over its collapsed rail to peek without resizing the terminal.
- **⌘ 1–8:** select the numbered tab; **⌘ 9:** select the last tab.
- **Control-Tab / Control-Shift-Tab:** next / previous tab, with wraparound. **⌘ Shift-[ / ⌘ Shift-]:** previous / next tab.
- **⌘ W:** close the active chat, confirming before stopping a live session.
- **⌘ ,:** Preferences.
- **⌘ C / ⌘ V:** terminal copy and paste.

Drop one or more files onto a connected terminal to insert quoted paths without submitting the input. SSH chats first copy the files to a private directory under `~/.local/share/harbor/drops` on that chat's host; these copies remain available for the conversation. Folders are not supported. File paths use Electron's [native file API](https://www.electronjs.org/docs/latest/api/web-utils).

The sidebar's sliding **Hide all closed chats** switch persists across restarts and keeps currently open tabs intact. Conversations running outside Harbor remain visible. Use **Chat actions → View launch command…** (also in the chat's right-click menu) to inspect and copy the original command and, after resuming, the latest command. Older chats show their saved launcher when available; imported chats identify when the original command is unknown.

Drag tabs to reorder them. Drag a tab, sidebar chat, or pane header onto another pane’s left, right, top, or bottom target to split it; the center target replaces that pane. Splits can be nested without a fixed pane-count limit. Drag any divider to resize, or double-click to reset its proportions. The sidebar’s right edge resizes it too. Focused dividers also support arrow keys. Layout, tab order, and sidebar width persist across restarts. Closing a pane removes it from the layout and keeps the chat open; closing its tab stops the chat after confirmation.

## Preferences

**Icon guide:** shows the actual chat status icons with a short explanation of each.

**Hosts:** only This Mac is present initially. Import selected SSH aliases or add hosts manually. Imported hosts remain editable: display name, address, username, port, identity file, and default folder. SSH config is never edited. Host profile edits apply to new projects; existing projects and chats retain their connection settings.

**Terminal:** font size/family and cursor blinking update open terminals. New launches clear inherited color-disabling variables and advertise full color. Colors and ⌘ Backspace are tested inside the actual Codex and Claude interfaces.

**Sidebar:** chats are indented under a branch line within each project. Confirmed-empty agent history is hidden, while freshly created chats stay visible for the current app session (until explicitly closed). Unknown or unreadable history remains visible, and no conversations are deleted. Five chats are shown initially (pinned first, then most recent); **Show more** reveals five more, and search includes all chats. Remote projects show a muted host name and a reachability dot, checked every 30 seconds; local projects omit this metadata. Enable or disable hover expansion; Harbor remembers whether the sidebar is collapsed.

**Agent defaults:** choose separate Codex and Claude permission defaults, or override the mode in New chat. Standard approvals are selected initially. Codex offers workspace, read-only, and full access; Claude offers standard, accept edits, plan, and full access. A managed chat retains its selected mode when resumed; Codex remote resumes use the conversation’s saved permissions because the CLI rejects permission overrides on that path. Modes use the installed CLIs’ supported flags, based on the [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) and [Claude permissions reference](https://code.claude.com/docs/en/permissions).

**Notifications:** enable desktop notifications, sound, notifications while Harbor is focused, and completion notifications. Use **Send test notification** to check macOS delivery and receive delivery or failure feedback. Run the packaged, signed Harbor.app so macOS registers Harbor by name. **Open notification settings** goes directly to macOS settings. Allow Harbor under **System Settings → Notifications** if needed; macOS Focus rules apply. Notifications work while Harbor is running, including with its window closed.

**Agent updates:** check installed Codex and Claude versions on enabled hosts and project machines against their official npm release channels. Results are grouped by host and distinguish current, update available, missing, and unavailable. **Update** uses the active installation’s npm, Homebrew, or Claude native updater, then checks the active version again and displays verification and command output. Unknown installation layouts are reported rather than replaced. Checks alone never install updates. Existing chats retain their running agent processes. Pinned/preview release channels may differ.

## Agent integration

Each new Codex chat has a private local app-server socket on its host and the normal Codex TUI. Harbor reads the exact thread ID, title, and runtime activity through the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server). No network listener, separate account, or API key is added.

Claude launches with an explicit conversation ID and session-scoped [lifecycle hooks](https://code.claude.com/docs/en/hooks). Hooks record status and timestamps, not prompts or tool arguments. Saved names and history are read from Claude’s host-local session metadata. The normal [Claude resume command](https://code.claude.com/docs/en/sessions) restores the conversation.

Sidebar and tab icons distinguish **Starting**, **Working**, **Needs input or approval**, **Turn finished — waiting for next prompt**, **Ready**, **Agent error**, **Closed**, **Status unavailable**, and **Running elsewhere**. Turn finished means an observed turn ended and the agent is now idle; it does not certify that the task succeeded. Codex uses runtime thread status and approval/input flags; Claude uses prompt, tool, permission, question, elicitation, stop, and failure hooks. Claude idle reminders preserve completion instead of falsely requesting input. Updated bridge mappings apply to newly launched or resumed agents. Shells only report availability. Existing pre-0.3 terminal processes remain intact; their live activity becomes available after a managed resume. When an old running terminal’s conversation ID can be identified through its process’s writer lock, Harbor links it; otherwise use its imported project-history entry. Harbor never guesses an ID from the most recently modified chat.

The host adapter is a Python standard-library script, deployed under `~/.local/share/harbor/`. It preserves agent configuration, credentials, and history. Codex sockets live in a private per-user temporary directory. Stopping a managed tmux session also stops its dedicated Codex app server.

## Requirements

- macOS on Apple Silicon for the included build (locally built and ad-hoc signed; not notarized).
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

### Version control

The private backup repository is [Syzygianinfern0/Agent-Manager](https://github.com/Syzygianinfern0/Agent-Manager), with `main` as the default branch. Source, tests, assets, documentation, build configuration, and `package-lock.json` belong in Git. Dependencies, build output, test screenshots, and `work/` are excluded. The `work/` directory contains local investigation artifacts and installation backups, including copied app profiles; it is not needed to build the application and should not be added wholesale.

For each completed change, review `git status --short` and `git diff`, run the relevant checks, stage the intended files explicitly, and commit them. Push completed commits with `git push origin main`; local commits alone are not a remote backup. Check `git status --short --branch` afterward for untracked files, pending edits, or unpushed commits.

Release tags use `v<package.json version>` and point to validated commits. Push new annotated tags explicitly with `git push origin <tag>`. Do not move an existing release tag or rewrite published history. Versions 0.1.0–0.3.0 identify the existing historical commits; 0.4.0 is the consolidated September 22 checkpoint of the previously uncommitted work, not a reconstruction of intermediate daily versions.

### Workspace controls

- Use the refresh icon at the top right (or ⌘R) to discover saved chats across projects and refresh session and host status.
- Shift+Enter inserts a newline in Codex and Claude; ⌘N followed by Enter starts a chat with the selected defaults. Middle-click a tab to close it, using the same running-session confirmation as its close button.
- Preferences opens in a centered, scrollable dialog. Its Projects pane supports drag ordering, visibility, and deletion; save to apply or cancel to discard. Project headings also support drag ordering directly in the sidebar. Deletion removes Harbor's project entry while keeping files, conversations, and running sessions.
- Shell terminals stay out of the chat sidebar. Closed and disconnected agent chats show a read-only saved-message preview when a transcript is available, with a message count and the last four text messages. Tool records are excluded; preview messages are shortened to 1,200 characters.
- Agent marks use monochrome OpenAI and Claude silhouettes from Simple Icons, colored by the app theme.

## Usage and scroll state

The subtle **24h cost** above Preferences shows overall usage across configured hosts. Click it for rolling **24-hour**, **7-day**, and **30-day** costs by host and model. **View detailed usage** opens Preferences → Usage, where you can group by host/model, model/host, or day/host/model. Overall views show costs only. They refresh every minute and on global refresh; Preferences also has a manual refresh.

Each Codex/Claude chat has a single lifetime total for tokens, recorded compactions, and cost when available. Hover over tokens for the input/output/cache breakdown; click the chat cost for its model breakdown. Visible chat metrics refresh every 30 seconds. Missing data is unavailable, and incomplete coverage is marked partial.

Harbor reads saved Codex and Claude JSONL on each host through its Python bridge (no Node or ccusage installation required there). It deduplicates Codex snapshots, leading parent snapshots in forked chats, and Claude streaming chunks. Overall costs include saved chats outside Harbor and subagent logs. The chat strip covers its own transcript; copies on separate hosts count on each host. Windows use usage-event timestamps; day groups use UTC.

Costs use recorded `costUSD` when available, otherwise model API rates from a bundled [LiteLLM catalog](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), refreshed daily and retained offline. Estimates account for input, output, cached input, cache writes (including Claude one-hour writes), known service tiers, and long-context rates. Unknown models or missing applicable rates remain unpriced. These estimates are not subscription charges, credits, or billing statements; provider tools and non-token charges may differ. The report displays the price snapshot date. Numeric usage, model names, timestamps and file fingerprints are cached under `~/.local/share/harbor`; prompts are not cached in the usage index or sent to the pricing service.

Open tabs retain their terminal instance, connection, scrollback and preview scroll position when switching tabs, showing project overviews, or moving between split panes. Closing a tab releases its view. Scroll positions are retained for the current app run; restarting still reconnects from tmux's saved history.

Standalone Codex installations (including `CODEX_HOME` overrides) update via the active binary’s `codex update` command. npm and Homebrew installations retain their existing update paths; unknown installation owners are rejected. Harbor verifies the active version after updating and does not retry a possibly completed mutation automatically.

### Agent update checks

Harbor checks Codex and Claude Code on startup, wake, and focus when its cached results are older than 24 hours. Unreachable machines are retried after an hour; **Check for updates** always requests a fresh check. Results survive app restarts. In Preferences → Agent updates, **Update all** checks again, then updates every installed agent with an available release across the listed machines. Failures are shown per agent while the remaining updates continue, even if Preferences is closed. Checks never install updates automatically.
