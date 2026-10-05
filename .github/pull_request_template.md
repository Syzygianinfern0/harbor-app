## Risk level

<!-- Keep one; see "Merging" in AGENTS.md. When unsure, pick the higher level. -->
- Low: docs, tests, or refactors with no change in behavior
- App: a change users can see or feel, or `site/`
- High risk: updater or release, workflows, dependencies, saved data formats, tmux attach/detach

## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:e2e` specs: <!-- which ones, or "not needed" and why -->
- [ ] UI checked by eye (screenshots below), or no UI change
- [ ] Real Codex / Claude / SSH checks: <!-- what ran, or "skipped" -->

## How to try it

<!-- App and High risk: `scripts/try-pr.sh <this PR>` installs Harbor Preview. List the steps a tester should follow and what they should see. -->

## Screenshots

<!-- For UI changes. Use a sandbox profile (`npm run dev:sandbox`); no real chats, hostnames, or usage numbers. -->
