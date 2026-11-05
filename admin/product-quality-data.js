// The ONE reader of the product-quality board (admin/product-quality.js judges what it returns): it composes readers the site already has, each failing to null so one broken source says "not measured"
// on its own area and never takes the page down. No new table, job or collector (owner, 5 Nov 2026: the sketch). Tables read: fill_cards, telemetry (search, crash, run_failed), synthetic_probes,
// plus the nightly summary, the self-healing snapshots, the e2e snapshot row, the answer counts and Sentry: about 15 D1 queries a view (Why (5 Nov 2026): the Lab's "sites reaching the form" headline alone was 32, so it is not read here). Guard: test/unit/admin/report/product-quality.test.js.
import {since} from './admin.js';
import {answersByFamily} from './answer-metrics.js';
import {readSnapshot} from './e2e-intel.js';
import {FORM_FILLING} from './headlines-form.js';
import {lastDays, loadNightlySummary} from './nightly-summary.js';
import {finderJobs} from './report-only-finders.js';
import {issues} from './sentry.js';
import {snapshots} from './selfheal.js';
import {readCard} from '../shared/synthetic.js';
import {MIN_INSTALLS} from '../shared/thin-data.js';
import {WEEK, WINDOW} from './product-quality.js';
import {qualityModel} from './product-quality-areas.js';

// A source that throws is null ("not measured" on its own area) but never silent: its name and message go to the Worker log (golden rule: no swallowed errors; the page cannot tell "broken" from "empty" otherwise).
const safe = async (name, read) => { try { return await read(); } catch (error) { console.error(`product-quality: ${name} unreadable: ${error?.message || error}`); return null; } };
const rowsOf = async (db, sql, ...binds) => (await db.prepare(sql).bind(...binds).all()).results || [];

// The fill-card sample of the period counted in SQL (forms, distinct installs; a card from before the install column is never an install), the shape shared/thin-data.js sampleOf gives.
async function sampleIn(db, from) {
  const row = (await rowsOf(db, "SELECT COUNT(*) AS forms, COUNT(DISTINCT NULLIF(install, '')) AS installs FROM fill_cards WHERE source = 'user' AND day >= ?", from))[0] || {};
  const installs = row.installs || 0;
  return {forms: row.forms || 0, installs, min: MIN_INSTALLS, enough: installs >= MIN_INSTALLS};
}

/**
 * Everything the five areas need, read once. Each key is null when its source is missing or unreadable.
 * @param {object} env the Worker env (STATS D1, SENTRY_AUTH_TOKEN)
 * @param {Date} [now]
 * @param {{healing?: object[]}} [shared] the self-healing snapshots when the page already read them (one read per view)
 * @returns {Promise<object>} the `inputs` of admin/product-quality-areas.js
 */
export async function loadInputs(env, now = new Date(), {healing: known} = {}) {
  const days = lastDays(now, WINDOW), from = days[0], db = env.STATS, week = since(now, 1), fortnight = since(now, 2), real = (id, ...args) => safe(id, () => FORM_FILLING[id](env, ...args));
  const [fill, nightly, answers, searches, probes, crashes, sentry, newProblems, snapshot, healing] = await Promise.all([
    db ? safe('fill cards', async () => ({
      rows: await rowsOf(db, "SELECT day, SUM(filled) AS filled, SUM(required) AS required FROM fill_cards WHERE source = 'user' AND day >= ? GROUP BY day", from),
      sample: await sampleIn(db, fortnight),
      benchmark: (await real('/admin/form-filling/benchmark', now))?.[0] || null})) : null,
    safe('nightly summary', () => loadNightlySummary(env, now, WINDOW)),
    db ? safe('answer counts', () => answersByFamily(db, week, since(now, 2))) : null,
    db ? safe('searches', async () => ({rows: (await rowsOf(db, "SELECT day, install, CAST(json_extract(data, '$.first_s') AS REAL) AS s FROM telemetry WHERE kind = 'search' AND day >= ? AND json_extract(data, '$.first_s') IS NOT NULL ORDER BY day DESC LIMIT 20000", from)).filter(row => Number.isFinite(row.s))})) : null,
    db ? safe('live checks', async () => ({rows: await rowsOf(db, 'SELECT substr(at, 1, 10) AS day, COUNT(*) AS n, SUM(ok) AS good FROM synthetic_probes WHERE at >= ? GROUP BY day', `${from}T00:00:00Z`), card: await readCard(env, now)})) : null,
    db ? safe('crash reports', async () => {
      const by = Object.fromEntries((await rowsOf(db, "SELECT CASE WHEN day >= ? THEN 'now' ELSE 'before' END AS p, COUNT(*) AS n, COUNT(DISTINCT install) AS installs FROM telemetry WHERE kind = 'crash' AND day >= ? GROUP BY p", week, fortnight)).map(row => [row.p, row]));
      return {now: {n: by.now?.n || 0, installs: by.now?.installs || 0}, before: {n: by.before?.n || 0}};
    }) : null,
    env.SENTRY_AUTH_TOKEN ? safe('Sentry', async () => (await issues(env, 'users')).length) : null,
    db ? safe('new problems', async () => rowsOf(db, "SELECT first AS day, COUNT(*) AS n FROM (SELECT MIN(day) AS first FROM telemetry WHERE kind IN ('crash', 'run_failed') GROUP BY fingerprint) WHERE first >= ? GROUP BY first", from)) : null,
    db ? safe('e2e snapshot', () => readSnapshot(db)) : null,
    known !== undefined ? known : db ? safe('self-healing snapshots', () => snapshots(env)) : []]);
  // Why (Gitar on #412): a finder count is a rolling 7 days, so only a snapshot of the last 7 days counts; a stopped job is "not measured", not a stale number labelled as this week.
  const filed = finderJobs(healing || [], days.slice(-WEEK)).filter(job => job.id.startsWith('finder-') && job.value !== '–').map(job => Number(job.value));
  return {days, fill, nightly, answers, searches, probes, crashes, sentry, newProblems, snapshot, finders: filed.length ? filed.reduce((sum, n) => sum + n, 0) : null};
}

/**
 * The board's model for the page, or null when anything in it throws (the page then draws the nightly cards alone, as before this board existed).
 * @param {object} env
 * @param {Date} [now]
 * @param {object[]} [healing] the self-healing snapshots the page already read
 */
export async function loadQuality(env, now = new Date(), healing) {
  try { return qualityModel(await loadInputs(env, now, {healing})); } catch (error) { console.error(`product-quality: board failed: ${error?.message || error}`); return null; }
}
