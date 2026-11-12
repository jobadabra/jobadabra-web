-- The rounds the owner chose to show on the public /benchmark (admin/benchmark-publish.js; owner, 12 Nov 2026: "First I should see them more in depth in Admin, and then having a button to publish them on the website").
-- One row per press of "Publish to website"; the newest row of a kind is what /benchmark-results.json serves, "Unpublish" deletes it so the one before (or, with none, the starting snapshot in the site's files) shows again.
-- body = the allowlisted public snapshot of that kind (aggregate counts and tool names, no answers, no listings), built when the owner confirmed.
CREATE TABLE IF NOT EXISTS benchmark_published (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, round TEXT NOT NULL, published_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS benchmark_published_kind ON benchmark_published (kind, id);
