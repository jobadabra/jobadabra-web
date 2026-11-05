-- The mail switches the owner can press in Admin → E-mail (owner, 5 Nov 2026: "be actual switches that I can turn on or off"). shared/mail-switches.js holds the rules.
-- One row per switch the owner has pressed: its last state. No row = the wrangler.toml value applies, so a missing table or row can only leave things as they were deployed.
CREATE TABLE IF NOT EXISTS mail_switch (
  name TEXT PRIMARY KEY,       -- 'MAIL' | 'MARKETING_MAIL' | 'TRIAL_REMINDERS' | 'MAIL_LAUNCH'
  state TEXT NOT NULL,         -- 'on' | 'off'
  at TEXT NOT NULL             -- when the owner pressed it (ISO)
);
