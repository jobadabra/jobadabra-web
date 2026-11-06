#!/usr/bin/env bash
# Lays this repo's files over a public tree at the paths the code expects (tools/layout-map.txt moves the tidy folders back to their joined-tree names).
# Usage: tools/lay-private.sh <this repo's dir> <tree dir> [extra rsync excludes...]. Used by overlay.sh, tree.sh and hero.sh: one place knows the map.
set -euo pipefail
# Why (6 Nov 2026, gi): --checksum, because rsync's default check (size + time) skipped an edit that kept the size (0.6 -> 0.9 in api/employers.js), so a site test ran green on the old code.
src="${1:?usage: lay-private.sh <repo dir> <tree dir>}"; dst="${2:?usage: lay-private.sh <repo dir> <tree dir>}"; shift 2
map="$(dirname "${BASH_SOURCE[0]}")/layout-map.txt"
base=(--exclude '.git' --exclude '.overlay/' --exclude '.private/' --exclude 'node_modules/' --exclude '.gitignore' --exclude 'README.md' --exclude 'CLAUDE.md' --exclude 'AGENTS.md' --exclude '.claude/' --exclude '.public-*' "$@")
pairs=(); while read -r from to; do case "$from" in ''|'#'*) continue;; esac; pairs+=("$from $to"); done < "$map"
skip=(); for pair in "${pairs[@]}"; do skip+=(--exclude "/${pair%% *}"); done
rsync -a --checksum "${base[@]}" "${skip[@]}" "$src"/ "$dst"/
for pair in "${pairs[@]}"; do
  from="${pair%% *}"; to="${pair##* }"; inner=()
  for other in "${pairs[@]}"; do o="${other%% *}"; [ "$o" != "$from" ] && case "$o" in "$from"/*) inner+=(--exclude "/${o#"$from"/}");; esac; done
  if [ -d "$src/$from" ]; then mkdir -p "$dst/$to"; rsync -a --checksum "${base[@]}" ${inner[@]+"${inner[@]}"} "$src/$from"/ "$dst/$to"/; fi   # not a bare && list: its status would be the script's exit when a mapped folder is absent
done
