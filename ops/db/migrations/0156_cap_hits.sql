-- Per-install lines met in each UTC hour, counts only (shared/install-caps.js): an install approaching or reaching a line is counted once a day per level, and the :00 tick sends
-- one 🟠 and one 🔴 card for the hours before it, then deletes their rows. No install id, no person. Owner, 13 Nov 2026, asked via AskUserQuestion: "Grouped hourly (Recommended)".
CREATE TABLE IF NOT EXISTS cap_hits (hour TEXT NOT NULL, line TEXT NOT NULL, level TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, line, level));
