# jobadabra-web: notes for Claude

The website, `/admin` and the scheduled jobs that feed them: **private**, split out of the public `GarryOne/jobadabra` on 20 Oct 2026 (owner: "leave open-source rather less than more").
**Visibility (owner, 24 Oct 2026, replaced 1 Nov 2026):** the 24 Oct plan was "public until 1 Nov 2026, then private again". On 1 Nov the owner decided: "For now we want to keep all public, in this phase of product, to benefit from Github public tier" (via mac-07), so this repo stays public and **nothing secret goes in it** (secrets stay in GitHub/Cloudflare secrets).
Read [README.md](README.md) first, then the public repo's `docs/rules/private-site.md` (`~/jobadabra`, or `gh repo view GarryOne/jobadabra`).

## The one rule
**Private reads public, public never reads private.** This repo only runs laid over a checkout of the public repo (the site imports shared validators from `extension/`, `desktop/lib/`, `app-core/src/`, `config/`).
Nothing here may be needed by a public file, test or workflow. Never copy a private file into the public repo.

## How to work
- **Where a file goes** (`website/README.md`): `website/` public pages, `admin/` the owner's pages and the CI uploads that feed them, `api/` what the apps call, `shared/` what both use, `workers/www/` the router. A new file goes in one of them, never `site/src`; `test/guards/boundary.test.js` fails on a wrong import (admin and api never import each other; a page's data goes in `shared/`, its HTML in `admin/`). Tests mirror the folders.
- **Run anything with `tools/site-run.sh <cmd>`** (public tree + this repo in `.overlay`, rebuilt hourly), e.g. `tools/site-run.sh node --test "test/**/*.test.js"`.
  Before shipping a `website/` change also run CI's step `bash tools/site-guards.sh .overlay .` (after `SITE_OVERLAY_FRESH=1 tools/site-run.sh true`): it adds the public repo's tests that read site files (e.g. `desktop/test/cost-labels.test.js`: no "~$29" on a page); site audit A went red on it (24 Oct 2026).
- **Land with the public repo's ship tool, from your worktree here:** `~/jobadabra/tools/ship.sh --background --body=<file>` (rebase, push, open the PR, watch it: `ship: RED/GREEN/MERGED/CONFLICT` in its log; Monitor it). Never a bare `gh pr create`. **A PR's title names the whole PR** (owner, 24 Oct 2026): with 2+ commits add `--title="<what the whole PR does for the user>"`, ship refuses to open it without.
  The body follows `~/jobadabra/tools/pr-body-template.md` (verdict line, **Why**, **Unblocks**, impact table, bullets, Before/After, "No screenshots: <why>"); CI's step "PR description laid out" fails without it. The check to wait for is "All checks passed" (`tests.yml`).
  Worktree: `git worktree add ../jobadabra-web-<topic> -b <topic>`; commit subject ≤ 72 characters. The owner merges by hand.
- **A PR's screenshots come from `tools/site-run.sh node tools/page-shot.mjs --path /admin/<page> --width 1440,390 --theme dark,light --seed <name> --out <dir>`** (owner, 25 Oct 2026, #92's images were raw HTML): it renders through the real Worker on demo data and refuses an unstyled page; never hand-render a bare page. Before = the same command from a worktree of the old commit. Host the PNGs with `node tools/pr-assets.mjs pr-assets-<branch> <png>... --repo=GarryOne/jobadabra-web` (it prints `github.com/<repo>/raw/<tag>/<file>` URLs: `raw.githubusercontent.com` does not render in a private repo). New demo data goes in `tools/page-shot-seeds.mjs`.
- **Merging to `main` deploys production** (`site.yml`, Worker `www`). Try it first on staging: Actions → "Release · Website staging" (Worker `www-staging`, no domain, no cron, no production secrets, probes every route against production).
- **A change on both sides lands here first** (owner, 21 Oct 2026: "the site lands first, and its tests check 'the site has everything public lists' instead of an exact match"): the Worker route, feed type, tag, step or reason word goes in here, then the public PR lists and uses it. A route the Worker has that public does not list yet is only told (`SITE_ROUTES_STRICT=1`, the daily run, fails it); a route public lists that the Worker lacks stays red. Open both PRs together, merge this one first. Detail: public `docs/rules/private-site.md`.
- **A public file the site bundles changed** (`extension/…`, `desktop/lib/…`, `app-core/src/report.js`, `config/…`): `public-watch.yml` (every 6 hours) redeploys; start it by hand when it matters.
- **Shared tables live in the public repo** (`desktop/e2e/lib/platform.mjs`, `applying-status.mjs`, `desktop/lib/free-ai-models.js`, `free-ai-translate.js`, `desktop/test/fixtures/host-cases.json`); the `shared/*.js` files re-export them. Edit them in the public repo.
- A test that needs a site file lives in the public repo behind `tests/site_private.py` / `desktop/test/site-private.js` (skipped there, run here) or in this repo's `test/python/` and `test/media/` (the joined tree has them at `tests/` and `desktop/test/`).
- **A job that calls the AI must never fail silently** (owner, 24 Oct 2026: the key's workspace hit its monthly limit; the changelog stayed green for a day, the digest failed 7 of 8 runs unseen): catch `AiRefused` (`admin/ai-refusal.js`, thrown by `ask`), name the cause, `reportRefusal` (Telegram once per outage), fail the run red, and keep a fallback that needs no AI where the output matters (`admin/changelog-plain.js`). New AI call = same handling + a test on fake 400-limit / 429 answers.

## Safety (same as the public repo)
- Secrets only in the macOS Keychain (`jobadabra.*`), GitHub secrets and Worker secrets. Never in code, docs, logs or PR text. The owner sets this repo's secrets; never print or copy a value.
- No AI spend without the owner's yes. Keep `/admin` behind its keys; never open a route without the guard its siblings have.
- Never edit another session's worktree. One issue per session.
- Cost: this repo is PUBLIC (checked with `gh repo view`, 1 Nov 2026), so its Actions minutes are free; the owner keeps all repos public in this phase to use GitHub's public tier (owner, 1 Nov 2026, via mac-07: "For now we want to keep all public, in this phase of product, to benefit from Github public tier"). Making any repo private again brings back a minutes budget (about 4,000 a month on the old private plan): say so before it. Still say what a new schedule or matrix costs in runs.

## Not here
The app, the extension, the engine (`src/`), the Telegram bot Worker (`worker/`), the user-called workflows and all their tests are in the **public** repo; do not copy them here.
