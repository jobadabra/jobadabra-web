// admin/ai-refusal.js: a skipped AI (the Codex broker said no) is named, kinds are told apart, the owner is told once per outage, no token is ever printed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ask} from '../../../../admin/build-digest.js';
import {AiRefused, aiLine, describe, isRefusal, kindOf, reportRefusal, shouldTell, staysDown, tellOwner} from '../../../../admin/ai-refusal.js';
import {reasonOf} from '../../../../desktop/e2e/lib/broker-reason.mjs';

// The Codex broker's answers as askBroker (desktop/e2e/lib/broker-client.mjs) reports them: 'capped' = its allowance or login said no, 'no-token', 'unreachable', or an HTTP status.
const answer = (status, detail) => ({broker: async () => ({ok: false, status, detail})});
const BUDGET = 'broker: budget:week 100% of 100% (scheduled)';

test('ask throws AiRefused with the kind: capped (the Codex allowance), no run token, 401, 429, 502', async () => {
  for (const [status, detail, kind] of [['capped', BUDGET, 'limit'], ['no-token', 'no GitHub OIDC token here', 'auth'], [401, 'broker: oidc: wrong repository', 'auth'], [429, 'broker: slow down', 'rate'], [502, 'broker: codex-failed', 'overloaded'], [422, 'broker: reply-refused: looks like a JWT', 'other']]) {
    const caught = await ask({system: 's', user: 'u'}, answer(status, detail)).catch(error => error);
    assert.ok(isRefusal(caught), `${status}`);
    assert.equal(caught.kind, kind, `${status}`);
    assert.equal(caught.status, status);
    assert.match(caught.message, new RegExp(`^broker answered ${status}: `));
  }
  assert.equal(kindOf(500, ''), 'overloaded');
});

test('the description says "AI skipped", names the cause and the broker\'s words, and never a token', async () => {
  const caught = await ask({system: 's', user: 'u'}, answer('capped', `${BUDGET} eyJhbGciOi`)).catch(error => error);
  assert.match(describe(caught), /^AI skipped \(limit\): no AI engine has an allowance left, or its login is not available\. broker: budget:week 100% of 100% \(scheduled\)/);
  assert.doesNotMatch(describe(caught), /Anthropic/);
  for (const kind of ['limit', 'auth', 'rate', 'overloaded', 'other']) assert.doesNotMatch(describe(new AiRefused(kind === 'limit' ? 'capped' : kind === 'auth' ? 401 : kind === 'rate' ? 429 : kind === 'overloaded' ? 502 : 422, 'x')), /Codex/, `${kind}: the broker also runs Claude and Free AI, so its refusals never say Codex`);
  assert.ok(staysDown(caught) && !staysDown(new AiRefused(422, 'reply-refused')) && !staysDown(new Error('x')));
});

test('the owner is told when the outage begins and once a day at 08, not at every red run', () => {
  assert.ok(shouldTell({previous: 'success', zurichHour: 14}) && shouldTell({previous: null, zurichHour: 14}));
  assert.ok(!shouldTell({previous: 'failure', zurichHour: 14}));
  assert.ok(shouldTell({previous: 'failure', zurichHour: 8}));
});

test('tellOwner uses the CI alerts bot, else the Build Log bot, skips without one, and never throws', async () => {
  const sent = [];
  const fetch = async (url, init) => { sent.push([url, JSON.parse(init.body).chat_id]); return new Response('{}'); };
  assert.deepEqual(await tellOwner('x', {env: {BUILDLOG_TELEGRAM_TOKEN: 'b', BUILDLOG_TELEGRAM_CHAT: '2', CI_ALERTS_TELEGRAM_BOT_TOKEN: 'a', CI_ALERTS_TELEGRAM_CHAT_ID: '1'}, fetch}), {sent: true});
  assert.deepEqual(await tellOwner('x', {env: {BUILDLOG_TELEGRAM_TOKEN: 'b', BUILDLOG_TELEGRAM_CHAT: '2'}, fetch}), {sent: true});
  assert.deepEqual(sent, [['https://api.telegram.org/bota/sendMessage', '1'], ['https://api.telegram.org/botb/sendMessage', '2']]);
  assert.ok((await tellOwner('x', {env: {}, fetch})).skipped);
  assert.ok((await tellOwner('x', {env: {BUILDLOG_TELEGRAM_TOKEN: 'b', BUILDLOG_TELEGRAM_CHAT: '2'}, fetch: async () => { throw new TypeError('down'); }})).skipped);
});

