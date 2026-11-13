// Guard: money — a per-install line (Free AI trial, day, month, minute; Pro credit; cloud checks; a night's cost; the ~500 ceilings; the web search) stops a person in silence.
// Every line of the registry (shared/install-caps.js): an install approaching or reaching it is counted once a day per level, and the 6-hour card time sends at most one 🟠 and one 🔴 card
// for the past hour, only when not zero. Fake Telegram, D1 from the real migrations (node:sqlite), fake KV.
// Why (13 Nov 2026, owner, asked via AskUserQuestion: "why not doing for all of them, both approaching and reached ?", then "Grouped hourly (Recommended)").
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {EVERY_HOURS, INSTALL_CAPS, installHit, isCardTime, sendCards} from '../../../shared/install-caps.js';
import {alertOf} from '../../../shared/notify-registry.js';
import {checkCard} from '../../../shared/tg-card.js';

const ROOT = new URL('../../../', import.meta.url);
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('db/migrations/', ROOT)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`db/migrations/${file}`, ROOT), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const r = db.prepare(sql).run(...args); return {meta: {changes: Number(r.changes)}}; }, all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };
const env = () => ({WAITLIST: kv(), STATS: d1(), BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c'});
const posting = (sent, ok = true) => async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response(JSON.stringify({ok, result: {message_id: 1}}), {status: ok ? 200 : 500}); };
// Why (13 Nov 2026, owner via sa: "every 6 hours, at most"): H11 is an hour tick that is no card time; H12 and H18 are card times.
const H10 = new Date('2026-11-13T10:20:00Z'), H11 = new Date('2026-11-13T11:00:00Z'), H12 = new Date('2026-11-13T12:00:00Z'), H18 = new Date('2026-11-13T18:00:00Z'), NEXT_DAY = new Date('2026-11-14T10:20:00Z');

test('every per-install line: 79% nothing, 80% counted 🟠 once per install a day, a refusal counted 🔴, and the next 6-hour card time sends one card per level', async () => {
  assert.ok(Object.keys(INSTALL_CAPS).length >= 9, 'positive control: the per-install lines are registered');
  assert.equal(alertOf('install-caps')?.wired, true, 'install-caps is a wired switchboard event');
  for (const [name, cap] of Object.entries(INSTALL_CAPS)) {
    assert.ok(cap.title && cap.sees && cap.fix, `${name}: title, what people see, what to raise`);
    const e = env(), sent = [];
    await installHit(e, name, 'i1', 79, 100, {now: H10});
    await installHit(e, name, 'i1', 80, 100, {now: H10}); await installHit(e, name, 'i1', 90, 100, {now: H10});
    await installHit(e, name, 'i2', 85, 100, {now: H10});
    await installHit(e, name, 'i1', 100, 100, {now: H10}); await installHit(e, name, 'i1', null, null, {now: H10, reached: true});
    assert.deepEqual(await sendCards(e, H10, {fetcher: posting(sent)}), [], `${name}: the hour still running waits`);
    assert.deepEqual(await sendCards(e, H11, {fetcher: posting(sent)}), [], `${name}: 11:00 is no card time`);
    assert.deepEqual(await sendCards(e, H12, {fetcher: posting(sent)}), ['reached', 'approaching'], name);
    assert.equal(sent.length, 2); assert.match(sent[0], /^🔴/); assert.match(sent[1], /^🟠/);
    assert.match(sent[0], new RegExp(`1\\s+${cap.title.replace(/[()$.*+?]/g, '\\$&')}`), `${name}: one install reached\n${sent[0]}`);
    assert.match(sent[1], new RegExp(`2\\s+${cap.title.replace(/[()$.*+?]/g, '\\$&')}`), `${name}: two installs approaching\n${sent[1]}`);
    assert.deepEqual(await sendCards(e, H18, {fetcher: posting(sent)}), [], `${name}: told once`);
    await installHit(e, name, 'i1', 100, 100, {now: NEXT_DAY});
    assert.equal(e.STATS.db.prepare('SELECT SUM(n) AS n FROM cap_hits').get().n, 1, `${name}: a new day counts again`);
  }
});

test('the class (13 Nov 2026, the drift card): a count at or past an install\'s line refused nothing, so it is counted 🟠, never 🔴; only a refusal is 🔴', async () => {
  for (const name of Object.keys(INSTALL_CAPS)) {
    const e = env();
    assert.equal(await installHit(e, name, 'i1', 100, 100, {now: H10}), 'approaching', name);
    assert.equal(await installHit(e, name, 'i2', 250, 100, {now: H10}), 'approaching', name);
    assert.equal(await installHit(e, name, 'i1', 100, 100, {now: H10, reached: true}), 'reached', name);
  }
});

test('the 6-hour cards pass the card shape check, with many lines at once', async () => {
  const e = env(), sent = [];
  for (const name of Object.keys(INSTALL_CAPS)) { await installHit(e, name, 'i1', 100, 100, {now: H10}); await installHit(e, name, 'i2', 90, 100, {now: H10}); }
  await sendCards(e, H12, {fetcher: posting(sent)});
  for (const text of sent) assert.deepEqual(checkCard({text, html: true}), [], text);
});

test('a failed send keeps its counts for the next card time; an alert never throws', async () => {
  const e = env(), sent = [];
  await installHit(e, 'free-ai-install-day', 'i1', 100, 100, {now: H10, reached: true});
  assert.deepEqual(await sendCards(e, H12, {fetcher: posting(sent, false)}), []);
  assert.deepEqual(await sendCards(e, H18, {fetcher: posting(sent)}), ['reached']);
  assert.equal(await installHit({}, 'free-ai-install-day', 'i1', 100, 100, {now: H10, reached: true}), null, 'no KV, no D1: nothing, no throw');
  assert.equal(await installHit({...e, STATS: {prepare: () => { throw new Error('d1 down'); }}}, 'free-ai-install-day', 'i9', 100, 100, {now: H10, reached: true}), null);
});

test('every registered line is wired in the file where its line refuses, by name', () => {
  const read = path => readFileSync(new URL(path, ROOT), 'utf8');
  const WHERE = {'free-ai-minute': 'shared/free-ai.js', 'pro-credit': 'shared/free-ai.js', 'web-search-day': 'shared/free-ai-web.js', 'cloud-checks-day': 'api/ready-read-access.js',
    'cloud-read-ceiling': 'api/ready-read-access.js', 'cloud-submit-ceiling': 'api/ready-auto.js', 'night-cost': 'api/ready.js',
    'aliases-day': 'api/aliases.js', 'playbook-day': 'api/playbook.js', 'index-day': 'api/employers.js', 'national-day': 'api/national.js', 'recipe-lookups-day': 'api/recipes.js',
    'recipe-samples-day': 'api/recipes.js', 'token-mints-day': 'api/recipes.js', 'reports-install-day': 'shared/report-form.js', 'feedback-day': 'api/feedback.js', 'telemetry-day': 'api/telemetry.js',
    'pool-minute': 'api/pool.js', 'pay-attempts-hour': 'api/pro-pay.js', 'signin-tries': 'api/pro-signin.js', 'hosted-tests-day': 'api/hosted-test.js'};
  const VIA_INSTALL_CAP = ['free-ai-trial', 'free-ai-install-day', 'free-ai-install-month'];   // installCap names the line; the refusal counts mine.line
  assert.deepEqual([...Object.keys(WHERE), ...VIA_INSTALL_CAP].sort(), Object.keys(INSTALL_CAPS).sort(), 'every line has its place here');
  for (const [name, path] of Object.entries(WHERE)) assert.match(read(path), new RegExp(`installHit\\(env, '${name}'`), `${name} is counted in ${path}`);
  // Why (13 Nov 2026, the drift card, #630): a request quota is 🔴 only when it refuses, so its installHit and its refusal read one `full`, never a count at the line.
  const QUOTAS = ['aliases-day', 'playbook-day', 'index-day', 'national-day', 'recipe-lookups-day', 'recipe-samples-day', 'token-mints-day', 'reports-install-day', 'feedback-day', 'telemetry-day',
    'pool-minute', 'pay-attempts-hour', 'signin-tries', 'hosted-tests-day'];
  for (const name of QUOTAS) assert.match(read(WHERE[name]), new RegExp(`installHit\\(env, '${name}',[^\\n]*reached: full\\}\\);[^\\n]*\\n\\s*if \\(full\\)`), `${name}: reached is its own refusal`);
  const free = read('shared/free-ai.js');
  assert.match(free, /if \(mine\) \{ await later\(ctx, installHit\(env, mine\.line,/, 'the per-install refusal counts the line installCap named');
  for (const name of VIA_INSTALL_CAP) assert.match(free, new RegExp(`return \\{capped: '\\w+', status: 429, message: \\w+, line: '${name}'\\}`), `installCap names ${name}`);
});

test('a count that arrives while the card is sending is kept for the next :00, not deleted unseen', async () => {
  const e = env(), sent = [];
  await installHit(e, 'free-ai-install-day', 'i1', 100, 100, {now: H10, reached: true});
  const late = async (url, init) => { await installHit(e, 'free-ai-install-day', 'i2', 100, 100, {now: H10, reached: true}); return posting(sent)(url, init); };
  assert.deepEqual(await sendCards(e, H12, {fetcher: late}), ['reached']);
  assert.match(sent[0], /1\s+Free AI per install today/);
  assert.deepEqual(await sendCards(e, H18, {fetcher: posting(sent)}), ['reached'], 'the late install is told at the next card time');
  assert.match(sent[1], /1\s+Free AI per install today/);
});

test('a D1 write that fails leaves the install uncounted for the day, so its next call counts it', async () => {
  const e = env(), real = e.STATS;
  e.STATS = {prepare: () => { throw new Error('d1 down'); }};
  assert.equal(await installHit(e, 'free-ai-install-day', 'i1', 100, 100, {now: H10, reached: true}), null);
  e.STATS = real;
  assert.equal(await installHit(e, 'free-ai-install-day', 'i1', 100, 100, {now: H10, reached: true}), 'reached');
});

test('the owner\'s "every 6 hours, at most": counts from 06:05 to 11:55 are held through every hourly tick and told on one card at 12:00', async () => {
  assert.equal(EVERY_HOURS, 6);
  assert.deepEqual(['00', '06', '12', '18'].map(h => isCardTime(new Date(`2026-11-13T${h}:00:00Z`))), [true, true, true, true]);
  assert.deepEqual(['01', '05', '07', '11', '13', '23'].map(h => isCardTime(new Date(`2026-11-13T${h}:00:00Z`))), [false, false, false, false, false, false]);
  assert.equal(isCardTime(new Date('2026-11-13T12:05:00Z')), false, 'one tick a card time, not every five minutes of that hour');
  const e = env(), sent = [];
  await installHit(e, 'aliases-day', 'i1', null, null, {now: new Date('2026-11-13T06:05:00Z'), reached: true});
  await installHit(e, 'aliases-day', 'i2', null, null, {now: new Date('2026-11-13T09:30:00Z'), reached: true});
  await installHit(e, 'feedback-day', 'i3', null, null, {now: new Date('2026-11-13T11:55:00Z'), reached: true});
  for (const h of ['07', '08', '09', '10', '11']) assert.deepEqual(await sendCards(e, new Date(`2026-11-13T${h}:00:00Z`), {fetcher: posting(sent)}), [], `${h}:00`);
  assert.equal(sent.length, 0, 'no card between card times');
  assert.deepEqual(await sendCards(e, H12, {fetcher: posting(sent)}), ['reached']);
  assert.equal(sent.length, 1); assert.match(sent[0], /^🔴.*since the last card \(6 h\): 3 installs/);
  assert.match(sent[0], /2\s+Alias lookups per install today/); assert.match(sent[0], /1\s+Feedback per install today/);
});
