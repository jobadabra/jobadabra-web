# A lost scout cache costs nothing

The owner chose on 6 Nov 2026: "Yes, copy it to R2 (Recommended)": save the scout's memory to a private R2 bucket after each run, read it back when GitHub's cache is missing, keep 30 dated copies.
Why: the memory (`data/jobs.sqlite`, `data/cache`, `data/geo.json`, about 3 MB) lived only in the lab repo's GitHub cache. On 2 Nov a repo move left it behind and the data loss followed; a lost cache still costs about a week of AI re-asking.

| PR | What | Proof |
|---|---|---|
| 1/2 | The site keeps the scout's memory: `PUT`/`GET /api/scout-memory` (Bearer INDEX_PUBLISH_KEY) in the private R2 bucket `scout-memory`, 30 days | `test/unit/api/scout-memory.test.js`: key, round trip, 30-day trim, size cap |
| 2/2 | jobadabra-lab `central-scout.yml` restores from it when no cache was found, and saves after each run | `tests/test_scout_workflows.py` reads the two steps; one scout run logs `saved to R2` |

## Progress
- [x] 1/2 site route and bucket (proof: test/unit/api/scout-memory.test.js)
- [ ] 2/2 lab workflow
