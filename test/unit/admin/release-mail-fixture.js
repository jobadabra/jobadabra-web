// The fake D1, KV and mail sender the release-mail tests share (moved from release-mail.test.js when it reached 500 lines, 12 Nov 2026). No real address, no delivery.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {addrOf} from '../../../shared/mail.js';

export const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
export function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0093_changelog.sql', '0105_changelog_plain.sql', '0117_release_mail.sql', '0135_mail_on.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values),
    run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
export const meta = value => { try { return JSON.parse(value); } catch { return undefined; } };
export const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); },
  list: async ({prefix}) => ({keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({name, metadata: meta(m.get(name))})), list_complete: true})}; };   // the Worker puts the entry and its metadata together (workers/www/index.js)
export const now = new Date('2026-10-28T10:00:00Z');
export const WEB = JSON.stringify({source: 'web'});   // a signup from the website form (shared/mail-lists.js signupKind)
export const answered = async (e, ...emails) => { for (const email of emails) e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES (?, 'releases', 'card', 'x')").run(await addrOf(email)); };   // the person saved the card in the app
export const confirm = (e, ...emails) => e.STATS.db.prepare(`UPDATE pro_accounts SET email_confirmed_at = 'x' WHERE email IN (${emails.map(() => '?').join(',')})`).run(...emails);
export const groups = [{kind: 'features', items: [{lead: 'Faster jobs', text: 'Open a job and see why it fits.'}, {lead: 'Calendar', text: 'Interviews show on a calendar.'}]}, {kind: 'fixes', items: [{lead: 'A fix', text: 'Something works.'}]}];
export function setup(extra = {}) {
  const sent = [], e = {MAIL: 'on', MARKETING_MAIL: 'on', STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', SELFHEAL_PUBLISH_KEY: 'k', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}, ...extra};
  e.STATS.db.prepare('INSERT INTO changelog_entries (version, date, channel, hidden, body, at) VALUES (?, ?, ?, 0, ?, ?)').run('0.8.42', '2026-10-27', 'stable', JSON.stringify(groups), 'x');
  return {e, sent};
}
