-- The central scout's published job boards (sitefacts rows `central-scout-<cc>`, each with 3+ local jobs) counted once a day, for the trend on /admin/job-search/scouting
-- (12 Nov 2026, owner via sa: per country and kind of work, "how that moved over time"). sitefacts keeps one row per board and country, updated in place, so its past is
-- not there to count later. JSON {total, profiles, cells: {'<family>|<cc>': boards}}; '' on days before this column. Counts only. Written by shared/board-counts.js.
ALTER TABLE index_daily ADD COLUMN boards TEXT NOT NULL DEFAULT '';
