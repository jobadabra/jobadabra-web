-- The AI's suggested impact for a feedback (docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 2/7). The owner's own rating stays in `impact` and always wins; these only say what the AI thought.
ALTER TABLE feedback ADD COLUMN impact_ai TEXT NOT NULL DEFAULT '';      -- '' (not suggested yet, or the AI failed) | high | medium | low
ALTER TABLE feedback ADD COLUMN impact_why TEXT NOT NULL DEFAULT '';     -- the AI's one line, or 'AI unavailable: <why>' when it failed (shown on the card: never a silent miss)
ALTER TABLE feedback ADD COLUMN impact_tries INTEGER NOT NULL DEFAULT 0; -- attempts so far; the daily job retries up to 3 within 7 days
