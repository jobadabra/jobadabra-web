// /admin/operations/notifications and the Operations menu: who sees and changes what, every control's POST, Change bot and Send test against a fake Telegram, the token never drawn,
// the same setting on Scheduled, and /ops/notify's door (Bearer key, unknown event, fail-open answer).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {GROUPS, PAGES, groupSlug, nav} from '../../../admin/admin.js';
import {load, page, view} from '../../../admin/notifications.js';
import {ALERTS, CHANNELS} from '../../../shared/notify-registry.js';
import {readSettings, saveSetting} from '../../../shared/notify.js';

const ORIGIN = 'https://www.jobpilotto.top', NOW = new Date('2026-11-05T10:00:00Z'), TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', NOTIFY_SECRET: 'vault', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('x')}});
const owner = {Cookie: 'jp_stats=k3y'};
const get = (e, path, headers = owner) => worker.fetch(new Request(`${ORIGIN}${path}`, {headers}), e, {});
const post = (e, fields, {headers = {...owner, Origin: ORIGIN}, path = '/admin/operations/notifications', fetcher} = {}) =>
  (fetcher ? view(new Request(`${ORIGIN}${path}`, {method: 'POST', headers, body: new URLSearchParams(fields)}), e, {fetcher, now: NOW}) : worker.fetch(new Request(`${ORIGIN}${path}`, {method: 'POST', headers, body: new URLSearchParams(fields)}), e, {}));
const telegram = () => {
  const calls = [];
  return {calls, fetcher: async (url, init) => {
    const [, token, method] = /bot([^/]+)\/(\w+)$/.exec(url); calls.push({token, method, body: JSON.parse(init.body || '{}')});
    const ok = result => new Response(JSON.stringify({ok: true, result}));
    if (method === 'getMe') return token === TOKEN ? ok({username: 'jobadabra_ci_bot'}) : new Response(JSON.stringify({ok: false, description: 'Unauthorized'}), {status: 401});
    if (method === 'getChat') return ok({title: 'Jobadabra CI'});
    if (method === 'getUpdates') return ok([{message: {chat: {id: 777}}}]);
    return ok({message_id: 1});
  }};
};

test('Operations is one menu group with Scheduled and Notifications; the Schedules group and the Testing → Scheduled tab are gone', () => {
  assert.ok(GROUPS.some(([name, icon]) => name === 'Operations' && icon === '⚙️') && !GROUPS.some(([name]) => name === 'Schedules'));
  assert.deepEqual(PAGES.filter(item => item.group === 'Operations').map(item => item.path), ['/admin/operations/scheduled', '/admin/operations/notifications']);
  const html = nav('/admin/operations/notifications');
  assert.match(html, /⚙️ Operations/);
  assert.match(html, /href="\/admin\/operations\/scheduled">⏰ Scheduled/);
  assert.match(html, /aria-current="page">🔔 Notifications/);
});

