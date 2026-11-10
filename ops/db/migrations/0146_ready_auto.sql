-- Cloud browser runner 4/4, cs 2/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"; owner, 10 Nov 2026: "Build it now (Recommended)", "~500/day + alert (Recommended)"):
--   ready_jobs.attempt: the one attempt the site reserved for a Full automation job before its press (api/ready-auto.js reserve); set once, never cleared, so a job is never pressed twice.
--   ready_read_days.submits: cloud submits taken today against the abuse-only ceiling; submits_alerted: the owner was told once today.
ALTER TABLE ready_jobs ADD COLUMN attempt TEXT;
ALTER TABLE ready_read_days ADD COLUMN submits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ready_read_days ADD COLUMN submits_alerted INTEGER NOT NULL DEFAULT 0;
