// Guard: data — an upload of kind "harness-fixer" can make the Agent harness page throw, render HTML, or claim a verdict from too few runs.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {cleanFixer, fixerCard} from '../../../../admin/harness-usage.js';
import {harnessPage} from '../../../../admin/ai-harness.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: async () => new Response('x')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const put = (e, body) => call(e, '/agent-coding/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(body)});
const day = {runs: 24, tools: [{id: 'map-index', runs: 12}, {id: 'map-hub', runs: 6}], help: {with_map: {n: 12, turns: 3.1, calls: 4.2, minutes: 9.5, ready: 7}, without_map: {n: 12, turns: 5.4, calls: 7.9, minutes: 17.3, ready: 3}}};

test('every value of the upload is clamped, unknown tool ids are dropped, and cleaning twice changes nothing', () => {
  const wild = cleanFixer({runs: 1e12, tools: [{id: 'codemap', runs: 5}, {id: 'map-hub', runs: 1e12}, {id: 'map-hub', runs: 2}, {id: '<b>x</b>', runs: 1}, null], help: {with_map: {n: 3, turns: -4, calls: 'x', minutes: 1e12, ready: 99}, without_map: '<script>'}});
  assert.equal(wild.runs, 1e7); assert.deepEqual(wild.tools, [{id: 'map-hub', runs: 1e7}]);
  assert.deepEqual(wild.help.with_map, {n: 3, turns: 0, calls: 0, minutes: 1e5, ready: 3}, 'ready never exceeds n');
  assert.deepEqual(wild.help.without_map, {n: 0, turns: 0, calls: 0, minutes: 0, ready: 0});
  assert.deepEqual(cleanFixer(day), day); assert.deepEqual(cleanFixer(cleanFixer(wild)), wild);
  for (const bad of [null, 'text', 5, []]) assert.equal(cleanFixer(bad), null);
});

test('below 5 runs in a group the card says "too few to compare" and claims nothing; with enough runs it says the difference as a link', () => {
  const small = fixerCard({...day, help: {...day.help, with_map: {...day.help.with_map, n: 4}}});
  assert.match(small, /too few to compare/); assert.doesNotMatch(small, /fewer turns|more turns/);
  const enough = fixerCard({...day, day: '2026-11-05'});
  assert.match(enough, /43% fewer turns with the map/); assert.match(enough, /link, not a cause/); assert.match(enough, /as of 2026-11-05/); assert.match(enough, /<details>/);
  assert.match(fixerCard({...day, help: {with_map: {...day.help.with_map, turns: 6}, without_map: day.help.without_map}}), /more turns with the map/);
});

test('no card, or a card that counted no run, reads "No data yet", never zeros', () => {
  for (const stored of [null, undefined, {runs: 0, tools: [], help: {}}, 'x', {}]) { const html = fixerCard(stored); assert.match(html, /No data yet/); assert.doesNotMatch(html, /<table/); }
});

test('a stored card of any shape (raw, from before a change) renders without throwing and never as HTML', () => {
  for (const stored of [{runs: 'many', tools: 'x', help: null}, {runs: 5, tools: [{id: 'map-index', runs: '<img src=x onerror=1>'}], help: {with_map: {n: '<b>', turns: '<i>'}}}, new Date(), {runs: 3, day: '<script>', tools: [], help: {}}]) {
    const html = harnessPage(null, stored);
    assert.doesNotMatch(html, /<img|<script>|<i>&lt|<b>x/);
  }
  assert.doesNotMatch(fixerCard({runs: 3, day: '<script>', tools: [], help: {}}), /<script>|as of/);
  assert.match(harnessPage(null, null), /No data yet/, 'the page still has its other cards without the upload');
});

test('the route stores the kind clamped, the page shows the card to the owner only, and the old Agent coding page ignores the kind', async () => {
  const e = env();
  assert.equal((await put(e, {kind: 'harness-fixer', days: [{day: '2026-11-05', ...day, tools: [{id: 'evil', runs: 1}, ...day.tools]}]})).status, 200);
  assert.equal((await call(e, '/admin/ai/harness')).status, 404);
  const html = await (await call(e, '/admin/ai/harness', owner)).text();
  assert.match(html, /does the map help/); assert.match(html, /43% fewer turns/); assert.match(html, /Context layers and sources/); assert.doesNotMatch(html, /evil/);
  assert.equal((await put(e, {kind: 'harness-fixer', days: [{day: '2026-11-05', runs: 'x'}]})).status, 200, 'a card with no usable number is stored as empty, shown as No data yet');
  assert.match(await (await call(e, '/admin/ai/harness', owner)).text(), /No data yet/);
  assert.equal((await put(e, {kind: 'harness-local', days: [{day: '2026-11-05'}]})).status, 400, 'the Mac kind is not accepted');
  assert.equal((await call(e, '/admin/agents/agent-coding', owner)).status, 200);
  assert.equal((await call(e, '/admin/ai/runs', owner)).status, 200);
});
