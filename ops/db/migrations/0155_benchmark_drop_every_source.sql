-- Benchmark Job Search: remove the line "Jobadabra (with every source)" (owner, 13 Nov 2026: "Let's remove this from admin, from benchmarks...", and "Delete the 59 rows").
-- Why: "It doesn't make sense to have a benchmark where we include rivals in our solution"; the benchmarks repo no longer sends the line. 59 rows over 6 rounds (2026-10-31 .. 2026-11-12-full); a backup export was taken first.
DELETE FROM benchmark_search_runs WHERE tool = 'Jobadabra (with every source)';
-- The snapshot still holds the deleted line: dropping its row makes the next reader rebuild it from the runs (snapshotOf in admin/benchmark-search-snapshot.js), so the rounds lose the line in this deploy.
DELETE FROM benchmark_search_snapshot;
