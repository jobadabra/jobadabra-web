# Admin trends: testing methods and job search, day by day

Owner, 7 Nov 2026: "can we measure the efficiency between these 2 testing methods? How many bugs each ones is catching. How many tokens/times each one is using compared to the bug caught"; "do I have a graph/trend for the job searches? same, in Admin".

| PR | What | Where |
|---|---|---|
| 1/2 | Bugs found vs tokens and CI minutes per testing method (7-day table, 14-day trend) | Testing → Overview, `admin/testing-methods-cost.js` |
| 2/2 | Candidates found, right local jobs, employer sites in time, night by night; one chart pair per candidate count | Job search → Lab → Night search, `admin/search-night-trend.js` |

Rules both follow: reuse the counts other pages already keep (no second way of counting real bugs or judging a night); a day with no data is a gap, never a 0; a method or night with nothing found is a warning, not hidden.
