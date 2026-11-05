// Synthetic monitoring (spec docs/superpowers/specs/2026-11-01-synthetic-monitoring-design.md): every 15 minutes the Worker asks its own public services one question each and
// checks that the answer says what a working service says, not only HTTP 200. One D1 row per probe per round; two reds in a row tell the owner once on the Sentry Telegram bot, the
// first green tells "back". REPORT ONLY: nothing here blocks a merge, a beta or a request. Guard: test/unit/shared/synthetic.test.js.
// No secret beyond what the Worker holds, no user data: the probe is one fixed install whose tokens are computed here (tokenFor), so nothing is minted and no counter moves.
import {tokenFor} from './guard.js';
import {chainOf, fetchHealth, problem} from './ai-broker.js';

export const ROUND_MINUTES = [5, 20, 35, 50];   // UTC minutes of the Worker's every-5-minutes tick; not :15 / :40, where the CI collectors start (shared/intel-start.js)
export const REDS_TO_TELL = 2, STALE_MIN = 45, TIMEOUT_MS = 10000, KEEP_DAYS = 30;
export const PROBE_INSTALL = 'synthetic-probe';
const SITE = 'https://www.jobadabra.top', API = 'https://www.jobpilotto.workers.dev';   // the aliases the apps call; the API host never changes (wrangler.toml)

/** Is this tick a probe round (a 5-minute tick at minute 5, 20, 35 or 50)? */
export const dueRound = date => ROUND_MINUTES.includes(date.getUTCMinutes());

class Red extends Error {}
const red = reason => { throw new Red(reason); };

// One request, 10 s: a short fixed-form reason on failure (never a body, a URL with a key, or a stack).
async function ask(fetcher, url, headers = {}) {
  let response;
  try { response = await fetcher(url, {headers, signal: AbortSignal.timeout(TIMEOUT_MS)}); }
  catch (error) { return red(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? `timeout ${TIMEOUT_MS / 1000}s` : 'unreachable'); }
  if (!response.ok) red(`HTTP ${response.status}`);
  return response;
}
const jsonOf = async (response, what) => response.json().catch(() => red(`${what} is not JSON`));

/** The probes. run({fetcher, env, key}) resolves when the service is up, throws Red(reason) when not, and returns 'skip' when the service is not bound in this environment. */
export const PROBES = [
  {id: 'site', label: 'Website', run: async ({fetcher}) => {
    const page = await (await ask(fetcher, `${SITE}/`)).text();
    if (!/<title>[^<]*Jobadabra/i.test(page)) red('page title missing');
  }},
  {id: 'index', label: 'Employer index pack', run: async ({fetcher}) => {
    const counts = await jsonOf(await ask(fetcher, `${API}/api/index?summary=1`), 'index summary');
    if (!(counts.employers > 0 && counts.jobs > 0)) red('no employers in the index');
  }},
  {id: 'license', label: 'Licence and plan check', run: async ({fetcher, key}) => {
    const plan = await jsonOf(await ask(fetcher, `${API}/api/pro/status`, {'x-api-key': key}), 'plan answer');
    if (plan.ok !== true || !['free', 'pro'].includes(plan.plan)) red('no plan in the answer');
  }},
  {id: 'free-ai', label: 'Free AI key check', run: async ({fetcher, key}) => {
    const models = await jsonOf(await ask(fetcher, `${API}/api/ai/v1/models`, {'x-api-key': key}), 'models answer');
    if (!Array.isArray(models.data)) red('no model list');
    const caps = await jsonOf(await ask(fetcher, `${API}/api/ai/caps`, {'x-api-key': key}), 'caps answer');
    if (caps.ok !== true || typeof caps.lane !== 'string') red('no lane in the caps');
  }},
  {id: 'updates', label: 'Update feed', run: async ({fetcher}) => {
    const release = await jsonOf(await ask(fetcher, `${API}/api/releases/latest`), 'release');
    const names = (release.assets || []).map(asset => String(asset.name));
    if (!/^(desktop-)?v?\d+\.\d+\.\d+/.test(String(release.tag_name))) red('no version tag');
    if (!names.some(name => /\.dmg$/.test(name)) || !names.some(name => /\.exe$/.test(name))) red('Mac or Windows installer missing');
  }},
  {id: 'broker', label: 'AI broker', run: async ({env}) => {
    if (!env.AI_BROKER) return 'skip';
    const response = await fetchHealth(env, TIMEOUT_MS).catch(() => red('unreachable'));
    if (!response.ok) red(`HTTP ${response.status}`);
    const health = await jsonOf(response, 'broker health'), fallback = health.fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fallback?.day)) || !Number.isFinite(fallback.freeAiCap)) red('no day meters');
    const wrong = problem(chainOf(health));
    if (wrong) red(wrong);
  }},
];

