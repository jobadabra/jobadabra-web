-- "Send to AI" on a feedback (docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 7/7): one CI run per click that ends in a draft PR (pr_url, state_note keep the rest).
-- The run is bound to the card by its GitHub run id the first time it asks for the brief; every later callback of the run must carry the same id.
ALTER TABLE feedback ADD COLUMN ai_run TEXT NOT NULL DEFAULT '';        -- the GitHub run id that took the brief ('' = none yet)
ALTER TABLE feedback ADD COLUMN ai_run_url TEXT NOT NULL DEFAULT '';    -- that run's page on GitHub (public repo), shown as a link on the card
ALTER TABLE feedback ADD COLUMN ai_include TEXT NOT NULL DEFAULT '';    -- what the brief carries besides the words: a comma list of logs, page, profile (the owner's ticks for this run)
