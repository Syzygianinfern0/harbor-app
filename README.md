# Harbor

A macOS desktop home for persistent **Codex, Claude Code, and shell sessions**, locally and over SSH.

Harbor keeps the processes in tmux on the machine where they run. Quitting the app, closing a tab, archiving a session, or losing the network does **not** terminate them. Reopen Harbor to reconnect, with restored scrollback. A machine reboot or explicit process exit still ends the process; this is session persistence, not job checkpointing.

## Run the app

Open `release/mac-arm64/Harbor.app` (or the copy in `~/Applications/Harbor.app` if installed). This is a locally built, unsigned app, not a notarized distribution.

Prerequisites on every session host:

- **tmux 3.2 or newer** (`brew install tmux` on a Mac; use the host's package manager on Linux).
- **bash**, plus your usual login shell. Bash and Zsh are supported; custom shell launch commands assume POSIX syntax.
- `codex` and/or `claude` installed and authenticated if you use those launchers. Harbor runs those existing CLI tools; it doesn't require its own API key or send prompts to a hosted service.
- For remote hosts, a working noninteractive `ssh your-alias` connection. Establish host trust or unlock your SSH key in Terminal first. Harbor honors system SSH config, ProxyJump, ProxyCommand, and SSH-agent authentication. Password/MFA dialogs inside Harbor are not implemented.

Click **New session**, select a launcher and a host, and choose an existing working directory. `~` refers to the target host's home. **Check host & tools** checks tmux and launcher paths before launching. Use **Custom** for another command or launcher flags.

- **⌘ N** creates a session; **⌘ K** searches names, hosts, paths, tags, and groups.
- **Split view** opens a second session alongside the current terminal.
- Closing a tab detaches it. Select the session from the sidebar to reattach.
- **Archive** hides a session but leaves its process running. Restore it from Archive.
- **Terminate session…** stops that session after an explicit confirmation. Its metadata stays in Archive.
- **Remove from Harbor…** removes only the index entry after confirmation; it never stops tmux.
- **Edit details** provides an attach command you can run in another terminal.
- Status reports **Running, Exited, Ended, Checking, or Unreachable**. Running means the process is alive; it doesn't infer whether an agent is busy, waiting for input, or asking for approval.

## Preferences and hosts

Open **Preferences** from the sidebar or **Harbor → Preferences…** (`⌘ ,`). Only **This Mac** is available initially; Harbor no longer imports SSH aliases at startup or during status refresh.

- **Import from SSH config:** inspect the aliases, select only the ones you want, then import and save. Effective hostname, username, and port are resolved with `ssh -G`; your SSH config file is never edited.
- **Add manually:** enter an alias or address. Customize its display name, hostname override, username, port, identity-file path, and default working directory.
- **Show in launcher:** turn a host on or off without deleting it. Removing a host is also available. Both operations preserve its existing sessions.
- **Edit an imported host:** select it in Preferences and change its fields. Clear an override to use the target alias's current SSH configuration. Explicit identity files are optional; otherwise your SSH config and agent supply authentication.
- **Terminal:** change font size, font family, and cursor blinking. Saved changes apply to open terminals without restarting their processes.

New sessions record their connection settings, so editing a saved host later cannot accidentally redirect an existing session to another machine. Old sessions from 0.1.0 remain accessible even if you haven't added their hosts to Preferences.

The active workspace uses one 42-pixel tab/action bar; the terminal fills the remainder of the right side. Split controls, pinning, editing, and reconnect are available from the bar. There is no Hosts section in the sidebar.

### Sidebar

The sidebar toggle (⌘ B) switches between the full session list and a compact icon rail. Hovering over the rail temporarily reveals the sidebar without resizing the terminal. Turn this off in **Preferences → Sidebar**; the collapsed state and hover preference survive restarting Harbor.

### Agent colors

Harbor 0.2.0 fixes inherited `NO_COLOR=1`, which could disable colors in Codex and Claude Code even while shell prompt colors worked. New sessions clear inherited color overrides and advertise `TERM=xterm-256color` and `COLORTERM=truecolor`. Both agents' actual screens were checked locally and on devbox, including after reconnect.

**Already-running agents retain their original environment.** Start a new session or restart the CLI when convenient to pick up the fix. Reconnecting alone cannot change an existing process's environment. Harbor never restarts a running agent automatically.

## Develop

Use Node.js 22.12+ (tested with Node 26.8.2) and npm:

```sh
npm ci
npm run dev       # Electron + Vite; renderer hot reload
npm run build     # Typecheck and build renderer, main, and preload
npm start         # Run the built app
npm test          # Unit tests and real, isolated local tmux integration tests
npm run test:e2e  # Real Electron UI tests; run build first
npm run package  # Build release/mac-arm64/Harbor.app on Apple Silicon
```

Changes to the engine or Electron main/preload require restarting `npm run dev`.

Remote integration testing is opt-in. The target directory must already exist:

```sh
HARBOR_TEST_SSH=devbox npm test
```

The remote test uses `~/harbor-smoke-test-20260916`, an isolated `harbor-test-*` tmux socket, and disposable sessions. It terminates only sessions on that test socket. Desktop tests use a temporary data directory and clean up only the sessions they created. Screenshots are written to `test-results/screenshots/`.

To test the actual packaged app, set `HARBOR_TEST_APP` to the absolute path of `Harbor.app/Contents/MacOS/Harbor` when running `npm run test:e2e`. Set `HARBOR_TEST_SSH=devbox` as well to include the remote desktop test. `HARBOR_TEST_SSH=devbox npx tsx scripts/check-launchers.ts` starts the actual Codex and Claude Code CLIs on both hosts, checks for their startup screens, and terminates those disposable sessions without submitting prompts or approving trust dialogs.

## Architecture

```text
src/shared/     Browser-safe types and the narrow engine API
src/engine/     Pure Node: SSH, tmux control protocol, host discovery, persistence
src/desktop/    Electron IPC adapter, sandboxed preload, menus, confirmations
src/renderer/   React workspace and xterm.js terminals
```

The engine has no Electron or React imports. `Transport` is injectable, so the engine can be tested without a GUI. A future web or CLI adapter can reuse it; no network API server is enabled in this version.

- **tmux control mode:** `tmux -C` over pipes; no native PTY module. `-CC` is unnecessary without a terminal whose canonical mode needs changing. Control output is decoded as bytes, preserving Unicode split across chunks. A capture primes scrollback; real pane output then streams to xterm. Input is sent in bounded hexadecimal chunks. Clipboard paste goes through `tmux paste-buffer -p` so tmux applies the correct bracketed-paste behavior even on older hosts.
- **Dedicated tmux server:** `tmux -L harbor` uses an app-specific socket and ignores your normal tmux config at server startup. Harbor's settings do not change your regular tmux sessions. Each managed session has one pane. Manage splits in Harbor rather than creating extra windows/panes inside its tmux sessions.
- **SSH:** `/usr/bin/ssh`, noninteractive authentication, private short ControlMaster socket paths, keepalives, and timeouts. General scripts go through stdin. Control-mode bootstrap uses fixed arguments and POSIX shell quoting because stdin remains reserved for the protocol. Read-only commands may retry without multiplexing; ambiguous mutations are never automatically replayed.
- **Launch:** starts the command directly inside the login shell rather than injecting keystrokes before the prompt is ready. Existing CLI preferences, authentication, and approval behavior remain in force.
- **Persistence:** versioned JSON, serialized writes, temporary file plus atomic rename, user-only permissions. Invalid indexes are preserved and cause a clear startup error rather than being silently overwritten.
- **Security:** sandboxed renderer, context isolation, no Node integration, sender-checked narrow IPC, CSP, no remote navigation, and HTTP(S)-only terminal link opening. No telemetry or cloud synchronization.

## Storage and recovery

The session index is at `~/Library/Application Support/Harbor/sessions.json`; selected hosts and terminal preferences are in `preferences.json` alongside it. Open its directory from **Settings**. The index contains session names, paths, commands, tags, and connection metadata. Environment values are not written to it, but anything you put literally into a custom command is saved as part of that command. A running process and tmux necessarily retain their launch environment; this isn't a secret vault.

The durable processes live on their target hosts, independently of the index. If needed:

```sh
tmux -L harbor list-sessions
tmux -L harbor attach -t harbor-SESSION_UUID
# On a remote host:
ssh -t your-alias tmux -L harbor attach -t harbor-SESSION_UUID
```

Only the explicit import screen reads `~/.ssh/config` and recursive `Include` files to discover literal `Host` aliases, skipping wildcard/negated patterns. SSH still resolves the underlying connection configuration for your selected target; explicit saved overrides are passed as separate arguments.

## Current boundaries

No agent-specific conversation resume, worktree automation, cost tracking, remote file transfer, session sharing, mobile/web client, cloud backup, or auto-updater. Starting a new session starts a new CLI invocation; use Custom with a launcher's own resume command when needed. Reconnecting an existing running tmux session preserves the existing CLI process.

Scrollback restoration is a rendered snapshot of up to 2,000 lines, not a full recording of terminal modes and events. Full-screen applications are best kept attached during active interaction. Lost network connections retry with backoff; unreachable hosts never cause session termination.

Design references: [tmux control protocol](https://github.com/tmux/tmux/wiki/Control-Mode), [tmux manual](https://man.openbsd.org/tmux), and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Agent UI color verification is opt-in: `HARBOR_TEST_AGENTS=1 HARBOR_TEST_SSH=devbox npm run test:e2e`. These tests launch the actual CLIs, inspect their rendered color sequences, and save screenshots without submitting prompts or accepting workspace-trust dialogs.
