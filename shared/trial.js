// The free trial as the server sees it (GET /api/trial/status): the app and the Always on runs on GitHub ask with the same install key (JPF1.<install>.<token>) and get the same answer.
// Trial = 20 applications or 60 days since the first run, whichever lasts longer (desktop/lib/license.js); over it, new work pauses unless Pro or licensed. Guard: test/unit/shared/trial.test.js.
// The caller reports `applied` and `first` (FSL accepts patching, 16 Oct 2026); the server keeps the highest count and the earliest first-run it has ever seen per install, so a lower number cannot reset the trial.
import {installOfTrialKey} from './trial-key.js';
import {verifyLicense} from './license.js';
import {accountOf, planOn} from './pro.js';

export const FREE_APPLICATIONS = 20, FREE_DAYS = 60;
// Owner, 10 Nov 2026 (asked via AskUserQuestion, relayed by the coordinator): a trial that uses the person's own AI "has a bit more headroom": 30 free applications instead of 20 ("Keep 30": once granted, an install keeps it after switching
// back to our AI) and "App sends a flag": the app tells the site once, never the key, and the site grants it through `bonus`. The flag is a claim: it lifts only this count; Free AI's $2 trial credit and its day lines do not read it (test/unit/shared/free-ai/free-ai.test.js).
export const OWN_AI_BONUS = 10;
const DAY = 24 * 60 * 60 * 1000;

// Pure: where an install stands. `bonus`: applications added for validated reports (shared/feedback-reply.js THANKS_APPS). -> {ended, used, limit, daysLeft, bonus}
export function stand({applied = 0, first, now = new Date(), bonus = 0}) {
  const started = Date.parse(first) || now.getTime();
  const daysLeft = Math.max(0, Math.ceil(FREE_DAYS - (now.getTime() - started) / DAY));
  const limit = FREE_APPLICATIONS + bonus;
  return {used: applied, limit, daysLeft, bonus, ended: applied >= limit && daysLeft === 0};
}

export async function status(request, env, now = new Date()) {
  const access = await installOfTrialKey(request.headers.get('x-api-key'), env);   // the app's JPF1 key or an Always-on repo's JPT1 key (shared/trial-key.js)
  if (!access) return Response.json({ok: false, error: 'unauthorized'}, {status: 401});
  const url = new URL(request.url), kv = env.WAITLIST;
  const asked = Math.max(0, Math.min(100000, Math.floor(Number(url.searchParams.get('applied')) || 0)));
  const askedFirst = Date.parse(url.searchParams.get('first'));
  const keys = {applied: `trial:applied:${access.who}`, first: `trial:first:${access.who}`, ownAi: `trial:ownai:${access.who}`};
  const [seenApplied, seenFirst] = kv ? await Promise.all([kv.get(keys.applied), kv.get(keys.first)]) : [null, null];
  const applied = Math.max(asked, Number(seenApplied) || 0);
  // The earliest first run known; never in the future, and the first request ever starts the clock.
  const known = [Date.parse(seenFirst), askedFirst].filter(time => time > 0 && time <= now.getTime());
  const first = new Date(known.length ? Math.min(...known) : now.getTime()).toISOString();
  if (kv) {
    if (applied !== Number(seenApplied)) await kv.put(keys.applied, String(applied));
    if (first !== seenFirst) await kv.put(keys.first, first);
  }
  const account = planOn(env) ? await accountOf(env, access.install) : null;
  const pro = account?.status === 'active';
  const license = !pro && await verifyLicense(request.headers.get('x-jp-license'), env.LICENSE_PUBLIC_KEY);   // founder / friend / pass key: no wall
  // Why (fb 2/7, 5 Nov 2026): the bonus is the sum of the thank-yous already told to this install; it lives in its own table (trial_bonus), so deleting a card never takes it back and nothing else can drift from it. A read that fails (CI only warns on a failed migration, so the table may not exist yet) gives no bonus: the trial still answers, and a missing bonus can only make the wall earlier, never open it.
  const bonus = Number((await env.STATS?.prepare("SELECT COALESCE(SUM(apps), 0) AS total FROM trial_bonus WHERE install = ?").bind(access.install).first().catch(() => null))?.total) || 0;
  let ownAi = !!kv && await kv.get(keys.ownAi) === '1';   // sticky: sent once by an app on its own AI, never taken back
  if (kv && !ownAi && url.searchParams.get('own_ai') === '1') { await kv.put(keys.ownAi, '1'); ownAi = true; }
  const state = stand({applied, first, now, bonus: bonus + (ownAi ? OWN_AI_BONUS : 0)});
  const ended = state.ended && !pro && !license;
  // The pause line goes out at most once a day per install: a run that will send it asks with claim=1 and is told yes once (the last day lives here, not in the repo).
  let notify = false;
  if (ended && kv && url.searchParams.get('claim') === '1') {
    const today = now.toISOString().slice(0, 10), noticeKey = `trial:notice:${access.who}`;
    if (await kv.get(noticeKey) !== today) { await kv.put(noticeKey, today, {expirationTtl: 3 * 86400}); notify = true; }
  }
  return Response.json({ok: true, pro: !!pro, licensed: !!license, ...state, first, ended, notify, ownAi});
}
