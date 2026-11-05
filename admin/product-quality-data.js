// The ONE reader of the product-quality board (admin/product-quality.js judges what it returns): it composes readers the site already has, each failing to null so one broken source says "not measured"
// on its own area and never takes the page down. No new table, job or collector (owner, 5 Nov 2026: the sketch). Tables read: fill_cards, telemetry (search, crash, run_failed), synthetic_probes,
// plus the nightly summary, the self-healing snapshots, the e2e snapshot row, the answer counts and Sentry. Guard: test/unit/admin/report/product-quality.test.js.
import {since} from './admin.js';
import {answersByFamily} from './answer-metrics.js';
import {readSnapshot} from './e2e-intel.js';
import {FORM_FILLING} from './headlines-form.js';
import {lastDays, loadNightlySummary} from './nightly-summary.js';
import {finderJobs} from './report-only-finders.js';
import {issues} from './sentry.js';
import {snapshots} from './selfheal.js';
import {readCard} from '../shared/synthetic.js';
import {sampleOf} from '../shared/thin-data.js';
import {WINDOW} from './product-quality.js';

const safe = async read => { try { return await read(); } catch { return null; } };
const rowsOf = async (db, sql, ...binds) => (await db.prepare(sql).bind(...binds).all()).results || [];

/**
 * Everything the five areas need, read once. Each key is null when its source is missing or unreadable.
 * @param {object} env the Worker env (STATS D1, SENTRY_AUTH_TOKEN)
 * @param {Date} [now]
 * @returns {Promise<object>} the `inputs` of admin/product-quality-areas.js
 */
export async function loadInputs(env, now = new Date()) {
  const days = lastDays(now, WINDOW), from = days[0], db = env.STATS, week = since(now, 1), fortnight = since(now, 2), real = (id, ...args) => safe(() => FORM_FILLING[id](env, ...args));
  const [fill, nightly, answers, searches, probes, crashes, sentry, newProblems, snapshot, healing] = await Promise.all([
    db ? safe(async () => ({
      rows: await rowsOf(db, "SELECT day, SUM(filled) AS filled, SUM(required) AS required FROM fill_cards WHERE source = 'user' AND day >= ? GROUP BY day", from),
      sample: sampleOf(await rowsOf(db, "SELECT install FROM fill_cards WHERE source = 'user' AND day >= ?", fortnight)),
      benchmark: (await real('/admin/form-filling/benchmark', now))?.[0] || null, lab: (await real('/admin/form-filling/lab', now))?.[0] || null})) : null,
    safe(() => loadNightlySummary(env, now, WINDOW)),
    db ? safe(() => answersByFamily(db, week, since(now, 2))) : null,
    db ? safe(async () => ({rows: (await rowsOf(db, "SELECT day, install, CAST(json_extract(data, '$.first_s') AS REAL) AS s FROM telemetry WHERE kind = 'search' AND day >= ? AND json_extract(data, '$.first_s') IS NOT NULL ORDER BY day DESC LIMIT 20000", from)).filter(row => Number.isFinite(row.s))})) : null,
    db ? safe(async () => ({rows: await rowsOf(db, 'SELECT substr(at, 1, 10) AS day, COUNT(*) AS n, SUM(ok) AS good FROM synthetic_probes WHERE at >= ? GROUP BY day', `${from}T00:00:00Z`), card: await readCard(env, now)})) : null,
    db ? safe(async () => {
      const by = Object.fromEntries((await rowsOf(db, "SELECT CASE WHEN day >= ? THEN 'now' ELSE 'before' END AS p, COUNT(*) AS n, COUNT(DISTINCT install) AS installs FROM telemetry WHERE kind = 'crash' AND day >= ? GROUP BY p", week, fortnight)).map(row => [row.p, row]));
      return {now: {n: by.now?.n || 0, installs: by.now?.installs || 0}, before: {n: by.before?.n || 0}};
    }) : null,
    env.SENTRY_AUTH_TOKEN ? safe(async () => (await issues(env, 'users')).length) : null,
    db ? safe(async () => rowsOf(db, "SELECT first AS day, COUNT(*) AS n FROM (SELECT MIN(day) AS first FROM telemetry WHERE kind IN ('crash', 'run_failed') GROUP BY fingerprint) WHERE first >= ? GROUP BY first", from)) : null,
    db ? safe(() => readSnapshot(db)) : null,
    db ? safe(() => snapshots(env)) : []]);
  const filed = finderJobs(healing || [], days).filter(job => job.id.startsWith('finder-') && job.value !== '–').map(job => Number(job.value));
  return {days, fill, nightly, answers, searches, probes, crashes, sentry, newProblems, snapshot, finders: filed.length ? filed.reduce((sum, n) => sum + n, 0) : null};
}
