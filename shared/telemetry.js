// Technical reports from Jobadabra apps (desktop/lib/telemetry.js scrubs them before sending): what is kept (D1 "telemetry", 90 days) and how it is read.
// The POST that stores them is api/telemetry.js, the /admin/growth/app page is admin/telemetry.js, and a daily run (scheduled) drops old reports
// (problems are no longer filed as issues since 20 Oct 2026). Design: Notion "📡 Technical reports (telemetry) — design".
// Guarded by test/unit/shared/telemetry.test.js.
import {installsByEngine} from './engines.js';
import {tabHandoff} from './tab-handoff.js';

export const KINDS = ['crash', 'run_failed', 'run_warning', 'form_issue', 'stuck', 'health', 'setup', 'control', 'advice', 'tab', 'search'];
export const MAX_EVENTS = 50, MAX_BYTES = 8000, PER_INSTALL_PER_DAY = 1000, KEEP_DAYS = 90;
export const day = date => date.toISOString().slice(0, 10);
export const text = (value, max = 300) => String(value ?? '').slice(0, max);

// A second scrub on the server, in case an old app sends something it shouldn't: keys, emails, home folders.
export function scrub(value) {
  return String(value ?? '').replace(/sk-ant-[\w-]+|\bntn_\w+|\bsecret_\w+|\bgh[pousr]_\w+|github_pat_\w+|GOCSPX-[\w-]+|\b\d{6,12}:AA[\w-]{20,}/g, '<secret>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>').replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>');
}

