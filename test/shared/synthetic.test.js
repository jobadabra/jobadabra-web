// Synthetic monitoring (shared/synthetic.js): each probe is up only on a POSITIVE answer (200 with the wrong content is down), two reds in a row tell once, the first green tells "back",
// a round starts only on its minutes, and nothing a probe or Telegram does can throw out of the tick. Fake fetch, fake Telegram, a real SQLite with the real migration.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../workers/www/index.js';
import {PROBES, ROUND_MINUTES, dueRound, lastRoute, purge, readCard, readDays, readDaysByProbe, runRound, settle, tell, tick} from '../../shared/synthetic.js';

const good = {
  'https://www.jobadabra.top/': '<html><title>Jobadabra: your job search on autopilot</title></html>',
  'https://www.jobpilotto.workers.dev/api/index?summary=1': {employers: 6216, jobs: 390105},
  'https://www.jobpilotto.workers.dev/api/pro/status': {ok: true, plan: 'free'},
  'https://www.jobpilotto.workers.dev/api/ai/v1/models': {data: [], has_more: false},
  'https://www.jobpilotto.workers.dev/api/ai/caps': {ok: true, lane: 'free', capped: null},
  'https://www.jobpilotto.workers.dev/api/releases/latest': {tag_name: 'desktop-v0.8.60', assets: [{name: 'Jobadabra-0.8.60-arm64.dmg'}, {name: 'Jobadabra-windows-x64.exe'}]},
};
const CHAIN = [{name: 'codex', configured: true, answeredToday: 0, ranOutToday: 40}, {name: 'claude', configured: true, state: 'ready', answeredToday: 12}, {name: 'free-ai', configured: true, answeredToday: 1}];   // today's real shape: Codex ran out, Claude answers
const BROKER = {fallback: {day: '2026-11-01', freeAi: 0, freeAiCap: 10}, chain: CHAIN};
const answer = body => (typeof body === 'string' ? new Response(body) : Response.json(body));

function world(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../db/migrations/0123_synthetic.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({results: db.prepare(sql).all(...args)})});
  const STATS = {prepare: sql => statement(sql), batch: async list => { for (const item of list) await item.run(); }};
  const telegram = [], seen = [], answers = {...good, ...overrides};
  const fetcher = async (url, init) => {
    url = String(url);
    if (url.includes('api.telegram.org')) { telegram.push(JSON.parse(init.body)); return overrides.telegramDown ? new Response('{}', {status: 500}) : new Response('{}'); }
    seen.push({url, key: init?.headers?.['x-api-key']});
    const body = answers[url];
    if (body instanceof Response) return body;
    if (body === 'throw') throw new TypeError('network');
    if (body === 'timeout') throw Object.assign(new Error('t'), {name: 'TimeoutError'});
    return body === undefined ? new Response('missing', {status: 404}) : answer(body);
  };
  const env = {STATS, STATS_SALT: 'salt', SENTRY_TELEGRAM_TOKEN: 'bot', SENTRY_TELEGRAM_CHAT: '42', AI_BROKER: {fetch: async () => Response.json(BROKER)}};
  return {db, env, fetcher, telegram, seen, answers};
}
const at = n => `2026-11-01T12:${String(n).padStart(2, '0')}:00Z`;
const byProbe = rows => Object.fromEntries(rows.map(row => [row.probe, row]));

test('a good world: every probe is up, with no reason', async () => {
  const w = world();
  const rows = await runRound(w.env, {fetcher: w.fetcher});
  assert.deepEqual(rows.map(row => row.probe).sort(), PROBES.map(probe => probe.id).sort());
  assert.ok(rows.every(row => row.ok === 1 && row.reason === ''), JSON.stringify(rows));
});

