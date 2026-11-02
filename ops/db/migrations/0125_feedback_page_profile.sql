-- Feedback also carries the data of the screen the person was on (page.json) and, only when they chose it, a snapshot of their Profile (profile.json):
-- docs/superpowers/specs/2026-11-02-feedback-screenshot-logs-design.md. Both live in R2 (FEEDBACK_FILES, 90 days) beside the screenshot and the logs; the row keeps 0/1.
ALTER TABLE feedback ADD COLUMN page INTEGER NOT NULL DEFAULT 0;      -- screen data kept: 1 | 0
ALTER TABLE feedback ADD COLUMN profile INTEGER NOT NULL DEFAULT 0;   -- profile snapshot kept: 1 | 0
