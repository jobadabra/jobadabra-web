#!/usr/bin/env bash
# Says whether a tools/hero.sh or tools/media.sh run still uses an overlay tree (its pid in <tree>/.git/in-use), so nothing rebuilds the tree under it
# (25 Oct 2026: a media test run with SITE_OVERLAY_FRESH=1 rebuilt the overlay a hero render was using; its preview lost playwright-core).
# Usage: tools/overlay-busy.sh <tree>: prints the pid and exits 0 when in use, exits 1 when free. Guard: test/unit/website/overlay-in-use.test.js.
pid="$(cat "${1:?usage: tools/overlay-busy.sh <tree>}/.git/in-use" 2>/dev/null)" || exit 1
[ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && { echo "$pid"; exit 0; }
exit 1