test('every probe, class loop: HTTP 200 with the wrong content is down, and so are a 5xx, a timeout and an unreachable host', async () => {
  const wrong = {
    site: ['https://www.jobadabra.top/', '<html><title>Error 1101</title></html>', 'page title missing'],
    index: ['https://www.jobpilotto.workers.dev/api/index?summary=1', {employers: 0, jobs: 0}, 'no employers in the index'],
    license: ['https://www.jobpilotto.workers.dev/api/pro/status', {ok: true}, 'no plan in the answer'],
    'free-ai': ['https://www.jobpilotto.workers.dev/api/ai/caps', {ok: true}, 'no lane in the caps'],
    updates: ['https://www.jobpilotto.workers.dev/api/releases/latest', {tag_name: 'desktop-v0.8.60', assets: [{name: 'Jobadabra-mac-arm64.dmg'}]}, 'Mac or Windows installer missing'],
  };
  for (const probe of PROBES.filter(item => item.id !== 'broker')) {
    const [url, body, reason] = wrong[probe.id];
    for (const [bad, expect] of [[body, reason], [new Response('x', {status: 502}), 'HTTP 502'], ['timeout', 'timeout 10s'], ['throw', 'unreachable']]) {
      const w = world({[url]: bad});
      const row = byProbe(await runRound(w.env, {fetcher: w.fetcher}))[probe.id];
      assert.equal(row.ok, 0, `${probe.id} must be down for ${expect}`);
      assert.equal(row.reason, expect, probe.id);
    }
  }
  const down = world(); down.env.AI_BROKER = {fetch: async () => Response.json({fallback: {}, chain: CHAIN})};
  assert.equal(byProbe(await runRound(down.env, {fetcher: down.fetcher})).broker.reason, 'no day meters');
  const none = world(); delete none.env.AI_BROKER;
  assert.ok(!(await runRound(none.env, {fetcher: none.fetcher})).some(row => row.probe === 'broker'), 'a broker that is not bound here is skipped, not red');
});

