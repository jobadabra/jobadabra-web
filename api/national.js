// National public employment services' job ads for installs (owner, 12 Nov 2026, asked via AskUserQuestion by sa: "Yes, add them (Recommended)" and
// "Yes, prepare both (Recommended)": "the keys held on our site Worker so every install can use them"). A service whose official feed needs a key the app
// must never hold is read here (api/national-feed.js keeps its ads in D1 national_ads) and searched by installs:
//   GET /api/index/national?country=no&q=<role word>[&lat=&lon=&r=<km>][&offset=]   Bearer <install token, purpose 'index'>, X-Install-Id
//   -> 200 {ok, total, rows: [{id, title, employer, place, date, url}]}  at most PAGE rows, newest first
//   -> 204 when the country is off (kill switch NATIONAL_FEEDS, no key, or a beta-only country for a non-beta install): the app reads nothing and says nothing.
// Why not a second delivery path (CLAUDE.local "Never a second delivery path"): that rule is for learned data that becomes prompt text (recipes, aliases,
// hints) and goes through the pack; these are a source's listings, read like EURES's, never prompt text. They sit under the employer index's route
// (/api/index/…), its install token (purpose 'index') and its revoke list, so no new credential or gate exists.
// Kill switch: NATIONAL_FEEDS = "<cc>[:beta],…" in wrangler.toml [vars]; a country missing is off, ":beta" serves only installs that opted into beta (X-Beta: 1).
// Invariant: a row served has exactly the fields rowOf keeps; nothing about a person is stored (the search words are not kept; usage is a count per install digest).
// Tests: test/unit/api/national.test.js.
import {authorize, flag} from '../shared/guard.js';
import {betaOf} from './canary-reach.js';
import PLACES from '../shared/norway-places.json' with {type: 'json'};
import {installHit} from '../shared/install-caps.js';

export const PAGE = 100;   // rows an answer holds: the engine's national reader asks 100 a page (src/sources/national.py PAGE)
export const PER_INSTALL_PER_DAY = 400;   // searches: a Find jobs press asks at most places x role words x pages (national.PAGES), well under this
const MAX_KM = 300, MAX_OFFSET = 2000, MAX_WORD = 60;

// Each service: its key's secret name, the address of an ad's own page (the terms: an ad opened from our list shows at the service), and where its places are.
export const SERVICES = {
  no: {secret: 'NAV_FEED_TOKEN', page: id => `https://arbeidsplassen.nav.no/stillinger/stilling/${id}`, places: PLACES.places},
};

const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store'}});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The one validator of an ad as kept and served: {id, title, employer, place, changed} or null. The feed reader keeps only what passes; the route serves only what passes. */
export function rowOf(item) {
  const id = String(item?.id || '').toLowerCase(), title = text(item?.title, 300), changed = new Date(item?.changed || '');
  if (!UUID.test(id) || !title || Number.isNaN(changed.getTime())) return null;
  return {id, title, employer: text(item?.employer, 200), place: text(item?.place, 80), changed: changed.toISOString()};
}

/** A municipality's name as people write it ("NORDRE FOLLO" -> "Nordre Follo"). */
export const placeName = name => text(name, 80).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (all, cut, letter) => cut + letter.toUpperCase());

/** The point of a municipality named by the feed: [lat, lon], or null when unknown or shared by two municipalities (then only whole-country searches see it). */
export const pointOf = (country, name) => SERVICES[country]?.places[text(name, 80).toLowerCase()] || null;

/** The words a search matches: the lowercased title (SQLite's LIKE folds ASCII only, so æ, ø and å are folded here). */
export const findOf = title => title.toLocaleLowerCase('nb');

/** Which countries are on, and whether only for beta installs: {no: 'on'|'beta'}. A country without its key is off. */
export function switches(env) {
  const out = {};
  for (const part of String(env?.NATIONAL_FEEDS || '').split(',').map(word => word.trim().toLowerCase()).filter(Boolean)) {
    const [country, mode] = part.split(':');
    if (SERVICES[country] && env[SERVICES[country].secret]) out[country] = mode === 'beta' ? 'beta' : 'on';
  }
  return out;
}

/** The search's box around a point: [south, north, west, east], r capped at MAX_KM; null without a point (the whole country). */
export function boxOf(lat, lon, r) {
  if (![lat, lon].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const km = Math.min(Math.max(Number.isFinite(r) ? r : 0, 1), MAX_KM), dlat = km / 111, dlon = km / (111 * Math.max(Math.cos(lat * Math.PI / 180), 0.05));
  return [lat - dlat, lat + dlat, lon - dlon, lon + dlon];
}

/** One page of a country's kept ads whose title holds the word, in the box when given, newest first: {total, rows}. */
export async function search(db, country, {word, box = null, offset = 0}) {
  const like = `%${findOf(word).replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
  const where = `country = ? AND find LIKE ? ESCAPE '\\'${box ? ' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?' : ''}`;
  const args = [country, like, ...(box || [])];
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM national_ads WHERE ${where}`).bind(...args).first())?.n || 0;
  const rows = total > offset ? ((await db.prepare(`SELECT id, title, employer, place, changed FROM national_ads WHERE ${where} ORDER BY changed DESC LIMIT ? OFFSET ?`)
    .bind(...args, PAGE, offset).all()).results || []) : [];
  return {total, rows: rows.map(rowOf).filter(Boolean).map(row => ({id: row.id, title: row.title, employer: row.employer, place: row.place, date: row.changed.slice(0, 10), url: SERVICES[country].page(row.id)}))};
}

/** GET /api/index/national: see the header. */
export async function nationalSearch(request, env, now = new Date()) {
  if (request.method !== 'GET') return json(405, {ok: false, error: 'GET only'});
  const url = new URL(request.url), country = (url.searchParams.get('country') || '').toLowerCase();
  const access = await authorize(env, request.headers.get('X-Install-Id') || '', (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), 'index');
  if (!access.ok) return json(401, {ok: false, error: 'token needed', hint: "POST /api/install-token {install, purpose: 'index'}"});
  const mode = switches(env)[country];
  if (!mode || (mode === 'beta' && !betaOf(request)) || !env.STATS) return json(204, null);
  const word = text(url.searchParams.get('q'), MAX_WORD);
  const offset = Math.min(Math.max(Math.trunc(Number(url.searchParams.get('offset')) || 0), 0), MAX_OFFSET);
  if (!word) return json(400, {ok: false, error: 'q (one role word) needed'});
  const day = now.toISOString().slice(0, 10);
  const used = await env.STATS.prepare(`INSERT INTO national_use (day, who, n) VALUES (?, ?, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n`).bind(day, access.who).first();
  const full = (used?.n || 0) > PER_INSTALL_PER_DAY;
  await installHit(env, 'national-day', access.who, used?.n || 0, PER_INSTALL_PER_DAY, {now, reached: full});   // 🟠 at 80%, 🔴 when refused: the hourly card (shared/install-caps.js; owner 13 Nov 2026, "Grouped hourly (Recommended)")
  if (full) { await flag(env, 'national-quota', access.who, country, now); return json(429, {ok: false, error: 'limit reached for today'}); }
  const point = ['lat', 'lon', 'r'].map(key => url.searchParams.has(key) ? Number(url.searchParams.get(key)) : NaN);
  const found = await search(env.STATS, country, {word, box: boxOf(...point), offset});
  return json(200, {ok: true, ...found});
}
