-- Which app mail a held digest item is (shared/mail-registry.js APP_ROWS; spec PR 5): the digest drops an item whose mail the person turned off after it was held.
ALTER TABLE mail_held ADD COLUMN mail_row TEXT NOT NULL DEFAULT '';
