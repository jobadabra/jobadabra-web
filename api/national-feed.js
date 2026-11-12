// Keeps Norway's public employment service ads (NAV's arbeidsplassen.no job vacancy feed, https://navikt.github.io/pam-stilling-feed) in D1 national_ads,
// which installs search through /api/index/national (api/national.js). The feed is every change to every ad in order, not a search: a page is its first
// item plus the next ones (pageSize up to 10,000), next_id points at the next page (null at the end, where the same page is asked again later), and an
// ETag + Last-Modified pair makes an unchanged page a 304 (NAV's own FeedController.kt / FeedService.kt, read 12 Nov 2026).
// Why once an hour (owner's e-mail to NAV, 12 Nov 2026: "one read of the feed per hour from one server"): the */5 tick at minute 25 reads up to PAGES pages.
// The terms (arbeidsplassen.nav.no/vilkar-api) ask that an inactive ad leave our results "immediately": here it leaves at the next hourly read.
// TODO(AI): every 15 minutes costs nothing (304s) and would match "immediately" better: an open choice for the owner (12 Nov 2026).
// Kept per ad: only the feed page's own fields (uuid, title, employer, municipality, last change): never the full ad, its contacts or any person.
// Safety: a 401 or 403 stops the read and that key is never sent again (its digest is kept; a new key is tried); a 429 ends this hour's read; no key, no request.
// Tests: test/unit/api/national-feed.test.js.
import {digestOf} from '../shared/guard.js';
import {findOf, placeName, pointOf, rowOf, switches} from './national.js';

export const FEED = 'https://pam-stilling-feed.nav.no';
export const PAGE_SIZE = 5000;   // items a feed page asks (the feed allows 10,000; 5,000 keeps one answer ~2 MB)
export const PAGES = 20;          // pages an hourly read follows at most: the first fill (~6 months of changes) takes a few hours, then one page an hour
export const KEEP_DAYS = 183;     // an ad lives 6 months at most (the feed's docs); a row older than that leaves, whatever the feed said
export const MINUTE = 25;         // the */5 tick that reads (minute 10 already carries the owner's pings)
const CHUNK = 200;                // statements per D1 batch

/** Whether this five-minute tick reads the feeds: once an hour, at MINUTE. */
export const isFeedTick = date => date.getUTCMinutes() === MINUTE;

/** A feed page's items as D1 changes, the last change of an ad winning: {put: [row], drop: [id]}. An item that fails rowOf is skipped and counted. */
export function changesOf(country, page) {
  const last = new Map();
  let skipped = 0;
  for (const item of Array.isArray(page?.items) ? page.items : []) {
    const entry = item?._feed_entry || {};
    if (entry.status === 'INACTIVE' && /^[0-9a-f-]{36}$/i.test(String(entry.uuid || ''))) { last.set(String(entry.uuid).toLowerCase(), null); continue; }
    const row = entry.status === 'ACTIVE' ? rowOf({id: entry.uuid, title: entry.title, employer: entry.businessName, place: placeName(entry.municipal || ''), changed: entry.sistEndret || item.date_modified}) : null;
    if (!row) { skipped += 1; continue; }
    last.set(row.id, row);
  }
  const put = [], drop = [];
  for (const [id, row] of last) {
    if (!row) { drop.push(id); continue; }
    const [lat, lon] = pointOf(country, row.place) || [null, null];
    put.push({...row, lat, lon, find: findOf(row.title)});
  }
  return {put, drop, skipped};
}

/** Writes one page's changes; an unchanged row is not rewritten. -> rows put, rows dropped. */
async function apply(db, country, {put, drop}) {
  const statements = [
    ...put.map(row => db.prepare(`INSERT INTO national_ads (country, id, title, employer, place, lat, lon, changed, find) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (country, id) DO UPDATE SET title = excluded.title, employer = excluded.employer, place = excluded.place, lat = excluded.lat, lon = excluded.lon,
      changed = excluded.changed, find = excluded.find WHERE national_ads.changed <> excluded.changed OR national_ads.title <> excluded.title`)
      .bind(country, row.id, row.title, row.employer, row.place, row.lat, row.lon, row.changed, row.find)),
    ...drop.map(id => db.prepare('DELETE FROM national_ads WHERE country = ? AND id = ?').bind(country, id)),
  ];
  let removed = 0;
  for (let at = 0; at < statements.length; at += CHUNK) {
    const done = await db.batch(statements.slice(at, at + CHUNK));
    done.slice(Math.max(0, put.length - at)).forEach(result => { removed += result?.meta?.changes || 0; });
  }
  return {written: put.length, removed};
}

