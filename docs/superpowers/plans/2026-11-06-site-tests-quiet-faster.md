# Site tests: quiet log, browser walks only where a PR reaches

> 🟢 One PR. The Site tests log is a summary plus failures; on a PR the browser walks run only when the PR reaches the pages they walk.

Owner, 6 Nov 2026: "site tests on jobadabra-web is too slow? What does it run?… Also, it's too verbose. I want only the summary, not every test detail" (picked "Both fixes").

| Plan | PRs |
|---|---|
| ▶️ 1 | `tools/site-test-reporter.mjs` (summary + failures in full) and the `WALKS` table in `tools/site-picks.mjs` (which changed paths cannot alter a walk's pages) |

Measured on web#450 (a privacy-page change): 133 test files, 147 s, 8 walks ~290 s of 370 s test time. Main and the daily run keep every test.
