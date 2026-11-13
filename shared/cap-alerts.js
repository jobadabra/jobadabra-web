// The registry of every line that stops something for everyone, and its one owner alert: a 🟠 medium card when the count approaches the line, a 🔴 critical card when it reaches it,
// each once per period (UTC day or month) through the switchboard (alertOwner), with a KV flag. Spec: the sketch https://claude.ai/artifact/PVB8Su2LfyX8uQc27duLhC.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it"):
// the Free AI $10 day stop was reached in silence (every Free install saw "Free AI is busy today" and the owner was not told), and the three alerts that existed were three functions
// with three flags. One registry: a new cap declares its line, its approach line and its words, and gets both cards; a test loops over it (test/unit/shared/cap-alerts.test.js).
// Invariants: never throws, so an alert cannot fail or slow a user's call (callers run it under ctx.waitUntil); a reached card is sent once even when no approach card came;
// a failed send gives its flag back so the next crossing tries again; the text holds counts and var names only, never a person.
import {alertOwner} from './notify-send.js';
import {capCard} from './owner-cards.js';
import {LIMITS, allowanceOf} from './free-ai.js';
import {monthLine} from './free-ai-web.js';

const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
// A cap's counter in the words and the bar of its card: 'usd' counts micro-USD, 'neurons' counts neurons.
const UNITS = {usd: {amount: micro => Math.round(Number(micro) / 1e4) / 100, show: n => `$${n.toFixed(2)}`, word: 'USD'}, neurons: {amount: n => Math.round(Number(n)), show: n => `${n} neurons`, word: 'neurons'}};
const BUSY_TODAY = 'every Free install sees "Free AI is busy today" until 00:00 UTC';

/**
 * name -> {title, event (switchboard registry), period: 'day' | 'month', unit: 'usd' | 'neurons' (the counter's own unit), line(env), approach(env) (both in the counter's own unit), sees (what people get), fix (what the owner can do, as "To move the stop: <fix>." / "To reopen it: <fix>.")}.
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
};

const periodOf = (period, now) => now.toISOString().slice(0, period === 'month' ? 7 : 10);
const flagOf = (name, level, period) => `cap:${name}:${level}:${period}`;

/**
 * Tells the owner about one cap after a counted call or at a refusal: `used` in the cap's own unit (null with `reached`, when the platform refused with no count of ours).
 * -> resolves to 'reached' | 'approaching' | null (what was sent, or nothing). Never rejects.
 */
export async function capCheck(env, name, used, {now = new Date(), fetcher = fetch, reached = false} = {}) {
  try {
    const cap = CAPS[name], kv = env?.WAITLIST;
    if (!cap || !kv) return null;
    const line = cap.line(env), near = cap.approach(env), period = periodOf(cap.period, now);
    const level = reached || used >= line ? 'reached' : used >= near ? 'approaching' : null;
    if (!level || await kv.get(flagOf(name, level, period))) return null;
    const ttl = {expirationTtl: (cap.period === 'month' ? 40 : 2) * 86400};
    // Both flags on a reached line: an approach card after the critical one would only confuse.
    const flags = level === 'reached' ? [flagOf(name, 'reached', period), flagOf(name, 'approaching', period)] : [flagOf(name, level, period)];
    const before = await Promise.all(flags.map(flag => kv.get(flag)));
    await Promise.all(flags.map(flag => kv.put(flag, '1', ttl)));
    const unit = UNITS[cap.unit], done = used == null ? null : unit.amount(used), total = Number.isFinite(line) ? unit.amount(line) : null;
    const text = capCard(level, {title: cap.title, used: done == null ? null : unit.show(done), line: total == null ? null : unit.show(total), done, total, word: unit.word, sees: cap.sees, fix: cap.fix}).text;
    if (!(await send(env, cap.event, level, text, fetcher))) await Promise.all(flags.filter((_, i) => !before[i]).map(flag => Promise.resolve(kv.delete?.(flag)).catch(() => {})));
    return level;
  } catch { return null; }
}

// The one send: the switchboard first, the Brain bot when it cannot deliver. -> true when the alert is done (sent, held on purpose by the switchboard, or nothing is configured at all).
// Why (5 Nov 2026, nt 2/4; kept from free-ai.js tellSpend): nothing configured (no bot, no store) is not a failed send: keeping the flag stops every later call from redoing the write (Gitar on #429).
async function send(env, event, level, text, fetcher) {
  const told = await alertOwner(env, event, {text, html: true, fetcher, level: 'problem', state: level,
    legacy: env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null}).catch(() => null);
  const unconfigured = told?.via === 'none' && (told.why === 'no-bot' || told.why === 'channel-not-connected' || told.why === 'no-store');
  return Boolean(unconfigured || told?.sent || told?.via === 'switchboard');
}
