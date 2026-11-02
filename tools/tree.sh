#!/usr/bin/env bash
# CI: lays the public jobadabra repo's tree over the workspace, then this repo's files over that, so a moved workflow runs exactly as it did in the public repo.
# This repo is checked out at .private/ (actions/checkout with path: .private). Usage: .private/tools/tree.sh [--full] [--ref <branch-or-sha>]
# Sets PUBLIC_SHA (the public commit under test) for later steps. The public repo is public: no token needed.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/repos.sh"   # JOBADABRA_PUBLIC_REPO, JOBADABRA_WEB_REPO
depth="--depth 1"; ref="main"
while [ $# -gt 0 ]; do case "$1" in --full) depth="--tags";; --ref) ref="${2:-main}"; shift;; *) echo "tree.sh: unknown $1" >&2; exit 2;; esac; shift; done
[ -n "$ref" ] || ref="main"
cd "${GITHUB_WORKSPACE:-.}"
git init -q .
git remote add origin "${PUBLIC_REPO_URL:-https://github.com/$JOBADABRA_PUBLIC_REPO.git}"
# shellcheck disable=SC2086
if ! git fetch -q $depth origin "$ref"; then
  # 26 Oct 2026: a draw pinned to "944a661" died here on "couldn't find remote ref"; GitHub fetches a commit only by its full sha.
  if [[ "$ref" =~ ^[0-9a-f]{4,39}$ ]]; then echo "tree.sh: '$ref' is a short sha: pass the full 40-character sha (git rev-parse $ref)" >&2; fi
  exit 128
fi
git checkout -q -f FETCH_HEAD
# Until the public PR that moves the shared tables public (branch site-private-repo-move) is merged, main lacks files the site imports: use that branch. A merged and deleted branch ends this by itself.
# shellcheck disable=SC2086
if [ "$ref" = main ] && [ ! -f desktop/e2e/lib/applying-status.mjs ] && git fetch -q $depth origin site-private-repo-move 2>/dev/null; then
  git checkout -q -f FETCH_HEAD; ref="site-private-repo-move, main lacks the moved tables"
fi
"$(dirname "${BASH_SOURCE[0]}")/compat-app-core.sh" .   # the public repo is mid-move: see that file
echo '.private/' >> .git/info/exclude
.private/tools/lay-private.sh .private .   # the folder map: .private/tools/layout-map.txt
# tests that list files with `git ls-files` must see this repo's files too
(cd "." && git ls-files -o --exclude-standard -z | xargs -0 -n 500 git add -N --)
sha="$(git rev-parse HEAD)"
echo "PUBLIC_SHA=$sha" >> "${GITHUB_ENV:-/dev/null}"
echo "tree: jobadabra@${sha:0:9} ($ref) + $(git -C .private rev-parse --short HEAD) of jobadabra-web"
