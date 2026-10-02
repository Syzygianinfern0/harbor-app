#!/bin/bash
# Installs or updates Harbor from the latest GitHub release:
#   curl -fsSL https://spsharan.com/harbor-app/install.sh | bash
# Set HARBOR_INSTALL_DIR to choose the folder (default: where Harbor already is, else /Applications or ~/Applications).
# Source: https://github.com/Syzygianinfern0/harbor-app/blob/main/site/install.sh
set -euo pipefail

main() {
  local repo="Syzygianinfern0/harbor-app" dest="${HARBOR_INSTALL_DIR:-}" tmp manifest version url sha size app
  say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
  die() { printf 'Harbor install failed: %s\n' "$*" >&2; exit 1; }

  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || die "Harbor needs macOS on Apple Silicon."
  if [ -z "$dest" ]; then
    if [ -d "$HOME/Applications/Harbor.app" ]; then dest="$HOME/Applications"
    elif [ -d /Applications/Harbor.app ] || [ -w /Applications ]; then dest=/Applications
    else dest="$HOME/Applications"; fi
  fi
  mkdir -p "$dest"
  [ -w "$dest" ] || die "$dest is not writable. Run with HARBOR_INSTALL_DIR=\"\$HOME/Applications\"."
  if pgrep -f "$dest/Harbor.app/Contents/MacOS/Harbor" >/dev/null 2>&1; then
    die "Harbor is running. Quit it first (your chats keep running in tmux), then run this again."
  fi

  tmp="$(mktemp -d)"
  # Expand now: $tmp is local to main and gone by the time the EXIT trap runs.
  trap "rm -rf '$tmp'" EXIT
  say "Finding the latest Harbor release"
  curl -fsSL "https://github.com/$repo/releases/latest/download/harbor-update.json" -o "$tmp/manifest.json" || die "could not reach GitHub releases."
  field() { /usr/bin/plutil -extract "$1" raw -o - "$tmp/manifest.json"; }
  version="$(field version)"; url="$(field url)"; sha="$(field sha256)"; size="$(field size)"
  case "$url" in "https://github.com/$repo/releases/download/"*) ;; *) die "unexpected download address: $url";; esac

  say "Downloading Harbor $version ($((size / 1048576)) MB)"
  curl -fL --progress-bar "$url" -o "$tmp/Harbor.zip" || die "download failed."
  [ "$(shasum -a 256 "$tmp/Harbor.zip" | cut -d' ' -f1)" = "$sha" ] || die "the download did not match its checksum."
  /usr/bin/ditto -x -k "$tmp/Harbor.zip" "$tmp/unpacked"
  app="$tmp/unpacked/Harbor.app"
  /usr/bin/codesign --verify --deep --strict "$app" || die "the app failed its signature check."

  if [ -d "$dest/Harbor.app" ]; then
    say "Replacing the Harbor in $dest"
    mv "$dest/Harbor.app" "$tmp/Harbor-previous.app"
  fi
  mv "$app" "$dest/Harbor.app" || { [ -d "$tmp/Harbor-previous.app" ] && mv "$tmp/Harbor-previous.app" "$dest/Harbor.app"; die "could not move Harbor into $dest."; }
  say "Installed Harbor $version in $dest. It updates itself from now on."

  command -v tmux >/dev/null 2>&1 || say "Harbor needs tmux on this Mac: brew install tmux"
  open "$dest/Harbor.app"
}

main "$@"
