#!/usr/bin/env bash
# Redo or improve the landing hero's four clips from a worktree, with its local edits (owner, 24 Oct 2026: "a repeatable way to redo/improve this hero
# video ... the feedback mechanism permanently available"). Skill: .claude/skills/redo-site-hero-video. Guard: test/unit/website/hero-redo.test.js.
#   tools/hero.sh [pieces...]          record (default: all four), contact sheets, the in-hero side-by-side (today's live hero | this one), opened
#   tools/hero.sh --words <set dir> [pieces...]  words only (captions, tags, cards): redraw that set's kept recordings, no new recording
#   tools/hero.sh --place <set dir>    copy a set's hero files into website/public/media (after the owner's yes), with their sizes
#   tools/hero.sh --preview [set dir]  only the side-by-side (no set: the files already in website/public/media)
# Pieces: hero-onboarding (Set up), hero (Find), hero-fill (Apply), hero-track (Track); their steps are media/scenes.mjs. Demo data only, no AI,
# a hidden window: nothing of the owner's app. Sets go to ~/.cache/jobadabra-media/hero-<time>. tools/media.sh (origin/main) keeps them fresh later.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/repos.sh"   # JOBADABRA_PUBLIC_REPO, JOBADABRA_WEB_REPO
trap 'echo "hero: FAILED at line $LINENO (see the lines above)" >&2' ERR
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
cache="$HOME/.cache/jobadabra-media"; mkdir -p "$cache"
HERO=(hero-onboarding hero hero-fill hero-track)
words=()   # --words <set dir>: redraw that set's kept recordings with the scenes' current words (media/words.mjs; owner, 24 Oct 2026: "you should have rerecord just one 1/4 clips")
if [ "${1:-}" = --words ]; then words=(--words "${2:?--words needs a set dir made by tools/hero.sh (it keeps its recordings)}"); shift 2; fi

if [ "${1:-}" = --place ]; then
  set_dir="${2:?--place needs a set dir}"
  for piece in "${HERO[@]}"; do
    # a phone copy of another width replaces the old one (round 9: 720 -> 1080), and the captions the phone copy leaves out go beside it (.vtt)
    if compgen -G "$set_dir/$piece-[0-9]*.mp4" >/dev/null; then git rm -q --ignore-unmatch -- "website/public/media/$piece-[0-9]*.mp4" "website/public/media/$piece-[0-9]*-poster.jpg"; fi
    git rm -q --ignore-unmatch -- "website/public/media/$piece.webm"   # MP4 only since 25 Oct 2026 (media/encode.mjs encodeVideo)
    for file in "$set_dir/$piece".{mp4,vtt} "$set_dir/$piece"-poster.jpg "$set_dir/$piece"-[0-9]*.mp4 "$set_dir/$piece"-[0-9]*-poster.jpg; do
      [ -f "$file" ] && cp "$file" website/public/media/
    done
  done
  ls -l website/public/media/hero* | awk '{printf "hero: %-32s %5.0f KB\n", $9, $5/1024}'
  echo "hero: placed. Next: the site tests (tools/site-run.sh node --test \"test/**/*.test.js\"), then ship."
  exit 0
fi

