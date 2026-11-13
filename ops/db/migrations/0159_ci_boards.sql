-- The job boards our own CI searches read (13 Nov 2026, owner via sa, asked via AskUserQuestion: "Any install + our CI searches (Recommended)"): board names only, no person, no job.
-- Its own table, never sitefacts: no install count, no k >= 3 serving and no yield number can ever include a CI run. Only the Central Scout reads it (api/scout-memory.js reportedBoards).
CREATE TABLE IF NOT EXISTS ci_boards (
  host TEXT NOT NULL,
  country TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (host, country)
);
CREATE INDEX IF NOT EXISTS ci_boards_day ON ci_boards(day);
