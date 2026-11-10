-- Cloud browser runner 3/4, per-lane caps (owner, 10 Nov 2026, asked via AskUserQuestion, relayed by the coordinator): the daily cap is for a Free trial on our Free AI only;
-- Pro and anyone whose own AI key answers are not capped per day, within their AI credit; an abuse-only ceiling (about 500 reads a day) stands on a claimed own key and alerts the owner.
--   ready_batches.strict: 1 when the daily cap can apply to the night (a non-Pro account), 0 for Pro.
--   ready_batches.own_ok: 1 once the person's own key was answered by Anthropic (a made-up key never is), so the night's reads are theirs, not ours.
--   ready_read_days.own: reads taken at the abuse ceiling today; own_alerted: the owner was told once today.
ALTER TABLE ready_batches ADD COLUMN strict INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ready_batches ADD COLUMN own_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ready_batches ADD COLUMN own_proof TEXT;   -- a fingerprint of the key Anthropic answered (never the key), so a proof of one key does not lift the cap for another
ALTER TABLE ready_read_days ADD COLUMN own INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ready_read_days ADD COLUMN own_alerted INTEGER NOT NULL DEFAULT 0;
