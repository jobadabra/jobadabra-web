#!/usr/bin/env bash
# The ONE command that makes the site's screenshots and videos (owner, 21 Oct 2026: "Local only, one command"; CI no longer records them): lays public
# origin/main under this repo, records the app (demo mode, nurse persona) and the real extension on this Mac, checks every piece, then
# tools/media-refresh.sh commits the files the site already shows on branch media-refresh and opens or updates its PR. The owner merges it.
#   tools/media.sh [--background] [--check] [--persona <folder>] [pieces...]     pieces: hero extension-fill apply-split stills snips (none = all)
#   --background  runs detached, logs to ~/.cache/jobadabra-media/media-<time>.log, prints that path and returns
#   --check       only says whether the screens changed since the last refresh (changed|same), records nothing
# MEDIA_REF=<branch> runs this repo's tools from a branch (to try a change before it is merged). Runs in its own worktree (default ~/jobadabra-web-media-run, MEDIA_RUN_DIR) so no checkout changes branch. Demo data only, no AI (the director's
# plans are committed), nothing of the owner's app. Guard: tests/test_site_media_refresh.py.
set -euo pipefail
trap 'echo "media: FAILED at line $LINENO (see the lines above)" >&2' ERR   # a silent stop is never success
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache="$HOME/.cache/jobadabra-media"; mkdir -p "$cache"
run="${MEDIA_RUN_DIR:-$HOME/jobadabra-site-media-run}"
background=no; check=no; args=()
while [ $# -gt 0 ]; do case "$1" in
  --background) background=yes;; --check) check=yes;;
  --persona) args+=("$1" "$(cd "$(dirname "${2:?--persona needs a folder}")" && pwd)/$(basename "$2")"); shift;;
  *) args+=("$1");; esac; shift; done

if [ "$background" = yes ]; then
  log="$cache/media-$(date +%Y%m%d-%H%M%S).log"
  nohup bash "$here/tools/media.sh" ${args[@]+"${args[@]}"} > "$log" 2>&1 &
  echo "media: running in the background (pid $!), log: $log"
  echo "media: follow it with: tail -n 0 -F $log | grep --line-buffered -E '^media'"
  exit 0
fi

# 1. the run worktree at this repo's ${MEDIA_REF:-origin/main} (a branch's own edits to the recorder come with a push; the run never uses a stale checkout)
git -C "$here" fetch -q origin
if [ -d "$run/.git" ] || [ -f "$run/.git" ]; then git -C "$run" checkout -q -f --detach "${MEDIA_REF:-origin/main}"; git -C "$run" clean -fdq -e .overlay -e node_modules
else git -C "$here" worktree add -q --detach "$run" "${MEDIA_REF:-origin/main}"; fi
cd "$run"

# 2. the public tree at origin/main with this repo laid over it
tools/overlay.sh .overlay >&2
echo $$ > .overlay/.git/in-use; trap 'rm -f "$run/.overlay/.git/in-use"' EXIT   # nothing rebuilds the overlay under this run (tools/overlay-busy.sh)
tree="$run/.overlay"; sha="$(git -C "$tree" rev-parse HEAD)"
echo "media: public ${sha:0:9} + site $(git rev-parse --short HEAD)"
if [ "$check" = yes ]; then tools/public-watch.sh "$tree" media $(cat tools/media-paths.txt); git checkout -q -- .public-media 2>/dev/null || rm -f .public-media; exit 0; fi   # a look must not move the record

# 3. the encoders (the plain Homebrew ffmpeg has no libwebp; ffmpeg-full has it)
if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE ' libwebp '; then
  echo "media: ffmpeg has no libwebp encoder: brew install ffmpeg-full, then put \$(brew --prefix ffmpeg-full)/bin first in PATH"; exit 1
fi
for encoder in libx264 libwebp; do ffmpeg -hide_banner -encoders | grep -qE " $encoder " || { echo "media: ffmpeg lacks $encoder"; exit 1; }; done

# 4. the app's and the harness's packages (cached by lock file; an APFS clone makes the copy instant)
for dir in desktop desktop/e2e; do
  key="$(shasum -a 256 "$tree/$dir/package-lock.json" | cut -c1-16)"; store="$cache/modules-$(echo "$dir" | tr / -)-$key"
  if [ -d "$store" ]; then cp -cR "$store" "$tree/$dir/node_modules"
  else
    echo "media: npm ci in $dir (first time for this lock file)"
    (cd "$tree/$dir" && { npm ci || npm install; } >/dev/null) && cp -cR "$tree/$dir/node_modules" "$store"
  fi
done
(cd "$tree/desktop/e2e" && npx playwright-core install chromium >/dev/null)

# 5. record, render, check (one heavy run at a time on this Mac)
node "$here/ops/media/prune.mjs" "$cache"   # the cache keeps the newest few of each kind (media/prune.mjs)
out="$cache/set-$(date +%Y%m%d-%H%M%S)"; start=$SECONDS
lock="${MEDIA_HEAVY_LOCK:-$HOME/jobadabra/tools/heavy-lock.sh}"
record=(node ../media/media.mjs --out "$out" ${args[@]+"${args[@]}"})
echo "media: recording ${args[*]:-all pieces} into $out"
if [ -f "$lock" ]; then (cd "$tree/desktop" && bash "$lock" product-media "${record[@]}"); else (cd "$tree/desktop" && "${record[@]}"); fi
echo "media: recorded and checked in $((SECONDS - start)) s"

# 6. the refresh PR
tools/media-refresh.sh "$out" "$tree" "$sha"
pr="$(gh pr list --head media-refresh --state open --json url --jq '.[0].url' 2>/dev/null || true)"
echo "media: done in $((SECONDS - start)) s. Refresh PR: ${pr:-none (nothing changed)}"
