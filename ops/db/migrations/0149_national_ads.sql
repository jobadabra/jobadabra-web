-- National public employment services' job ads, kept by the site from their official feeds (api/national-feed.js) and searched by installs (api/national.js).
-- Feed-page fields only, never a contact or a person: an ad's id at the service, its title, employer, municipality and when it last changed; `find` is the
-- lowercased title the search matches; lat/lon are the municipality's point (shared/norway-places.json), NULL when the name is unknown or shared by two.
-- A row leaves when the feed marks the ad inactive (the terms: "immediately"), or 183 days after its last change (an ad lives 6 months at most).
CREATE TABLE IF NOT EXISTS national_ads (
  country TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  employer TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  lat REAL,
  lon REAL,
  changed TEXT NOT NULL,
  find TEXT NOT NULL,
  PRIMARY KEY (country, id)
);
CREATE INDEX IF NOT EXISTS national_ads_box ON national_ads (country, lat);

-- Where each country's feed was left: the page to ask next with its ETag and Last-Modified (a 304 costs nothing), when it was last read, what the last
-- read wrote; `refused` holds the digest of a key the service refused (401/403): that key is never sent again, a new key is.
CREATE TABLE IF NOT EXISTS national_feeds (
  country TEXT PRIMARY KEY,
  page TEXT NOT NULL DEFAULT '',
  etag TEXT NOT NULL DEFAULT '',
  modified TEXT NOT NULL DEFAULT '',
  refused TEXT NOT NULL DEFAULT '',
  read_at TEXT NOT NULL,
  caught_up INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  written INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0
);

-- Searches per install per day (the cap), by the install's digest only.
CREATE TABLE IF NOT EXISTS national_use (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
