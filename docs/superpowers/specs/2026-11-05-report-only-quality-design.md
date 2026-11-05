# Report only → how good is our product

> **Verdict:** `/admin/testing/report-only` showed whether the nightly jobs ran (13 numbers: 2 about the product, 3 bugs found, 8 plumbing). It becomes a page that answers "how are we doing, and better or worse than last week" with five areas a job seeker feels. No new collector, job or table: the numbers already sit on other admin pages and are brought together.

Owner (5 Nov 2026): "report only page, doesn't really have insights. IT doesn't tell me how we're doing. What is our AI quality, or our speed... Basically I don't see the outcome of this runs of this reports... It should tell me what's the quality of our product... using graphs and so on."
Sketch, approved 5 Nov 2026: https://claude.ai/artifact/SLMgWyo25odDed92yc6qBx. Owner's picks: verdict = "Areas on target", real-user numbers under 3 installs = "Too few installs (n)", same page with a plumbing toggle, build it.

## Design (states, their one owner, the verdicts)
- **One owner of the numbers:** `admin/product-quality-data.js` reads (each source on its own, failing to null); `admin/product-quality-areas.js` builds the five areas; `admin/product-quality.js` holds the judging rules. The page only draws.
- **An area's state is one of:** `better` / `same` / `worse` (last 7 days against the 7 before), `new` (no earlier week yet), `thin` (real users, under 3 installs: "Too few installs (n)", no number), `none` (source missing or empty: "not measured" and why). Never a 0 for a missing number.
- **Tone:** `none` for thin and none; `bad` below its bar (AI quality 80%, live checks 99%). Form filling and Speed have no bar, so "on target" means *not getting worse*: a worse week is `warn`, a change beyond twice its tolerance (1 point, or 1 s / 10%) is `bad`; with a bar, a worse week still above it is `warn`; else `good`. Bugs: an escape = `warn`, more escaped than found = `bad`.
- **Thin vs not measured:** "Too few installs (n)" only judges a period that has data; no fill or search in the last 14 days is "not measured".
- **Verdict:** "N of 5 areas on target · X slipping · Y to watch · Z not measured". No blended score (a weighted one would be a guess).

## The five areas and where each number comes from
| Area | Number | Source (existing) | Bar |
|---|---|---|---|
| Form filling | required fields real users got filled, 7 days | `fill_cards` (source user); the benchmark line from `headlines-form.js` | none |
| AI quality | same score twice, within 8 (nightly pairs) | nightly summary `quality-ai`; prompt cases; `form_answers` kept rate | ≥ 80% |
| Speed | median seconds to the first job, real searches | `telemetry` kind `search` (`first_s`); AI call median; live probe ms | none (lower is better) |
| Reliability | share of live check results that passed, 7 days (the line shows 30) | `synthetic_probes`; `telemetry` crashes; Sentry open issues | ≥ 99% |
| Bugs | found (tests that caught a product bug + finders' 7 days) vs escaped (new problems real users reported) | e2e snapshot `caught`; self-healing snapshots; `telemetry` first-seen fingerprints | none |

Left out of the sketch (5 Nov 2026): "recorded sites reaching the form" under Form filling: its Lab loader is 32 D1 queries a view (the whole board is ~15); parked in the Backlog.

Not collected (proposals, nothing built): app speed a user feels (click → screen); AI quality per prompt (prompt cases are stored as one total per night).

## Plan (3 PRs; regrouped 5 Nov 2026 so each one shows something: the PR checker refuses a change under `admin/` without before/after images)
| PR | What | State |
|---|---|---|
| 1/3 | The reader and the rules, and the page opens with the verdict and the five area numbers (no charts yet), "not measured" and "Too few installs (n)" | in review |
| 2/3 | A 30-day line (columns for Bugs) in each area card from `admin/viz*.js`, hover tips, light + dark | next |
| 3/3 | The current 13 cards move under a "Plumbing: did the nightly jobs run" toggle; the page header and the Testing links say what it is now | after 2/3 |
