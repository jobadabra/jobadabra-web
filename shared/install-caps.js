// Per-install lines on two hourly cards: an install approaching (🟠, 80%) or reaching (🔴) a line of its own is counted once a day per level in D1 (cap_hits, counts only),
// and the five-minute tick's :00 run sends one 🟠 and one 🔴 card for the hours before it, only when not zero (workers/www/index.js). The global lines are shared/cap-alerts.js.
// Why (13 Nov 2026, owner, asked via AskUserQuestion: "why not doing for all of them, both approaching and reached ?", then "Grouped hourly (Recommended)"): one card per
// install would flood Telegram, and a line that stops many people at once (too low) shows as one big count.
// Invariants: installHit never rejects and is handed to waitUntil, so a call is never failed or slowed; the card holds line names and counts, never an install id or a person;
// rows are deleted only after their card is done, so a failed send is told at the next :00.
import {send} from './cap-alerts.js';
import {capGroupCard} from './owner-cards.js';

const APPROACH = 0.8;
const WHERE = 'workers/www/wrangler.toml';
/** name -> {title, sees (what the person gets at the line), fix (what the owner can raise, a lower-case phrase)}. Each is checked where its line refuses (installHit). */
export const INSTALL_CAPS = {
  'free-ai-trial': {title: 'Free AI trial', sees: 'the app asks them to get Pro or add their own AI key', fix: `raise FREE_AI_TRIAL_USD in ${WHERE}`},
  'free-ai-install-day': {title: 'Free AI per install today', sees: 'their Free AI waits until 00:00 UTC', fix: `raise FREE_AI_INSTALL_DAY_USD in ${WHERE}`},
  'free-ai-install-month': {title: 'Free AI per install this month', sees: 'their Free AI waits until the 1st', fix: `raise FREE_AI_INSTALL_MONTH_USD in ${WHERE}`},
  'free-ai-minute': {title: 'Free AI calls a minute', sees: 'their calls wait a minute and retry', fix: `raise FREE_AI_INSTALL_MINUTE_CALLS in ${WHERE}`},
  'pro-credit': {title: 'Pro AI credit', sees: 'their AI stops until they add credit or use their own key', fix: 'nothing to raise: the person adds credit'},
  'cloud-checks-day': {title: 'Cloud checks today', sees: 'their cloud checks start again at 00:00 UTC', fix: `raise READY_READ_DAY_MAX in ${WHERE}`},
  'night-cost': {title: 'A night\'s cost', sees: 'that night stops filling forms', fix: `raise READY_NIGHT_MAX_USD in ${WHERE}`},
  'cloud-read-ceiling': {title: 'Cloud reads ceiling (~500)', sees: 'their cloud reads stop until 00:00 UTC', fix: `raise READY_READ_OWN_MAX in ${WHERE}, if it is a real person`},
  'cloud-submit-ceiling': {title: 'Cloud submits ceiling (~500)', sees: 'their cloud submits stop until 00:00 UTC', fix: `raise READY_AUTO_MAX in ${WHERE}, if it is a real person`},
  'web-search-day': {title: 'Board web search per install today', sees: 'their web search runs again tomorrow', fix: 'raise WEB.installPerDay in shared/free-ai-web.js'},
  // Request quotas (4/4): an install's requests a day (or a minute, an hour) to one route; the app retries tomorrow or later.
  'aliases-day': {title: 'Alias lookups per install today', sees: 'the app reads no more aliases until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in api/aliases.js'},
  'playbook-day': {title: 'Playbook reads per install today', sees: 'the app reads no more board playbooks until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in api/playbook.js'},
  'index-day': {title: 'Employer index downloads per install today', sees: 'the app keeps the index it has until 00:00 UTC', fix: 'raise INDEX_PER_INSTALL_PER_DAY in api/employers.js'},
  'national-day': {title: 'National job search reads per install today', sees: 'Find jobs skips the national boards until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in api/national.js'},
  'recipe-lookups-day': {title: 'Form recipe lookups per install today', sees: 'forms fill without shared recipes until 00:00 UTC', fix: 'raise LOOKUPS_PER_INSTALL_PER_DAY in api/recipes.js'},
  'recipe-samples-day': {title: 'Form samples sent per install today', sees: 'the app sends no more form samples until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in api/recipes.js'},
  'token-mints-day': {title: 'Token mints per network address today', sees: 'new installs on that address cannot connect until 00:00 UTC', fix: 'raise MINTS_PER_ADDRESS_PER_DAY in api/recipes.js'},
  'reports-install-day': {title: 'Form reports per install today', sees: 'the Report button is refused until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in shared/report-form.js'},
  'feedback-day': {title: 'Feedback per install today', sees: 'Send feedback is refused until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in api/feedback.js'},
  'telemetry-day': {title: 'Telemetry per install today', sees: 'the app\'s health reports are dropped until 00:00 UTC', fix: 'raise PER_INSTALL_PER_DAY in api/telemetry.js'},
  'pool-minute': {title: 'Pool contributions a minute', sees: 'the app\'s shared finds wait a minute', fix: 'raise PER_MINUTE in api/pool.js'},
  'pay-attempts-hour': {title: 'Checkout attempts per install an hour', sees: 'Buy is refused for the hour', fix: 'raise the 20 in api/pro-pay.js'},
  'signin-tries': {title: 'Wrong Pro sign-in codes', sees: 'that code is locked; they ask for a new one', fix: 'raise MAX_TRIES in api/pro-signin.js'},
  'hosted-tests-day': {title: 'Always on tests per account today', sees: 'Test Always on is refused until 00:00 UTC', fix: 'raise TESTS_PER_DAY in api/hosted-test.js'},
};

