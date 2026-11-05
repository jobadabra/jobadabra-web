// The address a person gives Jobadabra (onboarding, Settings → Notifications) and the mail the app or a run sends to it. The install proves itself with its AI key
// (x-api-key: JPF1.<install>.<token>); POST /api/notify/email also takes the trial key an Always-on repo holds (JPT1.<handle>.<mac>, no install id: shared/trial-key.js). PUT/GET /api/account/email makes or reads the trial account; POST /api/notify/email mails a Telegram-style message to it;
// POST /api/account/email/resend sends the confirm link again; /confirm confirms the address. An address another account already holds is refused here (joining it takes a code sent to that address, the device sign-in). Guard: test/unit/api/account-email.test.js.
import {authorize, digestOf, equal, tokenFor} from '../shared/guard.js';
import {installOfTrialKey} from '../shared/trial-key.js';
import {addrOf, confirmLink, saidYes, send, validAddress, clean} from '../shared/mail.js';
import {fromTelegram} from './mail-html.js';
import {CADENCES, deliver, hold, testAlert} from './mail-held.js';
import {page, switchOff} from './mail-unsub.js';
import {accountOf, createAccount, link} from '../shared/pro.js';
import {escTags} from '../shared/html.js';
import {alertOwner} from '../shared/notify-send.js';

const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };
const json = (status, body) => Response.json(body, {status});

async function who(request, env) {
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  return access?.ok ? given.install : null;
}

/**
 * Saves the app's product news box. `fresh`: the address was just given, so its box takes nothing back.
 * Why (review of hr-24, 5 Nov 2026): the app sends `marketing` on every save, so `false` is a stop only when it takes back a yes; a never-answered box stays no answer.
 * A tick from an unconfirmed address keeps that address's stop: anyone can type someone else's address.
 */
async function setMarketing(env, account, on, now, fresh) {
  const row = await env.STATS.prepare('SELECT email, email_hash, email_confirmed_at, marketing_opt_in FROM pro_accounts WHERE id = ?').bind(account).first();
  if (!row?.email_hash) return;
  if (on) {
    await env.STATS.prepare('UPDATE pro_accounts SET marketing_opt_in = 1, marketing_opt_in_at = ? WHERE id = ?').bind(now.toISOString(), account).run();
    if (row.email_confirmed_at) await env.STATS.prepare("DELETE FROM mail_off WHERE addr = ? AND list = 'marketing'").bind(row.email_hash).run();
  } else if (row.marketing_opt_in || (!fresh && await saidYes(env, row.email, row))) await switchOff(env, row.email_hash, 'marketing', 'settings', now);
}

// Why (3 Nov 2026, owner: "Send me a telegram message everytime a new user puts his email, adds his email in the application"): the owner's Brain chat hears of each address an install gives, first time ("New user e-mail")
// or changed ("User e-mail changed"); a re-save of the same address is not fresh, so it never pings. It runs after the account is written and never throws, so Telegram can never fail the save
// (a bad answer or no BRAIN_* secrets = one log line without the token, or nothing). The address goes to the owner's own chat, as api/feedback.js does with a reporter's optional e-mail; no other personal data.
async function tellOwner(env, fetcher, {email, install, changed}) {
  try {
    const total = (await env.STATS.prepare("SELECT COUNT(*) AS n FROM pro_accounts WHERE email IS NOT NULL AND email != ''").first().catch(() => null))?.n;
    // Why (5 Nov 2026, owner: an alert never carries a name or e-mail address): the address is on /admin/growth/email; the ping says that one came and links there.
    const text = `📧 <b>${changed ? 'User e-mail changed' : 'New user e-mail'}</b> · install ${escTags(install.slice(0, 8))}${total ? ` · ${total} with an e-mail` : ''}`;
    const legacy = env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null;
    const sent = await alertOwner(env, 'email-added', {text, html: true, link: `${env.SITE_URL || 'https://www.jobadabra.top'}/admin/growth/email`, legacy, fetcher});
    if (!sent.sent && sent.via !== 'switchboard') console.log('account e-mail ping failed', String(sent.why).slice(0, 200));
  } catch (error) {
    console.log('account e-mail ping failed', String(error.message).split(env.BRAIN_BOT_TOKEN || '\u0000').join('<token>'));
  }
}

