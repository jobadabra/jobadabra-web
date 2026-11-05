-- "We got it" and the 24 hour reply clock (docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md in jobadabra, PR 1/7).
-- receipt_seen_at: when the reporter closed the receipt card in the app (the owner's later reply uses seen_at, so closing one never hides the other).
-- overdue_told_at: when the owner was pinged that this report is 24 h old with no reply (once per report; shared/feedback-overdue.js).
ALTER TABLE feedback ADD COLUMN receipt_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE feedback ADD COLUMN overdue_told_at TEXT NOT NULL DEFAULT '';