test('reportRefusal logs the named error and tells once: the run before red means no message', async () => {
  const told = [];
  const env = {BUILDLOG_TELEGRAM_TOKEN: 'b', BUILDLOG_TELEGRAM_CHAT: '2', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9'};
  const fetch = async (_, init) => { told.push(JSON.parse(init.body).text); return new Response('{}'); };
  const runs = conclusion => () => JSON.stringify([{databaseId: 9, status: 'in_progress', conclusion: null}, {databaseId: 8, status: 'completed', conclusion}]);
  const error = new AiRefused('capped', BUDGET);
  await reportRefusal(error, {job: 'Changelog publish', effect: 'Plain entries went out.', workflow: 'w.yml', zurichHour: 14, env, fetch, run: runs('success')});
  assert.equal(told.length, 1);
  // Why (6 Nov 2026, public jobadabra#3345; owner: "make it human readable"): Telegram carries the plain cause, never the broker's raw words; a `budget:` reason reads as the plain row the public repo owns, and the job's effect line follows.
  // Why (8 Nov 2026, fr; red main since 54b8319): the sentence itself is owned by desktop/e2e/lib/broker-reason.mjs (public jobadabra#3583 reworded "allowance is used up" to "Codex's week reached its line"); this test asserts the class, not a copy of the sentence: it is read from there.
  const row = reasonOf(BUDGET).row;
  assert.ok(row && !/budget:|broker/i.test(row), 'a plain row exists for a budget reason');
  assert.match(told[0], /^🟠 <b>Changelog publish: AI refused a job<\/b>/);   // the card (public jobadabra#3644): headline, the plain cause row, the job's effect line
  assert.ok(told[0].includes(`💳 ${row}`) && told[0].includes('Plain entries went out.'), told[0]);
  assert.doesNotMatch(told[0], /budget:|AI skipped/, 'no raw broker words in the message');
  await reportRefusal(error, {job: 'Changelog publish', workflow: 'w.yml', zurichHour: 14, env, fetch, run: runs('failure')});
  assert.equal(told.length, 1, 'already red before: no second message');
});

test('ask passes on which engine answered, and aiLine prints it on one line (owner, 1 Nov 2026: CI should know which model answers)', async () => {
  const reply = extra => ({broker: async () => ({ok: true, message: {content: [{type: 'text', text: 'hi'}], stop_reason: 'end_turn', usage: {}}, model: 'claude-haiku-5-5', ...extra})});
  const fell = await ask({system: 's', user: 'u'}, reply({engine: 'claude', fellBack: [{engine: 'codex', why: 'ran-out'}]}));
  assert.deepEqual([fell.engine, fell.model, fell.fellBack], ['claude', 'claude-haiku-5-5', [{engine: 'codex', why: 'ran-out'}]]);
  assert.equal(aiLine(fell), 'AI: claude / claude-haiku-5-5 (codex ran-out)');
  assert.equal(aiLine(await ask({system: 's', user: 'u'}, reply({engine: 'codex', model: 'gpt-6-luna'}))), 'AI: codex / gpt-6-luna');
  assert.equal(aiLine(await ask({system: 's', user: 'u'}, reply({}))), 'AI: claude-haiku-5-5', 'a client that does not send the engine yet (public repo 6/7) still shows the model');
  assert.equal(aiLine({}), '', 'nothing known, nothing printed');
});