export async function address(request, env, now = new Date(), fetcher = fetch, ctx = null) {
  const install = await who(request, env);
  if (!install || !env.STATS) return json(401, {ok: false, error: 'unauthorized'});
  let account = await accountOf(env, install);
  if (request.method === 'GET') {
    // Why (owner, 5 Nov 2026; replaces 28 Oct opt-out): "on" is a yes (shared/mail.js saidYes) with no mail_off row; an account that never answered is off.
    const newsOff = !!(account?.email_hash && await env.STATS.prepare("SELECT 1 AS y FROM mail_off WHERE addr = ? AND list IN ('marketing', 'all')").bind(account.email_hash).first());
    return json(200, {ok: true, email: account?.email || null, confirmed: !!account?.email_confirmed_at, marketing: !!account?.email_hash && !newsOff && await saidYes(env, account.email, account), serviceOff: !!account?.service_mail_off_at, cadence: account?.digest_cadence || 'daily', plan: account?.plan || null,
      sending: env.MAIL === 'on' && !!env.EMAIL,
      unconfirmedStopped: !!(account?.email_hash && await env.STATS.prepare("SELECT 1 AS y FROM mail_off WHERE addr = ? AND list = 'service' AND reason = 'unconfirmed'").bind(account.email_hash).first())});   // 14 days unconfirmed (api/mail-held.js)   // the kill switch (shared/mail.js): the app says so instead of promising a mail
  }
  if (request.method !== 'PUT') return json(405, {ok: false});
  const body = await request.json().catch(() => ({})), email = clean(body.email);
  if (!validAddress(email)) return json(400, {ok: false, error: 'Enter an email address like you@example.com.'});
  const hash = await digestOf(email);
  if (account && account.plan === 'pro' && account.email_hash !== hash) return json(409, {ok: false, error: 'pro'});   // a Pro account's address changes only through its own sign-in
  const holder = await env.STATS.prepare('SELECT id FROM pro_accounts WHERE email_hash = ?').bind(hash).first();
  let fresh = false, changed = false;   // a new or changed address: welcomed with the confirm button and told to the owner
  if (account && account.email_hash !== hash) {
    if (holder) return json(409, {ok: false, error: 'taken'});
    const id = `acc_${hash}`;   // a changed address is a new, unconfirmed one: same devices, same trial start
    await env.STATS.prepare('UPDATE pro_accounts SET id = ?, email_hash = ?, email = ?, email_confirmed_at = NULL, service_mail_off_at = NULL WHERE id = ?').bind(id, hash, email, account.id).run();
    await env.STATS.prepare('UPDATE pro_devices SET account = ? WHERE account = ?').bind(id, account.id).run();
    changed = !!account.email_hash;   // read from the account as it was, before it is re-keyed
    account = {...account, id};
    fresh = true;
  } else if (!account) {
    if (holder) return json(409, {ok: false, error: 'taken'});
    const id = await createAccount(env, email, now, {plan: 'trial'});
    const linked = await link(env, id, install, now);
    if (!linked.ok) return json(409, {ok: false, error: linked.error});
    account = {id};
    fresh = true;
  }
  if (fresh) {
    const ping = tellOwner(env, fetcher, {email, install, changed});   // the Worker passes ctx: the answer does not wait for Telegram; tests wait
    if (ctx?.waitUntil) ctx.waitUntil(ping); else await ping;
    await welcome(env, email, now);
  }
  if (typeof body.marketing === 'boolean') await setMarketing(env, account.id, body.marketing, now, fresh);
  if (CADENCES.includes(body.cadence)) await env.STATS.prepare('UPDATE pro_accounts SET digest_cadence = ? WHERE id = ?').bind(body.cadence, account.id).run();   // how often the digest comes: daily or weekly
  return json(200, {ok: true});
}

// The welcome mail with the confirm button, once per address ever (an address switched back and forth is not mailed again). It never fails the save: send() refuses
// quietly (mail off, the daily limit) and the confirm link still rides on the first real mail (api/mail-held.js deliver).
async function welcome(env, email, now) {
  if (!env.STATS) return;
  const before = await env.STATS.prepare("SELECT 1 AS y FROM mail_log WHERE addr = ? AND template = 'welcome' AND status = 'sent'").bind(await addrOf(email)).first();
  if (!before) await send(env, 'welcome', email, {confirmUrl: await confirmLink(env, email)}, {now});
}

