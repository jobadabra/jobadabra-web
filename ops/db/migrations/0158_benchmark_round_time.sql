-- Benchmark Job Search: every round in the snapshot now carries its own time (`at`, the newest row's), so the page lists full rounds by date and time (owner, 13 Nov 2026: "Full rounds by date + time (Recommended)").
-- The stored snapshot was built without it: dropping its row makes the next reader rebuild it from the runs (snapshotOf in admin/benchmark-search-snapshot.js), as 0155 did. No run is touched, nothing is republished.
DELETE FROM benchmark_search_snapshot;
