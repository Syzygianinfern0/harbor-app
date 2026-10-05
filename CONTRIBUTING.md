# Contributing to Harbor

Thanks for helping. Harbor is young, so expect things to move; open an issue before large changes.

## Setup

You need macOS on Apple Silicon, Node.js 22.12+ (`.nvmrc` pins 22), npm, tmux 3.2+, and Python 3.8+. Codex and Claude Code are optional, needed only for live agent checks.

```sh
brew install node tmux
git clone https://github.com/Syzygianinfern0/harbor-app.git
cd harbor-app
npm ci
npm run dev:sandbox
```

`npm run dev:sandbox` runs Harbor with its own profile in `.sandbox/profile` and its own tmux socket (`harbor-dev`), so it never sees the chats in your installed Harbor. Plain `npm run dev` uses your real profile and the real `tmux -L harbor` socket; avoid it unless you mean to. Engine, main, and preload changes need a dev app restart; renderer changes reload live.

## Making a change

1. Branch from `main` (`git switch -c <topic>`). `main` is protected; changes land through pull requests.
2. Make the change and run the checks in [VALIDATION.md](VALIDATION.md): at least `npm run build` and `npm test`, plus the relevant `npm run test:e2e` specs for UI changes.
3. Push and open a PR (`gh pr create`). The template asks what changed and how you verified it. CI runs the build and unit tests on macOS. Depending on the PR's risk level, a maintainer tries it and approves before it is squash-merged; the levels are in [AGENTS.md](AGENTS.md#merging).

Keep the repo public-safe: no credentials, real hostnames, usernames, home paths, usage numbers, or conversation contents in code, tests, docs, screenshots, or commit messages. Use placeholders such as `devbox`, `alice`, and `example.invalid`.

## Trying a pull request

Each pull request that touches the app is built as **Harbor Preview**, so you can try someone else's change, and they can try yours, without building it. On an Apple Silicon Mac with the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`), from a Harbor checkout:

```sh
scripts/try-pr.sh 42
```

It downloads the newest preview build of PR #42, checks its signature, installs it as `~/Applications/Harbor Preview.app` (replacing any earlier preview) and opens it. The build summary on the PR's Preview check shows the same command and the commit it was built from; push again and the next run rebuilds it. Builds are kept for 14 days.

Harbor Preview is a separate app that runs beside your Harbor. It has its own profile (`~/Library/Application Support/Harbor Preview`) and tmux socket (`tmux -L harbor-preview`, on SSH hosts too), so it never sees or touches your chats, and it never updates itself. It starts with an empty profile, and its chats and projects carry over from one preview to the next. To start over, quit it and delete that folder. To test against existing data, copy a throwaway profile there, never your real one.

macOS may ask for permissions (such as notifications) again for each preview, because each build has a new ad-hoc signature. A preview runs the pull request's code on your Mac, so read the diff first when it comes from someone you don't know.

## Working with coding agents

Most of Harbor is written with Codex and Claude Code, and you're welcome to do the same. Agents read [AGENTS.md](AGENTS.md), which holds the shared rules: branch and PR workflow, test expectations, fixture rules, and landing page decisions.

For your own preferences (how much autonomy the agent gets, whether it may merge, whether it should install builds on your Mac), create `AGENTS.local.md` in the repo root. It's gitignored, and `AGENTS.md` tells agents to read it first. Claude Code also reads `CLAUDE.local.md` natively. For example:

```md
# My preferences
- I'm hands-off: finish each task through an open PR without asking for routine approval.
- After a change is validated, install it on my Mac following "Installing a build on your own Mac" in AGENTS.md.
```

## Project layout

- `src/engine/` — the Node engine: tmux, SSH, persistence, agent status and history. No Electron or React.
- `src/desktop/` — Electron main process and preload.
- `src/renderer/` — the React UI.
- `src/bridge/harbor_bridge.py` — the Python host adapter (standard library only), deployed to each host under `~/.local/share/harbor/`.
- `src/shared/` — types and pure logic shared by the engine and UI (status, tabs, splits, notes).
- `tests/` — `*.test.ts` unit/integration tests (`npm test`) and `*.spec.ts` Electron UI tests (`npm run test:e2e`).
- `site/` — the landing page, published to GitHub Pages from `main`.

## Releases

Maintainers release by bumping `version` in `package.json` (and `package-lock.json`) in a PR, then pushing an annotated tag `v<version>` on the merged commit. The Release workflow builds the Apple Silicon app on GitHub Actions and publishes a GitHub prerelease with `Harbor-arm64.dmg`, the versioned `.zip`, SHA-256 checksums, and `harbor-update.json`, the signed manifest that installed copies update from (see [docs/architecture.md](docs/architecture.md#self-update)). A new release first reaches only installs on the **Beta** update channel (Preferences → Updates); collaborators should use Beta. Once it has held up in daily use, promote it to everyone on Stable, which is also what new installs and the download links get:

```sh
gh release edit v<version> --prerelease=false --latest
```

Beta installs update as soon as the release is published, so only tag commits you would install yourself. Only repository admins can create `v*` tags, and nobody can move or delete one once it is published.

The manifest is signed with the `HARBOR_UPDATE_SIGNING_KEY` repository secret. Its public half is compiled into Harbor, so losing the private key means shipping a new key in a release that users must install by hand.