test('the page needs the login; the owner sees every alert grouped, three channels, and what is not connected yet', async () => {
  const e = env();
  assert.equal((await get(e, '/admin/operations/notifications', {})).status, 404);
  const res = await get(e, '/admin/operations/notifications'), html = await res.text();
  assert.equal(res.status, 200);
  for (const alert of ALERTS) assert.ok(html.includes(alert.label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')), alert.id);
  for (const channel of CHANNELS) assert.ok(html.includes(channel.name.replace('&', '&amp;')), channel.name);
  assert.match(html, /Connect bot/);
  assert.match(html, new RegExp(`${ALERTS.filter(alert => alert.on).length} alerts on`), 'the count follows the registry (it is not a literal that breaks with each new alert)');
  assert.match(html, new RegExp(`${ALERTS.filter(alert => alert.wired).length} of ${ALERTS.length} senders moved over`), 'the page counts the senders that already use the switchboard (2/4: nine Worker-side ones; 3/4: the failed-release alert)');
  assert.match(html, /sender not moved yet/);
  const group = await get(e, `/admin/${groupSlug(GROUPS.find(([name]) => name === 'Operations'))}`);
  assert.deepEqual([group.status, group.headers.get('Location')], [301, '/admin/operations/scheduled'], 'the group address leads to its first page');
});

test('an invited admin reads the page without a single form or button; only the super admin has them', async () => {
  const data = await load(env(), fetch, NOW);
  const read = page(data, {canEdit: false, now: NOW}), write = page(data, {canEdit: true, now: NOW});
  assert.ok(!/<form|<select(?![^>]*disabled)/.test(read) && /Only the super admin changes these/.test(read), 'a viewer gets disabled boxes, no form');
  assert.ok(/<form/.test(write) && /<select(?![^>]*disabled)/.test(write) && !/Only the super admin/.test(write));
  const connectedData = {...data, channels: {...data.channels, engineering: {connected: true, live: true, name: '@ci_bot', title: 'Alice\'s chat'}}};
  assert.ok(page(connectedData, {canEdit: true, now: NOW}).includes('@ci_bot') && !page(connectedData, {canEdit: false, now: NOW}).includes('@ci_bot'), 'an invited admin does not read the bot name or the chat title');
  assert.equal((write.match(/name="action" value="toggle"/g) || []).length, ALERTS.length, 'one switch per alert');
});

test('every control saves its setting and returns to the page it came from; both pages show the same state', async () => {
  const e = env();
  let res = await post(e, {action: 'toggle', event: 'beta-published', on: '0', back: '/admin/operations/scheduled?area=testing'});
  assert.deepEqual([res.status, res.headers.get('Location')], [303, '/admin/operations/scheduled?area=testing']);
  res = await post(e, {action: 'mode', event: 'main-red', mode: 'every', back: '/admin/operations/notifications'});
  assert.equal(res.headers.get('Location'), '/admin/operations/notifications');
  res = await post(e, {action: 'channel', event: 'release-mail-draft', channel: 'engineering', back: 'https://evil.example/'});
  assert.equal(res.headers.get('Location'), '/admin/operations/notifications', 'a back address that is not one of ours is ignored');
  const saved = await readSettings(e);
  assert.deepEqual([saved.get('beta-published').enabled, saved.get('main-red').mode, saved.get('release-mail-draft').channel], [0, 'every', 'engineering']);
  const notifications = await (await get(e, '/admin/operations/notifications')).text();
  assert.match(notifications, /aria-label="Beta published: off"/);
  assert.match(notifications, /<option value="every" selected>Every time/);
  assert.match(notifications, new RegExp(`${ALERTS.filter(alert => alert.on).length - 1} alerts on`), 'one switched off');
  e.STATS.db.prepare('INSERT INTO schedules_snapshot (id, at, body) VALUES (1, ?, ?)').run(NOW.toISOString(), JSON.stringify({at: NOW.toISOString(), repos: [], jobs: [{repo: 'jobadabra/jobadabra', file: 'beta-approve.yml', name: 'Beta approve', about: '', crons: ['0 2 * * *'], recent: []}]}));
  assert.match(await (await get(e, '/admin/operations/scheduled')).text(), /aria-label="Beta published: off"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Beta published: off"/, 'Scheduled\'s Notify column shows the same switch');
});

test('a change needs the super admin, from this site, for a known alert and an allowed value', async () => {
  const e = env();
  assert.equal((await post(e, {action: 'toggle', event: 'beta-published', on: '0'}, {headers: {Origin: ORIGIN}})).status, 404, 'no login');
  assert.equal((await post(e, {action: 'toggle', event: 'beta-published', on: '0'}, {headers: {...owner, Origin: 'https://evil.example'}})).status, 404, 'a form on another site');
  assert.equal((await post(e, {action: 'mode', event: 'beta-published', mode: 'daily'})).status, 400, 'beta-published has one mode');
  assert.equal((await post(e, {action: 'toggle', event: 'made-up', on: '0'})).status, 400);
  assert.equal((await post(e, {action: 'wipe'})).status, 400);
  assert.equal((await readSettings(e)).size, 0, 'nothing was saved');
});

test('Change bot: the token is checked, kept sealed, never drawn back; a refusal says why and does not echo the token', async () => {
  const e = env(), tg = telegram();
  let res = await post(e, {action: 'connect', channel: 'engineering', token: 'nope'}, {fetcher: tg.fetcher});
  assert.equal(res.status, 400);
  assert.match(await res.text(), /not a bot token/);
  res = await post(e, {action: 'connect', channel: 'engineering', token: `${TOKEN.slice(0, -3)}xyz`}, {fetcher: tg.fetcher});
  const refused = await res.text();
  assert.ok(res.status === 400 && /did not accept this token/.test(refused) && !refused.includes(TOKEN.slice(0, -3)), 'the refusal never repeats the token');
  res = await post(e, {action: 'connect', channel: 'engineering', token: TOKEN, chat: ''}, {fetcher: tg.fetcher});
  assert.deepEqual([res.status, res.headers.get('Location')], [303, '/admin/operations/notifications?said=connected']);
  const html = await (await view(new Request(`${ORIGIN}/admin/operations/notifications?said=connected`, {headers: owner}), e, {fetcher: tg.fetcher, now: NOW})).text();
  assert.ok(html.includes('@jobadabra_ci_bot') && html.includes('Jobadabra CI') && html.includes('Bot connected') && html.includes('Change bot') && html.includes('Send test'));
  assert.ok(!html.includes(TOKEN) && !html.includes('AAHdq'), 'a token is never shown back');
  assert.ok(!JSON.stringify(e.STATS.db.prepare('SELECT * FROM notify_channels').all()).includes('AAHdq'), 'and not stored in the clear');
  res = await post(e, {action: 'test', channel: 'engineering'}, {fetcher: tg.fetcher});
  assert.deepEqual([res.status, res.headers.get('Location')], [303, '/admin/operations/notifications?said=tested']);
  assert.match(tg.calls.at(-1).body.text, /Test from Admin/);
  res = await post(e, {action: 'test', channel: 'marketing'}, {fetcher: tg.fetcher});
  assert.ok(res.status === 400 && /No bot connected/.test(await res.text()));
});

test('POST /ops/notify: the CI key only, an unknown event is refused, a held alert is told, a channel without a bot answers 503 so the sender falls back', async () => {
  const e = env(), ask = (body, key = 'pub', method = 'POST') => worker.fetch(new Request(`${ORIGIN}/ops/notify`, {method, headers: {Authorization: `Bearer ${key}`}, body: method === 'GET' ? undefined : JSON.stringify(body)}), e, {});
  assert.equal((await ask({event: 'beta-published'}, 'wrong')).status, 404);
  assert.equal((await ask({}, 'pub', 'GET')).status, 404);
  assert.deepEqual([(await ask({event: 'made-up', text: 'x'})).status, (await (await ask({event: 'made-up', text: 'x'})).json()).why], [400, 'unknown-event']);
  await saveSetting(e, 'beta-published', {enabled: false}, NOW);
  assert.deepEqual(await (await ask({event: 'beta-published', text: 'x'})).json(), {ok: true, sent: false, why: 'off'});
  const down = await ask({event: 'signup-new', text: 'x'});
  assert.deepEqual([down.status, (await down.json()).why], [503, 'channel-not-connected']);
  assert.deepEqual(await (await ask({event: 'main-red', text: 'x', fallback: true})).json(), {ok: true, sent: false, logged: true});
  assert.match(await (await get(e, '/admin/operations/notifications')).text(), /1 sent without switchboard \(7 d\)/);
});
