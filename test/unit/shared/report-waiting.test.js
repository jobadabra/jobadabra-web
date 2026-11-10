// A "Report this form" nobody fetched for 2 days tells the owner once (shared/report-waiting.js), and the owner can close a fetched report as "cannot replay" with a reason word that
// /admin/form-filling/reports shows (shared/report-form.js, admin/report-view.js). Why (10 Nov 2026, owner's Apply assessment R7): the 27 Oct report waited 14 days with no second word.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {pingWaitingReports, WAIT_DAYS} from '../../../shared/report-waiting.js';
import {reportForm} from '../../../shared/report-form.js';
import {page} from '../../../admin/report-view.js';
import {reportCounts} from '../../../admin/report-counts.js';

const NOW = new Date('2026-11-10T00:10:00Z');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0071_form_reports.sql', '0147_form_report_waiting.sql']) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const done = db.prepare(sql).run(...args); return {meta: {changes: Number(done.changes)}}; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = (extra = {}) => ({STATS: d1(), REPORTS: {get: async () => null}, STATS_KEY: 'k', STATS_API_KEY: 'owner-key', STATS_SALT: 's', BRAIN_BOT_TOKEN: 'bot-token', BRAIN_CHAT_ID: '42', ...extra});
const add = (e, id, day, status = 'new') => e.STATS.db.prepare('INSERT INTO form_reports (id, day, who, bytes, requests, cause, status) VALUES (?, ?, ?, 1000, 21, ?, ?)').run(id, day, 'w0123456789', 'person', status);
const telegram = (ok = true) => { const calls = []; return {calls, fetcher: async (url, init) => { calls.push(JSON.parse(init.body)); return ok ? Response.json({ok: true, result: {message_id: 1}}) : new Response('{"ok":false,"description":"down"}', {status: 500}); }}; };
const told = (e, id) => e.STATS.db.prepare('SELECT waiting_told_at FROM form_reports WHERE id = ?').get(id).waiting_told_at;

test('a report not fetched for 2 days tells the owner once; younger, fetched or expired ones never', async () => {
  const e = env(), fake = telegram();
  assert.equal(WAIT_DAYS, 2);
  add(e, 'old', '2026-10-27'); add(e, 'two', '2026-11-07'); add(e, 'young', '2026-11-08'); add(e, 'fetched', '2026-11-01', 'fetched'); add(e, 'expired', '2026-10-01');
  assert.equal(await pingWaitingReports(e, NOW, fake.fetcher), 2);
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[0].text, /A reported form has waited 14 days/); assert.match(fake.calls[1].text, /A reported form has waited 3 days/);
  assert.match(fake.calls[0].text, /reports-fetch/); assert.match(fake.calls[0].text, /admin\/form-filling\/reports/);
  assert.ok(!/w0123456789|old/.test(fake.calls[0].text.replace(/<[^>]+>/g, '')), 'no install digest or id in the words');
  assert.deepEqual(['old', 'two', 'young', 'fetched', 'expired'].map(id => told(e, id) !== ''), [true, true, false, false, false]);
  assert.equal(await pingWaitingReports(e, new Date('2026-11-10T01:10:00Z'), fake.fetcher), 0, 'the next tick: once only');
  assert.equal(fake.calls.length, 2);
});

test('a Telegram failure gives the flag back for the next tick; no bot configured is final; four at once are one line', async () => {
  const down = env(), failing = telegram(false);
  add(down, 'a', '2026-11-01');
  assert.equal(await pingWaitingReports(down, NOW, failing.fetcher), 1);
  assert.equal(told(down, 'a'), '', 'given back');
  const none = env({BRAIN_BOT_TOKEN: '', BRAIN_CHAT_ID: ''});
  add(none, 'a', '2026-11-01');
  await pingWaitingReports(none, NOW, telegram().fetcher);
  assert.notEqual(told(none, 'a'), '', 'nothing configured: not retried every hour');
  const many = env(), fake = telegram();
  for (const id of ['a', 'b', 'c', 'd']) add(many, id, '2026-11-01');
  assert.equal(await pingWaitingReports(many, NOW, fake.fetcher), 4);
  assert.equal(fake.calls.length, 1); assert.match(fake.calls[0].text, /4 reported forms have waited 2 days or more/);
});

const owner = (e, path) => reportForm(new Request(`https://x${path}`, {method: 'POST', headers: {Authorization: 'Bearer owner-key'}}), e, path.split('?')[0]);

test('the owner closes a fetched report as "cannot replay" with a reason word; the page and the counts show it, in words', async () => {
  const e = env();
  add(e, 'r1', '2026-10-27', 'fetched');
  assert.equal((await owner(e, '/api/report-form/r1?status=unreplayable&why=no-page')).status, 200);
  assert.deepEqual({...e.STATS.db.prepare('SELECT status, why FROM form_reports').get()}, {status: 'unreplayable', why: 'no-page'});
  assert.equal((await owner(e, '/api/report-form/r1?status=fixed&why=%3Cb%3E')).status, 200);
  assert.deepEqual({...e.STATS.db.prepare('SELECT status, why FROM form_reports').get()}, {status: 'fixed', why: ''}, 'a reason that is not a plain word is dropped');
  assert.equal((await owner(e, '/api/report-form/r1?status=deleted')).status, 405, 'only the known statuses');
  assert.equal((await reportForm(new Request('https://x/api/report-form/r1?status=fixed', {method: 'POST'}), e, '/api/report-form/r1')).status, 401);
  const rows = [{id: 'r1', day: '2026-10-27', who: 'w0123456789', bytes: 250870, requests: 21, cause: 'person', status: 'unreplayable', why: 'no-page'}];
  const html = page({rows, today: null, now: NOW});
  assert.match(html, /<span class="st unreplayable">cannot replay<\/span>/); assert.match(html, /the page itself was not recorded/);
  e.STATS.db.prepare("UPDATE form_reports SET status = 'unreplayable'").run();
  add(e, 'r2', '2026-11-09');
  assert.deepEqual(await reportCounts(e.STATS), {received: 2, waiting: 1, fetched: 0, fixed: 0, unreplayable: 1});
});