const hourOf = now => now.toISOString().slice(0, 13);

/**
 * One install against one of its lines: `used` and `line` in the same unit, or `reached` for a refusal with no count. Counts the install once a UTC day per level.
 * -> 'reached' | 'approaching' | null (what was counted). Never rejects.
 */
export async function installHit(env, name, install, used, line, {reached = false, now = new Date()} = {}) {
  try {
    if (!INSTALL_CAPS[name] || !install || !env?.WAITLIST || !env?.STATS) return null;
    const level = reached || used >= line ? 'reached' : used >= line * APPROACH ? 'approaching' : null;
    if (!level) return null;
    const flag = `caph:${name}:${level}:${now.toISOString().slice(0, 10)}:${install}`;
    if (await env.WAITLIST.get(flag)) return null;
    await env.STATS.prepare('INSERT INTO cap_hits (hour, line, level, n) VALUES (?, ?, ?, 1) ON CONFLICT (hour, line, level) DO UPDATE SET n = n + 1').bind(hourOf(now), name, level).run();
    await env.WAITLIST.put(flag, '1', {expirationTtl: 2 * 86400});   // Why (#625, Gitar): after the count, so a failed D1 write leaves the install to be counted at its next call
    return level;
  } catch { return null; }
}

/** The :00 tick: one card per level for the hours before `now`, most installs first; a done card deletes its rows. -> the levels told, 'reached' first. */
export async function sendHourly(env, now = new Date(), {fetcher = fetch} = {}) {
  const hour = hourOf(now), told = [];
  const {results} = await env.STATS.prepare('SELECT hour, line, level, n FROM cap_hits WHERE hour < ?').bind(hour).all();
  for (const level of ['reached', 'approaching']) {
    const read = results.filter(row => row.level === level), installs = {};
    for (const row of read) if (INSTALL_CAPS[row.line]) installs[row.line] = (installs[row.line] || 0) + Number(row.n);
    const rows = Object.entries(installs).map(([line, n]) => ({...INSTALL_CAPS[line], installs: n})).sort((a, b) => b.installs - a.installs);
    if (rows.length && !(await send(env, 'install-caps', level, capGroupCard(level, rows).text, fetcher))) continue;
    // Why (#625, Gitar): take away only what was read and told; a count that came in while the card was sending stays for the next :00.
    for (const row of read) await env.STATS.prepare('UPDATE cap_hits SET n = n - ? WHERE hour = ? AND line = ? AND level = ?').bind(Number(row.n), row.hour, row.line, row.level).run();
    if (read.length) await env.STATS.prepare('DELETE FROM cap_hits WHERE hour < ? AND level = ? AND n <= 0').bind(hour, level).run();
    if (rows.length) told.push(level);
  }
  return told;
}
