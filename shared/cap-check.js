// The one alert of a cap, for every Worker: a 🟠 medium card when the count approaches the line, a 🔴 critical card when it reaches it, each once per period.
// The caller brings where the once-per-period flags live (`store`: KV on the site, Durable Object storage in the AI broker) and how a card is sent (`send`: alertOwner on the site,
// POST /ops/notify from the broker), so both Workers share one rule and one card. Registries: shared/cap-alerts.js (the site's lines), workers/ai-broker/lib/cap-notes.mjs (the broker's).
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it").
// Invariants: never rejects, so an alert cannot fail a call; a reached card is sent once even when no approach card came, and no approach card follows it; a failed send gives
// its flags back so the next crossing tries again; the text holds counts and setting names only, never a person.
import {capCard} from './owner-cards.js';

// A cap's counter in the words and the bar of its card.
export const UNITS = {
  usd: {amount: micro => Math.round(Number(micro) / 1e4) / 100, show: n => `$${n.toFixed(2)}`, word: 'USD'},   // counted in micro-USD
  neurons: {amount: n => Math.round(Number(n)), show: n => `${n} neurons`, word: 'neurons'},
  percent: {amount: n => Math.round(Number(n)), show: n => `${n}%`, word: '%'},
  calls: {amount: n => Math.round(Number(n)), show: n => `${n} calls`, word: 'calls'},
  reports: {amount: n => Math.round(Number(n)), show: n => `${n} reports`, word: 'reports'},
  bytes: {amount: n => Math.round(Number(n) / 1048576), show: n => `${n} MB`, word: 'MB'},
};
const TTL = {day: 2, week: 9, month: 40};
const periodOf = (period, now) => now.toISOString().slice(0, period === 'month' ? 7 : 10);
const flagOf = (name, level, period) => `cap:${name}:${level}:${period}`;

/**
 * Tells the owner about one cap. `cap` = {name, title, event, period: 'day' | 'week' | 'month', unit (a key of UNITS), line(env), approach(env) (in the counter's unit), sees, fix};
 * `used` in the counter's unit, or null with `reached` (a refusal with no count of ours); `period` overrides the UTC day or month key (a plan's own week: its reset time).
 * `store` = {get, put(key, value, {expirationTtl}), delete}; `send(event, level, text)` -> true when the alert is done (sent, held on purpose, or nothing configured).
 * -> 'reached' | 'approaching' | null (what was sent). Never rejects.
 */
export async function checkCap(env, cap, used, {now = new Date(), reached = false, period = null, store, send}) {
  try {
    if (!cap || !store) return null;
    const line = cap.line(env), near = cap.approach(env), key = period ?? periodOf(cap.period, now);
    const level = reached || used >= line ? 'reached' : used >= near ? 'approaching' : null;
    if (!level || await store.get(flagOf(cap.name, level, key))) return null;
    const flags = level === 'reached' ? [flagOf(cap.name, 'reached', key), flagOf(cap.name, 'approaching', key)] : [flagOf(cap.name, level, key)];
    const before = await Promise.all(flags.map(flag => store.get(flag)));
    await Promise.all(flags.map(flag => store.put(flag, '1', {expirationTtl: (TTL[cap.period] || 2) * 86400})));
    const unit = UNITS[cap.unit], done = used == null ? null : unit.amount(used), total = Number.isFinite(line) ? unit.amount(line) : null;
    const text = capCard(level, {title: cap.title, used: done == null ? null : unit.show(done), line: total == null ? null : unit.show(total), done, total, word: unit.word, sees: cap.sees, fix: cap.fix}).text;
    if (!(await send(cap.event, level, text).catch(() => false))) await Promise.all(flags.filter((_, i) => !before[i]).map(flag => Promise.resolve(store.delete?.(flag)).catch(() => {})));
    return level;
  } catch { return null; }
}
