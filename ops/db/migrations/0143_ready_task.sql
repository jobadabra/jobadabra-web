-- Cloud browser runner 2/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): a night has a task. `fill` is Ready to send's night (every night until now); `readiness` reads each form only and keeps the read
-- sealed until the app takes it. One night per install, day AND task, so a day's readiness night never replaces that day's fill night (and the other way round).
ALTER TABLE ready_batches ADD COLUMN task TEXT NOT NULL DEFAULT 'fill';   -- fill | readiness (api/ready-read.js TASKS)
DROP INDEX IF EXISTS ready_batches_night;
CREATE UNIQUE INDEX IF NOT EXISTS ready_batches_night_task ON ready_batches (install, night, task);
