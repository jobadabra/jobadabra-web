// The night that never arrived (owner, 6 Nov 2026: "Am I getting alerted? I'm not alerted"; coordinator: the missing night is the same silence): the nightly Search check starts at 00:00 UTC (app-core/src/scheduler.js SEARCH_SLOT)
// and uploads its verdict when it ends, filed under that UTC day (admin/search-night.js). If a compare step crashes, the run is cancelled or the upload is refused, NOTHING reaches the Worker, so the judge never runs and no
// alert is sent. This check closes that hole: from CHECK_AT to CHECK_UNTIL on the Worker's existing five-minute tick (no new clock, no new trigger), a UTC day with no stored night tells the owner once, under the SAME alert kind and switch
// as a dropped night ("Night search", level problem, daily): one switch for one question, "did last night's search check come out right". The text names no number but the fact.
// A known limit: the daily slot is shared, so if this alert goes out and a run more than six hours late then uploads a dropped night the same UTC day, that night's alert is held until the next day. Guard: test/unit/admin/search/search-night.test.js.
import {alertOwner} from '../shared/notify-send.js';
import {nights} from './search-night.js';
import {nightMissingCard} from '../shared/owner-cards.js';

export const CHECK_AT = '06:30', CHECK_UNTIL = '07:30';   // UTC; the run ends about two hours earlier even with a long queue, so a night not filed by now is not coming
export const MISSING_TEXT = nightMissingCard().text;   // a card (shared/owner-cards.js), HTML

/** True on the five-minute ticks from CHECK_AT up to CHECK_UNTIL UTC. Why (review, 6 Nov 2026): one tick with no retry would bring the silence back whenever Cloudflare skips it; the switchboard's daily limit (and the `missing <day>` state) already make it once, so the extra ticks cost one D1 read each. */
export const isCheckTick = date => { const hhmm = date.toISOString().slice(11, 16); return hhmm >= CHECK_AT && hhmm < CHECK_UNTIL; };

/**
 * Tell the owner when no night is filed for the UTC day of `now` (once: the switchboard's daily limit holds a second send).
 * @param {object} env the Worker env (STATS D1)
 * @returns {Promise<{missing: boolean, alert: string|null}>} alert = 'sent' or the switchboard's reason; null when a night is there
 */
export async function checkMissing(env, now = new Date(), fetcher = fetch) {
  const today = now.toISOString().slice(0, 10);
  if ((await nights(env)).some(night => night.night === today)) return {missing: false, alert: null};
  const told = await alertOwner(env, 'search-check-dropped', {text: MISSING_TEXT, html: true, level: 'problem', state: `missing ${today}`, fetcher, now})
    .catch(error => ({sent: false, via: 'none', why: `error: ${String(error?.message).slice(0, 80)}`}));
  return {missing: true, alert: told.sent ? 'sent' : told.why || told.via};
}
