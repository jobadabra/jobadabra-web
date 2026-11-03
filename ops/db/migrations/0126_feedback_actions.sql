-- Actions on each feedback (docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 1/7): one state per message (owner: shared/feedback-actions.js), the owner's impact rating,
-- and a log of every change. Old rows are 'new' and unrated. Rows from before 0124 had no ref; the actions address a row by ref, so they get one (no files behind it).
ALTER TABLE feedback ADD COLUMN state TEXT NOT NULL DEFAULT 'new';       -- new | dismissed | false_positive | deferred | ai_running | ai_pr | fixed
ALTER TABLE feedback ADD COLUMN state_at TEXT NOT NULL DEFAULT '';       -- when the state last changed (UTC)
ALTER TABLE feedback ADD COLUMN state_note TEXT NOT NULL DEFAULT '';     -- the reason (false positive) or the owner's message, ≤ 300
ALTER TABLE feedback ADD COLUMN impact TEXT NOT NULL DEFAULT '';         -- '' (unrated) | high | medium | low: the owner's rating
UPDATE feedback SET ref = lower(hex(randomblob(8))) WHERE ref = '';
CREATE UNIQUE INDEX feedback_ref_unique ON feedback(ref) WHERE ref != '';   -- every action addresses a row by ref: a clash would change two rows
CREATE TABLE feedback_log (
  at TEXT NOT NULL,
  ref TEXT NOT NULL,       -- the feedback; the line stays after a delete, with no text of the message
  who TEXT NOT NULL,       -- 'owner (session)' | 'owner (key)'
  action TEXT NOT NULL,    -- dismiss | false_positive | reopen | delete | impact | ...
  detail TEXT NOT NULL     -- ≤ 200: the reason, or 'state -> state'
);
CREATE INDEX feedback_log_ref ON feedback_log(ref, at);
