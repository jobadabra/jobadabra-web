-- The three mail types (owner, 5 Nov 2026: "we should not treat all the emails as one box"): shared/mail-lists.js holds the rules.
-- mail_on: one row per stored yes for 'releases' or 'tips'; a no stays in mail_off, so an address has at most one answer per type and no row means no answer yet.
-- Keyed like mail_off by the address digest, so a tick stays with the address that gave it, never with a new unconfirmed one.
CREATE TABLE IF NOT EXISTS mail_on (
  addr TEXT NOT NULL,
  list TEXT NOT NULL,          -- 'releases' | 'tips'
  via TEXT NOT NULL,           -- 'settings' | 'card' | 'mail-settings' | 'old-box' | 'tick' (moved here from marketing_opt_in)
  at TEXT NOT NULL,
  PRIMARY KEY (addr, list)
);
-- The old single box named both types, so a stored tick or stop counts for both. marketing_opt_in is no longer read.
INSERT OR IGNORE INTO mail_on (addr, list, via, at) SELECT email_hash, 'releases', 'tick', COALESCE(marketing_opt_in_at, created_at) FROM pro_accounts WHERE marketing_opt_in = 1 AND email_hash IS NOT NULL;
INSERT OR IGNORE INTO mail_on (addr, list, via, at) SELECT email_hash, 'tips', 'tick', COALESCE(marketing_opt_in_at, created_at) FROM pro_accounts WHERE marketing_opt_in = 1 AND email_hash IS NOT NULL;
INSERT OR IGNORE INTO mail_off (addr, list, reason, at) SELECT addr, 'releases', reason, at FROM mail_off WHERE list = 'marketing';
INSERT OR IGNORE INTO mail_off (addr, list, reason, at) SELECT addr, 'tips', reason, at FROM mail_off WHERE list = 'marketing';
DELETE FROM mail_off WHERE list = 'marketing';
