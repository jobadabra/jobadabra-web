# jobadabra-web (private)

The website, `/admin`, and the CI jobs that feed them. Moved out of the public `GarryOne/jobadabra` on 19-20 Oct 2026.

**Rule: private may read public, public never reads private.** This repo only runs laid over a tree of the public repo
(the site imports shared validators from `extension/`, `desktop/lib/`, `app-core/src/`, `config/`).

## Work here
- `tools/site-run.sh <cmd>`: runs a command in `.overlay` (public tree + this repo), rebuilt when older than an hour.
- `tools/overlay.sh <out> [ref]`: build that tree by hand. `tools/tree.sh`: the same, for CI.
- `tools/site-guards.sh <tree> [<this repo>]`: the public tests that read site files plus this repo's own tests.
- No `ship.sh` here: open a normal PR; the required check is the job "All checks passed" (`tests.yml`).

## Layout (top level, by audience; 21 Oct 2026)
| Folder | What |
|---|---|
| `website/` `admin/` `api/` `shared/` | the public pages, /admin, what the apps call, what both use (see `website/README.md`) |
| `workers/` | `www` (the ONE Worker serving web + admin + api), `hosted-runner`, `ready-runner`, `bot` (the deploy shell of the Telegram bot Worker; its code is the public repo's `app-core/`) |
| `ops/hosted/` | the two container images' own files: `Dockerfile` (Always on) and `ready-fill/` (Dockerfile, `main.mjs`, `image-check.mjs`); the code they run is the public repo's (`src/`, `desktop/ready-fill/`) |
| `ops/db/migrations/` | D1 migrations |
| `test/` | mirrors the folders above (and holds `python/` and `desktop/`, below); `test/boundary.test.js` guards the import directions. Run: `node --test "test/**/*.test.js"` |
| `ops/media/` | the product-media recorder (videos and stills for the site); run it with `tools/media.sh` (by hand, never CI) |
| `ops/jobs/` | scheduled jobs that feed /admin (digest, ops overview, changelog, e2e intel, hosted e2e, Lab uploads) |
| `tools/` | the dev kit (overlay, tree, site-run, site-guards, staging) |
| `test/python/`, `test/desktop/` | tests that run inside the public tree's own harness (python / desktop): the joined tree has them at `tests/` and `desktop/test/` (`tools/layout-map.txt`) |

## Contract with the public repo
`docs/site-routes.json` (public) lists every route the app calls. Two tests keep it true: `test/site-routes.test.js` (here) and `desktop/test/site-routes.test.js` (public).

## CI
`tests.yml` (PRs, push, daily against newest public main), `site.yml` (deploy), `public-watch.yml` (every 6 hours: a public change that a deploy bundles dispatches the deploy), plus the scheduled jobs moved from public (digest, changelog, ops overview, e2e intel, hosted e2e, random draw, search lab).

## Secrets (set on this repo by the owner; never in code)
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `AI_COST_PUBLISH_KEY`, `SELFHEAL_PUBLISH_KEY`, `REPLAYS_PUBLISH_KEY`, `BUILDLOG_TELEGRAM_TOKEN`, `BUILDLOG_TELEGRAM_CHAT`;
Lab: `RANDOM_DRAWS_ANTHROPIC_KEY`, `CI_APP_ID`, `CI_APP_PRIVATE_KEY`, `NET_RECORD_KEY`, `NET_RECORDS_READ_TOKEN`.

Never deploy Worker `www` from here and from public `site.yml` at the same time.

**The tidy top level and the joined tree** (owner, 2 Nov 2026): the repo root shows few, grouped folders; `tools/layout-map.txt` says where each lands in the joined tree (this repo laid over the public one), so `website/` runs as `web/` with no import or workflow step changed. `tools/lay-private.sh` is the one place that applies the map (overlay.sh, tree.sh, hero.sh); a test is `test/tools/lay-private.test.js`.
