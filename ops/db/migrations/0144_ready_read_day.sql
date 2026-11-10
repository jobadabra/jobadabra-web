-- Cloud browser runner 3/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): what an install's cloud readiness reads cost in one UTC day.
-- Owner, 9 Nov 2026 (asked via AskUserQuestion): "30 reads, $0.15/day (Recommended)". A counter row, not a count of ready_jobs: a batch posted again for the same night replaces its rows, which would reset a count.
CREATE TABLE IF NOT EXISTS ready_read_days (
  install TEXT NOT NULL,
  day TEXT NOT NULL,                    -- UTC date
  reads INTEGER NOT NULL DEFAULT 0,     -- forms queued for a read today
  micro INTEGER NOT NULL DEFAULT 0,     -- micro-USD the reads cost today (container seconds and the page-kind calls)
  PRIMARY KEY (install, day)
);
