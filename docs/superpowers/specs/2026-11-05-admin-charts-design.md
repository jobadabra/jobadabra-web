# Admin tables become charts

> **Rule (owner, 5 Nov 2026, after PR 1 and 2 were built):** only PLAIN tables of raw numbers become charts. A table whose value cells already carry colour (chips, bars, dots, strips) stays: "these 2 tables were not that bad. They were giving some visual feedback (colors)… only this type of tables should be the target right now" (shown: Speed and Scorecard stay; "Main's green share per day", a colourless table, is the target). The inventory below was triaged before this rule: PRs 3–7 re-triage each row by it; a row marked 📊 whose table is colour-coded becomes 📋 stays.

> **Verdict:** 143 sections on 8 admin groups were checked. **94 are summaries and become charts**, 41 are lookups and stay tables, 8 are already visual and stay. One shared chart module draws all of them, and the exact numbers stay one click away ("Show table"). Seven PRs, AI → Costs first.

Owner (5 Nov 2026): "Please find all the sections/tables like this in the entire Admin UI and transform them into a more visual representation. Preferably graphs. Something that is easy to digest. Nobody reads tables and raw data. There can be exceptions where…" — his pick for the exceptions: **"Lookup tables stay."** A list you search for one row in stays a table (a run log, feedback, a key you look up). Summaries become charts.

## How the inventory was made (5 Nov 2026)
- Every page in `admin/admin.js` `PAGES` (41) was opened through the real Worker on demo data with all seeds (`tools/worker-server.mjs`); every `<table>` was read: 114 tables.
- The demo data hides sections that only draw with real data, so the source was read too: ᵃ marks the 28 found only there. Row counts on demo data are not production counts, so this table says what a section **answers**, not how many rows it has; the size class is set per PR from the code's own caps.
- A section is a **summary** when the owner reads it for a shape (who spends most, which part is big, did it get better). It is a **lookup** when he reads it to find one row (a run, a site, a key, a person).

## Inventory

