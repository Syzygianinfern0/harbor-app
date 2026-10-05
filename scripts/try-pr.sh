#!/usr/bin/env bash
# Installs a pull request's preview build as ~/Applications/Harbor Preview.app and opens it.
# Usage: scripts/try-pr.sh <PR number>
#
# Harbor Preview has its own profile (~/Library/Application Support/Harbor Preview) and tmux socket (harbor-preview) and
# never updates itself, so it runs beside your Harbor without touching its chats. Each run replaces the previous preview.
# Needs an Apple Silicon Mac and the GitHub CLI (`gh auth login`); the build comes from the PR's Preview workflow run.
set -euo pipefail

pr=${1:-}
[[ $pr =~ ^[0-9]+$ ]] || { echo "Usage: scripts/try-pr.sh <PR number>" >&2; exit 2; }
repo=Syzygianinfern0/harbor-app
app_name="Harbor Preview"
dest="$HOME/Applications/$app_name.app"

command -v gh >/dev/null || { echo "Install the GitHub CLI first: brew install gh && gh auth login" >&2; exit 1; }
[[ $(uname -m) == arm64 ]] || { echo "Harbor builds are Apple Silicon only." >&2; exit 1; }

sha=$(gh pr view "$pr" -R "$repo" --json headRefOid -q .headRefOid)
run=$(gh run list -R "$repo" -w preview.yml -c "$sha" -s success -L 1 --json databaseId -q '.[0].databaseId // empty')
if [[ -z $run ]]; then
  echo "No finished preview build for PR #$pr at ${sha:0:7}." >&2
  echo "It may still be building (gh run list -R $repo -w preview.yml -c $sha), have failed, or the PR may not touch the app." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "Downloading the preview of PR #$pr (${sha:0:7})…"
gh run download "$run" -R "$repo" -n "harbor-preview-pr$pr" -D "$work"
zips=("$work"/*.zip)
[[ -f ${zips[0]} ]] || { echo "The download has no app zip." >&2; exit 1; }
ditto -x -k "${zips[0]}" "$work/app"
codesign --verify --deep --strict "$work/app/$app_name.app"

# Quit a running preview gracefully first. Matches only the exact "Harbor Preview" process, never Harbor itself.
pids=$(pgrep -x "$app_name" || true)
if [[ -n $pids ]]; then
  echo "Quitting the running $app_name…"
  kill -TERM $pids
  for _ in $(seq 50); do pgrep -x "$app_name" >/dev/null || break; sleep 0.2; done
  if pgrep -x "$app_name" >/dev/null; then echo "$app_name is still running; quit it and run this again." >&2; exit 1; fi
fi

mkdir -p "$HOME/Applications"
rm -rf "$dest"
ditto "$work/app/$app_name.app" "$dest"
xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
open "$dest"
echo "Opened $app_name $(defaults read "$dest/Contents/Info" CFBundleShortVersionString) from PR #$pr."
