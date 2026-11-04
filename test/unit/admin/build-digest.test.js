// Guard for the daily build digest (admin/build-digest.js) on the PRs merged on 16 Oct 2026 (#957-#1081): cut-down, validation of the AI's fixed answer, rendering. No live AI: the model is a fake.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {ask, buildPrompt, countOf, dayWords, makeDigest, plan, prList, render, summarize, validate, zurichDay, zurichHour} from '../../../admin/build-digest.js';

const prs = JSON.parse(readFileSync(new URL('../../fixtures/prs-2026-10-16.json', import.meta.url), 'utf8'));
const numbers = prs.map(pr => pr.number);

// A fake model: three goals, each PR in one of them.
const fakeAnswer = (list, extra = {}) => JSON.stringify({groups: [0, 1, 2].map(i => ({emoji: ['🧭', '🤖', '🧪'][i], title: `Goal ${i}`, bullets: [{lead: `Lead ${i}`, text: `Plain sentence ${i}.`, prs: list.filter((_, k) => k % 3 === i)}]})), open: 'The bot token.', ...extra});
// A fake Codex broker (askBroker's answer shape): texts in order (the last repeats); each request body (Messages shape) is kept in `calls`.
const fakeFetch = (texts) => { const calls = []; return {calls, broker: async body => { calls.push(body); const text = texts[Math.min(calls.length - 1, texts.length - 1)]; return {ok: true, message: {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 9000, output_tokens: 1200}}}; }}; };

test('the day is the Zurich day, not the UTC one', () => {
  assert.equal(zurichDay(new Date('2026-10-16T22:30:00Z')), '2026-10-17');
  assert.equal(zurichDay(new Date('2026-10-16T10:00:00Z')), '2026-10-16');
  assert.equal(dayWords('2026-10-16'), '16 Oct');
});

test('a PR body is cut down to its verdict, changes and one before/after row (≤ 400 characters)', () => {
  const pr = prs.find(item => item.number === 1078), item = summarize({...pr, body: readFullBody()});
  assert.equal(item.title, 'Add /api/trial/status: one free-trial answer for the app and Always on');
  assert.match(item.text, /Always on now counts against the same free trial/);
  assert.match(item.text, /GET \/api\/trial\/status/);
  assert.match(item.text, /Cloud run after day 60 \/ 20 apps: keeps searching -> pauses/);
  for (const one of prs.map(summarize)) assert.ok(one.text.length <= 400 && one.title, `#${one.number}`);
});
function readFullBody() {
  return `## 🟢 Always on now counts against the same free trial as the app.\n\n> [!NOTE]\n> **Why:** x\n\n---\n\n### 📊 Impact\n\n| Area | Impact | How |\n|---|---|---|\n| 👤 Real users | 🟢 High | x |\n\n---\n\n### ✅ What changed\n\n- ✅ New \`GET /api/trial/status\`: highest count kept\n- ✅ The JPF1 key is refused\n\n---\n\n### 🔍 Before → After\n\n| 📏 What | 🔴 Before | 🟢 After |\n|:---|:---:|:---:|\n| **Cloud run after day 60 / 20 apps** | keeps searching | **pauses** |\n`;
}

test('the prompt carries every merged PR and the open ones, nothing else', () => {
  const {system, user} = buildPrompt(prs.map(summarize), [{number: 1090, title: '[31] Open thing'}]);
  for (const number of numbers) assert.ok(user.includes(`#${number} `), `#${number}`);
  assert.match(user, /Open thing/);
  assert.match(system, /ONLY a JSON object/);
  assert.ok(user.length < 60000, `prompt is ${user.length} characters`);
});

test('a good answer is kept, unknown PR numbers and empty bullets are dropped, forgotten PRs go to Smaller changes', () => {
  const ok = validate(`Here you go:\n${fakeAnswer(numbers.slice(0, 90))}`, numbers);
  assert.equal(ok.groups.length, 4);
  assert.equal(ok.groups.at(-1).title, 'Smaller changes');
  assert.deepEqual(ok.groups.at(-1).bullets[0].prs, numbers.slice(90));
  const bad = validate({groups: [{emoji: '🧭', title: 'A', bullets: [{lead: 'L', text: 'T', prs: [999999]}, {lead: 'L2', text: 'T2', prs: [numbers[0], 999999]}]}]}, numbers);
  assert.deepEqual(bad.groups[0].bullets.map(bullet => bullet.prs), [[numbers[0]]]);
  assert.equal(bad.dropped, 1);
});

