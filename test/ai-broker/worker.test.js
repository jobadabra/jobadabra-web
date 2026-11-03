// Exercises broker admission, persistence and failure accounting offline; only Cloudflare's runtime and Codex transport are replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import {day, body, success, harness} from './harness.mjs';

test('concurrent calls across the cap dispatch only 24 and preserve token completions', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness();
  let dispatched = 0;
  broker.containerFetch = async () => { dispatched++; return success(); };
  const replies = await Promise.all(Array.from({length: 30}, () => broker.call('drift', body)));
  assert.equal(replies.filter(r => r.status === 200).length, 24);
  assert.equal(replies.filter(r => r.status === 429).length, 6);
  for (const reply of replies.filter(r => r.status === 429)) {
    assert.deepEqual(await reply.json(), {why: 'budget:daily 24 of 24 calls (drift)'});
  }
  assert.equal(dispatched, 24);
  assert.equal((await storage.get('meter')).tokens.drift, 120);
  assert.equal((await (await broker.health()).json()).daily.drift, 24);
});

test('each failure counts before dispatch and survives an eviction or rerun', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, restart} = harness();
  const responses = [
    () => new Response(JSON.stringify({error: 'codex failed'}), {status: 500}),
    () => new Response('not JSON', {status: 502}),
    () => { throw new Error('container unavailable'); },
    () => new Response(JSON.stringify({reply: 'sk-' + 'a'.repeat(30), tokens: {input: 1, output: 1}, ms: 1})),
  ];
  for (let i = 0; i < 24; i++) {
    broker.containerFetch = async () => {
      assert.equal((await (await broker.health()).json()).daily.drift, i + 1, 'reservation precedes transport');
      return responses[i % 4]();
    };
    if (i % 4 === 2) await assert.rejects(() => broker.call('drift', body), /container unavailable/);
    else assert.equal((await broker.call('drift', body)).status, [502, 502, 0, 422][i % 4]);
  }
  const resumed = restart();
  assert.equal((await resumed.call('drift', body)).status, 429);
  assert.equal((await (await resumed.health()).json()).daily.drift, 24);
});

test('health and admission reset on the next UTC day, even with an old stored meter', async t => {
  let now = day;
  t.mock.method(Date, 'now', () => now);
  const {broker, restart, storage} = harness({resetsAt: 2000000000, tokens: {pr: 1, scheduled: 2, bench: 3}});
  assert.equal((await (await broker.health()).json()).daily.drift, 0);
  for (let i = 0; i < 24; i++) assert.equal((await broker.call('drift', body)).status, 200);
  now += 1000;
  const resumed = restart();
  assert.equal((await (await resumed.health()).json()).daily.drift, 0);
  assert.equal((await resumed.call('drift', body)).status, 200);
  assert.equal((await (await resumed.health()).json()).daily.drift, 1);
  assert.equal((await storage.get('meter')).tokens.drift, 125);
});

test('weekly refusals do not consume daily slots and caller input cannot change the accepted lane', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness();
  await storage.put('limits', {usedPercent: 100});
  assert.equal((await broker.call('drift', {...body, lane: 'pr'})).status, 429);
  assert.equal((await (await broker.health()).json()).daily.drift, 0);
  broker.limits = {usedPercent: 0};
  for (let i = 0; i < 24; i++) assert.equal((await broker.call('drift', {...body, lane: 'pr'})).status, 200);
  assert.equal((await broker.call('drift', {...body, lane: 'pr'})).status, 429);
});

test('non-boolean search is a 400 before admission or container dispatch', async t => {
  for (const search of ['true', 'false', 0, 1, null, {}, []]) await t.test(JSON.stringify(search), async () => {
    const {broker, storage} = harness();
    broker.containerFetch = async () => { assert.fail('invalid search must not reach Codex'); };
    const response = await broker.fetch(new Request('http://c/call', {
      method: 'POST', headers: {'x-lane': 'scheduled'}, body: JSON.stringify({...body, search}),
    }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {why: 'search must be a boolean'});
    assert.equal(await storage.get('meter'), undefined);
  });
});

test('search keeps every tier, lane, queue priority and meter identical to ordinary calls', async t => {
  t.mock.method(Date, 'now', () => day);
  const tiers = [[undefined, 'mid', 'gpt-6.1-sol'], ['small', 'small', 'gpt-6-luna'], ['mid', 'mid', 'gpt-6.1-sol'], ['large', 'large', 'gpt-6-astra']];
  for (const lane of ['pr', 'scheduled', 'bench', 'drift']) for (const [tier, expectedTier, model] of tiers) {
    let ordinaryMeter;
    for (const option of [{}, {search: false}, {search: true}]) {
      const {broker, storage} = harness();
      const acquire = broker.gate.acquire.bind(broker.gate);
      broker.gate.acquire = async priority => {
        assert.equal(priority, lane === 'drift' ? 'scheduled' : lane);
        return acquire(priority);
      };
      broker.containerFetch = async (url, init) => {
        assert.equal(url, 'http://c/call');
        assert.deepEqual(JSON.parse(init.body), {prompt: 'offline test', ...(tier === undefined ? {} : {tier}), ...option, lane: 'forged', model});
        return success();
      };
      const response = await broker.call(lane, {...body, tier, ...option, lane: 'forged'});
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {reply: 'ok', tokens: {input: 2, output: 3}, ms: 1, lane, tier: expectedTier, model, weekUsedPercent: null, engine: 'codex'});
      const meter = await storage.get('meter');
      assert.equal(meter.tokens[lane], 5);
      if (ordinaryMeter) assert.deepEqual(meter, ordinaryMeter);
      else ordinaryMeter = meter;
      broker.limits = {usedPercent: 100};
      assert.equal((await broker.call(lane, {...body, tier, ...option})).status, 429);
      assert.deepEqual(await storage.get('meter'), ordinaryMeter);
    }
  }
});

// The fallback to Free AI (the last engine, no paid API) is tested in free-ai-fallback.test.js.

test('an unknown effort is a 400 before admission or container dispatch', async t => {
  for (const effort of ['', 'max', 'HIGH', 'minimal', 1, null, {}, []]) await t.test(JSON.stringify(effort), async () => {
    t.mock.method(Date, 'now', () => day);
    const {broker, storage} = harness();
    broker.containerFetch = async () => { assert.fail('invalid effort must not reach Codex'); };
    const response = await broker.call('scheduled', {...body, effort});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {why: 'effort must be low, medium, high or xhigh'});
    assert.equal(await storage.get('meter'), undefined);
  });
});

test('a valid effort reaches Codex and counts for more of the week: low and none 1x, high 2x, xhigh 4x', async t => {
  t.mock.method(Date, 'now', () => day);
  for (const [effort, counted] of [[undefined, 5], ['low', 5], ['medium', 5], ['high', 10], ['xhigh', 20]]) {
    const {broker, storage} = harness();
    let sent;
    broker.containerFetch = async (url, init) => { sent = JSON.parse(init.body); return success(); };
    const response = await broker.call('scheduled', {...body, tier: 'large', ...(effort ? {effort} : {})});
    assert.equal(response.status, 200);
    assert.equal(sent.effort, effort);
    assert.equal(sent.model, 'gpt-6-astra');
    assert.equal((await storage.get('meter')).tokens.scheduled, counted, `${effort ?? 'default'} effort`);
  }
});
