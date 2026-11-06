# Night search: per-step counters (report only)

**Verdict:** the nightly check reports what each step of the press did, per candidate, against that candidate's own last 7 nights, so "EURES lists 19, our read listed A, we scored B" is visible and a step that stopped working shows as one line. No new gate, no alert.

## Problem
Owner, 6 Nov 2026: "How can we make sure that we don't fix one and break another... we only grow/improve but not regress?" then "go ahead. Fix the search". The nightly reports time and pooled quality only; on 6 Nov all employer sites ran out of time in 13 of 18 candidates and nothing said which step failed.

## Behaviour
- Per candidate and night, five counters from the press's own log: **EU portal (EURES) jobs our read listed**, **employer sites read**, **titles asked**, **AI calls**, **seconds to the first job** (the relevant local jobs and "N of X on EURES" already show).
- Each counter against the median of that candidate's last 7 nights of the same candidate count; a **drop** is more than 2 sample spreads below it (above it for the seconds; "none" counts as above). Silent in the first week, with no press numbers, and at a median of 0.
- A drop is one line per counter in the night's head ("EU jobs: p10 200 → 0, p1 146 → 0 (+3 more)") and a mark with its usual on the candidate's row. **Report only:** the night's `dropped` and the alert keep their three reasons.
- Counts and seconds only; the public tool (jobadabra `tools/persona-search/`) writes them into each verdict row as `counters`; no change under `src/`.

## Acceptance
- A flat night reads clean; a counter falling beyond its spread is named; a counter drop never adds a reason (tests in `test/unit/admin/search/search-night-counters.test.js`; three mutants fail them).
- An older night without counters shows none, never zeros.

## Non-goals
No Telegram, no new gate, no counter from `src/` (a missing log line is a request to the search slot), no per-source breakdown.

## Progress
- [x] Site: store, judge, tab (this PR)
- [ ] Public: `funnel.py` reads the lines, `gate.py` puts `counters` on each row
