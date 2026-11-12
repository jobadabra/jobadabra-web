// The numbers behind /admin/growth/email (owner, 26 Oct 2026: "a section for emailing... stats, data, templates"): what our e-mail did, who can still get it, and what waits for the digest.
// Counts and short hashes only, never an address (mail_log keeps the hash; pro_accounts is only counted). Guard: tests/test_site_admin_email.js.
const DAY = 24 * 60 * 60 * 1000;
export const WINDOWS = [7, 30, 90];
import {switchRows} from '../shared/mail-switches.js';
import {ruleRows} from '../shared/mail-registry.js';
import {offCounts} from '../shared/mail-choices.js';
export {SWITCHES} from '../shared/mail-switches.js';   // the flags shared/mail.js and admin/mail-lifecycle.js read (their state: shared/mail-switches.js); "on" or anything else (= off)

const one = async (env, sql, ...args) => (await env.STATS.prepare(sql).bind(...args).first().catch(() => null)) || {n: 0};
const many = async (env, sql, ...args) => (await env.STATS.prepare(sql).bind(...args).all().catch(() => ({results: []}))).results || [];

// The accounts each mail type reaches (shared/mail-lists.js; releases wait for an answer); the waitlist is in the owner's card (admin/email-audience.js). Inlined literal: `list` comes from this file only.
const NOT_STOPPED = list => `NOT EXISTS (SELECT 1 FROM mail_off o WHERE o.addr = a.email_hash AND o.list IN ('all', '${list}'))`;

export const windowOf = value => (WINDOWS.includes(Number(value)) ? Number(value) : 7);
export const hashOf = addr => String(addr || '').slice(0, 8);   // addr is already a digest (shared/mail.js addrOf); 8 characters tell two rows apart and nothing else

export async function collect(env, {days = 7, now = new Date()} = {}) {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const [perDay, sentByTemplate, presses, refused, recent, offReasons, confirmed, unconfirmed, service, releases, tips, digest, held, heldOldest, today] = await Promise.all([
    many(env, "SELECT substr(at, 1, 10) AS day, SUM(status = 'sent') AS sent, SUM(status NOT IN ('sent', 'claimed')) AS refused FROM mail_log WHERE at >= ? GROUP BY day ORDER BY day", since),
    many(env, "SELECT template, SUM(status = 'sent') AS sent, SUM(status NOT IN ('sent', 'claimed')) AS refused, MAX(CASE WHEN status = 'sent' THEN at END) AS last FROM mail_log WHERE at >= ? GROUP BY template ORDER BY sent DESC", since),
    many(env, "SELECT substr(source, 6) AS template, COUNT(DISTINCT visitor) AS n FROM visits WHERE page IN ('/open', '/open.html') AND source LIKE 'mail-%' AND day >= ? GROUP BY source", since.slice(0, 10)),   // by day: a press keeps only its day (api/downloads.js stamp)
    many(env, "SELECT status AS reason, COUNT(*) AS n FROM mail_log WHERE status NOT IN ('sent', 'claimed') AND at >= ? GROUP BY status ORDER BY n DESC", since),
    many(env, "SELECT at, addr, template, status FROM mail_log WHERE status NOT IN ('sent', 'claimed') ORDER BY at DESC LIMIT 10"),
    many(env, "SELECT reason, list, COUNT(*) AS n FROM mail_off WHERE list NOT LIKE 'app-%' GROUP BY reason, list ORDER BY n DESC"),
    one(env, 'SELECT COUNT(*) AS n FROM pro_accounts WHERE email_confirmed_at IS NOT NULL'),
    one(env, 'SELECT COUNT(*) AS n FROM pro_accounts WHERE email_confirmed_at IS NULL'),
    one(env, `SELECT COUNT(*) AS n FROM pro_accounts a WHERE a.service_mail_off_at IS NULL AND ${NOT_STOPPED('service')}`),
    one(env, `SELECT COUNT(*) AS n FROM pro_accounts a WHERE (a.email_confirmed_at IS NOT NULL OR a.plan = 'pro') AND ${NOT_STOPPED('releases')}`),   // What's new is on until stopped (owner, 12 Nov 2026; Gitar on #569): no stored yes needed
    one(env, `SELECT COUNT(*) AS n FROM pro_accounts a JOIN mail_on y ON y.addr = a.email_hash AND y.list = 'tips' WHERE (a.email_confirmed_at IS NOT NULL OR a.plan = 'pro') AND ${NOT_STOPPED('tips')}`),
    one(env, `SELECT COUNT(*) AS n FROM pro_accounts a JOIN mail_on y ON y.addr = a.email_hash AND y.list = 'jobdigest' WHERE (a.email_confirmed_at IS NOT NULL OR a.plan = 'pro') AND ${NOT_STOPPED('jobdigest')}`),
    one(env, 'SELECT COUNT(*) AS n, COUNT(DISTINCT account) AS accounts FROM mail_held'),
    one(env, 'SELECT MIN(at) AS at, 0 AS n FROM mail_held'),
    one(env, "SELECT COUNT(*) AS n FROM mail_log WHERE status = 'sent' AND at >= ?", new Date(now.getTime() - DAY).toISOString()),
  ]);
  const testMail = await many(env, 'SELECT received_at, to_addr, subject FROM test_mail ORDER BY received_at DESC LIMIT 5');   // test-account-* inboxes only (admin/test-mail.js)
  const byTemplate = sentByTemplate.map(row => ({...row, opened: presses.find(press => press.template === row.template)?.n || 0}));
  const sent = perDay.reduce((total, row) => total + (row.sent || 0), 0), notSent = perDay.reduce((total, row) => total + (row.refused || 0), 0);
  const failed = refused.find(row => row.reason === 'failed')?.n || 0;
  const stopped = offReasons.filter(row => row.reason === 'bounce' || row.reason === 'complaint').reduce((total, row) => total + row.n, 0);
  return {days, testMail, sent, notSent, failed, stopped, perDay, byTemplate, refused, recent: recent.map(row => ({...row, addr: hashOf(row.addr)})), offReasons,
    confirmed: confirmed.n, unconfirmed: unconfirmed.n, types: {service: service.n, releases: releases.n, tips: tips.n, jobdigest: digest.n}, held: {items: held.n, accounts: held.accounts || 0, oldest: heldOldest.at || null}, today: today.n,
    switches: await switchRows(env), rules: await ruleRows(env), offs: await offCounts(env), dayMax: Number(env.MAIL_DAY_MAX || 3000)};
}