/** One round: every probe at once, each alone in its try. -> [{probe, ok, ms, reason}] (a skipped probe is left out). */
export async function runRound(env, {fetcher = fetch, probes = PROBES} = {}) {
  const key = `JPF1.${PROBE_INSTALL}.${await tokenFor(PROBE_INSTALL, env, 'ai')}`;
  const rows = await Promise.all(probes.map(async probe => {
    const start = Date.now();
    try {
      if (await probe.run({fetcher, env, key}) === 'skip') return null;
      return {probe: probe.id, ok: 1, ms: Date.now() - start, reason: ''};
    } catch (error) {
      return {probe: probe.id, ok: 0, ms: Date.now() - start, reason: error instanceof Red ? error.message : 'probe failed'};
    }
  }));
  return rows.filter(Boolean);
}

/** Stores the round's rows, then moves each probe's state: down after REDS_TO_TELL reds in a row, up on the first green. told = 0 marks a change the owner has not been told yet. */
export async function settle(db, rows, at) {
  const events = [];
  for (const row of rows) {
    const before = await db.prepare('SELECT state, since, red_since, streak, told FROM synthetic_state WHERE probe = ?').bind(row.probe).first();
    const was = before?.state || 'up', streak = row.ok ? 0 : (before?.streak || 0) + 1;
    const state = row.ok ? 'up' : streak >= REDS_TO_TELL ? 'down' : was;
    const changed = state !== was, since = changed || !before ? at : before.since;
    // A "back" after a "down" nobody was told about is not worth a message.
    const redSince = row.ok || streak > 1 ? before?.red_since || '' : at;   // the first red of a streak; kept through "down" and the green after it
    const told = changed ? (state === 'up' && before?.told === 0 ? 1 : 0) : (before?.told ?? 1);
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO synthetic_probes (probe, at, ok, ms, reason) VALUES (?, ?, ?, ?, ?)').bind(row.probe, at, row.ok, row.ms, row.reason),
      db.prepare('INSERT OR REPLACE INTO synthetic_state (probe, state, since, red_since, streak, reason, told) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(row.probe, state, since, redSince, streak, row.ok ? '' : row.reason, told),
    ]);
    if (changed && !told) events.push(row.probe);
  }
  return events;
}

const label = id => PROBES.find(probe => probe.id === id)?.label || id;
const text = value => String(value ?? '').replace(/[<>&]/g, char => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[char]));
const clock = iso => String(iso).slice(11, 16);

