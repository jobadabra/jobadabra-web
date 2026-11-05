-- The thank-you of a validated report (spec docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md in jobadabra, PR 2/7).
-- feedback.thanks_apps: free applications the owner ticked on the Fixed form (0 = none), only a wish until the reporter is told.
-- trial_bonus: one row per report that was granted, written in the same batch that tells the reporter (shared/feedback-reply.js); the PRIMARY KEY makes the grant once per report.
-- It holds an install id, a report ref and a number, nothing the reporter wrote; it outlives the card, so deleting a feedback never takes a granted bonus back. An install's bonus is the sum of its rows (shared/trial.js).
ALTER TABLE feedback ADD COLUMN thanks_apps INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS trial_bonus (ref TEXT PRIMARY KEY, install TEXT NOT NULL, apps INTEGER NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trial_bonus_install ON trial_bonus (install);
