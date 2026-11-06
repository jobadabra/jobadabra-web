# The nightly Search check is visible in Admin and tells the owner when it drops

The owner asked on 6 Nov 2026: "the nightly search persona... I see nowhere in Admin... Where should I see it the search dropped? Am I getting alerted? I'm not alerted. Let's fix this".
Why: `search-personas.yml` (6 fictional candidates, every night) keeps its verdict only as a GitHub artifact. On 5 Nov it measured 0 of 6 and on 6 Nov 2 of 6 (employer sites out of time in all 6), both runs green, nobody told.

Design: one verdict owns "the night dropped" (`admin/search-night-judge.js`); the Admin tab, the Report only chip and the alert all read it, so they cannot disagree.
- State: the nights (last 30, one per UTC night), written only by `PUT /search-check/night` (Bearer REPLAYS_PUBLISH_KEY, the key every search-lab upload uses), stored in `ci_state` under `search-nights`.
- A night has dropped when any of: fewer than 4 of 6 personas measured; relevant local jobs (pooled) below the median of the last 7 nights minus 2 spreads (the PR gate's own rule, owner 27 Oct 2026: "no guessed number"; silent until 7 earlier nights exist); employer sites out of time in 4 or more personas.
- The Worker decides and sends (`search-check-dropped`, once a day by the switchboard, counts only); CI only uploads.

| PR | What | Proof |
|---|---|---|
| 1/2 | jobadabra-web: the route, the store, the judge, the alert, the "Night search" tab on Job search, the "Search" area on Report only | `test/unit/admin/search/search-night.test.js`, `test/unit/admin/report/product-quality.test.js`; the 5 and 6 Nov verdicts rendered |
| 2/2 | jobadabra (public): `search-personas.yml` uploads `verdict.json` at its end (`if: always()`, never fails the run); `docs/site-routes.json` lists the route | `agent-run-upload.test.mjs`-style test; the next nightly run shows its row |

## Progress
- [ ] 1/2 site route, store, tab, Report only area, alert
- [ ] 2/2 public workflow uploads the verdict
