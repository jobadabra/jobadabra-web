// Where the What's new page gets its versions (owner, 18 Oct 2026: it publishes itself for every beta and stable). CI (changelog-publish.yml → jobs/changelog-publish.mjs) drafts each new version with the AI and sends it
// (PUT /changelog/data, Bearer SELFHEAL_PUBLISH_KEY); the site checks it AGAIN with the same rules (admin/changelog.js) and keeps one row per version (changelog_entries). GET /changelog/data (same key) says what is stored,
// so CI drafts a version once. GET /changelog.json (public, cached 5 minutes) is what the page reads; with no row yet it falls back to public/changelog-seed.json. No commit, no PR. Guard: test/unit/admin/changelog/changelog-store.test.js.
import {equal} from '../shared/guard.js';
import {CHANNELS, newestFirst, problems} from './changelog.js';
import {draft} from './release-mail.js';

const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});

// PUT {entries: [{version, date, channel, groups}], hidden: [{version, date, channel}], channels: {version: channel}}
//   entries: a drafted version (checked, stored once: a stored body is never replaced); hidden: a version with nothing to say; channels: a stored version became stable (beta -> stable only).
//   plain: true on an entry = written without the AI (it could not draft, 24 Oct 2026); redraft: [entry] replaces the body of a stored PLAIN version with the AI's, once (plain -> 0); a body that is not plain is never replaced.
// GET: {have: {version: channel}} for every stored version, hidden ones too; plain: [versions] still waiting for the AI's words.
export async function ingest(request, env) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  if (request.method === 'GET') {
    const {results = []} = await env.STATS.prepare('SELECT version, channel, plain FROM changelog_entries').all();
    return json({have: Object.fromEntries(results.map(row => [row.version, row.channel])), plain: results.filter(row => row.plain).map(row => row.version)});
  }
  if (request.method !== 'PUT') return new Response('Not found', {status: 404});
  const text = await request.text();
  if (text.length > 200000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(text); } catch { return new Response('Not JSON', {status: 400}); }
  const entries = Array.isArray(data?.entries) ? data.entries : [], hidden = Array.isArray(data?.hidden) ? data.hidden : [];
  if (entries.length > 50 || hidden.length > 50) return new Response('Unexpected shape', {status: 400});
  const redraft = Array.isArray(data?.redraft) ? data.redraft : [];
  if (redraft.length > 50) return new Response('Unexpected shape', {status: 400});
  const bad = [...entries, ...redraft].map(entry => ({version: entry?.version, problems: problems(entry)})).filter(item => item.problems.length);
  if (bad.length) return json({ok: false, rejected: bad}, 422);
  const at = new Date().toISOString();
  const write = env.STATS.prepare('INSERT INTO changelog_entries (version, date, channel, hidden, body, at, plain) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(version) DO NOTHING');
  const promote = env.STATS.prepare(`UPDATE changelog_entries SET channel = 'stable' WHERE version = ? AND channel = 'beta'`);
  const note = item => /^\d+\.\d+\.\d+$/.test(item?.version || '') && /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') && CHANNELS.includes(item?.channel);
  const rewrite = env.STATS.prepare('UPDATE changelog_entries SET body = ?, plain = 0, at = ? WHERE version = ? AND plain = 1 AND hidden = 0');
  await env.STATS.batch([...entries.map(entry => write.bind(entry.version, entry.date, entry.channel, 0, JSON.stringify(entry.groups), at, entry.plain ? 1 : 0)),
    ...redraft.map(entry => rewrite.bind(JSON.stringify(entry.groups), at, entry.version)),
    ...hidden.filter(note).map(item => write.bind(item.version, item.date, item.channel, 1, '[]', at, 0)),
    ...Object.entries(data?.channels || {}).filter(([version, channel]) => /^\d+\.\d+\.\d+$/.test(version) && channel === 'stable').map(([version]) => promote.bind(version))]);
  // Why (5 Nov 2026, owner): every stable release drafts changes since the previous stable, even when the final build has no notes of its own.
  const stable = [...entries.filter(entry => entry.channel === 'stable').map(entry => entry.version), ...hidden.filter(note).filter(entry => entry.channel === 'stable').map(entry => entry.version), ...Object.entries(data?.channels || {}).filter(([, channel]) => channel === 'stable').map(([version]) => version)];
  for (const version of new Set(stable)) await draft(env, version).catch(error => console.error(`release mail draft ${version}: ${error.message}`));
  return json({ok: true, stored: entries.length, hidden: hidden.length});
}

// GET /changelog.json: the shown versions, newest first (the page's one read).
export async function list(request, env) {
  let rows = [];
  try { ({results: rows = []} = await env.STATS.prepare('SELECT version, date, channel, body FROM changelog_entries WHERE hidden = 0').all()); } catch { rows = []; }
  if (!rows.length) return env.ASSETS.fetch(new Request(new URL('/changelog-seed.json', request.url), request));   // not public/changelog.json: a static file with the route's name would be served before this code runs
  const entries = rows.map(row => ({version: row.version, date: row.date, channel: row.channel, groups: JSON.parse(row.body)}));
  return json(newestFirst(entries), 200, {'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex'});   // Why (12 Nov 2026, Search Console): a data file Google crawled and judged "Crawled - currently not indexed"; the header says that on purpose. The seed fallback gets it from public/_headers
}
