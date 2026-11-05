-- Who owns each e-mail, the owner's stop per mail (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md; shared/mail-registry.js).
-- One row per mail the owner pressed. No row = the mail goes as its rules say. rhythm is kept for the later digest rhythm (spec PR 3).
CREATE TABLE IF NOT EXISTS mail_rule (
  id TEXT PRIMARY KEY,       -- a TEMPLATES name in shared/mail-templates.js
  enabled INTEGER NOT NULL,  -- 0 = the owner stopped it
  rhythm TEXT,
  at TEXT NOT NULL           -- ISO, when it was pressed
);
