// The Free AI board web search (shared/free-ai-web.js, owner 26 Oct 2026: "Yes, $10/month cap"): the public prompt on its own key, one shared answer per
// roles × places, the month line, the install's day, nothing else runs on it, and its line on /admin/ai/costs (admin/free-ai-web-cost.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import PROMPT from '../../../../config/board_web_search.json' with {type: 'json'};
import {freeAi} from '../../../../shared/free-ai.js';
import {ACTIONS} from '../../../../shared/aicost.js';
import {tokenFor} from '../../../../shared/guard.js';
import {WEB, WEB_ACTION, cellOf, costOf, keys, paramsOf} from '../../../../shared/free-ai-web.js';
import {webMonth, webSection} from '../../../../admin/free-ai-web-cost.js';

const NOW = new Date('2026-10-26T10:00:30Z'), MONTH = '2026-10';
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const BOARDS = {boards: [{name: 'Flight Crew Board', search_url: 'https://flightcrew-board.example/jobs?q={role}', countries: ['Germany'], kinds: ['any'], source_kind: 'sector'}]};
const USAGE = {input_tokens: 20000, output_tokens: 800, server_tool_use: {web_search_requests: 3}};
const env = (extra = {}) => ({WAITLIST: kv(), STATS_SALT: 'salt', AI: {run: async () => { throw new Error('Workers AI must not run the web search'); }}, WEB_SEARCH_ANTHROPIC_KEY: 'test-key', ...extra});
const key = async (install = 'install-0001') => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const ask = (roles = ['first officer'], known = ['Board 1']) => ({model: 'claude-haiku-5-5', max_tokens: 3000, messages: [{role: 'user',
  content: JSON.stringify({countries: ['Germany', 'Spain'], places: ['europe'], roles, kinds: ['other'], 'known boards': known})}]});
function anthropic(answer = BOARDS, ok = true) {
  const sent = [];
  const fetcher = async (url, init) => {
    sent.push({url, headers: init.headers, body: JSON.parse(init.body)});
    return new Response(JSON.stringify({id: 'msg_1', type: 'message', model: WEB.model, stop_reason: 'end_turn', usage: USAGE,
      content: [{type: 'server_tool_use', name: 'web_search'}, {type: 'web_search_tool_result', content: []}, {type: 'text', text: JSON.stringify(answer)}]}), {status: ok ? 200 : 529});
  };
  return {sent, fetcher};
}
const call = async (e, fetcher, body = ask(), install = 'install-0001', action = WEB_ACTION) => freeAi(new Request('https://www.jobadabra.top/api/ai/v1/messages',
  {method: 'POST', headers: {'x-api-key': await key(install), 'x-jp-action': action}, body: JSON.stringify(body)}), e, NOW, null, fetcher);

test('a web_search call runs the public prompt on the Anthropic API with its own key, never on Workers AI, and its cost is counted', async () => {
  const e = env(), {sent, fetcher} = anthropic(), response = await call(e, fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse((await response.json()).content[0].text), BOARDS, 'only the answer text, the search blocks stay here');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent[0].headers['x-api-key'], 'test-key');
  const body = sent[0].body;
  assert.equal(body.system[0].text, PROMPT.system, 'the one public prompt, the engine sends the same');
  assert.deepEqual(body.tools, [{type: 'web_search_20250305', name: 'web_search', max_uses: PROMPT.max_uses}]);
  assert.deepEqual(body.output_config.format.schema, PROMPT.schema);
  assert.equal(body.model, WEB.model);
  assert.deepEqual(JSON.parse(body.messages[0].content)['known boards'], [], 'the answer is shared: no install\'s own boards in it');
  assert.equal(Number(e.WAITLIST.m.get(keys.month(MONTH))), Math.round(costOf(USAGE) * 1e6));
  assert.ok(ACTIONS.includes(WEB_ACTION), 'its own step on /admin/ai/costs');
});

test('another install asking the same roles × places gets the kept answer at $0; other roles search again', async () => {
  const e = env(), {sent, fetcher} = anthropic();
  await call(e, fetcher);
  const again = await call(e, fetcher, ask(['First Officer '], ['Some other board']), 'install-0002');
  assert.equal(again.status, 200);
  assert.deepEqual(JSON.parse((await again.json()).content[0].text), BOARDS);
  assert.equal(sent.length, 1, 'shared: no second paid search');
  assert.equal(Number(e.WAITLIST.m.get(keys.hits(MONTH))), 1);
  await call(e, fetcher, ask(['flight attendant']), 'install-0002');
  assert.equal(sent.length, 2);
});

