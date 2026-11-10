-- Cloud browser runner 4/4, cs 2/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"; owner, 10 Nov 2026: "Build it now (Recommended)", "~500/day + alert (Recommended)"):
--   ready_attempts: the ONE press of each queued Full automation item (install, the Mac's queue session, job). Nothing but the 30-day purge deletes it: a night sent again, cleared or swept
--     cannot hand the same item a second attempt (code review of cs 2/4: on the night's row alone, a re-POST reset it).
--   ready_jobs.attempt: that attempt on the night's row (Stop, the cap and the timeout read it); ready_jobs.session: the item's queue session, kept at the batch.
--   ready_read_days.submits: cloud submits taken today against the abuse-only ceiling; submits_alerted: the owner was told once today.
CREATE TABLE IF NOT EXISTS ready_attempts (install TEXT NOT NULL, session TEXT NOT NULL, job TEXT NOT NULL, attempt TEXT NOT NULL, batch TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (install, session, job));
ALTER TABLE ready_jobs ADD COLUMN attempt TEXT;
ALTER TABLE ready_jobs ADD COLUMN session TEXT;
ALTER TABLE ready_read_days ADD COLUMN submits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ready_read_days ADD COLUMN submits_alerted INTEGER NOT NULL DEFAULT 0;
