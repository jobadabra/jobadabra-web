-- "Fixed" and "Acknowledge + defer" on a feedback, and telling the reporter (docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 3/7).
-- The owner's words to the reporter, what he linked, and whether and how the reporter was told. The app reads its install's unseen replies (api/feedback-replies.js).
ALTER TABLE feedback ADD COLUMN fixed_in TEXT NOT NULL DEFAULT '';       -- the version the fix is in, as the owner typed it; '' = the next release (a release fills it in: PR 5/7)
ALTER TABLE feedback ADD COLUMN pr_url TEXT NOT NULL DEFAULT '';         -- the PR or commit that fixed it (a github.com link), '' when none
ALTER TABLE feedback ADD COLUMN linear_url TEXT NOT NULL DEFAULT '';     -- the Linear JOB issue a deferred feedback was parked in (a linear.app link), typed, never fetched
ALTER TABLE feedback ADD COLUMN tell_mode TEXT NOT NULL DEFAULT '';      -- '' | now | release | never: when the reporter is told
ALTER TABLE feedback ADD COLUMN tell_message TEXT NOT NULL DEFAULT '';   -- the owner's own words to the reporter (≤ 300); '' = the default sentence for the state
ALTER TABLE feedback ADD COLUMN tell_mail INTEGER NOT NULL DEFAULT 0;    -- 1 = also e-mail the contact (only when it is an address)
ALTER TABLE feedback ADD COLUMN told TEXT NOT NULL DEFAULT '';           -- '' (not told) | pending (waits for a release) | app | app+mail | 'app, mail refused: <why>'
ALTER TABLE feedback ADD COLUMN told_at TEXT NOT NULL DEFAULT '';        -- when the reply became visible to the app (UTC)
ALTER TABLE feedback ADD COLUMN seen_at TEXT NOT NULL DEFAULT '';        -- when the app showed it and the person closed it (UTC)
CREATE INDEX feedback_replies ON feedback(install) WHERE told LIKE 'app%' AND seen_at = '';