test('an unusable answer is an error, never a half digest', () => {
  assert.equal(validate('sorry, no', numbers).error, 'not JSON');
  assert.equal(validate({groups: []}, numbers).error, 'no usable group');
  assert.equal(validate({nope: 1}, numbers).error, 'no groups');
  assert.equal(validate({groups: [{emoji: '', title: 'A', bullets: [{lead: 'L', text: 'T', prs: [numbers[0]]}]}]}, numbers).error, 'no usable group');
});

test('PR numbers: runs of 3 or more become a range', () => {
  assert.equal(prList([980, 972, 973, 974]), '#972-#974, #980');
  assert.equal(prList([5, 6]), '#5, #6');
  assert.deepEqual(countOf(numbers), {count: 116, min: 957, max: 1081});
});

test('the intro is written by code, with the count and range of the day', () => {
  const checked = validate(fakeAnswer(numbers), numbers), md = render({day: '2026-10-16', groups: checked.groups, open: checked.open, numbers});
  assert.match(md, /^Here's what we achieved on 16 Oct, grouped by goal\. About 116 PRs merged, from #957 to #1081\./);
  assert.match(md, /🧭 \*\*Goal 0\*\*\n- \*\*Lead 0\.\*\* Plain sentence 0\. \(#957/);
  assert.match(md, /\*\*Still open:\*\* The bot token\.\n$/);
  assert.match(render({day: '2026-10-17', groups: [], open: '', numbers: []}), /^Nothing was merged on 17 Oct\./);
});

test('makeDigest: asks once, validates, reports the tokens; a bad first answer is retried once; two bad ones throw', async () => {
  const good = fakeFetch([fakeAnswer(numbers)]);
  const done = await makeDigest({day: '2026-10-16', prs, open: [], broker: good.broker});
  assert.equal(good.calls.length, 1);
  assert.equal(good.calls[0].model, 'claude-haiku-5-5');
  assert.deepEqual(done.usage, {input_tokens: 9000, output_tokens: 1200});
  assert.equal(done.calls, 1, 'one broker call');
  assert.equal(done.groups.length, 3);
  const retry = fakeFetch(['not json', fakeAnswer(numbers)]);
  assert.equal((await makeDigest({day: '2026-10-16', prs, broker: retry.broker})).usage.input_tokens, 18000);
  await assert.rejects(makeDigest({day: '2026-10-16', prs, broker: fakeFetch(['no']).broker}), /unusable twice/);
  const none = fakeFetch(['unused']);
  assert.match((await makeDigest({day: '2026-10-16', prs: [], broker: none.broker})).markdown, /Nothing was merged/);
  assert.equal(none.calls.length, 0);
});

test('plan: a draft only when the PR set changed, once an hour, 8 a day; the final one from 23:00 Zurich or after midnight, once', () => {
  const now = new Date('2026-10-16T12:00:00Z'), at = minutes => new Date(now.getTime() - minutes * 60000).toISOString();
  const base = {now, numbers: [1, 2, 3], zurichHour: 14};
  assert.deepEqual(plan({...base, stored: {numbers: null, drafts: 0}}), {final: false});
  assert.deepEqual(plan({...base, numbers: [], stored: {numbers: null}}), {skip: 'nothing merged'});
  assert.deepEqual(plan({...base, stored: {numbers: [3, 2, 1], drafts: 2, updatedAt: at(200)}}), {skip: 'unchanged'});
  assert.deepEqual(plan({...base, stored: {numbers: [1, 2], drafts: 2, updatedAt: at(20)}}), {skip: 'updated less than an hour ago'});
  assert.deepEqual(plan({...base, stored: {numbers: [1, 2], drafts: 8, updatedAt: at(200)}}), {skip: 'already 8 drafts today'});
  assert.deepEqual(plan({...base, stored: {numbers: [1, 2], drafts: 2, updatedAt: at(61)}}), {final: false});
  assert.deepEqual(plan({...base, zurichHour: 23, stored: {numbers: [1, 2, 3], drafts: 8, updatedAt: at(5)}}), {final: true});
  assert.deepEqual(plan({...base, late: true, stored: {numbers: [1], drafts: 1}}), {final: true});
  assert.deepEqual(plan({...base, zurichHour: 23, stored: {finalAt: at(1)}}), {skip: 'closed'});
  assert.equal(zurichHour(new Date('2026-10-16T21:10:00Z')), 23);   // summer time: 23:10 in Zurich
  assert.equal(zurichHour(new Date('2026-12-16T22:10:00Z')), 23);   // winter time
  assert.equal(zurichHour(new Date('2026-10-16T22:10:00Z')), 0);
});

// 16 Oct 2026: 116 PRs, 3,000 tokens of room: Haiku's JSON was cut off at max_tokens, twice, and the run said only "not JSON".
test('a cut-off answer (stop_reason max_tokens) is retried once with more room and, if still cut, named as such', async () => {
  const calls = [];
  const cut = answers => async body => {
    calls.push(body.max_tokens);
    const [text, stop] = answers[Math.min(calls.length - 1, answers.length - 1)];
    return {ok: true, message: {content: [{type: 'text', text}], stop_reason: stop, usage: {input_tokens: 9000, output_tokens: body.max_tokens}}};
  };
  const half = fakeAnswer(numbers).slice(0, 300);
  const done = await makeDigest({day: '2026-10-16', prs, broker: cut([[half, 'max_tokens'], [fakeAnswer(numbers), 'end_turn']])});
  assert.deepEqual(calls, [8000, 16000]);
  assert.equal(done.groups.length, 3);
  calls.length = 0;
  await assert.rejects(makeDigest({day: '2026-10-16', prs, broker: cut([[half, 'max_tokens']])}), /unusable twice \(cut off at the 16000-token limit after 16000 tokens, 116 PRs\)/);
});

// A skipped call says why (the daily digest once failed with only "model answered 400", 17 Oct 2026): the broker's own words, and no token ever.
const skipped = (status, detail) => async () => ({ok: false, status, detail});
const BUDGET = 'broker: budget:week 100% of 100% (scheduled)';

test('a refused ask names the broker status and its reason', async () => {
  await assert.rejects(ask({system: 's', user: 'u'}, {broker: skipped('capped', BUDGET)}), {message: `broker answered capped: ${BUDGET}`});
  await assert.rejects(ask({system: 's', user: 'u'}, {broker: skipped('no-token', 'no GitHub OIDC token here')}), {message: 'broker answered no-token: no GitHub OIDC token here'});
  await assert.rejects(ask({system: 's', user: 'u'}, {}), {message: /^broker answered no-token: /}, 'no broker client given = refused, not a crash');
});

test('a long or empty reason is cut to a short one', async () => {
  const long = await ask({system: 's', user: 'u'}, {broker: skipped(502, 'x'.repeat(2000))}).catch(error => error);
  assert.equal(long.reason.length, 300);
  assert.equal((await ask({system: 's', user: 'u'}, {broker: skipped('unreachable', '')}).catch(error => error)).reason, 'no reason given');
});

test('ask sends the Messages request the broker client turns into a Haiku-tier call, and returns text, usage and the stop reason', async () => {
  const fake = fakeFetch(['hello']);
  assert.deepEqual(await ask({system: 'sys', user: 'usr'}, {broker: fake.broker}), {text: 'hello', usage: {input_tokens: 9000, output_tokens: 1200}, stopReason: 'end_turn'});
  assert.deepEqual([fake.calls[0].model, fake.calls[0].system, fake.calls[0].messages], ['claude-haiku-5-5', 'sys', [{role: 'user', content: 'usr'}]]);
});

test('makeDigest reports which engine wrote the digest (the last call\'s), so the job can print it', async () => {
  const good = fakeFetch([fakeAnswer(prs.map(pr => pr.number))]);
  const reporting = async body => ({...(await good.broker(body)), engine: 'claude', model: 'claude-haiku-5-5', fellBack: [{engine: 'codex', why: 'ran-out'}]});
  const done = await makeDigest({day: '2026-10-16', prs, open: [], broker: reporting});
  assert.deepEqual(done.answered, {engine: 'claude', model: 'claude-haiku-5-5', fellBack: [{engine: 'codex', why: 'ran-out'}]});
  assert.deepEqual((await makeDigest({day: '2026-10-16', prs, open: [], broker: good.broker})).answered, {}, 'a client that reports nothing gives an empty record, never undefined');
});
