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
3. Push and open a PR (`gh pr create`). The template asks what changed and how you verified it. CI runs the build and unit tests on macOS; a maintainer reviews and squash-merges.

Keep the repo public-safe: no credentials, real hostnames, usernames, home paths, usage numbers, or conversation contents in code, tests, docs, screenshots, or commit messages. Use placeholders such as `devbox`, `alice`, and `example.invalid`.

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

Maintainers release by bumping `version` in `package.json` (and `package-lock.json`) in a PR, then pushing an annotated tag `v<version>` on the merged commit. The Release workflow builds the Apple Silicon app on GitHub Actions and publishes a GitHub Release with a `.dmg`, a `.zip`, and SHA-256 checksums. Never move or delete a published tag.
