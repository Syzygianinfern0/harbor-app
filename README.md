# Harbor

A macOS home for projects and persistent Codex, Claude Code, and terminal chats, on your Mac and over SSH.

Open `~/Applications/Harbor.app` or `release/mac-arm64/Harbor.app`.

## Projects and chats

Use **Add project** to choose a saved host and an existing directory. The directory field offers a VS Code-style folder quick pick on both your Mac and saved SSH hosts: type a partial path to filter, click a folder to enter it, or use ↑/↓ and Tab/Enter. **Use this folder** confirms the current directory. Home, parent-folder (Alt+↑), hidden-folder, and local macOS picker controls are available above the list. Harbor discovers that directory’s existing Codex and Claude conversations, including ones created in standalone terminals. **Refresh past chats** picks up later changes. History stays with the original agent on its host; Harbor stores its conversation ID, title, and project association.

- The **+** beside a project creates a Codex, Claude Code, or Terminal chat in that directory. **⌘ N** uses the selected project.
- Agent-generated titles appear automatically. **Right-click → Rename chat…** sets a persistent Harbor name that takes precedence over later automatic titles.
- Right-click a chat to **pin**, **rename**, **close**, **resume**, or **reconnect & resume** it.
- **Notes:** hover a chat and click the faint note icon (or right-click → **Add note…**) to attach free-form text. Chats with a note keep a muted icon; hover it to read the note, click it to edit. ⌘↩ or clicking away saves, Esc discards, and **Remove** deletes the note. Notes are stored with the chat in `sessions.json` and do not change chat ordering.
- **Project notes:** projects take notes the same way — hover a project heading and click its note icon, or right-click → **Add note…**. They are stored with the project in `sessions.json`.
- **Only show chats with notes:** this sidebar switch (below **Hide all closed chats**) keeps only chats that have a note; projects with no noted chats are hidden unless the project itself has a note. The switch persists across restarts.
- **Close chat** (⌘ W), including the tab’s **×** and a split pane’s close button, asks for confirmation before stopping a live session (press Return to confirm, Esc to cancel), then terminates that chat’s tmux session. The closed chat remains gray in its project. Closing does not delete the agent conversation.
- **Resume chat** creates a new tmux session and resumes the exact saved conversation ID. **Reconnect & resume** first closes the old tmux session, then resumes in a new one.
- **Fork chat** (chat right-click menu, tab right-click menu, or **Chat actions**) starts a new chat from a Codex or Claude conversation, like Claude Code’s `/branch`. The fork, named “<name> (fork)”, uses the original’s folder, host (SSH included), agent and permission mode, and gets its own conversation ID; the original is left untouched and can keep running. Claude launches with `--resume <id> --fork-session --session-id <new id>`; Codex runs `codex fork <id>` against Harbor’s private app server, which reports the new thread (its `forkedFromId` is the original). The fork’s tab goes right after the original’s, joins the original’s custom tab group, and always opens as a split to the original’s right. If the original was off screen, it comes back first (with its split, if it had one) and the view you left is parked. Forking needs a saved conversation: a chat that is still starting or has no messages yet shows the reason on the greyed item and when clicked. A fork closed before it saved its own conversation forks the original again when resumed.
- A closed shell reopens as a fresh shell in the project directory; shells don’t have agent conversation history to restore.
- Conversations with an active writer outside Harbor must be closed there before resuming here. Harbor checks again at resume time.
- **Remove from sidebar…** removes only Harbor’s index entry after confirmation. Refreshing project history can discover it again.

**Quitting Harbor or closing its macOS window does not close chats.** Their tmux sessions keep running. Network reconnects reattach automatically without restarting the agent. Host reboots still stop processes; saved agent conversations can be resumed afterward.

Right-click a project and choose **Open in Cursor** to open its directory locally or through Cursor Remote-SSH. Harbor preserves the project’s saved SSH connection, including username, port, hostname, and identity-file overrides.

## Keyboard and layout

