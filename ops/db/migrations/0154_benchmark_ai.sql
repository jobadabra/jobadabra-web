-- Benchmark Job Search: which AI ran ours in that run ('app' = the app's own tiers, small Haiku + main Sonnet, through the broker; 'haiku' or '' = Haiku only) (owner, 13 Nov 2026).
-- Why (13 Nov 2026, jobadabra-benchmarks #31): rounds from the switch on cannot be compared with the earlier Haiku-only ones; every row written before has no value and reads as Haiku (admin/benchmark-ai.js).
ALTER TABLE benchmark_search_runs ADD COLUMN ai TEXT NOT NULL DEFAULT '';
