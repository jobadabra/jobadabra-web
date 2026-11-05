# Prompt-case night results kept every night (jobadabra-web#259)

> **Verdict:** the nightly prompt-case replay gets its own table, one row per night run, so a night without a second quality scoring no longer loses it. Two PRs, the site first.

**Who gets what:** the owner sees a prompt-case tile and a 14-night trend without holes.

**Design:**
- State: one replay per night run (`e2e_prompt_cases`, key = run id). Its one owner is the ingest of `PUT /e2e/data` (`promptNights`); the quality table no longer carries it.
- Readers (Quality AI card tile and column, nightly summary) read `snapshot.promptNights` through `admin/e2e-prompt.js`; a snapshot stored before the key reads the old quality rows until the next hourly write.
- The collector (public `tools/ci-intel/jobs/e2e-intel.mjs`, `nightFromJobs`) reads the replay on its own, whether or not a quality job scored twice, and skips runs the site lists in `GET ?v=` → `prompts`.

## PRs
| PR | What |
|---|---|
| 1/2 (jobadabra-web) | table, ingest, snapshot, readers, backfill |
| 2/2 (jobadabra) | collector sends `promptNights` for every night run; closes #259 |
