#!/usr/bin/env bash
# Runs, inside the joined tree, (1) the public repo's tests that read site files (they skip in the public repo, where site/ is absent) and (2) the tests that live in this repo.
# A public test joins by using tests/site_private.py (python) or desktop/test/site-private.js (node); three node files that read site/ without it are named below.
# Usage: tools/site-guards.sh <tree> [<this-repo-dir>]
set -euo pipefail
tree="${1:-.}"; priv="${2:-$tree}"
priv="$(cd "$priv" && pwd)"
export SITE_REPO_DIR="$priv"   # tests that must read only this repo's own files (tests/test_site_workflow_pipefail.py)
cd "$tree"
status=0
# A test of this repo at the path of a public test REPLACES it in the joined tree and then runs against both repos' files (24 Oct 2026: tests/test_workflow_pipefail.py hid the public one and failed on its workflows). Same path = fail.
public_tree="$PWD"
# Why (layout 3/3, 2 Nov 2026): this repo keeps its tests at test/python and test/media; the joined tree has them at tests/ and desktop/test (tools/layout-map.txt), so the path to compare with public's is the joined one.
joined() { awk -v f="$1" '$0 !~ /^#/ && NF == 2 && index(f, $1 "/") == 1 && length($1) > best { best = length($1); out = $2 substr(f, length($1) + 1) } END { print best ? out : f }' "$priv/tools/layout-map.txt"; }
shadowed="$(cd "$priv" && git ls-files test 2>/dev/null | while read -r file; do j="$(joined "$file")"; if git -C "$public_tree" cat-file -e "HEAD:$j" 2>/dev/null; then echo "$j"; fi; done)"
if [ -n "$shadowed" ]; then echo "::error::these tests of this repo have the path of a public test and would replace it (rename them site_*): $shadowed"; status=1; fi
# Names are split by repo (public docs/site-test-names.json): every test here carries the site's prefix, so no public test can take its path later.
node "$priv/tools/site-test-names.mjs" "$public_tree" "$priv" || status=1
python_files="$( { grep -l "needs_site" tests/*.py | grep -v site_private.py; (cd "$priv" && ls test/python/test_*.py 2>/dev/null | sed "s#^test/python/#tests/#"); } | sort -u)"
for file in $python_files; do
  python3 -m unittest discover -s tests -p "$(basename "$file")" || status=1
done
cd desktop
[ -d node_modules ] || ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --silent
node scripts/stage.mjs >/dev/null
node_files="$( { grep -l "site-private.js" test/*.test.js | grep -v '^test/site-private'; (cd "$priv/test/media" && ls *.test.js 2>/dev/null | sed "s#^#test/#"); echo test/plan.test.js; echo test/no-credit-words.test.js; echo test/no-question-mark.test.js; echo test/cost-labels.test.js; } | sort -u | tr '\n' ' ')"
# A pull request that changes no media file skips the media tests and their ffmpeg/Electron installs (tests.yml "Does this PR touch media?",
# 26 Oct 2026: a stalled Ubuntu mirror failed a migration-only PR 4 times). Pushes to main and the daily run always run them, never skipped.
if [ "${MEDIA_TOOLS:-1}" = 0 ]; then
  skipped="$(printf '%s\n' $node_files | grep '^test/media-' | tr '\n' ' ')"
  node_files="$(printf '%s\n' $node_files | grep -v '^test/media-' | tr '\n' ' ')"
  echo "site-guards: this pull request changes no media file: media tests not run here (main and the daily run run them): $skipped"
fi
# shellcheck disable=SC2086
node --test "--test-reporter=$priv/tools/site-test-reporter.mjs" $node_files || status=1   # summary and failures only (6 Nov 2026, owner: "I want only the summary")
exit $status
