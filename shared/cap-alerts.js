// The site's lines that stop something for everyone (Free AI, the board web search, the form reports' day total), on the one cap alert (shared/cap-check.js: 🟠 approaching, 🔴 reached,
// once per period). Here the flags live in KV (WAITLIST) and a card goes through the switchboard (alertOwner). Sketch and inventory: https://claude.ai/artifact/PVB8Su2LfyX8uQc27duLhC.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it"):
// the Free AI $10 day stop was reached in silence. A new cap is one entry below; test/unit/shared/cap-alerts.test.js loops over every entry.
import {alertOwner} from './notify-send.js';
import {checkCap} from './cap-check.js';
import {LIMITS, allowanceOf} from './free-ai.js';
import {monthLine} from './free-ai-web.js';
import {ALL_BYTES_PER_DAY, ALL_REPORTS_PER_DAY} from './report-form.js';

/** Containers each cloud runner may run at once (workers/hosted-runner and workers/ready-runner wrangler.jsonc max_instances). */
export const RUNNER_CEILING = 100;
// Per runner: `live` = containers running now (an open run, a running night); `waiting` = ones opened 5+ minutes ago whose container never started (no first read of the run's
// profile; no job of the night begun): the trace a start Cloudflare refused leaves. `?` = now, then `cutoff(now minus 5 minutes)`, the clock each table keeps of the start.
// A night keeps no start time: ready.js start() sets expires_at = start + RUN_HOURS, so "started before t" is "expires_at before t + NIGHT_HOURS" (as api/ready-why.js reads it).
// Why (Gitar on #638): fill_at / created_at are when the night was planned or queued, so a night started late by a busy tick counted as refused the minute it turned running.
export const NIGHT_HOURS = 3;   // api/ready.js RUN_HOURS (shared/ may not import api/); test/unit/shared/cap-alerts.test.js holds the two equal
export const RUNNER_LIVE = {
  'find-jobs-runner': {live: 'SELECT COUNT(*) AS n FROM hosted_runs WHERE finished_at IS NULL AND expires_at > ?',
    waiting: 'SELECT COUNT(*) AS n FROM hosted_runs WHERE finished_at IS NULL AND expires_at > ? AND read_at IS NULL AND started_at < ?', cutoff: before => before},
  'apply-runner': {live: "SELECT COUNT(*) AS n FROM ready_batches WHERE state = 'running' AND expires_at > ?",
    waiting: "SELECT COUNT(*) AS n FROM ready_batches b WHERE b.state = 'running' AND b.expires_at > ? AND b.expires_at < ? AND NOT EXISTS (SELECT 1 FROM ready_jobs j WHERE j.batch = b.id AND j.started_at IS NOT NULL)",
    cutoff: before => new Date(before.getTime() + NIGHT_HOURS * 3600000)},
};
const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
const BUSY_TODAY = 'every Free install sees "Free AI is busy today" until 00:00 UTC';

/**
 * name -> {title, event (switchboard registry), period: 'day' | 'month', unit (shared/cap-check.js UNITS), line(env), approach(env) (both in the counter's own unit), sees (what people get), fix (what the owner can do, as "To move the stop: <fix>." / "To reopen it: <fix>.")}.
 * The Free AI lines keep the alert lines the owner set (FREE_AI_ALERT_USD, FREE_AI_MONTH_ALERT_USD); a line with none approaches at 80%.
 */
