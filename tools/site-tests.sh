#!/usr/bin/env bash
# Runs the site tests from the joined tree: on a web PR only those its files reach (tools/site-picks.mjs), otherwise every test.
# Usage: tools/site-tests.sh <this repo's dir> [<file with the PR's changed paths>]. No list, or a picker that fails, means every test: a failure never shrinks the run.
set -uo pipefail
here="$1"; list="${2:-}"
# Why (6 Nov 2026, owner: "it's too verbose. I want only the summary"): tools/site-test-reporter.mjs prints the summary and each failure, not a line per passing test.
report="--test-reporter=$(cd "$here" && pwd)/tools/site-test-reporter.mjs"
# Why (6 Nov 2026, owner: "Try 6 at a time (Recommended)"): node runs cpus-1 = 3 files at once on the 4-vCPU runner; the browser walks wait on pages, so more at once fills the idle time. Measured on web#465 (wide runs, 3 before and 3 after).
conc="--test-concurrency=${SITE_TEST_CONCURRENCY:-6}"
every() { exec node --test "$conc" "$report" 'test/**/*.test.js'; }   # this repo's own run: jobadabra's check tools are for desktop and the extension
[ -s "$list" ] || every
picks="$(node "$here/tools/site-picks.mjs" "$list")" || every
[ -n "$picks" ] || { echo 'site-tests: this PR reaches no site test'; exit 0; }
mapfile -t files <<<"$picks"
exec node --test "$conc" "$report" "${files[@]}"
