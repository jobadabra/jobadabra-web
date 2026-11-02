-- Feedback with a screenshot and logs (docs/superpowers/specs/2026-11-02-feedback-screenshot-logs-design.md). The files live in R2 (FEEDBACK_FILES, 90 days);
-- the row keeps their handle (ref), what was kept (shot: '' | 'png' | 'jpg', logs: 0/1), the screen the person was on, and whether the owner's Telegram got it.
ALTER TABLE feedback ADD COLUMN ref TEXT NOT NULL DEFAULT '';        -- random 16-hex id, the R2 folder; '' on rows from before this change
ALTER TABLE feedback ADD COLUMN screen TEXT NOT NULL DEFAULT '';     -- the app page the feedback was sent from
ALTER TABLE feedback ADD COLUMN shot TEXT NOT NULL DEFAULT '';       -- screenshot kept: 'png' | 'jpg' | ''
ALTER TABLE feedback ADD COLUMN logs INTEGER NOT NULL DEFAULT 0;     -- logs kept: 1 | 0
ALTER TABLE feedback ADD COLUMN notified TEXT NOT NULL DEFAULT '';   -- '' (not tried: old rows) | 'sent' | 'off' (no bot secrets) | 'failed: <why>'
CREATE INDEX feedback_ref ON feedback(ref);
