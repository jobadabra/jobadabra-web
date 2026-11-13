-- How many jobs a search kept from a CI-read board (13 Nov 2026, owner via sa: "send that number with the host (a count, fixed shape, validator both ends, capped), the site keeps the highest seen").
-- A count only, 0..999: the Scout reads boards that gave people right jobs first (api/scout-memory.js reportedBoards, src/scout_board_candidates.py in jobadabra). 0 = not reported.
ALTER TABLE ci_boards ADD COLUMN local INTEGER NOT NULL DEFAULT 0;
