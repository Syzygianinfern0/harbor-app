# Harbor agent instructions

## End-to-end ownership

The user is completely hands-off. Own every requested feature, fix, repository maintenance task, version-control operation, and other project change end to end: investigate, implement, validate, document, commit, push, and deploy as applicable. Do not wait for additional prompting or routine approval. Make reasonable decisions and resolve recoverable failures independently. Ask only for indispensable information/access or actions outside the requested scope. Report outcomes, verification, and blockers concisely.

## Development and version control

- Follow `README.md` and `VALIDATION.md`; use Node.js 22.12+ and npm (`npm ci` when needed).
- For application changes, run `npm run build`, `npm test`, and relevant `npm run test:e2e` coverage (build first). Visually inspect UI changes. Use isolated profiles/sessions; never test against real chats. Check real CLI/SSH integration when relevant; disclose skipped verification. Documentation-only changes need document checks, not an app rebuild.
- Review status/diffs, run `git diff --check`, stage intended files explicitly, commit, push (normally `origin main`), and confirm final status. Preserve unrelated work; exclude generated output, credentials, profiles, and `work/` backups. Never rewrite published history or move existing release tags.

## Local delivery and active-chat safety

After a feature or app fix is tested and proven to work, automatically replace and relaunch the user's installed Harbor. This is standing authorization and part of completion.

1. Identify the running bundle and actual profile; the usual installation is `~/Applications/Harbor.app`, with state in `~/Library/Application Support/Harbor/`. Inventory open tabs/panes and local/SSH sessions, including tmux session IDs, pane IDs, and PIDs. Use `tmux -L harbor`, not the default socket. Ensure the update procedure itself survives Harbor quitting.
2. Run `npm run package` and wait for successful completion. Verify `release/mac-arm64/Harbor.app` with `codesign --verify --deep --strict` and smoke-test the packaged app using an isolated profile.
3. Retain a rollback copy of the installed bundle and back up persisted state/preferences. Gracefully quit only Harbor, let it finish persisting state, then refresh the state backup and replace the bundle. Quitting detaches clients; chats remain in tmux. Never close chats, kill tmux/agents, or restart active conversations to install an update. Preserve remote connection settings, history, credentials, and exact conversation IDs.
4. Verify installed signature, version, and matching packaged/installed `app.asar` SHA256; relaunch the installed path. Confirm the new process, restored tabs/panes, reattached chats, and unchanged surviving tmux pane IDs/PIDs on reachable hosts. Investigate discrepancies; roll back the bundle if launch or reconnection fails, preserving current chat data. Do not claim success from packaging progress alone.

Harbor currently uses ad-hoc signing (`mac.identity: "-"`); rebuilds may trigger macOS permission prompts. Preserve signing configuration and report any OS interaction required; never promise permission persistence or alter privacy settings silently.
