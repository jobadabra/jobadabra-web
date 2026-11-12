-- Free AI's calls per minute, so the owner is told when it starts failing people's calls (owner, 12 Nov 2026: "That could be real users not being able to perform actions"; shared/free-ai-alert.js).
-- free_ai_minutes: one row per UTC minute, counts only: `ok` calls answered, `bad` calls that ended in an error the person feels (5xx). A caller's own limit, a bad token or a bad body is neither.
-- free_ai_failed: one row per bad call, an install's short digest and the cause (no prompt, no answer, no name), so the alert can say how many installs were hit. Both kept 2 days.
CREATE TABLE IF NOT EXISTS free_ai_minutes (minute TEXT PRIMARY KEY, ok INTEGER NOT NULL DEFAULT 0, bad INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS free_ai_failed (at TEXT NOT NULL, who TEXT NOT NULL, why TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS free_ai_failed_at ON free_ai_failed (at);
