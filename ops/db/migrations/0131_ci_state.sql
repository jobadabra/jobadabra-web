-- The CI's small stores that were pinned GitHub issues (state-issues plan, owner 5 Nov 2026): the noise register, the weekly verdict audit and the red-main list (admin/ci-state.js).
-- One row per key, the body is JSON. No user data: finding titles of the loop's own issues, suite names, PR numbers.
CREATE TABLE IF NOT EXISTS ci_state (key TEXT PRIMARY KEY, body TEXT NOT NULL, at TEXT NOT NULL);
