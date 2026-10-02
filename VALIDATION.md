# Validating changes

What to run before opening a pull request. Record what you ran, and what you skipped, in the PR description; that is the validation record.

## Every application change

```sh
npm run build        # TypeScript check + production renderer and Electron bundles
npm test             # unit/integration tests, including the Python bridge (tests/bridge_test.py)
git diff --check
```

`npm test` starts real tmux sessions on private sockets and removes them afterwards; it needs tmux and python3 but no agents or network. CI runs the same build and tests on macOS for every pull request.

Documentation-only changes need a read-through and `git diff --check`, not a rebuild.

## UI changes

Build first, then run the Electron specs that cover the area you touched (all of them for broad changes):

```sh
npm run build
npm run test:e2e                              # everything
npx playwright test tests/tab-groups.spec.ts  # one spec
```

Each spec launches Harbor with a temporary `HARBOR_DATA_DIR` profile. Also look at the result yourself in `npm run dev:sandbox` and attach screenshots to the PR. Screenshots must not show real chats, hostnames, paths, or usage numbers.

Known issue: the `control letters…` Command-W case in `workspace.spec.ts` fails on some machines (`terminate` not received). Note it if you see it; don't let it hide new failures.

## Real agents and SSH (opt-in)

When a change touches launching, resuming, status, history, usage, or anything over SSH, also run against real tools:

```sh
HARBOR_TEST_AGENTS=1 HARBOR_TEST_SSH=<your ssh alias> npm test
HARBOR_TEST_AGENTS=1 HARBOR_TEST_SSH=<your ssh alias> npm run test:e2e
```

`HARBOR_TEST_AGENTS=1` starts real Codex and Claude Code chats with short echo-only prompts in throwaway directories. `HARBOR_TEST_SSH` repeats the host-dependent tests on that alias, which needs non-interactive SSH, tmux 3.2+, and Python 3.8+. Remote test folders are created under `~/harbor-smoke-test-*` and removed where the test can.

## Packaged app

For packaging, signing, or Electron upgrades, build the real bundle and point the UI specs at it:

```sh
npm run package
codesign --verify --deep --strict release/mac-arm64/Harbor.app
HARBOR_TEST_APP="$PWD/release/mac-arm64/Harbor.app/Contents/MacOS/Harbor" npm run test:e2e
```

## Self-update

Changes to `src/desktop/appUpdater*.ts`, `scripts/update-manifest.mjs`, packaging, or `site/install.sh` need a real update, not just unit tests. Build two release-channel zips (`HARBOR_RELEASE_BUILD=1 npm run build`, then `npx electron-builder --mac zip --arm64 -c.extraMetadata.version=<old> -c.directories.output=<dir>` for an older and a newer version), sign a manifest for the newer one with `scripts/update-manifest.mjs http://127.0.0.1:<port>` using a throwaway ed25519 key, serve it locally, and run the older app from a scratch folder with `HARBOR_UPDATE_FEED`, `HARBOR_UPDATE_PUBLIC_KEY` (the throwaway key's PEM), `HARBOR_DATA_DIR` and `HARBOR_TMUX_SOCKET` set. Check both **Restart to update** (swaps and relaunches) and install-on-quit (swaps without relaunching), the version of the bundle on disk, `update-install.log`, and the rollback copy.

## Test environment variables

| Variable | Effect |
| --- | --- |
| `HARBOR_DATA_DIR` | Profile directory instead of `~/Library/Application Support/Harbor`. |
| `HARBOR_TMUX_SOCKET` | tmux socket name instead of `harbor` (`tmux -L <name>`). |
| `HARBOR_TEST_APP` | Run the UI specs against a packaged app binary instead of the dev build. |
| `HARBOR_TEST_AGENTS` | `1` enables real Codex/Claude tests. |
| `HARBOR_TEST_SSH` | SSH alias for remote tests. |
| `HARBOR_UPDATE_FEED` | Update manifest URL for a release build (testing); signatures are still required. |
| `HARBOR_UPDATE_PUBLIC_KEY` | Verify update manifests with this PEM public key instead of the release key (testing). |

Hand-written `sessions.json` fixtures must pass the engine's index check; the rules are in `AGENTS.md`.