# the joined tree with this worktree's edits. The app recorded is public main (or HERO_PUBLIC_REF, e.g. a public PR branch that redesigns a screen the
# hero shows): rebuilt when that commit moved (round 2: a stale overlay would have recorded the old setup step), then the hero's folders are synced.
ref="${HERO_PUBLIC_REF:-main}"
want="$(git ls-remote "${PUBLIC_REPO_URL:-https://github.com/$JOBADABRA_PUBLIC_REPO.git}" "refs/heads/$ref" 2>/dev/null | cut -c1-40 || true)"
have="$(git -C .overlay rev-parse HEAD 2>/dev/null || true)"
if [ -z "$have" ] || { [ -n "$want" ] && [ "$want" != "$have" ]; }; then
  echo "hero: recording the app at jobadabra/$ref ${want:0:7} (the overlay had ${have:-none}): rebuilding .overlay" >&2
  tools/overlay.sh .overlay "$ref" >&2
fi
rsync -a ops/media/ .overlay/media/ && rsync -a --exclude next website/ .overlay/web/ && rsync -a tools/ .overlay/tools/
echo $$ > .overlay/.git/in-use; trap 'rm -f .overlay/.git/in-use' EXIT   # nothing rebuilds the overlay under this run (tools/overlay-busy.sh)
for dir in desktop desktop/e2e; do   # packages, cached by lock file as tools/media.sh does
  [ -d ".overlay/$dir/node_modules" ] && continue
  key="$(shasum -a 256 ".overlay/$dir/package-lock.json" | cut -c1-16)"; store="$cache/modules-$(echo "$dir" | tr / -)-$key"
  if [ -d "$store" ]; then cp -cR "$store" ".overlay/$dir/node_modules"; else (cd ".overlay/$dir" && npm ci >/dev/null) && cp -cR ".overlay/$dir/node_modules" "$store"; fi
done
# the browser the extension take drives, as tools/media.sh does: a fresh Mac runner has none, and a disk cleanup can remove it (25 Oct 2026)
(cd .overlay/desktop/e2e && npx playwright-core install chromium >/dev/null)

if [ "${1:-}" = --preview ]; then
  out="${2:-$cache/hero-preview-$(date +%Y%m%d-%H%M%S)}"; mkdir -p "$out"
  node tools/hero-preview.mjs --out "$out/preview.png" ${2:+--media "$2"}
  open "$out/preview.png" 2>/dev/null || true
  exit 0
fi

pieces=("$@"); [ ${#pieces[@]} -gt 0 ] || pieces=("${HERO[@]}")
# the cache keeps the newest HERO_KEEP runs (this one included) and of every other kind its newest few (media/prune.mjs; a KEEP file or the --words set stays)
node ops/media/prune.mjs "$cache" --keep "hero=$(( ${HERO_KEEP:-3} - 1 ))" --protect "${words[1]:-}"
set_dir="$cache/hero-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$set_dir/sheets"
echo "hero: ${words[1]:+words only from ${words[1]}: }recording ${pieces[*]} into $set_dir"
lock="${MEDIA_HEAVY_LOCK:-$HOME/jobadabra/tools/heavy-lock.sh}"
record=(node ../media/media.mjs "${pieces[@]}" --out "$set_dir" --keep ${words[@]+"${words[@]}"})
if [ -f "$lock" ]; then (cd .overlay/desktop && bash "$lock" product-media "${record[@]}"); else (cd .overlay/desktop && "${record[@]}"); fi

# beat sheets: one frame per beat (the scene's looks, at their hold's end; manifest.json "beats"), desktop and phone, to read before the preview
# (round 2, owner 24 Oct 2026: evenly spaced frames hid a missing step and a bad crop). The beats and their words: `hero: <piece> beat <n> <t> s: <words>`.
for piece in "${pieces[@]}"; do
  beats="$(node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const e = m.items.find(i => i.name === process.argv[2]); for (const b of e?.beats || []) console.log(`${b.t}\t${b.beat}`)' "$set_dir/manifest.json" "$piece")"
  for clip in "$piece" "$piece-720"; do
    [ -f "$set_dir/$clip.mp4" ] || continue
    length="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$set_dir/$clip.mp4")"
    inputs=(); n=0
    while IFS=$'\t' read -r at words; do
      [ -n "$at" ] || continue
      n=$((n + 1)); ffmpeg -v error -y -ss "$at" -i "$set_dir/$clip.mp4" -frames:v 1 -vf scale=600:-1 "$set_dir/sheets/$clip-beat$n.png"; inputs+=(-i "$set_dir/sheets/$clip-beat$n.png")
      [ "$clip" = "$piece" ] && printf "hero: %s beat %d %s s: %s\n" "$piece" "$n" "$at" "$words"
    done <<< "$beats"
    if [ "$n" -gt 1 ]; then ffmpeg -v error -y "${inputs[@]}" -filter_complex "hstack=inputs=$n" "$set_dir/sheets/$clip.png"; else cp "$set_dir/sheets/$clip-beat1.png" "$set_dir/sheets/$clip.png" 2>/dev/null || true; fi
    printf "hero: %s %.1f s, %d beats, sheet %s\n" "$clip" "$length" "$n" "$set_dir/sheets/$clip.png"
  done
done

# the in-hero side-by-side: other pieces come from website/public/media, so a partial set still shows the whole stage
node tools/hero-preview.mjs --media "$set_dir" --out "$set_dir/preview.png"
open "$set_dir/preview.png" 2>/dev/null || true
echo "hero: DONE $set_dir (on the owner's yes: tools/hero.sh --place $set_dir)"
