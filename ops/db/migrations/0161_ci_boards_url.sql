-- The search address a CI search read on a board, as a template (14 Nov 2026, owner via sa, asked via AskUserQuestion: "CI report carries it (Recommended)"): "our CI test searches (never a real install) report the
-- search address shape they read, with {role} and {place} as blanks; the site stores it after a validator (https, same board, blanks only, no personal words) and hands it to the Scout, which reads the same page the search read."
-- One address per (host, country): the latest valid one. NULL = none reported (the Scout reads the board's home page, as before). Never filled with a person's words (api/ci-boards.js searchAddress).
ALTER TABLE ci_boards ADD COLUMN url TEXT;
