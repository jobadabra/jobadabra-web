-- What the shared "scheduled job" alert remembers per job (shared/job-alert.js): the last state it saw, whether this red streak was told, the owner's per-job switch, and the day a refused Worker start was last told.
-- Why (12 Nov 2026, owner: "let's close these gaps"): a red streak must be told once and survive a Worker restart, so it lives in D1, not in memory.
CREATE TABLE IF NOT EXISTS job_alert (job TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT '', alerted INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, start_day TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT '');
