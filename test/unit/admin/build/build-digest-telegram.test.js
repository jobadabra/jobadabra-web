// The Build Log Telegram post (admin/build-digest-telegram.js): HTML, split under the limit, escaped, skipped without a token, once. No live Telegram: fetch is a fake.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messages, post} from '../../../../admin/build-digest-telegram.js';
import {checkCard} from '../../../../shared/tg-card.js';

const digest = {day: '2026-10-16', numbers: [957, 959, 960, 1081], open: 'The bot <token>.', groups: [{emoji: '🧭', title: 'Apply & fill', bullets: [{lead: 'Radio groups', text: 'A radio question is named by its own question.', prs: [957, 958, 959]}]}]};
const fake = (status = 200) => { const calls = []; return {calls, fetch: async (url, init) => { calls.push({url, body: JSON.parse(init.body)}); return {ok: status === 200, status}; }}; };

test('one card: the count in the headline, one row per goal with its first lead, no PR numbers, HTML escaped, one link', () => {
  const [text, ...rest] = messages(digest);
  assert.equal(rest.length, 0);
  assert.match(text, /^🟢 <b>Build log 16 Oct: about 4 PRs merged<\/b>/);
  assert.match(text, /🧭 Apply &amp; fill: Radio groups\n/);
  assert.match(text, /Still open: The bot &lt;token&gt;\./);
  assert.doesNotMatch(text, /#\d/, 'the PR numbers stay on the admin Build log page');
  assert.equal((text.match(/<a /g) || []).length, 1);
  assert.deepEqual(checkCard(text), []);
});

test('a day with many goals and bullets is a few lines (owner, 29 Oct 2026: "summarize a day in few lines"): top 3 goals + N more', () => {
  const many = {...digest, groups: Array.from({length: 7}, (_, i) => ({emoji: '🧪', title: `Goal ${i}`, bullets: Array.from({length: 5}, (_, k) => ({lead: `Lead ${k}`, text: 'x'.repeat(240), prs: [957 + k]}))}))};
  const [text, ...rest] = messages(many);
  assert.equal(rest.length, 0);
  assert.match(text, /🧪 Goal 0: Lead 0 \+4\n/);
  assert.match(text, /… \+4 more/, 'goals past the third are counted, not listed');
  assert.ok(text.length < 800, `${text.length} characters is not a few lines`);
  assert.doesNotMatch(text, /x{20}/, 'the bullets\' long text is not posted');
});

test('even a huge digest is one message under Telegram\'s 4096 characters, no tag cut in half', () => {
  const huge = {...digest, groups: Array.from({length: 400}, (_, i) => ({emoji: '🧪', title: `Goal ${i}`, bullets: [{lead: 'L'.repeat(60), text: 'x', prs: [957]}]}))};
  const list = messages(huge);
  assert.equal(list.length, 1);
  assert.ok(list[0].length <= 4096);
  assert.equal((list[0].match(/<b>/g) || []).length, (list[0].match(/<\/b>/g) || []).length);
  assert.match(list[0], /Still open/);
});

test('post: sends every message to the chat as HTML; no token or chat skips; an error names the status only', async () => {
  const ok = fake();
  assert.deepEqual(await post(digest, {token: 'T0K', chat: '-100', fetch: ok.fetch}), {sent: 1});
  assert.equal(ok.calls[0].url, 'https://api.telegram.org/botT0K/sendMessage');
  assert.deepEqual([ok.calls[0].body.chat_id, ok.calls[0].body.parse_mode], ['-100', 'HTML']);
  const none = fake();
  assert.match((await post(digest, {token: '', chat: '-100', fetch: none.fetch})).skipped, /not set/);
  assert.equal(none.calls.length, 0);
  await assert.rejects(post(digest, {token: 'SECRET', chat: '-100', fetch: fake(401).fetch}), error => /401/.test(error.message) && !/SECRET/.test(error.message));
});