test('the probe is one fixed install: its token is computed, nothing is minted, and no request carries anything else', async () => {
  const w = world();
  await runRound(w.env, {fetcher: w.fetcher});
  const keys = new Set(w.seen.filter(call => call.key).map(call => call.key));
  assert.equal(keys.size, 1);
  assert.match([...keys][0], /^JPF1\.synthetic-probe\.[0-9a-f]{32}$/);
  assert.ok(!w.seen.some(call => /install-token|\/api\/ai\/v1\/messages/.test(call.url)), 'no mint, no AI call');
  assert.ok(w.seen.every(call => /^https:\/\/www\.(jobadabra\.top|jobpilotto\.workers\.dev)\//.test(call.url)));
});

test('one red is nothing; two reds tell once; a third tells nothing; the first green tells "back" once', async () => {
  const w = world({'https://www.jobpilotto.workers.dev/api/releases/latest': new Response('x', {status: 502})});
  const round = async (n, env = w) => { const rows = await runRound(env.env, {fetcher: env.fetcher}); await settle(env.env.STATS, rows, at(n)); return tell(env.env, env.env.STATS, env.fetcher); };
  assert.equal(await round(5), 0, 'one red: no message');
  assert.equal(await round(20), 1, 'two reds: one message');
  assert.equal(w.telegram.length, 1);
  assert.match(w.telegram[0].text, /Down<\/b> · Update feed[\s\S]*HTTP 502[\s\S]*2 reds in a row since 12:05 UTC/);
  assert.equal(await round(35), 0, 'a third red: nothing more');
  assert.equal(w.telegram.length, 1);
  w.answers['https://www.jobpilotto.workers.dev/api/releases/latest'] = good['https://www.jobpilotto.workers.dev/api/releases/latest'];   // the feed recovers
  assert.equal(await round(50), 1, 'first green: back');
  assert.match(w.telegram.at(-1).text, /Back<\/b> · Update feed[\s\S]*Down since 12:05 UTC/);
  assert.equal(await round(51), 0);
  assert.equal(w.telegram.length, 2);
});

test('a flicker (red, green, red, green) never tells', async () => {
  const w = world(), bad = world({'https://www.jobadabra.top/': '<title>Oops</title>'});
  for (const [n, who] of [[5, bad], [20, w], [35, bad], [50, w]]) { await settle(w.env.STATS, await runRound(who.env, {fetcher: who.fetcher}), at(n)); await tell(w.env, w.env.STATS, w.fetcher); }
  assert.equal(w.telegram.length, 0);
});

test('Telegram failing keeps the row and the change; the next round tells it', async () => {
  const w = world({'https://www.jobadabra.top/': '<title>Oops</title>', telegramDown: true});
  for (const n of [5, 20]) { await settle(w.env.STATS, await runRound(w.env, {fetcher: w.fetcher}), at(n)); await tell(w.env, w.env.STATS, w.fetcher); }
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM synthetic_probes').get().n, 12);
  assert.equal(w.db.prepare("SELECT told FROM synthetic_state WHERE probe = 'site'").get().told, 0, 'still to tell');
  const retry = world({'https://www.jobadabra.top/': '<title>Oops</title>'});
  assert.equal(await tell(w.env, w.env.STATS, retry.fetcher), 1);
  assert.equal(retry.telegram.length, 1);
});

test('a "back" after a down nobody was told about sends nothing', async () => {
  const w = world({'https://www.jobadabra.top/': '<title>Oops</title>', telegramDown: true});
  for (const n of [5, 20]) await settle(w.env.STATS, await runRound(w.env, {fetcher: w.fetcher}), at(n));
  const healed = world();
  await settle(w.env.STATS, await runRound(healed.env, {fetcher: healed.fetcher}), at(35));
  assert.equal(await tell(w.env, w.env.STATS, healed.fetcher), 0);
  assert.equal(healed.telegram.length, 0);
});

test('the tick runs a round only on its minutes, and never throws', async () => {
  assert.deepEqual(ROUND_MINUTES, [5, 20, 35, 50]);
  const w = world();
  for (let minute = 0; minute < 60; minute += 5) assert.equal(dueRound(new Date(Date.UTC(2026, 10, 1, 12, minute))), ROUND_MINUTES.includes(minute), `minute ${minute}`);
  assert.deepEqual(await tick(w.env, new Date('2026-11-01T12:10:00Z'), {fetcher: w.fetcher}), {ran: false, rows: 0, told: 0});
  const done = await tick(w.env, new Date('2026-11-01T12:20:00Z'), {fetcher: w.fetcher});
  assert.deepEqual([done.ran, done.rows], [true, 6]);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM synthetic_probes').get().n, 6);
  assert.equal((await tick({...w.env, SYNTHETIC: 'off'}, new Date('2026-11-01T12:35:00Z'), {fetcher: w.fetcher})).ran, false, 'kill switch');
  assert.equal((await tick({...w.env, STATS: undefined}, new Date('2026-11-01T12:35:00Z'), {fetcher: w.fetcher})).ran, false, 'no D1');
  const broken = {...w.env, STATS: {prepare: () => { throw new Error('d1 down'); }, batch: async () => { throw new Error('d1 down'); }}};
  assert.equal((await tick(broken, new Date('2026-11-01T12:35:00Z'), {fetcher: w.fetcher})).ran, false, 'a D1 error is caught, not thrown');
});

test('the card: newest row per probe, 24 h uptime, stale after 45 minutes, null when unreadable; the public route gives only a timestamp', async () => {
  const w = world({'https://www.jobadabra.top/': '<title>Oops</title>'});
  await settle(w.env.STATS, await runRound(w.env, {fetcher: w.fetcher}), at(5));
  const healed = world();
  await settle(w.env.STATS, await runRound(healed.env, {fetcher: healed.fetcher}), at(20));
  const card = await readCard(w.env, new Date('2026-11-01T12:25:00Z'));
  assert.equal(card.lastRoundAt, at(20));
  assert.equal(card.stale, false);
  assert.equal(card.probes.length, 6);
  const site = card.probes.find(item => item.probe === 'site');
  assert.deepEqual([site.ok, site.state, site.uptime24h, site.label], [true, 'up', 50, 'Website']);
  assert.equal((await readCard(w.env, new Date('2026-11-01T13:06:00Z'))).stale, true);
  assert.equal(await readCard({STATS: {prepare: () => { throw new Error('no table'); }}}), null);
  assert.deepEqual(await (await lastRoute(new Request('https://x/api/synthetic/last'), w.env)).json(), {at: at(20)});
  const viaWorker = await worker.fetch(new Request('https://www.jobadabra.top/api/synthetic/last'), w.env, {});
  assert.equal(viaWorker.status, 200);
  assert.deepEqual(Object.keys(await viaWorker.json()), ['at']);
});

test('rows older than 30 days are purged', async () => {
  const w = world();
  await settle(w.env.STATS, await runRound(w.env, {fetcher: w.fetcher}), '2026-09-01T12:05:00Z');
  await settle(w.env.STATS, await runRound(w.env, {fetcher: w.fetcher}), at(5));
  await purge(w.env, Date.parse('2026-11-01T13:00:00Z'));
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM synthetic_probes WHERE at < '2026-10-01'").get().n, 0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM synthetic_probes').get().n, 6);
});

test('the 14-day map: one state per UTC day, oldest first; two reds in a row make a day red, one blip does not, a day without rows is none', async () => {
  const w = world({'https://www.jobadabra.top/': '<title>Oops</title>'}), good = world();
  const round = async (who, iso) => settle(w.env.STATS, await runRound(who.env, {fetcher: who.fetcher}), iso);
  await round(good, '2026-10-30T12:05:00Z');                                                       // 30 Oct: green
  await round(w, '2026-10-31T12:05:00Z'); await round(good, '2026-10-31T12:20:00Z');               // 31 Oct: one blip -> green
  await round(w, '2026-11-01T11:05:00Z'); await round(w, '2026-11-01T11:50:00Z');                  // 1 Nov: site red in two stored rounds in a row, a tick skipped between them -> red, as the alert would tell
  const days = await readDays(w.env, 14, new Date('2026-11-01T13:00:00Z'));
  assert.equal(days.length, 14);
  assert.deepEqual([days[0], days.at(-1)], [{day: '2026-10-19', state: 'none'}, {day: '2026-11-01', state: 'red'}]);
  assert.deepEqual(days.filter(item => item.state !== 'none'), [{day: '2026-10-30', state: 'green'}, {day: '2026-10-31', state: 'green'}, {day: '2026-11-01', state: 'red'}]);
  await round(w, '2026-11-02T00:05:00Z'); const next = await readDays(w.env, 14, new Date('2026-11-02T13:00:00Z'));
  assert.deepEqual(next.slice(-2).map(item => item.state), ['red', 'red'], 'the red at 11:50 and the next red at 00:05 are two stored rounds in a row: the streak is told, so 2 Nov is red too')
  assert.equal(await readDays({STATS: {prepare: () => { throw new Error('no table'); }}}), null);
  assert.equal(await readDaysByProbe({STATS: {prepare: () => { throw new Error('no table'); }}}), null);
});

test('the per-probe map: only the probe that had 2 reds in a row has the red day; the others stay green (Gitar, #273)', async () => {
  const w = world({'https://www.jobadabra.top/': '<title>Oops</title>'});
  const round = async (who, iso) => settle(who.env.STATS, await runRound(who.env, {fetcher: who.fetcher}), iso);
  await round(w, '2026-11-01T11:05:00Z'); await round(w, '2026-11-01T11:50:00Z');
  const by = await readDaysByProbe(w.env, 14, new Date('2026-11-01T13:00:00Z'));
  assert.deepEqual(Object.keys(by).sort(), PROBES.map(probe => probe.id).sort());
  assert.deepEqual([by.site.at(-1).state, by.index.at(-1).state, by.broker.at(-1).state], ['red', 'green', 'green']);
  assert.deepEqual((await readDays(w.env, 14, new Date('2026-11-01T13:00:00Z'))).at(-1), {day: '2026-11-01', state: 'red'}, 'the Overview row is the union');
});

test('the AI broker probe names the engines (Why, owner 1 Nov 2026: Claude, Codex or Free AI by one flag): green while one can answer, red when Claude\'s token is rejected or none can', async () => {
  assert.equal(PROBES.find(probe => probe.id === 'broker').label, 'AI broker');
  const withChain = chain => { const w = world(); w.env.AI_BROKER = {fetch: async () => Response.json({...BROKER, chain})}; return w; };
  const reason = async chain => { const w = withChain(chain); return byProbe(await runRound(w.env, {fetcher: w.fetcher})).broker; };
  assert.deepEqual([(await reason(CHAIN)).ok, (await reason(CHAIN)).reason], [1, ''], 'Codex out, Claude ready: up');
  const rejected = await reason(CHAIN.map(item => item.name === 'claude' ? {...item, state: 'token-invalid'} : item));
  assert.deepEqual([rejected.ok, rejected.reason], [0, 'Claude token rejected']);
  const none = await reason(CHAIN.map(item => ({...item, configured: false})));
  assert.deepEqual([none.ok, none.reason], [0, 'no AI engine can answer']);
  const noChain = await reason(undefined);
  assert.deepEqual([noChain.ok, noChain.reason], [1, ''], 'an older broker build without a chain is not red');
});
