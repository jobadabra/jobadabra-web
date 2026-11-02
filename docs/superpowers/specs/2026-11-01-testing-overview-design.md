# Testing → Overview (`/admin/testing/overview`)

> **Verdict:** one page that lists every way we look for bugs, as cards in four rings, each with what it proves, how often it runs, its last run (✓/✕/◷ + word + link) and the bugs it caught. No number is typed by hand; a method with no stored data says so on its card.

Owner, 1 Nov 2026: "show us all different methods of testing and finding bugs we use to keep our application qualitative, bug-free and reliable"; "unit tests… are too low level to put on this list… more for the agent development, not proving the app is stable". Target: the approved sketch (artifact HBJrMgbCYTNJjXmQrEqs5P).

## Design (states, owner of each, what changes them)

| Thing on a card | Owner (the one reader) | Changes when |
|---|---|---|
| Cadence | the workflow's cron, read from the schedules snapshot (`schedules.read`); triggers that are not crons (every PR, after each merge, by hand) are catalogue words checked against the public workflows by a test | a workflow changes |
| Last run (workflow) | `schedules_snapshot` → `recent[0]` (newest finished run: conclusion, time, run link) | hourly collector |
| Last run (E2E kinds, Wander, Interactions) | `e2e_snapshot` (`latest`, `suiteNights`) via `e2e-intel.readSnapshot` | hourly collector |
| Last run (Integration) | `integration_snapshot` via `integration-intel.readSnapshot` | hourly collector |
| Last run (Quality AI) | `e2e_snapshot.quality` (newest night) | nightly |
| Bugs caught, PR checks | newest `pr_check_months` card, `realCatches` of the check named like the workflow (30 days) | monthly scorecard |
| Bugs caught, UI Finder detectors | newest `selfheal_snapshots` row, `periods.last7.byDetector` (real = fixed + queued; 7 days: the finest window stored) | every 3 hours |
| Bugs caught, E2E | `e2e_snapshot.caught`: reds whose cause is `product`, on every run kind (before merge, after merge, scheduled, night, beta…), 30 days, one per run, with where it was caught. The same rule as the E2E scorecard (`isCatch`). Owner, 2 Nov 2026: PR-only counting missed what main, the night and the beta caught once PRs stopped running e2e. A fix names the reds it closes with run ids in its `E2E-cause:` trailer (wins over the window up to the next green) | hourly |
| Planted bugs | `selfheal_snapshots` `quality.mutation` and `recall` | weekly / nightly |
| Sentry | the Sentry page's own `issues()` (5-minute cache) | live |

Verdicts: a card line is `green`, `red`, `running`, `none` (never ran / no stored run). The top band counts lines by verdict and names the red ones. A cron job that missed a run (`schedules-model.missed`) shows a "late" chip.

Planned methods (owner approved 1 Nov 2026, not built): upgrade + data test, fault injection, AI user agents, daily fresh-install smoke → grey "planned" cards; the day one lands its card gets a `workflow` and moves out of `PLANNED`. Synthetic monitoring landed 1 Nov 2026: a live card in the "real" ring, read through `readCard` and `readDays` (`shared/synthetic.js`); red "no round" when no probe round ran for 45 min.

## Not on the page
Unit tests (owner). No new table, no new collector, no AI call, no CI check. GTM readiness is a link card (session gr's page); it links only once `/admin/testing/gtm-readiness` is in the menu.

## Files
`admin/testing-overview-methods.js` (the catalogue: pure data), `admin/testing-overview-data.js` (loads the rows, resolves each card), `admin/testing-overview.js` (page + view), route in `workers/www/index.js`, menu entry in `admin/admin.js`, test `test/admin/testing-overview.test.js`.
