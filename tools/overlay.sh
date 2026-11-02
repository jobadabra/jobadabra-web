#!/usr/bin/env bash
# Builds the full tree this repo is tested and deployed in: the public jobadabra repo (main) with this repo's files laid over it at the same paths.
# Usage: tools/overlay.sh <out-dir> [public-ref]; tools/overlay.sh --sync <out-dir> lays this repo's current files over a built tree again (site-run.sh). The site imports the public repo's validators (../../extension/...), so it only runs inside that tree.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/repos.sh"   # JOBADABRA_PUBLIC_REPO, JOBADABRA_WEB_REPO
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# this repo's files over the tree; tests that list files with `git ls-files` must see them too
lay() {
  "$here/tools/lay-private.sh" "$here" "$1"   # the folder map: tools/layout-map.txt
  (cd "$1" && git ls-files -o --exclude-standard -z | xargs -0 -n 500 git add -N --)
}
if [ "${1:-}" = --sync ]; then lay "${2:?usage: tools/overlay.sh --sync <out-dir>}"; exit 0; fi
out="${1:?usage: tools/overlay.sh <out-dir> [public-ref]}"
ref="${2:-main}"
# never under a running hero.sh/media.sh (tools/overlay-busy.sh)
if pid="$("$here/tools/overlay-busy.sh" "$out")"; then echo "overlay: $out is in use by pid $pid (tools/hero.sh or tools/media.sh): not rebuilt; wait for it to end, or work in another worktree" >&2; exit 3; fi
rm -rf "$out"
git clone --quiet --depth 1 --branch "$ref" "${PUBLIC_REPO_URL:-https://github.com/$JOBADABRA_PUBLIC_REPO.git}" "$out"
"$here/tools/compat-app-core.sh" "$out"   # the public repo is mid-move: see that file
lay "$out"
echo "overlay: $(git -C "$out" rev-parse --short HEAD) of jobadabra/$ref + $(git -C "$here" rev-parse --short HEAD 2>/dev/null || echo local) of jobadabra-web -> $out"
