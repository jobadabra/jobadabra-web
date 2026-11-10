// Demo data for Admin → Operations → Notifications and the Scheduled page's Notify column (5 Nov 2026, spec 2026-11-05-ops-notifications-design.md): two demo bots, a few switches changed,
// a week of made-up sends. Only api.telegram.org is faked (getMe/getChat/sendMessage answer for the demo tokens); every other host is untouched. Tokens and names are invented.
import {connect, notify, saveSetting} from '../shared/notify.js';

const DEMO = {'111111111': {bot: 'demo_ci_bot', chat: 'Demo · CI alerts'}, '222222222': {bot: 'demo_brain_bot', chat: 'Demo · Brain'}};
const answer = result => new Response(JSON.stringify({ok: true, result}), {headers: {'Content-Type': 'application/json'}});
function fakeTelegram(url, init) {
  const [, id, method] = /bot(\d+):[^/]+\/(\w+)$/.exec(String(url)), demo = DEMO[id];
  if (!demo) return new Response(JSON.stringify({ok: false, description: 'Unauthorized'}), {status: 401});
  return answer(method === 'getMe' ? {username: demo.bot} : method === 'getChat' ? {title: demo.chat} : method === 'getUpdates' ? [{message: {chat: {id: -1001}}}] : {message_id: 1});
}
export const notifySeeds = {
  // Admin → Form filling → Reports: made-up reports, one per status; the "cannot replay" row carries its reason word (a database without the column keeps it fetched: the page before 10 Nov 2026).
  'form-reports': async ({env}) => {
    const day = days => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    for (const [id, days, requests, cause, status] of [['demo-1', 0, 18, 'stalled', 'new'], ['demo-2', 3, 21, 'person', 'fetched'], ['demo-3', 6, 40, 'failed', 'fixed'], ['demo-4', 9, 12, 'unsure', 'fetched']]) {
      await env.STATS.prepare('INSERT INTO form_reports (id, day, who, bytes, requests, cause, status) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, day(days), `demo${id}0000000000`, 250000, requests, cause, status).run();
    }
    await env.STATS.prepare("UPDATE form_reports SET status = 'unreplayable', why = 'no-page' WHERE id = 'demo-2'").run().catch(() => {});
  },
  notifications: async ({env}) => {
    env.NOTIFY_SECRET = 'page-shot-vault';
    await (await import('./page-shot-seeds.mjs')).seeds.schedules({env});   // the Scheduled page needs jobs to hang its Notify column on
    const real = globalThis.fetch;
    globalThis.fetch = (url, init) => (/^https:\/\/api\.telegram\.org\//.test(String(url)) ? Promise.resolve(fakeTelegram(url, init)) : real(url, init));
    const now = Date.now(), ago = hours => new Date(now - hours * 3600000), fetcher = async (url, init) => fakeTelegram(url, init);
    await connect(env, 'engineering', '111111111:DEMODEMODEMODEMODEMODEMO', '-1001', fetcher, ago(60));
    await connect(env, 'users', '222222222:DEMODEMODEMODEMODEMODEMO', '-1002', fetcher, ago(60));
    for (const [event, patch] of [['broker-fallback', {enabled: false}], ['main-red', {mode: 'every'}], ['release-mail-draft', {channel: 'engineering'}], ['sentry-issue', {mode: 'every'}], ['daily-build-digest', {enabled: false}]]) await saveSetting(env, event, patch, ago(50));
    const send = (event, hours, extra = {}) => notify(env, {event, text: 'Demo alert', ...extra}, {now: ago(hours), fetcher});
    for (const [event, hours] of [['beta-published', 9], ['beta-published', 31], ['stable-promoted', 12], ['main-red', 20], ['feedback-received', 1.2], ['feedback-received', 30], ['form-reported', 52], ['sentry-issue', 3], ['sentry-issue', 5], ['ai-fixer-round', 7], ['site-probe', 80], ['free-ai-spend', 100], ['pro-waitlist', 140]]) await send(event, hours);
    await send('chrome-store-failed', 160);
    await send('main-red', 6, {fallback: true});
  },
};
