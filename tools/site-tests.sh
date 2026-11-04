#!/usr/bin/env bash
# Runs the site tests from the joined tree: on a web PR only those its files reach (tools/site-picks.mjs), otherwise every test.
# Usage: tools/site-tests.sh <this repo's dir> [<file with the PR's changed paths>]. No list, or a picker that fails, means every test: a failure never shrinks the run.
set -uo pipefail
here="$1"; list="${2:-}"
every() { exec bash tools/check.sh --area site; }
[ -s "$list" ] || every
picks="$(node "$here/tools/site-picks.mjs" "$list")" || every
[ -n "$picks" ] || { echo 'site-tests: this PR reaches no site test'; exit 0; }
mapfile -t files <<<"$picks"
exec node --test "${files[@]}"
