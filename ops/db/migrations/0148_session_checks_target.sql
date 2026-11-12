-- /admin/job-search/lab "Session checks" (owner, 12 Nov 2026, asked via AskUserQuestion: "Add a target field (Recommended)"): the round's target per check (X, the relevant
-- local jobs that exist for the person, counted outside the app) as a count, so the tab draws "found of target" bars instead of reading it out of the conclusion sentence.
-- Old rows get it once from their sentence "N <n> of X <x>"; a "not measured" check keeps NULL (its X is no count).
ALTER TABLE session_checks ADD COLUMN target INTEGER;
UPDATE session_checks SET target = CAST(substr(conclusion, instr(conclusion, ' of X ') + 6) AS INTEGER)
  WHERE target IS NULL AND instr(conclusion, ' of X ') > 0 AND conclusion NOT LIKE '%not measured%';