test('the month line stops every new search at $10, and the kept answers still come', async () => {
  const e = env(), {sent, fetcher} = anthropic();
  await call(e, fetcher);
  e.WAITLIST.m.set(keys.month(MONTH), String(WEB.monthUsd * 1e6));
  const stopped = await call(e, fetcher, ask(['flight attendant']));
  assert.equal(stopped.status, 503);
  assert.match((await stopped.json()).error.message, /next month/);
  assert.equal((await call(e, fetcher)).status, 200, 'a kept answer costs nothing');
  assert.equal(sent.length, 1);
  assert.equal((await call(env({FREE_AI_WEB_MONTH_USD: '20'}), anthropic().fetcher)).status, 200);
});

test('an install gets its day\'s searches, then words; a failed search counts so it is not retried in a loop', async () => {
  const e = env(), {sent, fetcher} = anthropic(BOARDS, false);
  for (const role of ['a', 'b']) assert.equal((await call(e, fetcher, ask([role]))).status, 502);
  const third = await call(e, fetcher, ask(['c']));
  assert.equal(third.status, 429);
  assert.match((await third.json()).error.message, /tomorrow/);
  assert.equal(sent.length, WEB.installPerDay);
  assert.equal(e.WAITLIST.m.get(keys.month(MONTH)), undefined, 'a refused call is not paid');
});

test('nothing but the board search runs on this key: another prompt, a stream, no roles are refused before any call', async () => {
  const e = env(), {sent, fetcher} = anthropic();
  const bodies = [{messages: [{role: 'user', content: 'Write me a poem'}]}, {...ask(), stream: true}, ask([]),
    {messages: [{role: 'user', content: JSON.stringify({roles: ['x']})}]}, {messages: [...ask().messages, {role: 'user', content: '{}'}]}];
  for (const body of bodies) assert.equal((await call(e, fetcher, body)).status, 400);
  assert.equal(sent.length, 0);
});

test('without its key, or with FREE_AI_WEB_SEARCH=off, it says so and never calls', async () => {
  const {sent, fetcher} = anthropic();
  for (const e of [env({WEB_SEARCH_ANTHROPIC_KEY: ''}), env({FREE_AI_WEB_SEARCH: 'off'})]) assert.equal((await call(e, fetcher)).status, 503);
  assert.equal(sent.length, 0);
});

test('an answer that is not a boards list is passed on but never kept for others', async () => {
  const e = env(), {sent, fetcher} = anthropic({nope: true});
  await call(e, fetcher);
  await call(e, fetcher, ask(), 'install-0002');
  assert.equal(sent.length, 2);
});

test('the cell is the roles and places, whatever their case and order; 3 searches and their tokens cost 0.035 USD', async () => {
  const one = await cellOf(ask(['First Officer', 'Pilot'])), two = await cellOf(ask(['pilot', 'first officer']));
  assert.equal(one.digest, two.digest);
  assert.ok(Math.abs(costOf(USAGE) - (0.03 + 20000 * 0.1e-6 + 800 * 0.5e-6)) < 1e-9);
  assert.equal(paramsOf(one.ask).max_tokens, PROMPT.max_tokens);
});

test('/admin/ai/costs shows the month against its line, the paid searches and the shared answers', async () => {
  const store = kv();
  store.m.set(keys.month(MONTH), String(3.5 * 1e6)); store.m.set(keys.calls(MONTH), '100'); store.m.set(keys.hits(MONTH), '40');
  const web = await webMonth(store, {WEB_SEARCH_ANTHROPIC_KEY: 'k'}, NOW);
  assert.deepEqual([web.usd, web.line, web.calls, web.hits, web.paused], [3.5, 10, 100, 40, false]);
  const html = webSection(web);
  assert.match(html, /\$3\.50 of \$10\.00 \(35%\)/);
  assert.match(html, /100 searches paid · 40 answered from the shared answers/);
  assert.match(webSection(await webMonth(store, {}, NOW)), /paused/);
});