// POST /api/account/email/resend: the confirm link again, to the address this account holds and has not confirmed (the welcome mail goes once per address ever, so a lost mail had no way back).
// At most 1 an hour and 3 a day per address -> {ok:false, error:'wait'}; 'confirmed' / 'stopped' (the person stopped our mail) / 'no_address' / 'off' (mail switched off) / 'not_sent' say why nothing went. Guard: test/unit/api/account-email.test.js.
export const RESEND_PER_HOUR = 1, RESEND_PER_DAY = 3;
export async function resend(request, env, now = new Date()) {
  const install = await who(request, env);
  if (!install || !env.STATS) return json(401, {ok: false, error: 'unauthorized'});
  if (request.method !== 'POST') return json(405, {ok: false});
  const account = await accountOf(env, install);
  if (!account?.email) return json(200, {ok: false, error: 'no_address'});
  if (account.email_confirmed_at) return json(200, {ok: false, error: 'confirmed'});
  const addr = await addrOf(account.email);
  // Why (#333, Gitar, 2 Nov 2026): a Resend lifts only the 14-day "unconfirmed" stop. An address that said stop itself (the unsubscribe link or Email settings: service_mail_off_at, or a service row
  // with another reason) must never get a "confirm" mail again: anyone can type someone else's address, and an essential mail carries no stop link.
  const stopped = await env.STATS.prepare("SELECT 1 AS y FROM mail_off WHERE addr = ? AND list = 'service' AND reason != 'unconfirmed'").bind(addr).first();
  if (account.service_mail_off_at || stopped) return json(200, {ok: false, error: 'stopped'});
  const since = ms => new Date(now.getTime() - ms).toISOString();
  const made = async ms => (await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE addr = ? AND template = 'confirm-resend' AND status = 'sent' AND at >= ?").bind(addr, since(ms)).first()).n;
  if (await made(3600 * 1000) >= RESEND_PER_HOUR || await made(24 * 3600 * 1000) >= RESEND_PER_DAY) return json(200, {ok: false, error: 'wait'});
  const sent = await send(env, 'confirm-resend', account.email, {confirmUrl: await confirmLink(env, account.email)}, {now});
  if (sent.ok) return json(200, {ok: true});
  return json(200, {ok: false, error: sent.reason === 'off' ? 'off' : sent.reason === 'rate' ? 'wait' : 'not_sent'});
}

// POST /api/notify/email {subject, html, buttons?: [{text, url}], kind?: 'activity' | 'test'}: 'activity' is held for the digest; 'test' (the GitHub way's Test) sends the
// alert test mail instead of the body, once a day, outside the per-address cap (api/mail-held.js testAlert: a stolen repo key gets one mail a day); anything else goes at once; `html` is the Telegram HTML the engine built (tgcard.py); only a safe subset reaches the mail (mail-html.js).
export async function notify(request, env, now = new Date()) {
  const install = (await installOfTrialKey(request.headers.get('x-api-key'), env))?.install;   // also the JPT1 key an Always-on repo holds: it reaches only this route and the trial status
  if (!install || !env.STATS) return json(401, {ok: false, error: 'unauthorized'});
  if (request.method !== 'POST') return json(405, {ok: false});
  const account = await accountOf(env, install);
  if (!account?.email) return json(200, {ok: false, reason: 'no_address'});
  const body = await request.json().catch(() => ({}));
  if (body.kind === 'test') { const sent = await testAlert(env, account, now); return json(200, sent.ok ? {ok: true, earlier: !!sent.earlier} : {ok: false, reason: sent.reason}); }
  const {html, text} = fromTelegram(body.html);
  if (!text) return json(400, {ok: false, reason: 'empty'});
  const buttons = (Array.isArray(body.buttons) ? body.buttons : []).slice(0, 6).filter(b => b && /^https:\/\//.test(b.url) && b.text).map(b => ({text: String(b.text).slice(0, 80), url: String(b.url).slice(0, 500)}));
  const item = {subject: String(body.subject || '').slice(0, 150), html, text, buttons};
  if (body.kind === 'activity') return json(200, await hold(env, account, item, now));   // not new matches, not urgent: waits for the daily or weekly digest (api/mail-held.js)
  const result = await deliver(env, account, item, now);
  if (result.reason === 'unconfirmed') return json(200, await hold(env, account, item, now));   // today's one mail to an unconfirmed address went: this one waits for the digest, never dropped
  return json(200, result.ok ? {ok: true} : {ok: false, reason: result.reason});
}

// GET /confirm?a&t asks (a mail scanner opening the link confirms nothing); POST confirms.
export async function confirm(request, env, now = new Date()) {
  const url = new URL(request.url), addr = url.searchParams.get('a') || '', token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{16}$/.test(addr) || !equal(token, await tokenFor(addr, env, 'confirm'))) return page('This link does not work', '<p>It may be cut off. Open the link from the mail again.</p>', 400);
  if (request.method === 'POST') {
    await env.STATS.prepare('UPDATE pro_accounts SET email_confirmed_at = ? WHERE email_hash = ? AND email_confirmed_at IS NULL').bind(now.toISOString(), addr).run();
    await env.STATS.prepare("DELETE FROM mail_off WHERE addr = ? AND list = 'service' AND reason = 'unconfirmed'").bind(addr).run();   // the 14-day stop ends
    return page('Email confirmed ✓', '<p>Thank you. Your Jobadabra mails will reach you. You can close this tab.</p>');
  }
  if (request.method !== 'GET') return page('Not allowed', '', 405);
  return page('Confirm your email?', '<p>One press, and your Jobadabra mails reach you.</p><form method="post"><button>Yes, this is my email</button></form>');
}
