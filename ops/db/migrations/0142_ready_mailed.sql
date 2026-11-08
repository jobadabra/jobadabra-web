-- Ready to send: when the night's mail (api/ready-mail.js) was claimed, so a night reported twice mails once. NULL = not mailed.
ALTER TABLE ready_batches ADD COLUMN mailed_at TEXT;