- **⌘ Backspace:** delete back to the beginning of the terminal input line (Ctrl-U).
- **⌘ Left / ⌘ Right:** move to the beginning / end of the terminal input line (Ctrl-A / Ctrl-E).
- **⌘ N / ⌘ T:** new chat in the selected project.
- **⌘ K / ⌘ F:** search chat and project names. With a terminal focused, **⌘ F** instead opens a find bar over that pane that searches its scrollback: all matches are highlighted and the count shows the current one ("3 of 12"). **Enter** steps to the next older match, **Shift-Enter** to the next newer one, and **Esc** closes the bar and returns to the terminal.
- **⌘ B:** collapse/pin the sidebar. Hover over its collapsed rail to peek without resizing the terminal.
- **⌘ 1–8:** select the numbered visible tab; **⌘ 9:** select the last visible tab. See [Tab groups](#tab-groups) for group shortcuts.
- **⌘ 1 / ⌘ 2 / ⌘ 3 in the New chat dialog:** choose Codex / Claude Code / Terminal. Each option shows its shortcut.
- With many tabs, inactive tabs shrink first; then the tab strip scrolls horizontally (trackpad or mouse wheel) with its scrollbar hidden. The active tab stays in view.
- **Control-Tab / Control-Shift-Tab:** next / previous tab, with wraparound. **⌘ Shift-[ / ⌘ Shift-]:** previous / next tab.
- **⌘ W:** close the active chat, confirming before stopping a live session.
- **⌘ ,:** Preferences.
- **⌘ C / ⌘ V:** terminal copy and paste.
- **Control-letter shortcuts** pass through to the terminal, including **Ctrl-T** for Codex's transcript, **Ctrl-R** for shell history search, and **Ctrl-W** for word deletion. **Control-Tab / Control-Shift-Tab** remain Harbor tab navigation.

Drop one or more files or folders onto a connected terminal to insert quoted paths without submitting the input. SSH chats first copy them to a private directory under `~/.local/share/harbor/drops` on that chat's host; these copies remain available for the conversation. Folders are copied recursively, including hidden files, with a streamed `tar` (the host needs `tar`); symlinks inside a folder are copied as links, and macOS extended attributes are omitted. File paths use Electron's [native file API](https://www.electronjs.org/docs/latest/api/web-utils).

The sidebar's sliding **Hide all closed chats** switch persists across restarts and keeps currently open tabs intact. Conversations running outside Harbor remain visible. Clicking a project's name still shows that project's closed chats in the sidebar while its page is showing, and the page lists them all. Opening a chat, clicking the name again, picking another project, or flipping the switch hides them again. Use **Chat actions → View launch command…** (also in the chat's right-click menu) to inspect and copy the original command and, after resuming, the latest command. Older chats show their saved launcher when available; imported chats identify when the original command is unknown.

Drag tabs to reorder them. Drag a tab, sidebar chat, or pane header onto another pane’s left, right, top, or bottom target to split it; the center target replaces that pane. Splits can be nested without a fixed pane-count limit. Drag any divider to resize, or double-click to reset its proportions. The sidebar’s right edge resizes it too. Focused dividers also support arrow keys. Layout, tab order, and sidebar width persist across restarts. Closing a pane removes it from the layout and keeps the chat open; closing its tab stops the chat after confirmation.

Split views work like Chrome's: chats tiled together stay linked. In the tab strip their tabs sit side by side, in pane order (left/top first), inside one shared rounded outline marked with a small split icon. The split on screen is lit as a unit in its group's color, and the focused pane's tab is filled brightest; it keeps full width while other tabs shrink. Clicking a tab of the split focuses that pane. Clicking any other tab (or opening a chat from the sidebar) shows it alone and parks the split, still outlined; clicking either of its tabs brings the whole split back with that pane focused. Dragging a split's tab in the strip moves the whole split (both tabs dim, and the insertion line marks where it lands); nothing can be dropped between its tabs, and dropping it into a custom group adds all of it. Folding a group parks the split in it. Closing one of a split's tabs, or its pane, collapses the split and leaves the other tab a plain tab. Parked splits persist across restarts. A split whose chats are in different tab groups shows each part outlined in its own group.

## Tab groups

Open tabs are grouped so many chats fit in one tab row. Folding a group hides its tabs without stopping any chat.

- **Group tabs by project** (on by default): tabs from the same project sit together behind a colored label, and one line in that color runs under the label and the group's tabs. The active tab's outline in its group's color runs up its sides and across its top, curving at the bottom into that line. Groups follow the sidebar's project order. When every open tab belongs to one project, no label is shown.
- **Fold a group:** click its label. A folded group becomes a chip with its tab count and its most urgent status (needs input, then error, turn finished, background work, working). Click that status icon to open the chat it refers to. Folding puts a group away: its panes leave the view, which moves to the most recently used chat still in the strip. Unfolding right after is an exact undo. Opening a chat from a folded group (sidebar, status icon, ⌘ J) unfolds it.
- **Everything folded:** when no tab is left in the strip (for example after **Collapse all groups**, or in focus mode after folding the open group), the main area shows an overview of the open groups as cards, with their chats and statuses. Click a chat to open it, or a card's title to unfold that group and bring back its split. Clicking a project name in the sidebar always shows that project's page instead, in focus mode too.
- **Custom groups:** ⌘-click or Shift-click tabs to select them, then press **⌘ G** (or right-click a tab → **New group**). Name the group and pick a color in the field that opens. A custom group can mix projects and hosts, and it takes precedence over project grouping. Right-click a tab to add it to or remove it from a group. Right-click a label to rename, recolor, collapse or ungroup. A custom group disappears when its last tab closes. A new chat from the same project as the current tab joins the current tab's custom group.
- **Dragging:** drag a tab into a group's run to join it, or out to leave. Drag a label to move the whole group; dragging a project label onto another project reorders the projects in the sidebar too. Dropping a tab or sidebar chat on a chip adds it without unfolding.
- **Tab groups** button (the layers icon beside Split view) holds the switches: **Group tabs by project**, **Focus mode** (only the current tab's group stays open; clicking a chip switches to that group's last-used tab), and **Shrink tabs before scrolling** (on by default: inactive tabs narrow to fill the strip, then turn to icon and status one at a time, other groups and farthest tabs first, before the strip scrolls). The same menu can collapse or expand all groups.
- **Motion:** opening, closing, folding and reordering animate briefly (under 0.2 s): tabs slide into place, new ones fade in, removed ones fade out, and a chat fades in when it lands in a pane. Clicks are never delayed. macOS **Reduce motion** turns this off.
- When tabs still overflow, markers at the strip's edges count the hidden tabs and turn amber when a hidden chat needs input. Click one to scroll there.
- **Colors:** the active tab and the selected sidebar chat take their group's color (or their project's, when ungrouped). Change a project's color from its sidebar right-click menu or its tab-group label menu.
- **Sidebar:** each project's folder icon uses its group color, and chats that are open as tabs have a soft outline in that color. A folded project shows its live chat count and most urgent status. The collapsed rail shows the same status as a badge; in focus mode, clicking a rail project switches to its tab group, and clicking the open group's project (or one without tabs) shows its project page. Right-click a project for **Show tabs** and **Fold in tab bar**.
- **Shortcuts:** **⌘ G** group selected tabs, **⌘ ⇧ G** toggle project grouping, **⌥ ⌘ ← / →** previous / next group, **⌥ ⌘ 1–9** group N, **⌘ J** next chat that needs input (unfolding its group). **⌘ 1–9** and **Control-Tab** move among the tabs shown in the strip.

