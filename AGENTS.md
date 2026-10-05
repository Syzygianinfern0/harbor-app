# Harbor agent instructions

These rules are shared by everyone working on Harbor and by their coding agents. Human setup is in `CONTRIBUTING.md`; checks are in `VALIDATION.md`.

## Personal instructions

If `AGENTS.local.md` exists in the repository root, read it before starting and follow it. It is gitignored and holds one contributor's own preferences (how hands-off they are, whether to install builds on their Mac, merge rights). Where it conflicts with this file, it wins for that contributor only. Claude Code users may use `CLAUDE.local.md` the same way.

## Ownership

Own each task end to end: investigate, implement, validate, document, commit on a branch, push, and open a pull request. Make reasonable decisions and resolve recoverable failures yourself. Ask only for information or access you cannot get, or for actions outside the task. Report outcomes, verification, and blockers concisely, including anything you skipped.

## Development

- Use Node.js 22.12+ and npm (`npm ci` when dependencies change). Follow `CONTRIBUTING.md` and `VALIDATION.md`; `docs/architecture.md` explains the engine, host adapter and storage.
- For application changes, run `npm run build`, `npm test`, and the relevant `npm run test:e2e` specs (build first). Visually inspect UI changes. Documentation-only changes need document checks, not an app rebuild.
- Never touch real chats. Run the app with `npm run dev:sandbox` (temporary profile, private tmux socket), or set `HARBOR_DATA_DIR` and `HARBOR_TMUX_SOCKET` yourself. Plain `npm run dev` uses your real profile and `tmux -L harbor`. Real CLI/SSH checks are opt-in (`HARBOR_TEST_AGENTS=1`, `HARBOR_TEST_SSH=<your alias>`); say when you skipped them.
- Hand-written `sessions.json` fixtures (for `HARBOR_DATA_DIR` profiles) must pass the engine's index check (`Invalid session index.` in `src/engine/engine.ts`): `version` 1 or 2; each session's `tmuxName` matches `^harbor-[a-f0-9-]+$` (hex only: `harbor-bbbb0`, not `harbor-look0`/`harbor-group0`/`harbor-zzzz1`), `paneId` matches `^%\d+$`, `name`/`cwd`/`group` are strings, `tags` is an array, and `launcher` is `shell`/`codex`/`claude`/`custom`. An invalid index pops a modal "Harbor could not start" dialog on screen and never opens a window, so automation just times out waiting for one. Copy the fixture in `tests/tab-groups.spec.ts`. Shell chats are not listed in the sidebar, so open fixtures through `codex`/`claude` rows.
- When behavior changes, update `docs/user-guide.md` (features, shortcuts, preferences) or `docs/architecture.md` (internals). Keep `README.md` a short front page: only add to it for a headline feature.
- Keep the repository public-safe: no credentials, real hostnames, usernames, home paths, usage numbers, or conversation IDs in code, tests, docs, screenshots, or commit messages. Use `devbox`, `alice`, `example.invalid` and similar placeholders.

## Version control

- `main` is protected: work on a branch (`<topic>` or `<name>/<topic>`), never push to `main` directly. One focused change per pull request.
- Review `git status` and the diff, run `git diff --check`, stage intended files explicitly, and write commit messages in the imperative ("Add …", "Fix …"). Preserve unrelated work; exclude generated output, profiles, credentials, and `work/`.
- Push the branch and open a PR with `gh pr create`, filling in `.github/pull_request_template.md` (risk level, what changed, how it was verified, how to try it, screenshots for UI). CI (build + unit tests) must pass. Merge only as **Merging** below allows; then squash-merge.
- Never rewrite published history or move release tags. Releases are tagged `v<package.json version>` by the maintainer (see `CONTRIBUTING.md` → Releases).

### Merging

Every PR states one risk level. It decides what has to happen before the PR merges:

| Level | Covers | Before merging |
| --- | --- | --- |
| Low | Docs (not `site/`), tests, comments, internal refactors with no change in behavior | CI passes. |
| App | Anything a user can see or feel in the app, and `site/` (it publishes publicly) | CI passes, and a person has tried it and approved: the Harbor Preview build (`scripts/try-pr.sh <PR>`, see `CONTRIBUTING.md`) for the app, or the PR's desktop and phone screenshots for `site/`. |
| High risk | The updater and Release workflow, any workflow or `CODEOWNERS` change, dependencies, `site/install.sh`, saved data formats (`sessions.json`, `preferences.json`), tmux attach/detach and anything else that could lose chats | As App, approved by the owner. After release it stays on Beta for a while before it is promoted. |

