// Feedback from the app (shared/feedback.js): stored, sent to the owner's Brain bot, limited per install, and given to
// the product brain's signals without the contact.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {feedback} from '../../../api/feedback.js';
import {recentFeedback} from '../../../shared/feedback.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql', '0128_feedback_replies.sql', '0129_feedback_ai.sql']) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: '42'});
const send = (e, body, sent = []) => feedback(new Request('https://x/api/feedback', {method: 'POST', body: JSON.stringify(body)}), e,
  async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}'); });
const good = {install: 'install-aaaa-bbbb', version: '0.5.70', platform: 'darwin', text: 'The kit is great; setup took 20 min', contact: 'ana@example.com'};

test('feedback is stored and sent to the owner with the version and the contact', async () => {
  const e = env(), sent = [];
  assert.equal((await send(e, good, sent)).status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1);
  assert.equal(sent[0].chat_id, '42');
  assert.match(sent[0].text, /setup took 20 min/);
  assert.match(sent[0].text, /ana@example\.com/);
});

// Owner, 3 Nov 2026: "this should be mandatory for every feedback sent" (the app version, the OS platform, the install id); the e-mail stays optional.
test('a feedback without the app version, the platform or the install id is refused and says why; the e-mail stays optional', async () => {
  const e = env();
  for (const missing of ['version', 'platform']) {
    for (const blank of [undefined, '', '   ']) {
      const answer = await send(e, {...good, [missing]: blank});
      assert.equal(answer.status, 400, `${missing}=${JSON.stringify(blank)}`);
      assert.match((await answer.json()).error, /version and platform/);
    }
  }
  assert.equal((await send(e, {...good, install: undefined})).status, 400);
  for (const odd of [{}, ['0.5.70'], 123, true]) for (const field of ['version', 'platform']) assert.equal((await send(e, {...good, [field]: odd})).status, 400, `${field}=${JSON.stringify(odd)}`);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0, 'nothing stored');
  assert.equal((await send(e, {...good, contact: ''})).status, 200);
  assert.equal((await send(e, {...good, contact: undefined})).status, 200);
});

test('a refused feedback does not use up the daily limit: it is refused before the count', async () => {
  const e = env();
  for (let i = 0; i < 10; i++) assert.equal((await send(e, good)).status, 200);
  assert.equal((await send(e, {...good, platform: ''})).status, 400, 'not 429: the check comes before the limit');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 10);
});

test('empty text or a bad install id is refused; 10 a day per install', async () => {
  const e = env();
  assert.equal((await send(e, {...good, text: '  '})).status, 400);
  assert.equal((await send(e, {...good, install: 'x'})).status, 400);
  for (let i = 0; i < 10; i++) assert.equal((await send(e, good)).status, 200);
  assert.equal((await send(e, good)).status, 429);
});

test('the brain gets the words, never the contact', async () => {
  const e = env();
  await send(e, good);
  const rows = await recentFeedback(e.STATS);
  assert.equal(rows[0].text, good.text);
  assert.ok(!JSON.stringify(rows).includes('ana@example.com'));
});

test('the live page is the owner\'s only: 404 without the key, the page and its JSON with it', async () => {
  const {view} = await import('../../../admin/feedback.js');
  const e = {...env(), STATS_KEY: 'secret'};
  await send(e, good);
  const open = (path, headers = {}) => view(new Request(`https://x/feedback${path}`, {headers}), e);
  assert.equal((await open('')).status, 404);
  assert.equal((await open('?json=1')).status, 404);
  const auth = {Authorization: 'Bearer secret'};
  const page = await open('', auth);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /💬 Feedback/);
  const data = await (await open('?json=1', auth)).json();
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].text, good.text);
  assert.equal(data.rows[0].contact, good.contact);
});
