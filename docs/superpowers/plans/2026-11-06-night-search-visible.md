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
- [x] 1/2 site route, store, tab, Report only area, alert (#461)
- [x] 2/2 public workflow uploads the verdict (jobadabra #3337)

## Stage 2: 18 fixed personas, each against its own baseline (owner, 6 Nov 2026)
Owner: "6 personas is too narrow and could not tell the full story" -> "18: 6 fixed + 12 rotating", then "Bu those 12 rotating, how I would be able to understand what's the baseline?" -> all 18 FIXED (no rotation), and "how to know if it's a good or bad result?" -> "EURES direct + Google Jobs weekly".
Design: three yardsticks per persona, shown together on the Night search tab: (1) its own last 7 nights ("usual"; a drop is what alerts), (2) the floor (the result chip: a right job within the press limit), (3) the weekly reference X (how many right local jobs exist: EURES direct + Google Jobs through SerpAPI, read outside the app, counts only, tagged reachable without a login or not).
- Every threshold is a share of the night's own personas (two thirds: 6 -> 4, 18 -> 12), and a night is only compared with earlier nights of the same persona count, so a changed set starts its own silent first week.
- A night that never arrives (the compare step crashes, the run is cancelled, the upload is refused) alerts once at 06:30 UTC on the Worker's five-minute tick, under the same alert kind and switch.

| PR | What | Proof |
|---|---|---|
| 3/5 | jobadabra-web: thresholds as shares, per-persona usual, "found N of X" columns (the reference record's shape), the 06:30 missing-night alert, the upload cap 12 -> 40 rows | `search-night-scale.test.js`, `search-night.test.js` |
| 4/5 | jobadabra (public): the 18 fixed personas in `gate-personas.json`, the 18-job matrix, the gate pooling 18 | the gate's own tests; one hand dispatch from main after merge |
| 5/6 | jobadabra-web: `PUT /search-check/reference` stores the weekly reference (counts only, latest week replaces) that the tab already reads (split off 6 Nov 2026: the site lands first) | `search-reference.test.js` |
| 6/6 | jobadabra (public): the weekly reference job (EURES direct + Google Jobs behind a fake; no live SerpAPI run before the owner's quota decision) | tests on fakes |

## Progress (stage 2)
- [x] 3/5 site: scaled thresholds, usual, reference columns, missing-night alert
- [x] 4/5 public: 18 fixed personas
- [ ] 5/6 site: the reference store route
- [ ] 6/6 public: the weekly reference job