When unsure, pick the higher level. For App and High risk PRs, list in the PR the steps a tester should follow and what they should see.

- **Approval** is a GitHub review approval. `CODEOWNERS` decides whose approval counts and keeps High risk paths owner-only; branch protection enforces it.
- **Agents** never merge an App or High risk PR without an explicit go-ahead from a person, in chat or on the PR. Low PRs may be merged after CI only if your personal instructions allow it.
- **Your own PRs:** GitHub doesn't let you approve a PR you opened, including ones your agent opened under your account. Admins may then merge with `--admin`, but only after recording the approval as a PR comment (for example "Tried the preview: tab folding works. Approved."), so the history shows who checked what. Everyone else asks another maintainer to review.

## Installing a build on your own Mac (opt-in)

Do this only when your personal instructions ask for it. It replaces the Harbor you use every day without losing chats.

1. Identify the running bundle and actual profile; the usual installation is `~/Applications/Harbor.app`, with state in `~/Library/Application Support/Harbor/`. Inventory open tabs/panes and local/SSH sessions, including tmux session IDs, pane IDs, and PIDs. Use `tmux -L harbor`, not the default socket. Make sure the update procedure itself survives Harbor quitting.
2. Run `npm run package` and wait for it to finish. Verify `release/mac-arm64/Harbor.app` with `codesign --verify --deep --strict` and smoke-test the packaged app with an isolated profile.
3. Keep a rollback copy of the installed bundle and back up persisted state/preferences. Quit only Harbor gracefully (`kill -TERM <exact Harbor PID>`; never `pkill -f` on Harbor paths), let it finish persisting state, refresh the state backup, then replace the bundle. Quitting detaches clients; chats remain in tmux. Never close chats, kill tmux/agents, or restart active conversations to install an update. Preserve remote connection settings, history, credentials, and exact conversation IDs.
4. Verify the installed signature, version, and matching packaged/installed `app.asar` SHA256, then relaunch the installed path with a clean environment (no inherited `CLAUDE*`/`AI_AGENT`/`TMUX` variables). Confirm the new process, restored tabs/panes, reattached chats, and unchanged tmux pane IDs/PIDs on reachable hosts. Investigate discrepancies; roll back the bundle if launch or reconnection fails, keeping current chat data. Do not claim success from packaging progress alone.

Harbor uses ad-hoc signing (`mac.identity: "-"`); rebuilds may trigger macOS permission prompts. Keep the signing configuration and report any OS interaction required; never promise that permissions persist or change privacy settings silently.

## Landing page (`site/`)

Mechanics are in `docs/landing-page.md`. These are the owner's decisions; keep them unless the owner asks.

- **Pitch:** Harbor replaces the tmux routine (ssh, cd, `tmux new`, start an agent, repeat) for people who do all four at once: many projects, both Codex and Claude Code, local and SSH machines, and handing work off to step away. Everything else is extras. The hero leads with "Stop juggling tmux sessions." and a before/after whose terminal lines name those four needs.
- **Less is more:** one short sentence per section, no bullet lists or feature essays. Cut before adding.
- **Show, don't list:** every feature gets a real screenshot tightly cropped around it, legible at card size; never a phrase alone and never mockups. Features without a screenshot don't go on the page.
- **Demo:** keep the tab demo simple: three groups, one window, three tasks (fold, split, focus). Its strip mirrors the app's CSS (outline with flares, split pill) and FLIP motion (`useTabMotion`); a coach pointer shows the next task after a pause (clicking a task pill replays it); "Start over" lives in the task row. Status icons match the app: Done is the green circle-check, not the gray circle. It must work on phones (Split button, stacked panes). Test odd sequences; review with fresh eyes if it grows.
- **Install:** the `install.sh` one-liner is the default, because it skips the Gatekeeper “Open Anyway” step a downloaded copy needs (Harbor isn't notarized). The nav and hero buttons jump to the install section, which leads with that command; the latest release's `Harbor-arm64.dmg` is only a small link there, with the Open Anyway note. The nav and footer link to the GitHub repo. `site/install.sh` is public and piped into bash: keep it small, readable, and safe to rerun.
- **Screenshots only via `npm run site:shots`:** it uses a temp profile, its own tmux socket, scripted terminals, and fake usage numbers. Never screenshot an installed Harbor or a real profile; a raw capture exposed real spend once.
- **Publishing:** the site is public at https://spsharan.com/harbor-app/; anything under `site/` that reaches `main` is published. Verify at desktop and phone widths (no errors, no horizontal scroll) before merging, then confirm the Pages run and the live page.
