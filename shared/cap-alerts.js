// The site's lines that stop something for everyone (Free AI, the board web search, the form reports' day total), on the one cap alert (shared/cap-check.js: 🟠 approaching, 🔴 reached,
// once per period). Here the flags live in KV (WAITLIST) and a card goes through the switchboard (alertOwner). Sketch and inventory: https://claude.ai/artifact/PVB8Su2LfyX8uQc27duLhC.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it"):
// the Free AI $10 day stop was reached in silence. A new cap is one entry below; test/unit/shared/cap-alerts.test.js loops over every entry.
import {alertOwner} from './notify-send.js';
import {checkCap} from './cap-check.js';
import {LIMITS, allowanceOf} from './free-ai.js';
import {monthLine} from './free-ai-web.js';
import {ALL_BYTES_PER_DAY, ALL_REPORTS_PER_DAY} from './report-form.js';

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
async function send(env, event, level, text, fetcher) {
  const told = await alertOwner(env, event, {text, html: true, fetcher, level: 'problem', state: level,
    legacy: env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null}).catch(() => null);
  const unconfigured = told?.via === 'none' && (told.why === 'no-bot' || told.why === 'channel-not-connected' || told.why === 'no-store');
  return Boolean(unconfigured || told?.sent || told?.via === 'switchboard');
}
