# Jobadabra website

One Worker (`www`, `workers/www/wrangler.toml`) serves the pages, `/admin` and the API. Its code sits in top-level folders, by who calls it:

| Folder | What | May import |
|---|---|---|
| `website/` | the public pages: `website/public/` (static, no build step; Workers static assets) | nothing |
| `admin/` | the owner's `/admin` pages and the CI uploads that feed them (`PUT /ops/data`, `/applying/*`, …) | `shared/` |
| `api/` | the routes installed apps and the extension call (`/api/*`, `/report/*`, `/install`, `/download/*`); their URLs never change | `shared/` |
| `shared/` | used by both: auth, guard, mail, free AI, the data behind the pages | `shared/` only |
| `workers/www/` | `index.js`: the router, cron and queue; the only file that imports from every folder | all |

`test/` mirrors them (`test/admin`, `test/api`, `test/shared`, `test/web`, `test/workers`); `test/boundary.test.js` fails when a file imports the wrong way, or a module is left outside its folder.
The rest of the repo: `db/migrations/` (D1), `workers/{hosted-runner,ready-runner}` (the two container Workers), `media/` (the product-media recorder), `preview/` (the next website, reviewed before it goes live), `jobs/` (scheduled jobs), `tools/` (the dev kit).
A page and its data are two files: the data in `shared/`, the page in `admin/` (e.g. `shared/telemetry.js`, `api/telemetry.js`, `admin/telemetry.js`).

`workers/www/index.js` also serves `POST /api/waitlist`, which keeps Pro early-access sign-ups in Cloudflare KV.

- Deploy by hand: `cd workers/www && npx wrangler@4 deploy`
- Automatic: `.github/workflows/site.yml` deploys on every push to `main` that changes `website/`, `admin/`, `api/`, `shared/`, `workers/www/` or `db/migrations/`.

## Reading the owner pages from a script (/admin/*)

Every `/admin/*` page (overview, ai-cost, self-healing, …) answers **404** without the owner's credentials (`shared/auth.js`).
From a terminal or an agent session on the owner's Mac:

```sh
curl -s -H "Authorization: Bearer $(security find-generic-password -s jobadabra.site.api_key -w)" \
  https://www.jobadabra.top/admin/ai/costs
```

- The Bearer token is the Worker secret `STATS_API_KEY`, kept in the Keychain as `jobadabra.site.api_key`.
- `STATS_KEY` (`jobadabra.site.stats_key`) is **not** accepted as a Bearer token: it is the browser login (`?key=` once, then the session cookie).
- The pages are HTML; strip the tags to read the tables (`/admin/ai/costs`: By group, By day, By API key, By job).
