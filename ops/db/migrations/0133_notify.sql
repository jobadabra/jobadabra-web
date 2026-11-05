-- The notification switchboard (owner, 5 Nov 2026; admin/notifications.js, api/ops-notify.js): the owner's settings per alert, the three Telegram channels, and every send.
-- notify_settings: a row only for an alert the owner changed; the registry (shared/notify-registry.js) holds the defaults, so a new alert needs no migration.
-- notify_channels: a bot the owner connected in Admin; token_enc is AES-GCM under the Worker secret NOTIFY_SECRET (shared/notify-vault.js), never shown back.
-- notify_log: one row per send (delivered or failed), plus "sent without switchboard" rows a sender reports after its fail-open post. Kept 30 days. No names or e-mail addresses: the text is not stored.
CREATE TABLE IF NOT EXISTS notify_settings (event TEXT PRIMARY KEY, enabled INTEGER, mode TEXT, channel TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notify_channels (channel TEXT PRIMARY KEY, token_enc TEXT NOT NULL, chat_id TEXT NOT NULL, bot_name TEXT NOT NULL DEFAULT '', chat_title TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, at TEXT NOT NULL, channel TEXT NOT NULL DEFAULT '', sent INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT 'switchboard');
CREATE INDEX IF NOT EXISTS notify_log_event_at ON notify_log (event, at);