**AI · Costs**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Who answered today | Which engine answered the CI, did one run out? | 📊 chart · PR 1 | stack: answered | ran out | failed per engine + state chip |
| By provider | Claude vs OpenAI: who costs what? | 📊 chart · PR 1 | split: share bar; today and 30 d in the label |
| Free AI · per install | Which installs near their day or month cap? | 📊 chart · PR 1 | meter: month use per install against the cap line, today as a marker |
| Free AI · steps | Which step spends the free allowance? | 📊 chart · PR 1 | bars: cost per step (calls, tokens, per call in the tooltip) |
| Pro AI · steps | Which step uses the credit? | 📊 chart · PR 1 | bars: credit per step |
| By group | Which group of jobs costs most? | 📊 chart · PR 1 | bars |
| By day | Does what the jobs report match Anthropic's bill, day by day? | 📊 chart · PR 1 | columns: Jobs and Billed side by side, 30 days; a gap shows at once |
| By API key | Which key spends? | 📊 chart · PR 1 | bars: range, today as a marker; last used in the tooltip |
| By workspace | Which workspace is near its limit? | 📊 chart · PR 1 | bars |
| By job | Which job costs most? | 📊 chart · PR 1 | bars: cost; runs, calls, per run, last run in the tooltip |
| Workflow tokens (with its per-job sub-rows) ᵃ | Which workflow burns the tokens, on which engine? | ✅ kept | already has share bars and engine mix; sub-rows kept as ca built them (#379) |
| Rings: where each subscription stands ᵃ | How full is Claude / Codex? | ✅ kept | rings kept as they are |

**AI · Engines**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Who answered today | same card as on Costs | 📊 chart · PR 1 | stack (same helper call) |

**AI · AI steps**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Every CI job that asks the AI | Which job, on which engine, did it run? | 📋 stays | a registry you search a job in; chips and run dots already show state |

**AI · Harness**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Context layers and sources | What does the fixer read? | 📋 stays | a reference list of files |

**Growth · Website**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Pro waitlist | Who joined the waitlist? | 📋 stays | a list of people |
| Per day (visitors, downloaders) ᵃ | How many people a day? | ✅ kept | columns with Y axis, #252 |

**Growth · App**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Problems, most users first | What breaks for users? (click for a sample) | 📋 stays | you open one problem for its sample |
| Machines | Which install is this? | 📋 stays | an install you look up |
| Channels | Which channel brings installs that finish setup? | 📊 chart · PR 5 | funnel: machines → finished setup → active, per channel |
| What installs ask | Which questions come up most? | 📊 chart · PR 5 | bars: times per question |
| Boards: how applications went | How do applications end per board? | 📊 chart · PR 5 | split: one bar per board (ended as) |
| Boards: where applications got to | Where do they stall per board? | 📊 chart · PR 5 | funnel per board |
| Access guard | Who hit the guard? | 📋 stays | a log |

**Growth · E-mail**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| By template | What did each mail send, what was held back? | 📊 chart · PR 5 | split: sent | not sent per template |
| Why mail was not sent | Why was mail held? | 📊 chart · PR 5 | bars |
| Addresses | Who can still get our mail? | 📊 chart · PR 5 | split: one bar by group |
| Stopped (all time) | Who opted out and why? | 📊 chart · PR 5 | bars |
| Arrived in the test inbox | Did the test mail arrive? | 📋 stays | a list of mails |
| Last 10 refusals and failures | What failed just now? | 📋 stays | a log |
| Audience: addresses ᵃ | Is this address on the list? | 📋 stays | an address you look up |

**Growth · Insights**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Is the search too narrow? (by role, region) | Where do keywords miss postings? | 📊 chart · PR 5 | bars: share the keywords catch, per role and region |
| Role words the keywords miss | Which words do we miss? | 📊 chart · PR 5 | bars |
| Role words people accept | Which words do people add? | 📊 chart · PR 5 | bars |
| Why jobs are dismissed | Why do people dismiss jobs? | 📊 chart · PR 5 | bars |
| Does the score predict action? | Do high scores get acted on? | 📊 chart · PR 5 | columns: acted-on rate per score band |
| Do higher scores get replies? | Do high scores get replies? | 📊 chart · PR 5 | columns: reply rate per score band |
| Which sources give useful jobs? | Which board is worth reading? | 📊 chart · PR 5 | bars: acted-on rate per source; the rest in the tooltip |
| Answers people change | Which answers are wrong? | 📊 chart · PR 5 | bars: changed by hand ÷ filled |
| Why fields stay empty | Why are fields left empty? | 📊 chart · PR 5 | bars |
| What the AI costs us · users | What does a user cost? | 📊 chart · PR 5 | tiles: total, per user per day, median, 95th, max |
| What the AI costs us · steps | Which step costs? | 📊 chart · PR 5 | bars |

**Growth · Monetization**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| AI cost: who, figure | Does the money cover the AI? | 📊 chart · PR 5 | tiles + meter (cost against revenue) |
| USD figures ᵃ | What are the dollar numbers? | 📊 chart · PR 5 | tiles |

**Growth · Promo codes**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Codes | Which code is this, who used it? | 📋 stays | a code you look up |

**Form filling · Real users**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Why fields were left empty (groups) | Which group of fields stays empty? | 📊 chart · PR 6 | bars: fields left, share of required in the tooltip |
| Empty fields by bucket ᵃ | What kind of field stays empty? | 📊 chart · PR 6 | bars |
| What the fill missed | What does the fill miss most, per 100 forms? | 📊 chart · PR 6 | bars: this week, last week as a marker |
| How applications ended | How did applications end, this week vs last? | 📊 chart · PR 6 | split: two bars (this week, last week) |
| Boards: finished, submitted, assisted, failed ᵃ | Which board fails? | 📊 chart · PR 6 | split: one bar per board |
| Efficiency, day by day | Is filling getting better day by day? | 📊 chart · PR 6 | line: filled %, needing nothing %; median time as its own small line |
| Required marks: seen vs counted | Do we count the required marks right? | 📊 chart · PR 6 | bars: seen vs counted per board + verdict chip |

**Form filling · Learning**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| By AI family, this week | Which AI family fills best? | 📊 chart · PR 6 | bars: success % per family |
| The AI's answers, by family | What happens to the AI's answers? | 📊 chart · PR 6 | split: kept | left empty | wrong field | cut per family |
| Proposed answers: used as proposed | Are proposed answers used? | 📊 chart · PR 6 | split: used | edited | ignored per source |
| Learning loop: best case (parked) | How far could the loop go? | 📊 chart · PR 6 | funnel |
| Recipe funnel: controls that failed | Which controls fail? | 📊 chart · PR 6 | bars |
| Recipe funnel: candidate → retired | How many recipes are at each stage? | 📊 chart · PR 6 | funnel: stepper with counts |

**Form filling · Lab**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Needs a fix | Which site do I fix next? | 📋 stays | a work list with links |
| By cause | What to fix first? | 📊 chart · PR 6 | bars: rows per cause; claimed as a marker |
| The pool: every smoke site | How did this site do? | 📋 stays | a site you look up (run dots exist) |
| Replay vs livePrototype | Does the replay agree with the live run? | 📋 stays | scenarios with verdict chips |
| What we test on | How big is each test set? | 📊 chart · PR 6 | bars: count per set |
| Platform scorecard | Which platform works for real users? | 📊 chart · PR 6 | bars: required filled and reached the form per platform + verdict chip |

**Form filling · Benchmark**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Tool scores (right, wrong, empty) ᵃ | Are we better than the other tools? | 📊 chart · PR 6 | split: right | wrong | empty per tool |
| Per form ᵃ | How did each tool do on this form? | 📋 stays | a form you look up |
| Builds over time ᵃ | Are we improving build by build? | 📊 chart · PR 6 | line: score per build |
| Fair benchmark: tools and builds ᵃ | Same, on the fair set | 📊 chart · PR 6 | split + line (same helpers) |

**Form filling · Reports**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Newest first | Which form was reported? | 📋 stays | a list of reports |

**Job search · Lab**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Candidates ᵃ | How did each candidate run? | 📋 stays | a run you look up |
| Run history ᵃ | Is time to first job getting faster? | 📊 chart · PR 7 | line: first job, 10th job, fit, per run |
| Real use by city ᵃ | How fast is search per city? | 📊 chart · PR 7 | bars |
| Real use by role family ᵃ | How fast per role family? | 📊 chart · PR 7 | bars |
| Real use, day by day ᵃ | Is real search getting better? | 📊 chart · PR 7 | line |
| Fixes ᵃ | Which search fix is open? | 📋 stays | a work list |
| Experiments ᵃ | What did we try? | 📋 stays | a log of dated experiments |
| Draws ᵃ | Which draw is this? | 📋 stays | a run you look up |
| Session checks (board, listed, relevant) ᵃ | Does each board list relevant jobs? | 📊 chart · PR 7 | bars: listed vs relevant per board |

**Job search · Scouting**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Where the list is strong or thin (country) | Where is the employer list weak? | ✅ kept | already a shaded heat table; keep, add the tooltip and the toggle |
| Employers by kind and country | Which kind is thin in which country? | ✅ kept | same shaded heat table |
| Employers by kind (role mix) and region | same | ✅ kept | same shaded heat table |
| Day by day: employers, failing, dead ends | Is the list growing? | 📊 chart · PR 7 | line: employers; failing and dead ends as a second line |
| The pool and discovery routes | How much of the pool do installs share? | 📊 chart · PR 7 | tiles |
| Discovery routes that work | Which route finds employers? | 📊 chart · PR 7 | bars |
| Shared by installs, per AI family | Which family shares most? | 📊 chart · PR 7 | bars: grouped |
| Steps skipped thanks to other installs (also on Installs) | How much work did sharing save? | 📊 chart · PR 7 | columns: today, 7 d, 30 d per kind |
| Freshness: growing, stale, failing | Is the list fresh? | 📊 chart · PR 7 | tiles / chips |
| Failing employers | Which employer fails? | 📋 stays | a work list |
| Most useful employers | Which employers pay off? | 📊 chart · PR 7 | bars: interviews, applied |
| Boards: installs' jobs checks, by kind of role | Which board matches? | 📊 chart · PR 7 | bars: jobs matched per board |
| Advice: shown, taken, dismissed | Do people take our advice? | 📊 chart · PR 7 | split: taken | dismissed | ignored per advice |
| Closed sites | Why is this site closed? | 📋 stays | owner's example of a table you filter; reason chips filter it |
| Employers (website, installs, last) | Is this employer on the list? | 📋 stays | an employer you look up |

**Job search · Installs**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Steps skipped thanks to other installs | same card | 📊 chart · PR 7 | columns (same helper call) |

**Job search · Benchmark**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Score per tool | Is our job search better than other tools? | 📊 chart · PR 7 | bars: relevant share per tool; time and cost in the tooltip |
| Per search | How did each tool do on this search? | 📋 stays | a search you look up |
| Tech and non-tech | Do we work outside IT? | 📊 chart · PR 7 | bars: grouped, two per tool |
| Relevant jobs we add beyond each rival | What do we add? | 📊 chart · PR 7 | bars |
| Jobs we miss, by job system ᵃ | What do we miss? | 📊 chart · PR 7 | bars |

**Agent Coding · Agent coding**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Every push check, by stops | Which check stops most pushes? | 📊 chart · PR 4 | bars: stops; runs and time in the tooltip |
| Fix PRs per area, by week | Where do we go in circles? | 📊 chart · PR 4 | heat: area × week, 3+ in red with the 🌀 |
| CI minutes per push, by week | Are pushes getting slower? | 📊 chart · PR 4 | line: median and slowest 1 in 10 |
| SDLC: every check (stops, real catches) ᵃ | Does a check catch real bugs? | 📊 chart · PR 4 | bars: stops vs real catches |
| SDLC: layers ᵃ | Which layer stops most? | 📊 chart · PR 4 | split per layer |

**Agent Coding · Overview**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| PRs by category ᵃ | What do we spend PRs on? | 📊 chart · PR 4 | bars: PRs; lines and hours in the tooltip |
| Latest PRs ᵃ | Which PR is this? | 📋 stays | PRs you look up |

**Agent Coding · Build log**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| (no table: a day-by-day list of words) | — | 📋 stays | text, nothing to chart |

**Agent Coding · Access**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| People | Who can open the admin? | 📋 stays | a list of people |
| Logins | Who logged in? | 📋 stays | a log |

**Testing · E2E**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Numbers per day (by kind) | How often is e2e green, by kind? | ✅ already a line chart (`admin/e2e-green.js`), numbers in a toggle | line: green % per kind |
| Top causes | Why do suites go red? | ✅ already bar rows (public `e2e-top.mjs`) | bars |
| PR e2e: cost vs catch | Is e2e on PRs worth its minutes? | 📊 chart · PR 2 | columns: minutes; line: green % (two charts, no second axis) |
| How steady the AI is | Does the AI judge the same every night? | 📊 chart · PR 2 | split per night: within 8 | over 20 | invented |
| Grey suites | Which suite is grey and when does it return? | 📋 stays | a work list with dates |
| Speed, last 30 days | Which suite is slow? | 📊 chart · PR 2 | range: p25–p95 whisker, median dot, budget tick |
| Which suites cost the most | Where do the red minutes go? | 📊 chart · PR 2 | bars: job time |
| Scorecard: which suites catch bugs | Which suite catches real bugs? | 📊 chart · PR 2 | split per suite: caught | missed | noise | CI and AI | not named |
| Where e2e work goes | Which file takes the commits? | 📊 chart · PR 2 | bars |
| What each cause means | What does this cause word mean? | 📋 stays | a glossary |
| Latest 25 runs / beta runs | What happened in this run? | 📋 stays | run log (lookup) |

**Testing · Integrations**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| The three layers | How big and how green is each layer? | 📊 chart · PR 2 | bars: tests per layer; median time and main green as chips |
| Time bombs | Which test file fails soon? | 📋 stays | files to open, sorted by days |
| Numbers per day | Are integration tests steady? | 📊 chart · PR 2 | line: green % per layer |
| Flaky tests | Which test is flaky? | 📋 stays | tests to open |
| Slowest 10 tests | Which tests are slowest? | 📊 chart · PR 2 | bars: time |

**Testing · PR checks**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Every check, last 30 days | Does this check catch bugs or only wait? | 📊 chart · PR 2 | split: real catches | false reds per check, p90 as a bar, verdict chip |

**Testing · Overview**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Every method, day by day | Did each way of finding bugs run green? | 📊 chart · PR 3 | heat: method × day, cells with colour + icon |
| What we test (sets) ᵃ | How big is each set? | 📊 chart · PR 3 | bars |

**Testing · Synthetics**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Last 14 days (13 checks) | Is the live app up, every check? | 📊 chart · PR 3 | heat: check × day |

**Testing · AI persona**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Runs | What did the persona do? | 📋 stays | runs with notes and a video |

**Testing · GTM**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Tier 1 journeys | How stable is each critical journey? | ✅ kept | already state chips, trend and a gauge; keep |
| Tier 2 journeys | How stable is each integration journey? | 📊 chart · PR 3 | bars: green % per journey |

**Testing · Report only**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| (no table: cards) | — | 📋 stays | nothing to chart |

**Testing · Self-healing**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| What the Finder found | Which detector finds real bugs? | 📊 chart · PR 3 | split per detector: real fixed | queued | false positive | duplicate | unclear |
| Trend and issues filed per day | Is precision improving? | ✅ kept | already line charts with a table view |
| Resolution words ᵃ | How were issues resolved? | 📊 chart · PR 3 | split |
| Detector outcomes ᵃ | Is this detector wrong? | 📋 stays | run dots exist |
| Real bugs caught | Which bug was real? | 📋 stays | a list with links |
| How the loop works | What are the rules? | 📋 stays | a reference list |

**Testing · Sentry**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Issues, most users first | What does the app report? | 📋 stays | an issue you open |

**Testing · Scheduled**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Scheduled testing jobs | Is this job on time and green? | 📋 stays | a job you look up; dots exist |

**Schedules · All jobs**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| All scheduled jobs (30) | Is this job on time and green? | 📋 stays | a job you look up; dots exist |

**Feedback · Inbox**

| Section | Answers | | Chart, or why it stays |
|---|---|---|---|
| Feedback cards | What did a user say? | 📋 stays | a list of cards |

## The chart vocabulary (one module, every page)
Seven forms, picked by the data's job (skill `dataviz`, `choosing-a-form`). A page never draws its own SVG for these.

| Form | Job | Used for |
|---|---|---|
| `bars` | rank, compare magnitude | most sections. One hue, largest first, value at the end of the bar. Options: `marker` (today, last week), `cap` (a limit line, amber from 70%, red from 90%, as on the rings), `steps` (a funnel: stages in order) |
| `split` | part to whole | one thin segmented bar per row (outcomes, shares), a name-only legend, ≤ 6 parts, the tail folded into "Other" |
| `columns` | change over days / weeks / builds | grouped or stacked, a Y axis from 0, the number above a column while there is room |
| `line` | trend | ≤ 4 series, direct labels, one axis (never two) |
| `heat` | a grid: item × day, area × week | status cells carry colour **and** an icon |
| `range` | spread against a budget | p25–p95 whisker, median dot, budget tick |
| `tiles` | a few headline figures | value, delta, optional sparkline |

Rules that hold for all seven:
- **Exact numbers stay reachable twice:** a floating tooltip on every mark (hover, keyboard focus, tap), and a "Show table" toggle under the chart that opens the **original table** (so the sort/search tools still work on it).
- **Colour:** ranked bars one hue; a part-to-whole of outcomes uses the status colours with an icon and a word (answered / ran out / failed), neutral parts use categorical slots in fixed order, never cycled. The palette is checked with the skill's validator on the admin card (#14181d): dark passes all checks; light passes with the "labels or table view" relief, which the toggle gives.
- **Admin is dark-only today** (each page hard-codes dark tokens). The module defines every colour as a CSS variable with a light set too, so it is ready, but turning the admin light is a non-goal.
- **Thin marks, 2 px surface gaps, 4 px rounded data ends, ≥ 40 px touch targets, no number on every point.** The 390 px phone is a first-class width (bars stack label over bar).
- A chart has a title that says the answer's subject, not "Chart"; an empty section says why in one line.

### Module shape
- `admin/viz.js` is the one import for pages: `figure({title, note, chart, table})` wraps any form with the toggle, plus the seven functions, `VIZ_STYLE`, `VIZ_SCRIPT` (one tooltip, added once per page).
- Siblings keep every file under 450 lines: `viz-bars.js`, `viz-time.js` (columns, line), `viz-grid.js` (heat, range, tiles), `viz-core.js` (palette tokens, scales, escape, number words). The tooltip and tick maths come from what exists (`shared/scoutingcharts.js` `TOOLTIP`, `admin/stats-chart.js` `niceTicks`) instead of a third copy; older page-local charts (`stats-chart.js`, `trend.js`, `installscharts.js`) move onto the module only when their page is touched, never in a pure move PR.
- No chart library: plain SVG/HTML strings like the existing charts, so the page works offline and nothing is added to bundle or CSP.
- Tests: one table-driven unit test per form (rows in → marks out, empty, one row, a long label, a zero) and one test per page that every converted section has a `figure` and its table behind the toggle.

## Acceptance criteria
1. Every 📊 row above is drawn by the module; none keeps a bare summary table.
2. Every chart's exact numbers are reachable by tooltip and by "Show table".
3. Every 📋 row is untouched; every ✅ row only gains the tooltip/toggle if it lacks them.
4. Light and dark token sets both pass the palette validator (dark with no warning; light with the relief).
5. 1440 px and 390 px shots per PR, no sideways scroll (`tools/admin-no-sideways.mjs` stays green), taps ≥ 40 px.
6. Each PR body has a `| What changed | Before | After |` table with real before/after shots on fictional data.
7. A section whose data is unavailable says so in one line (as today), never an empty chart frame.

## Non-goals
- No new data, query or metric: the charts draw what the sections already read.
- No light theme for the admin pages, no redesign of cards/tiles/rings that already work (the Costs rings, workflow-tokens card, GTM Tier 1, the Self-healing trend).
- Lookup tables are not restyled (the table tools stay as they are).
- No new gate, guard or CI check (owner rule: a gate only if it pays).

## PR plan (title `[ac] n/7 …`)
| PR | Scope | Charts |
|---|---|---|
| 1/7 | The module + AI → Costs and Engines (the owner's 7 sections first) | 11 |
| 2/7 | Testing: E2E, Integrations, PR checks | 12 |
| 3/7 | Testing: Overview, Synthetics, GTM Tier 2, Self-healing | 6 |
| 4/7 | Agent Coding: Agent coding, Overview | 6 |
| 5/7 | Growth: App, E-mail, Insights, Monetization | 21 |
| 6/7 | Form filling: Real users, Learning, Lab, Benchmark | 19 |
| 7/7 | Job search: Lab, Scouting, Installs, Benchmark | 19 |

PRs 5–7 hold 19–21 charts each; if one grows past what a reviewer reads in a sitting, it splits by page (5a/5b…), the numbering updates here.
AI → Costs was shared with session `ca`; its per-job PR (#379) is merged, so the Costs files are free and ca edits none unless asked. Kept as ca built them: the workflow card's per-job sub-rows (`/health` `jobs`, "|other" is the shared overflow key) and the rings card above "Who answered today".

## Progress
- [x] Inventory (41 pages, 114 tables on demo data, 28 more found in source)
- [x] Spec
- [x] Sketch and the owner's yes (5 Nov 2026: "Yes, as sketched"; https://claude.ai/artifact/GdfzfegP7Xz1H93f5ffKv5)
- [x] 1/7 Module + AI → Costs (#384, merged 5 Nov 2026)
- [x] 2/7 Testing: E2E, Integrations, PR checks (rescoped by the rule above: 4 charts; Speed, Scorecard, AI steadiness, suite cost and layers stay tables)
- [ ] 3/7 Testing: Overview, Synthetics, GTM, Self-healing
- [ ] 4/7 Agent Coding
- [ ] 5/7 Growth
- [ ] 6/7 Form filling
- [ ] 7/7 Job search
