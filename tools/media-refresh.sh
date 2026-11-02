#!/usr/bin/env bash
# The last step of tools/media.sh (the one local command that makes the site's media): copies a fresh media set over the files website/public/media already holds
# (the site picks which pieces it shows; a new piece is listed, never added), records the public screens it was made from (.public-media), commits
# on the branch media-refresh and opens or updates its PR for the owner. Guarded by tests/test_site_media_refresh.py.
# Usage, from this repo's root: tools/media-refresh.sh <media set> <public tree> <public sha> [--no-push]
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/repos.sh"   # JOBADABRA_PUBLIC_REPO, JOBADABRA_WEB_REPO
set_dir="$1"; tree="$2"; sha="$3"; push=yes
[ "${4:-}" = --no-push ] && push=no
dest=website/public/media
[ -f "$set_dir/manifest.json" ] || { echo "media-refresh: $set_dir has no manifest.json: not a media set"; exit 1; }
# The refresh PR is ONE commit on the newest origin/main, whatever commit the recording ran from: a refresh merged meanwhile (same files) would
# otherwise leave the new PR CONFLICTING (site#33, 21 Oct 2026). The files are copied after this, so the set always wins.
git fetch -q origin main 2>/dev/null || true
git checkout -q -f -B media-refresh "$(git rev-parse --verify -q origin/main || echo HEAD)"
updated=(); missing=()
for file in "$dest"/*; do
  name="$(basename "$file")"
  if [ -f "$set_dir/$name" ]; then cp "$set_dir/$name" "$file"; updated+=("$name"); else missing+=("$name"); fi
done
extra=()
for file in "$set_dir"/*; do
  name="$(basename "$file")"
  [ -e "$dest/$name" ] || [ "$name" = manifest.json ] || extra+=("$name")
done
tools/public-watch.sh "$tree" media $(cat tools/media-paths.txt) >/dev/null
echo "media-refresh: ${#updated[@]} refreshed: ${updated[*]:-none}"
[ ${#missing[@]} -eq 0 ] || echo "media-refresh: the site shows files this set did not make (kept as they were): ${missing[*]}"
[ ${#extra[@]} -eq 0 ] || echo "media-refresh: made but not on the site (add one by hand to show it): ${extra[*]}"
git add "$dest"
[ ! -f .public-media ] || git add .public-media
if git diff --cached --quiet; then echo "media-refresh: nothing changed"; exit 0; fi
git -c user.name=product-media -c user.email=product-media@users.noreply.github.com commit -q -m "Refresh the site's media from public ${sha:0:9}"
[ "$push" = yes ] || { echo "media-refresh: committed on media-refresh (no push)"; exit 0; }
git push -q -f origin media-refresh
where="recorded on this Mac by tools/media.sh"
[ -z "${GITHUB_RUN_ID:-}" ] || where="recorded by run ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$JOBADABRA_WEB_REPO}/actions/runs/$GITHUB_RUN_ID"
detail="$(mktemp)"; trap 'rm -f "$detail"' EXIT
printf 'Re-recorded from public %s (%s).\n\n- Refreshed: %s\n- Made but not on the site: %s\n- Look first: the changed files in this PR (videos play in the PR file view)\n' \
  "${sha:0:9}" "$where" "${updated[*]:-none}" "${extra[*]:-none}" > "$detail"
# the PR-description check wants the owner's layout: the public repo's bot-pr-body.sh lays it out (the joined tree holds it)
if [ -f "$tree/tools/bot-pr-body.sh" ]; then
  body="$(bash "$tree/tools/bot-pr-body.sh" HEAD~1 --verdict="🎬 The site's screenshots and videos are re-recorded from the app's current screens" \
    --why="The app's screens changed since the last refresh (public ${sha:0:9})" --unblocks="Your review: merge it and the site shows the new screens" \
    --label="Media" --before="the previous recording" --after="${#updated[@]} files refreshed" --detail="$detail" \
    --no-screens="the files are the screenshots and videos themselves; open them in the PR file view" \
    --rate="Real users=🟡 Medium|the site shows the current app")"
else
  body="$(cat "$detail")"
fi
if [ -n "$(gh pr list --head media-refresh --state open --json number --jq '.[0].number')" ]; then
  echo "media-refresh: the open refresh PR now holds this set"
elif ! gh pr create --head media-refresh --base main --title "[media] Refresh the site's media (screens changed)" --body "$body"; then
  echo "media-refresh: GitHub refused the PR (is gh signed in on this Mac: gh auth status?)."
  echo "media-refresh: the set is on branch media-refresh: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$JOBADABRA_WEB_REPO}/compare/main...media-refresh"
  exit 1
fi