// The same problem across users and versions: numbers, ids and quoted values don't make it a different one.
export const normal = value => String(value ?? '').replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b|[0-9a-f-]{36}/gi, '<id>').replace(/\d+/g, '#')
  .replace(/(["'])[^"']{0,80}\1/g, '"…"').slice(0, 160);
export function describe(item) {
  const frame = String(item.stack || '').split('\n').map(line => line.trim()).find(line => /\.(m?js|cjs|py)\b/.test(line)) || '';
  const place = frame.replace(/:\d+(:\d+)?\)?$/, '').replace(/.*\/(desktop|renderer|lib|pages|src|extension)\//, '$1/').slice(-80);
  switch (item.kind) {
    case 'crash': return {key: `crash|${item.where}|${item.type}|${place}|${normal(item.message)}`,
      summary: `${item.type || 'Error'}: ${text(item.message, 140)}${place ? ` (${place})` : ''}`};
    case 'run_failed': return {key: `run|${item.job}|${normal(item.error)}`, summary: `${item.job}: ${text(item.error, 150)}${item.cutOff ? ' (cut off)' : ''}`};
    case 'run_warning': return {key: `warn|${item.job}|${normal(item.warning)}`, summary: `${item.job}: ${text(item.warning, 150)} (ended with warnings)`};
    case 'form_issue': return {key: `form|${item.site}|${normal(item.label)}|${item.reason}`, summary: `${item.site}: ${text(item.label, 80)} (${item.reason || 'not filled'})`};
    case 'control': return {key: `control|${item.fp}|${item.outcome}|${normal(item.why)}`,
      summary: `Control ${text(item.control, 24)} ${text(item.fp, 16)}: ${item.outcome}${item.why ? ` (${text(item.why, 80)})` : ''}`};
    case 'advice': return {key: `advice|${item.where}|${item.advice}|${item.act}`, summary: `Advice ${text(item.advice, 20)} on ${text(item.where, 20)}: ${text(item.act, 10)}${item.source ? ` (${text(item.source, 30)})` : ''}`};
    case 'tab': return {key: `tab|${item.outcome}`, summary: `Form tab: ${text(item.outcome, 30)}${item.outcome === 'taken' ? '' : ' (the extension did not take the tab the app opened)'}`};
    case 'stuck': return {key: `stuck|${item.action}|${item.page}`, summary: `Stuck: ${item.action} (${item.page || 'app'})`};
    case 'search': return {key: `search|${item.family}`, summary: `Search (${text(item.family, 20)}): ${item.in_places ?? '?'} in places, first in ${item.first_s ?? '–'} s`};
    default: return {key: 'health', summary: 'health'};
  }
}
// Whether a machine looks used: it reported on 2+ days, or sent anything past the first setup steps and the health line. One setup report on one day is "tried once"
// (a person who stopped at setup, or a test run: the table can't say which, so it doesn't claim to).
export const useOf = ({days = 0, beyond = 0} = {}) => days >= 2 || beyond > 0 ? 'in use' : 'tried once';
export async function hash(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The problems of the last `days`, most users first: one row per fingerprint, with its latest sample.
export async function problems(db, days, now = new Date(), limit = 50) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = (await db.prepare(`SELECT fingerprint, kind, MAX(summary) AS summary, COUNT(*) AS n, COUNT(DISTINCT install) AS users,
      GROUP_CONCAT(DISTINCT version) AS versions, MIN(day) AS first, MAX(at) AS last, MAX(data) AS sample
    FROM telemetry WHERE day >= ? AND kind NOT IN ('health', 'setup', 'search', 'advice') AND NOT (kind = 'tab' AND json_extract(data, '$.outcome') = 'taken') GROUP BY fingerprint ORDER BY users DESC, n DESC LIMIT ?`).bind(from, limit).all()).results || [];
  const installs = (await db.prepare(`SELECT version, platform, COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ?
    GROUP BY version, platform ORDER BY n DESC`).bind(from).all()).results || [];
  // Machines, not (version, platform) rows: one install that updated twice reports under three versions but is one machine.
  const unique = (await db.prepare('SELECT COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ?').bind(from).first())?.n || 0;
  const everSeen = (await db.prepare('SELECT COUNT(DISTINCT install) AS n FROM telemetry').first())?.n || 0;
  // Each machine once: the version it last reported (what is installed now), when it first and last reported, and every version it has run.
  const machineSql = columns => `SELECT install, platform, version AS current, MAX(at) AS last${columns} FROM telemetry GROUP BY install ORDER BY last DESC LIMIT 50`;
  const machines = (await db.prepare(machineSql(', (SELECT t.country FROM telemetry t WHERE t.install = telemetry.install AND t.country IS NOT NULL ORDER BY t.at DESC LIMIT 1) AS country')).all()
    .catch(() => db.prepare(machineSql('')).all())).results || [];   // before migration 0062: no country
  const history = (await db.prepare('SELECT install, version, MIN(at) AS at FROM telemetry GROUP BY install, version ORDER BY at').all()).results || [];
  const usage = new Map((((await db.prepare("SELECT install, COUNT(DISTINCT day) AS days, SUM(kind NOT IN ('setup', 'health')) AS beyond FROM telemetry GROUP BY install").all()).results) || []).map(row => [row.install, row]));
  for (const m of machines) {
    m.use = useOf(usage.get(m.install)); m.days = usage.get(m.install)?.days || 0;
    const own = history.filter(h => h.install === m.install);
    m.versions = own.map(h => h.version);
    m.first = own[0]?.at;
  }
  const platforms = (await db.prepare('SELECT platform, COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ? GROUP BY platform ORDER BY n DESC').bind(from).all()).results || [];
  // How it helped: each install's latest daily health line, summed (anonymous counts; "ever reached" for the funnel).
  const health = (await db.prepare(`SELECT t.data FROM telemetry t WHERE t.kind = 'health' AND t.day >= ?
    AND t.at = (SELECT MAX(at) FROM telemetry WHERE install = t.install AND kind = 'health')`).bind(from).all()).results || [];
  // Only installs that sent a count add to it; none yet → no number (shown "–", never a false 0).
  const outcomes = {}, counted = {};
  for (const row of health) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    for (const name of OUTCOMES) if (typeof data[name] === 'number') { outcomes[name] = (outcomes[name] || 0) + data[name]; counted[name] = (counted[name] || 0) + 1; }
  }
  outcomes.counted = counted;
  // Which AI each install runs (its latest health report): the four engines, to see plan vs API (owner, 9 Oct 2026; shared/engines.js).
  const engines = await installsByEngine(db, from).catch(() => []);
  const tabs = await tabHandoff(db, from).catch(() => []);
  return {from, days, rows, installs, unique, everSeen, platforms, machines, outcomes, reporting: health.length, engines, tabs};
}
// Machines by the channel they came from (the install link's ?src=, reported once by the app with its anonymous id):
// how many installed, how many finished setup, how many are active (reported on 2+ days). "unknown" = installed from a
// download button, or before the app reported a channel. A channel is a label, never a person.
export async function channels(db, days, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  return (await db.prepare(`WITH per AS (
      SELECT install, MAX(json_extract(data, '$.source')) AS source,
        COUNT(DISTINCT CASE WHEN kind = 'health' THEN day END) AS health_days,
        MAX(CASE WHEN kind = 'setup' AND json_extract(data, '$.step') = 'done' THEN 1 ELSE 0 END) AS done
      FROM telemetry WHERE day >= ? GROUP BY install)
    SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS machines, SUM(done) AS done, SUM(health_days >= 2) AS active
    FROM per GROUP BY COALESCE(source, 'unknown') ORDER BY machines DESC, source LIMIT 30`).bind(from).all()).results || [];
}

// Setup funnel (desktop/lib/setup-funnel.js): per install, the furthest step reached; installs that got at least that far.
export const STOP_REASONS = {ai: 'AI key or cost', time: 'Too long', privacy: 'Privacy',
  looking: 'Just looking', broke: 'Something broke', other: 'Other'};  // = desktop/lib/setup-funnel.js REASONS
export const SETUP_STEPS = ['welcome', 'ai', 'cv', 'draft', 'hosted', 'extras', 'done'];  // older apps also reported 'notion' (it left the wizard 3 Oct 2026; its row was dropped 25 Oct 2026): an unknown step is ignored
export async function funnel(db, days, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = (await db.prepare("SELECT install, data FROM telemetry WHERE kind = 'setup' AND day >= ?").bind(from).all()).results || [];
  const furthest = {}, minutesDone = [];
  let trial = 0;
  const trialInstalls = new Set();
  const stopped = {};  // step -> reason -> count ("Leaving setup?" and "Stuck? Tell us")
  for (const row of rows) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    if (data.step === 'stopped') {
      const at = String(data.where || '?'), why = String(data.reason || 'other');
      (stopped[at] ||= {})[why] = (stopped[at][why] || 0) + 1;
      continue;
    }
    const index = SETUP_STEPS.indexOf(data.step);
    if (index < 0) continue;
    furthest[row.install] = Math.max(furthest[row.install] ?? -1, index);
    if (data.step === 'done' && typeof data.minutes === 'number') minutesDone.push(data.minutes);
    if (data.ai === 'trial' || data.ai === 'free') trialInstalls.add(row.install);
  }
  trial = trialInstalls.size;
  const reached = SETUP_STEPS.map((step, i) => ({step, n: Object.values(furthest).filter(max => max >= i).length}));
  minutesDone.sort((a, b) => a - b);
  return {stopped, reached, started: Object.keys(furthest).length, medianMinutes: minutesDone.length ? minutesDone[Math.floor(minutesDone.length / 2)] : null, trial};
}

export const OUTCOMES = ['matches', 'goodFits', 'formsFilled', 'applied', 'replies', 'screenings', 'interviews', 'offers'];

// Daily (Worker cron): drop reports older than 90 days. The top problems are no longer sent to the private triage (owner, 20 Oct 2026: 0 of
// 18 such issues led to a fix; Sentry and its fixer handle crashes and failed runs): they stay counted here, on /admin/growth/app.
export async function daily(env, now = new Date()) {
  if (!env.STATS) return 0;
  await env.STATS.prepare('DELETE FROM telemetry WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_DAYS * 86400000))).run();
  return 0;
}
