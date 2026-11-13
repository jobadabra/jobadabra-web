-- The Always on LinkedIn trial (api/linkedin-turn.js; jobadabra spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md, Caps): each turn a cloud run asked for and
-- what LinkedIn answered (status and one word, never page text), the 6-hour cache of the public cards, and the one 24-hour stop. No install id, no person, no cookie.
CREATE TABLE IF NOT EXISTS linkedin_turns (id TEXT PRIMARY KEY, asked_at TEXT NOT NULL, day TEXT NOT NULL, way TEXT NOT NULL, kind TEXT NOT NULL,
  url_hash TEXT NOT NULL, answer TEXT NOT NULL, status INTEGER, word TEXT, answered_at TEXT);
CREATE INDEX IF NOT EXISTS linkedin_turns_day ON linkedin_turns (day, answer);
CREATE TABLE IF NOT EXISTS linkedin_cache (url_hash TEXT PRIMARY KEY, body TEXT NOT NULL, kept_until TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS linkedin_stop (id INTEGER PRIMARY KEY CHECK (id = 1), until TEXT NOT NULL, why TEXT NOT NULL);