const httpDate = date => date.toUTCString();

/**
 * One hourly read of Norway's feed into national_ads, from where the last one stopped. `fetcher` is fetch; `now` the tick's time.
 * -> {country, status: 'off'|'refused'|'caught-up'|'read'|'slowed'|'failed', pages, written, removed, skipped}
 */
export async function readNorway(env, {fetcher = fetch, now = new Date()} = {}) {
  const country = 'no', token = env.NAV_FEED_TOKEN, db = env.STATS;
  const result = {country, status: 'off', pages: 0, written: 0, removed: 0, skipped: 0};
  if (!switches(env)[country] || !token || !db) return result;
  const key = await digestOf(token);
  const state = await db.prepare('SELECT page, etag, modified, refused FROM national_feeds WHERE country = ?').bind(country).first() || {page: '', etag: '', modified: '', refused: ''};
  if (state.refused === key) return {...result, status: 'refused'};
  let {page, etag, modified} = state, caughtUp = false;
  for (let n = 0; n < PAGES && !caughtUp; n += 1) {
    const headers = {Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'jobadabra-web (one hourly read)'};
    const start = page ? `${FEED}/api/v1/feed/${page}?pageSize=${PAGE_SIZE}` : `${FEED}/api/v1/feed?pageSize=${PAGE_SIZE}`;
    if (page && etag) headers['If-None-Match'] = etag;
    if (page && modified) headers['If-Modified-Since'] = modified;
    if (!page) headers['If-Modified-Since'] = httpDate(new Date(now.getTime() - KEEP_DAYS * 86400000));   // the first fill starts where the oldest live ad can be
    let answer;
    try { answer = await fetcher(start, {headers}); } catch (error) { result.status = 'failed'; result.error = String(error?.message || error).slice(0, 120); break; }
    if (answer.status === 401 || answer.status === 403) {
      await db.prepare(`INSERT INTO national_feeds (country, refused, read_at) VALUES (?, ?, ?) ON CONFLICT (country) DO UPDATE SET refused = excluded.refused, read_at = excluded.read_at`)
        .bind(country, key, now.toISOString()).run();
      return {...result, status: 'refused', code: answer.status};
    }
    if (answer.status === 429) { result.status = 'slowed'; break; }
    if (answer.status === 304) { caughtUp = true; result.status = 'caught-up'; break; }
    if (!answer.ok) { result.status = 'failed'; result.code = answer.status; break; }
    const body = await answer.json();
    const changes = changesOf(country, body);
    const done = await apply(db, country, changes);
    result.pages += 1; result.written += done.written; result.removed += done.removed; result.skipped += changes.skipped;
    if (body?.next_id) { page = String(body.next_id); etag = ''; modified = ''; result.status = 'read'; continue; }
    page = String(body?.id || page); etag = answer.headers.get('ETag') || ''; modified = answer.headers.get('Last-Modified') || '';
    caughtUp = true; result.status = 'caught-up';
  }
  if (page) await db.prepare(`INSERT INTO national_feeds (country, page, etag, modified, refused, read_at, caught_up, pages, written, removed) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)
    ON CONFLICT (country) DO UPDATE SET page = excluded.page, etag = excluded.etag, modified = excluded.modified, refused = '', read_at = excluded.read_at,
    caught_up = excluded.caught_up, pages = excluded.pages, written = excluded.written, removed = excluded.removed`)
    .bind(country, page, etag, modified, now.toISOString(), caughtUp ? 1 : 0, result.pages, result.written, result.removed).run();
  return result;
}

/** Once a day: rows past KEEP_DAYS leave (an ad the feed never marked inactive). -> rows removed. */
export async function sweepNational(env, now = new Date()) {
  if (!env.STATS) return 0;
  const cut = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  return (await env.STATS.prepare('DELETE FROM national_ads WHERE changed < ?').bind(cut).run())?.meta?.changes || 0;
}
