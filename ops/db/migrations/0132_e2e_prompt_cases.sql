-- The nightly prompt-case replay, one row per night run, on its own (admin/e2e-prompt.js): it used to ride on the e2e_quality row, which exists only for a night whose quality job
-- scored twice, so a night without that scoring lost its replay (jobadabra-web#259). json = counts only (status, total, right, flipped, noise, newWrong, unconfirmed, calls).
CREATE TABLE IF NOT EXISTS e2e_prompt_cases (run_id INTEGER PRIMARY KEY, day TEXT NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS e2e_prompt_cases_day ON e2e_prompt_cases (day);
-- The replays already stored with their quality night move over; e2e_quality.prompt_cases is not written any more (the column stays: SQLite keeps dead columns).
INSERT OR IGNORE INTO e2e_prompt_cases (run_id, day, json) SELECT run_id, day, prompt_cases FROM e2e_quality WHERE prompt_cases IS NOT NULL;
