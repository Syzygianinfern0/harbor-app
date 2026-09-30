# Harbor agent instructions

## End-to-end ownership

The user is completely hands-off. Own every requested feature, fix, repository maintenance task, version-control operation, and other project change end to end: investigate, implement, validate, document, commit, push, and deploy as applicable. Do not wait for additional prompting or routine approval. Make reasonable decisions and resolve recoverable failures independently. Ask only for indispensable information/access or actions outside the requested scope. Report outcomes, verification, and blockers concisely.

## Development and version control

- Follow `README.md` and `VALIDATION.md`; use Node.js 22.12+ and npm (`npm ci` when needed).
- For application changes, run `npm run build`, `npm test`, and relevant `npm run test:e2e` coverage (build first). Visually inspect UI changes. Use isolated profiles/sessions; never test against real chats. Check real CLI/SSH integration when relevant; disclose skipped verification. Documentation-only changes need document checks, not an app rebuild.
- Hand-written `sessions.json` fixtures (for `HARBOR_DATA_DIR` profiles) must pass the engine's index check (`Invalid session index.` in `src/engine/engine.ts`): `version` 1 or 2; each session's `tmuxName` matches `^harbor-[a-f0-9-]+$` (hex only: `harbor-bbbb0`, not `harbor-look0`/`harbor-group0`/`harbor-zzzz1`), `paneId` matches `^%\d+$`, `name`/`cwd`/`group` are strings, `tags` is an array, and `launcher` is `shell`/`codex`/`claude`/`custom`. An invalid index pops a modal "Harbor could not start" dialog on the user's screen and never opens a window, so automation just times out waiting for one. Copy the fixture in `tests/tab-groups.spec.ts`. Shell chats are not listed in the sidebar, so open fixtures through `codex`/`claude` rows.
- Review status/diffs, run `git diff --check`, stage intended files explicitly, commit, push (normally `origin main`), and confirm final status. Preserve unrelated work; exclude generated output, credentials, profiles, and `work/` backups. Never rewrite published history or move existing release tags.

## Local delivery and active-chat safety

After a feature or app fix is tested and proven to work, automatically replace and relaunch the user's installed Harbor. This is standing authorization and part of completion.

1. Identify the running bundle and actual profile; the usual installation is `~/Applications/Harbor.app`, with state in `~/Library/Application Support/Harbor/`. Inventory open tabs/panes and local/SSH sessions, including tmux session IDs, pane IDs, and PIDs. Use `tmux -L harbor`, not the default socket. Ensure the update procedure itself survives Harbor quitting.
2. Run `npm run package` and wait for successful completion. Verify `release/mac-arm64/Harbor.app` with `codesign --verify --deep --strict` and smoke-test the packaged app using an isolated profile.
3. Retain a rollback copy of the installed bundle and back up persisted state/preferences. Gracefully quit only Harbor, let it finish persisting state, then refresh the state backup and replace the bundle. Quitting detaches clients; chats remain in tmux. Never close chats, kill tmux/agents, or restart active conversations to install an update. Preserve remote connection settings, history, credentials, and exact conversation IDs.
4. Verify installed signature, version, and matching packaged/installed `app.asar` SHA256; relaunch the installed path. Confirm the new process, restored tabs/panes, reattached chats, and unchanged surviving tmux pane IDs/PIDs on reachable hosts. Investigate discrepancies; roll back the bundle if launch or reconnection fails, preserving current chat data. Do not claim success from packaging progress alone.

Harbor currently uses ad-hoc signing (`mac.identity: "-"`); rebuilds may trigger macOS permission prompts. Preserve signing configuration and report any OS interaction required; never promise permission persistence or alter privacy settings silently.

## Landing page (`site/`)

Mechanics are in `README.md` → "Landing page". These are the owner's decisions; keep them unless asked.

- **Pitch:** Harbor replaces the tmux routine (ssh, cd, `tmux new`, start an agent, repeat) for people who do all four at once: many projects, both Codex and Claude Code, local and SSH machines, and handing work off to step away. Everything else is extras. The hero leads with "Stop juggling tmux sessions." and a before/after whose terminal lines name those four needs.
- **Less is more:** one short sentence per section, no bullet lists or feature essays. Cut before adding.
- **Show, don't list:** every feature gets a real screenshot tightly cropped around it, legible at card size; never a phrase alone and never mockups. Features without a screenshot don't go on the page.
- **Demo:** keep the tab demo simple: three groups, one window, three tasks (fold, split, focus). Its strip mirrors the app's CSS (outline with flares, split pill) and FLIP motion (`useTabMotion`); a coach pointer shows the next task after a pause (clicking a task pill replays it); "Start over" lives in the task row. Status icons match the app: Done is the green circle-check, not the gray circle. It must work on phones (Split button, stacked panes). Test odd sequences; review with fresh eyes if it grows.
- **Placeholders:** download buttons stay `data-placeholder` ("coming soon") until the owner gives a release URL.
- **Screenshots only via `npm run site:shots`:** it uses a temp profile, its own tmux socket, scripted terminals, and fake usage numbers. Never screenshot the installed Harbor or a real profile; a raw capture exposed real spend once.
- **Publishing:** the site is public at https://spsharan.com/Agent-Manager/ although the repo is private; anything under `site/` that reaches `main` is published. Verify at desktop and phone widths (no errors, no horizontal scroll) before pushing, then confirm the Pages run and the live page.