/** The one Telegram message for the changes not told yet (rows with told = 0), then marks them told. Telegram failing leaves them untold: the next round tries again. */
export async function tell(env, db, fetcher = fetch) {
  if (env.SYNTHETIC_TELEGRAM === 'off' || !env.SENTRY_TELEGRAM_TOKEN || !env.SENTRY_TELEGRAM_CHAT) return 0;
  const { results = [] } = await db.prepare('SELECT probe, state, red_since, streak, reason FROM synthetic_state WHERE told = 0 ORDER BY probe').all();
  if (!results.length) return 0;
  const base = env.SITE_URL || SITE;
  const lines = results.map(row => (row.state === 'down'
    ? `🔴 <b>Down</b> · ${text(label(row.probe))}\n<code>${text(row.reason)}</code> · ${row.streak} reds in a row since ${clock(row.red_since)} UTC`
    : `🟢 <b>Back</b> · ${text(label(row.probe))}\nDown since ${clock(row.red_since)} UTC`));
  const response = await fetcher(`https://api.telegram.org/bot${env.SENTRY_TELEGRAM_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: env.SENTRY_TELEGRAM_CHAT, parse_mode: 'HTML', disable_web_page_preview: true, text: `${lines.join('\n\n')}\n\n<a href="${base}/admin/testing/overview">Testing overview</a>`})}).catch(() => null);
  if (!response?.ok) return 0;
  await db.batch(results.map(row => db.prepare('UPDATE synthetic_state SET told = 1 WHERE probe = ?').bind(row.probe)));
  return results.length;
}

/**
 * The Worker's every-5-minutes tick. Does nothing off the round minutes, with SYNTHETIC = "off" or without D1. Never throws: a probe or Telegram problem must not fail the
 * tick the other jobs share. -> {ran, rows, told}
 */
export async function tick(env, now = new Date(), {fetcher = fetch} = {}) {
  if (!dueRound(now) || env.SYNTHETIC === 'off' || !env.STATS) return {ran: false, rows: 0, told: 0};
  try {
    const rows = await runRound(env, {fetcher});
    await settle(env.STATS, rows, now.toISOString().slice(0, 16) + ':00Z');
    return {ran: true, rows: rows.length, told: await tell(env, env.STATS, fetcher).catch(() => 0)};
  } catch (error) { console.error(`synthetic round: ${error.message}`); return {ran: false, rows: 0, told: 0}; }
}

/** Rows older than KEEP_DAYS go in the daily job. */
export async function purge(env, now = Date.now()) {
  if (env.STATS) await env.STATS.prepare('DELETE FROM synthetic_probes WHERE at < ?').bind(new Date(now - KEEP_DAYS * 86400000).toISOString()).run();
}

/** The card's data: {lastRoundAt, stale, probes: [{probe, label, ok, at, ms, reason, state, since, uptime24h}]}. null when D1 or the tables are unreadable. */
export async function readCard(env, now = new Date()) {
  try {
    const from = new Date(now.getTime() - 86400000).toISOString();
    const [latest, states, sums] = await Promise.all([
      env.STATS.prepare('SELECT probe, at, ok, ms, reason FROM synthetic_probes WHERE at = (SELECT MAX(at) FROM synthetic_probes p WHERE p.probe = synthetic_probes.probe)').all(),
      env.STATS.prepare('SELECT probe, state, since FROM synthetic_state').all(),
      env.STATS.prepare('SELECT probe, COUNT(*) AS n, SUM(ok) AS good FROM synthetic_probes WHERE at >= ? GROUP BY probe').bind(from).all()]);
    const probes = (latest.results || []).map(row => {
      const state = (states.results || []).find(item => item.probe === row.probe), sum = (sums.results || []).find(item => item.probe === row.probe);
      return {probe: row.probe, label: label(row.probe), ok: !!row.ok, at: row.at, ms: row.ms, reason: row.reason, state: state?.state || 'up', since: state?.since || row.at,
        uptime24h: sum?.n ? Math.round(100 * sum.good / sum.n) : null};
    }).sort((a, b) => a.probe.localeCompare(b.probe));
    const lastRoundAt = probes.reduce((newest, item) => (item.at > newest ? item.at : newest), '');
    return {lastRoundAt, stale: !lastRoundAt || now.getTime() - Date.parse(lastRoundAt) > STALE_MIN * 60000, probes};
  } catch { return null; }
}

/**
 * One state per UTC day for the Overview's 14-day health map, oldest first, ending today: [{day: 'YYYY-MM-DD', state: 'green' | 'red' | 'none'}].
 * red = some probe was red in two STORED rounds in a row that day, whatever the time between them: exactly settle()'s rule, so the map and the alert never disagree (a skipped tick must not make a told "Down"
 * a green day; Gitar, #264). green = rounds ran and none did; none = no rows that day (before monitoring began, or the Worker was dead all day). Two small D1 reads (day counts, and the few red days
 * through LAG), not every row. null when D1 or the tables are unreadable. Why (1 Nov 2026, to): one reader, so the page never writes a second per-day query.
 */
export async function readDays(env, days = 14, now = new Date()) {
  const by = await readDaysByProbe(env, days, now);
  if (!by) return null;
  const lists = Object.values(by);
  return (lists[0] || []).map((cell, i) => ({day: cell.day, state: lists.some(list => list[i].state === 'red') ? 'red' : lists.some(list => list[i].state === 'green') ? 'green' : 'none'}));
}

/**
 * The same map per probe: {probeId: [{day, state}]} for every probe in PROBES, oldest first, ending today; each probe's own red days (its own 2 reds in a row) and its own ran days. readDays() is the
 * union of these, so the Overview's row and the Synthetic Monitoring tab's rows never disagree. null when D1 or the tables are unreadable.
 * Why (1 Nov 2026, Gitar on #273): one all-probes history on every probe row showed a broker outage as a red Website day.
 */
export async function readDaysByProbe(env, days = 14, now = new Date()) {
  try {
    const today = now.toISOString().slice(0, 10), start = Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000;
    const first = `${new Date(start).toISOString().slice(0, 10)}T00:00:00Z`, lookback = new Date(start - 86400000).toISOString();   // a streak may begin the evening before the first day
    const [ran, reds] = await Promise.all([
      env.STATS.prepare('SELECT probe, substr(at, 1, 10) AS day, COUNT(*) AS n FROM synthetic_probes WHERE at >= ? GROUP BY probe, day').bind(first).all(),
      env.STATS.prepare('SELECT probe, substr(at, 1, 10) AS day FROM (SELECT probe, at, ok, LAG(ok) OVER (PARTITION BY probe ORDER BY at) AS prev FROM synthetic_probes WHERE at >= ?) WHERE ok = 0 AND prev = 0 AND at >= ? GROUP BY probe, day')
        .bind(lookback, first).all()]);
    const redDays = new Set((reds.results || []).map(row => `${row.probe}|${row.day}`)), seen = new Set((ran.results || []).filter(row => row.n > 0).map(row => `${row.probe}|${row.day}`));
    return Object.fromEntries(PROBES.map(probe => [probe.id, Array.from({length: days}, (_, i) => {
      const day = new Date(start + i * 86400000).toISOString().slice(0, 10), key = `${probe.id}|${day}`;
      return {day, state: redDays.has(key) ? 'red' : seen.has(key) ? 'green' : 'none'};
    })]));
  } catch { return null; }
}

/** GET /api/synthetic/last: when the newest probe round ran, nothing else (the bot Worker's heartbeat reads it from outside). */
export async function lastRoute(request, env) {
  if (request.method !== 'GET') return new Response('GET only', {status: 405});
  const row = await env.STATS?.prepare('SELECT MAX(at) AS at FROM synthetic_probes').first().catch(() => null);
  return Response.json({at: row?.at || null}, {headers: {'Cache-Control': 'no-store'}});
}