Groups, folding, colors and the switches persist across restarts alongside tab order (`harbor.tabGroups` in the app's local storage).

## Preferences

**Icon guide:** shows the actual chat status icons with a short explanation of each.

**Hosts:** only This Mac is present initially. Import selected SSH aliases or add hosts manually. Imported hosts remain editable: display name, address, username, port, identity file, and default folder. SSH config is never edited. Host profile edits apply to new projects; existing projects and chats retain their connection settings.

**Terminal:** font size/family and cursor blinking update open terminals. New launches clear inherited color-disabling variables and advertise full color. Colors and ⌘ Backspace are tested inside the actual Codex and Claude interfaces.

**Sidebar:** chats are indented under a branch line within each project. Confirmed-empty agent history is hidden, while freshly created chats stay visible for the current app session (until explicitly closed). Unknown or unreadable history remains visible, and no conversations are deleted. Five chats are shown initially (pinned first, then most recent); **Show more** reveals five more, and search includes all chats. Remote projects show a muted host name and a reachability dot, checked every 30 seconds; local projects omit this metadata. Enable or disable hover expansion; Harbor remembers whether the sidebar is collapsed.

**Agent defaults:** choose separate Codex and Claude permission defaults, or override the mode in New chat. Standard approvals are selected initially. Codex offers workspace, read-only, and full access; Claude offers standard, accept edits, plan, and full access. A managed chat retains its selected mode when resumed; Codex remote resumes use the conversation’s saved permissions because the CLI rejects permission overrides on that path. Modes use the installed CLIs’ supported flags, based on the [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) and [Claude permissions reference](https://code.claude.com/docs/en/permissions).

**Notifications:** enable desktop notifications, sound, notifications while Harbor is focused, and completion notifications. Use **Send test notification** to check macOS delivery and receive delivery or failure feedback. Run the packaged, signed Harbor.app so macOS registers Harbor by name. **Open notification settings** goes directly to macOS settings. Allow Harbor under **System Settings → Notifications** if needed; macOS Focus rules apply. Notifications work while Harbor is running, including with its window closed.

**Unread chats:** when a chat needs input or approval, hits an agent error, or finishes a turn (if **Notify when an agent finishes working** is on) while you aren't looking at it, it's marked unread with a small blue dot and a bolder title. You're looking at a chat when it's in a visible pane of Harbor's window and that window has focus. The dot shows on the chat's sidebar row, its tab (icon-only tabs too) and its groups-overview card. Rollup dots appear on folded tab-group chips, groups-overview cards, folded sidebar projects (and a project heading whose unread chat is past **Show more** or filtered out) and collapsed-rail projects. The macOS Dock badge shows how many chats are unread. The marker is Harbor's in-app notification, so it works even with desktop notifications turned off. The mark clears when the chat becomes the focused pane of the focused window, for example when you click it or its desktop notification. If you open it while Harbor is in the background, it clears once you switch back. It's saved with the chat in `sessions.json` (`unread: true`), so it survives a restart. Older indexes without the field load unchanged. Archived chats aren't counted.

**Agent updates:** check installed Codex and Claude versions on enabled hosts and project machines against their official npm release channels. Results are grouped by host and distinguish current, update available, missing, and unavailable. **Update** uses the active installation’s npm, Homebrew, or Claude native updater, then checks the active version again and displays verification and command output. Unknown installation layouts are reported rather than replaced. Checks alone never install updates. Existing chats retain their running agent processes. Pinned/preview release channels may differ.

## Agent integration

Each new Codex chat has a private local app-server socket on its host and the normal Codex TUI. Harbor reads the exact thread ID, title, and runtime activity through the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server). No network listener, separate account, or API key is added.

Claude launches with an explicit conversation ID and session-scoped [lifecycle hooks](https://code.claude.com/docs/en/hooks). Hooks record status and timestamps, not prompts or tool arguments. Saved names and history are read from Claude’s host-local session metadata. The normal [Claude resume command](https://code.claude.com/docs/en/sessions) restores the conversation.

Sidebar and tab icons distinguish **Starting**, **Working**, **Needs input or approval**, **Waiting on background work**, **Turn finished — waiting for next prompt**, **Ready**, **Agent error**, **Closed**, **Status unavailable**, and **Running elsewhere**. Turn finished means an observed turn ended and the agent is now idle; it does not certify that the task succeeded. Codex uses runtime thread status and approval/input flags; Claude uses prompt, tool, permission, question, elicitation, stop, and failure hooks. Claude idle reminders preserve completion instead of falsely requesting input. **Waiting on background work** (hourglass) means the turn ended while background work is still running; hover it to see what. For Claude, that's background shells, monitors or background agents listed in the `Stop` hook's `background_tasks`. Claude resumes by itself when they report back, and the chat shows finished only after the final turn (no completion notification before that). If a shell-only wait loses its processes without Claude waking up, Harbor clears the wait after about 10 seconds. For Codex, it's background terminals from the app-server's `thread/backgroundTerminals/list`. Codex doesn't start a new turn when they exit, so the chat moves to **Turn finished** once the terminals end. Updated bridge mappings apply to newly launched or resumed agents. Shells only report availability. Existing pre-0.3 terminal processes remain intact; their live activity becomes available after a managed resume. When an old running terminal’s conversation ID can be identified through its process’s writer lock, Harbor links it; otherwise use its imported project-history entry. Harbor never guesses an ID from the most recently modified chat.

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

Live agent tests submit a short echo-only prompt in dedicated test directories. Remote test directories are created under `~/harbor-smoke-test-20260916/`. `HARBOR_TMUX_SOCKET=<name>` points the app at a private tmux server instead of `-L harbor`; `clipboard.spec.ts` uses one per run (and a removed `~/harbor-copytest-20260924/` directory remotely). See [VALIDATION.md](VALIDATION.md).

Session/project state is stored atomically in `~/Library/Application Support/Harbor/sessions.json` (schema 2); preferences use `preferences.json`. Earlier indexes migrate without changing running tmux identities. No telemetry is added.

### Version control

The private backup repository is [Syzygianinfern0/Agent-Manager](https://github.com/Syzygianinfern0/Agent-Manager), with `main` as the default branch. Source, tests, assets, documentation, build configuration, and `package-lock.json` belong in Git. Dependencies, build output, test screenshots, and `work/` are excluded. The `work/` directory contains local investigation artifacts and installation backups, including copied app profiles; it is not needed to build the application and should not be added wholesale.

For each completed change, review `git status --short` and `git diff`, run the relevant checks, stage the intended files explicitly, and commit them. Push completed commits with `git push origin main`; local commits alone are not a remote backup. Check `git status --short --branch` afterward for untracked files, pending edits, or unpushed commits.

Release tags use `v<package.json version>` and point to validated commits. Push new annotated tags explicitly with `git push origin <tag>`. Do not move an existing release tag or rewrite published history. Versions 0.1.0–0.3.0 identify the existing historical commits; 0.4.0 is the consolidated September 22 checkpoint of the previously uncommitted work, not a reconstruction of intermediate daily versions.

### Workspace controls

- Use the refresh icon at the top right (or ⌘R) to discover saved chats across projects and refresh session and host status.
- Shift+Enter inserts a newline in Codex and Claude. Ctrl+Enter reaches them as a distinct key (`ESC [13;5u`, as in kitty-protocol terminals) instead of a plain Enter: Claude submits, and Codex ignores it unless bound, e.g. `[tui.keymap.composer] submit = ["enter", "ctrl-enter"]` in `~/.codex/config.toml`. Shell chats still receive a plain carriage return; ⌘N followed by Enter starts a chat with the selected defaults. Middle-click a tab to close it, using the same running-session confirmation as its close button.
- Preferences opens in a centered, scrollable dialog. Its Projects pane supports drag ordering, visibility, and deletion; save to apply or cancel to discard. Project headings also support drag ordering directly in the sidebar. Deletion removes Harbor's project entry while keeping files, conversations, and running sessions.
- Shell terminals stay out of the chat sidebar. Closed and disconnected agent chats show a read-only saved-message preview when a transcript is available, with a message count and the last four text messages. Tool records are excluded; preview messages are shortened to 1,200 characters.
- Agent marks use monochrome OpenAI and Claude silhouettes from Simple Icons, colored by the app theme.

## Usage and scroll state

The subtle **24h cost** above Preferences shows overall usage across configured hosts. Click it for rolling **24-hour**, **7-day**, and **30-day** costs by host and model. **View detailed usage** opens Preferences → Usage, where you can group by host/model, model/host, or day/host/model. Overall views show costs only. They refresh every minute and on global refresh; Preferences also has a manual refresh.

Each Codex/Claude chat has a single lifetime total for tokens, recorded compactions, and cost when available. Hover over tokens for the input/output/cache breakdown; click the chat cost for its model breakdown. Visible chat metrics refresh every 30 seconds. Missing data is unavailable, and incomplete coverage is marked partial.

Harbor reads saved Codex and Claude JSONL on each host through its Python bridge (no Node or ccusage installation required there). It deduplicates Codex snapshots, leading parent snapshots in forked chats, and Claude streaming chunks, and counts a Claude request copied into several transcripts (forks, background copies) once by message and request ID. Overall costs include saved chats outside Harbor and subagent logs. The chat strip covers its own transcript plus its subagents: Claude subagent and Workflow agent logs (`<session>/subagents/**/agent-*.jsonl`, or legacy `agent-*.jsonl` files with the chat's session ID) and Codex threads spawned from the chat, each priced at its own model's rates; it notes how many were included. Copies on separate hosts count on each host. Windows use usage-event timestamps; day groups use UTC.

Costs use recorded `costUSD` when available, otherwise model API rates from a bundled [LiteLLM catalog](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), refreshed daily and retained offline. Estimates account for input, output, cached input, cache writes (including Claude one-hour writes), known service tiers, and long-context rates. Unknown models or missing applicable rates remain unpriced. These estimates are not subscription charges, credits, or billing statements; provider tools and non-token charges may differ. The report displays the price snapshot date. Numeric usage, model names, timestamps and file fingerprints are cached under `~/.local/share/harbor`; prompts are not cached in the usage index or sent to the pricing service.

Open tabs retain their terminal instance, connection, scrollback and preview scroll position when switching tabs, showing project overviews, or moving between split panes. Closing a tab releases its view. Scroll positions are retained for the current app run; restarting still reconnects from tmux's saved history.

Standalone Codex installations (including `CODEX_HOME` overrides) update via the active binary’s `codex update` command. npm and Homebrew installations retain their existing update paths; unknown installation owners are rejected. Harbor verifies the active version after updating and does not retry a possibly completed mutation automatically.

### Agent update checks

Harbor checks Codex and Claude Code on startup, wake, and focus when its cached results are older than 24 hours. Unreachable machines are retried after an hour; **Check for updates** always requests a fresh check. Results survive app restarts. In Preferences → Agent updates, **Update all** checks again, then updates every installed agent with an available release across the listed machines. Failures are shown per agent while the remaining updates continue, even if Preferences is closed. Checks never install updates automatically.