export const CAPS = {
  'free-ai-day': {title: 'Free AI today', event: 'free-ai-spend', period: 'day', unit: 'usd',
    line: env => num(env.FREE_AI_STOP_USD, LIMITS.stopUsd) * 1e6, approach: env => num(env.FREE_AI_ALERT_USD, LIMITS.alertUsd) * 1e6,
    sees: BUSY_TODAY, fix: 'raise FREE_AI_STOP_USD in workers/www/wrangler.toml'},
  'free-ai-month': {title: 'Free AI this month', event: 'free-ai-spend', period: 'month', unit: 'usd',
    line: env => num(env.FREE_AI_MONTH_STOP_USD, LIMITS.monthStopUsd) * 1e6, approach: env => num(env.FREE_AI_MONTH_ALERT_USD, LIMITS.monthAlertUsd) * 1e6,
    sees: 'every Free install sees "Free AI is busy this month" until the 1st', fix: 'raise FREE_AI_MONTH_STOP_USD in workers/www/wrangler.toml'},
  'free-ai-neurons': {title: 'Workers AI\'s free allowance today', event: 'free-ai-spend', period: 'day', unit: 'neurons',
    line: env => allowanceOf(env), approach: env => allowanceOf(env) * 0.8,
    sees: BUSY_TODAY, fix: 'move Workers AI to the paid plan, then set FREE_AI_NEURONS = "off" in workers/www/wrangler.toml'},
  'free-ai-web-month': {title: 'The Free AI board web search this month', event: 'free-ai-spend', period: 'month', unit: 'usd',
    line: env => monthLine(env) * 1e6, approach: env => monthLine(env) * 1e6 * 0.8,
    sees: 'installs on Free AI get no board web search until the 1st', fix: 'raise FREE_AI_WEB_MONTH_USD in workers/www/wrangler.toml'},
  'form-reports-day': {title: 'Form reports today', event: 'form-reports-full', period: 'day', unit: 'reports',
    line: () => ALL_REPORTS_PER_DAY, approach: () => ALL_REPORTS_PER_DAY * 0.8,
    sees: 'every Report press says "limit reached for today" until 00:00 UTC', fix: 'raise ALL_REPORTS_PER_DAY in shared/report-form.js'},
  'form-report-bytes-day': {title: 'Form report uploads today', event: 'form-reports-full', period: 'day', unit: 'bytes',
    line: () => ALL_BYTES_PER_DAY, approach: () => ALL_BYTES_PER_DAY * 0.8,
    sees: 'every Report press says "limit reached for today" until 00:00 UTC', fix: 'raise ALL_BYTES_PER_DAY in shared/report-form.js'},
  // Why (13 Nov 2026, owner, asked via AskUserQuestion: "100 each (Recommended)", "80% of the ceiling (Recommended)"; "80% warning and 100% critical"): a runner past its max_instances refuses
  // the next person's start (Cloudflare errors that start), and the Ready to send ceiling of 2 would have queued a third Pro person in silence. RUNNER_CEILING is the one number; a test holds
  // both runners' wrangler.jsonc max_instances to it.
  'find-jobs-runner': {title: 'Find jobs runner (Always on searches running now)', event: 'runner-capacity', period: 'day', unit: 'containers',
    line: () => RUNNER_CEILING, approach: () => RUNNER_CEILING * 0.8,
    sees: 'the runner is full and Cloudflare refused a start: a person\'s Always on search did not run', fix: 'raise max_instances in workers/hosted-runner/wrangler.jsonc and RUNNER_CEILING'},
  'apply-runner': {title: 'Apply runner (Ready to send nights and Full automation running now)', event: 'runner-capacity', period: 'day', unit: 'containers',
    line: () => RUNNER_CEILING, approach: () => RUNNER_CEILING * 0.8,
    sees: 'the runner is full and Cloudflare refused a start: a person\'s night or Full automation batch did not run', fix: 'raise max_instances in workers/ready-runner/wrangler.jsonc and RUNNER_CEILING'},
};
for (const [name, cap] of Object.entries(CAPS)) cap.name = name;

/**
 * Tells the owner about one of the site's caps after a counted call or at a refusal: `used` in the cap's own unit (null with `reached`, when the platform refused with no count of ours).
 * -> resolves to 'reached' | 'approaching' | null (what was sent, or nothing). Never rejects.
 */
export async function capCheck(env, name, used, {now = new Date(), fetcher = fetch, reached = false} = {}) {
  const kv = env?.WAITLIST;
  if (!kv) return null;
  return checkCap(env, CAPS[name], used, {now, reached, store: kv, send: (event, level, text) => send(env, event, level, text, fetcher)});
}

// The one send: the switchboard first, the Brain bot when it cannot deliver. -> true when the alert is done (sent, held on purpose by the switchboard, or nothing is configured at all).
// Why (5 Nov 2026, nt 2/4; kept from free-ai.js tellSpend): nothing configured (no bot, no store) is not a failed send: keeping the flag stops every later call from redoing the write (Gitar on #429).
/** One cap card through the switchboard. -> true when done: sent, or nothing configured to send with (no bot, no channel, no store). Never rejects. */
export async function send(env, event, level, text, fetcher) {
  const told = await alertOwner(env, event, {text, html: true, fetcher, level: 'problem', state: level,
    legacy: env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null}).catch(() => null);
  const unconfigured = told?.via === 'none' && (told.why === 'no-bot' || told.why === 'channel-not-connected' || told.why === 'no-store');
  return Boolean(unconfigured || told?.sent || told?.via === 'switchboard');
}

/**
 * The 5-minute tick's look at the two cloud runners: counts the containers live now and tells the owner through the cap alert, 🟠 at 80% of RUNNER_CEILING and 🔴 at the ceiling,
 * each once a day. Why (Gitar on #635; owner, 13 Nov 2026: "please resolve the suggestions in the next PR"): 🔴 needs a refused start, not a count (shared/cap-check.js:5-6), so it
 * comes only when the runner is full AND a run opened 5+ minutes ago never started. -> {name: {live, waiting}} for the log (null where D1 failed). Never rejects.
 */
export async function runnerCheck(env, {now = new Date(), fetcher = fetch} = {}) {
  const out = {}, at = now.toISOString(), before = new Date(now - 5 * 60000);
  for (const [name, sql] of Object.entries(RUNNER_LIVE)) {
    try {
      const live = Number((await env.STATS.prepare(sql.live).bind(at).first())?.n) || 0, waiting = Number((await env.STATS.prepare(sql.waiting).bind(at, sql.cutoff(before).toISOString()).first())?.n) || 0;
      out[name] = {live, waiting};
      await capCheck(env, name, live, {now, fetcher, reached: waiting > 0 && live >= CAPS[name].line(env)});
    } catch { out[name] = null; }
  }
  return out;
}
