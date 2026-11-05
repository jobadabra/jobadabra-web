// The Switches card on /admin/growth/email (owner, 5 Nov 2026: "let's make these switches look better … and be actual switches that I can turn on or off"): real toggles that post to
// /admin/growth/email/switch, owner only, with one confirmation before a switch turns on. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {collect} from '../../../admin/email-data.js';
import {page} from '../../../admin/email.js';
import {switchPress} from '../../../admin/email-switches.js';
import {resetSwitchCache, withSwitches} from '../../../shared/mail-switches.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  resetSwitchCache();
  const db = new DatabaseSync(':memory:');
  for (const file of ['0078_test_mail.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0093_changelog.sql', '0105_changelog_plain.sql', '0117_release_mail.sql', '0135_mail_on.sql', '0137_mail_switch.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const ORIGIN = 'https://www.jobadabra.top';
const setup = () => ({STATS: d1(), STATS_SALT: 'salt', STATS_KEY: 'stats-key', STATS_API_KEY: 'owner-key', MAIL: 'on', MARKETING_MAIL: 'off'});
const press = (env, fields, headers = {Authorization: 'Bearer owner-key', Origin: ORIGIN}) => switchPress(new Request(`${ORIGIN}/admin/growth/email/switch`, {method: 'POST', headers, body: new URLSearchParams(fields)}), env);
const stored = env => env.STATS.db.prepare('SELECT name, state FROM mail_switch ORDER BY name').all().map(row => [row.name, row.state]);

test('the card shows four real switches (role=switch, aria-checked) with their state and where it came from', async () => {
  const env = setup();
  const html = page({...await collect(env, {days: 7}), confirm: ''}, null, null, null, [], null, 'settings');
  const switches = html.slice(html.indexOf('id="switches"'), html.indexOf('</section>', html.indexOf('id="switches"')));   // the Mails card below has switches of its own
  assert.equal((switches.match(/role="switch"/g) || []).length, 4);
  assert.ok(html.includes('role="switch" aria-checked="true" aria-label="MAIL"'));
  assert.ok(html.includes('role="switch" aria-checked="false" aria-label="MARKETING_MAIL"'));
  assert.ok(html.includes('action="/admin/growth/email/switch"') && html.includes('as deployed'));
  assert.ok(!html.includes('change them in Cloudflare'));
});

test('turning a switch off is one press and is stored', async () => {
  const env = setup();
  const response = await press(env, {name: 'MAIL', state: 'off'});
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/admin/growth/email?tab=settings#switches');
  assert.deepEqual(stored(env), [['MAIL', 'off']]);
  assert.equal((await withSwitches(env)).MAIL, 'off');
});

test('turning a switch on asks first: the first press stores nothing and comes back with the question, the second stores it', async () => {
  const env = setup();
  const first = await press(env, {name: 'MARKETING_MAIL', state: 'on'});
  assert.equal(first.headers.get('Location'), '/admin/growth/email?tab=settings&confirm=MARKETING_MAIL#switches');
  assert.deepEqual(stored(env), []);
  const html = page({...await collect(env, {days: 7}), confirm: 'MARKETING_MAIL'}, null, null, null, [], null, 'settings');
  assert.ok(html.includes('Yes, turn it on') && html.includes('name="confirmed" value="1"'));
  const second = await press(env, {name: 'MARKETING_MAIL', state: 'on', confirmed: '1'});
  assert.equal(second.headers.get('Location'), '/admin/growth/email?tab=settings#switches');
  assert.deepEqual(stored(env), [['MARKETING_MAIL', 'on']]);
  assert.equal((await withSwitches(env)).MARKETING_MAIL, 'on');
});

test('only the owner, from the page itself, can press; an unknown name or state is refused', async () => {
  const env = setup();
  assert.equal((await press(env, {name: 'MAIL', state: 'off'}, {Origin: ORIGIN})).status, 404);
  assert.equal((await press(env, {name: 'MAIL', state: 'off'}, {Authorization: 'Bearer wrong', Origin: ORIGIN})).status, 404);
  assert.equal((await press(env, {name: 'MAIL', state: 'off'}, {Authorization: 'Bearer owner-key', Origin: 'https://evil.example'})).status, 404);
  assert.equal((await switchPress(new Request(`${ORIGIN}/admin/growth/email/switch`, {headers: {Authorization: 'Bearer owner-key'}}), env)).status, 404);   // GET
  assert.equal((await press(env, {name: 'STATS_KEY', state: 'on', confirmed: '1'})).status, 400);
  assert.equal((await press(env, {name: 'MAIL', state: 'toggle'})).status, 400);
  assert.deepEqual(stored(env), []);
});

// Through the real Worker (workers/www/index.js): the press route is wired, and a pressed state reaches the next request and the next scheduled run's env.
import worker from '../../../workers/www/index.js';
test('the Worker applies a press to the next request: pressing MAIL off shows it off on the page; the deployed value is untouched', async () => {
  const env = {...setup(), WAITLIST: {list: async () => ({keys: [], list_complete: true})}}, headers = {Authorization: 'Bearer owner-key', Origin: 'https://www.jobpilotto.top'};
  const call = (path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, ...init}), env, {waitUntil() {}});
  const before = await (await call('/admin/growth/email?tab=settings')).text();
  assert.ok(before.includes('role="switch" aria-checked="true" aria-label="MAIL"'));
  const pressed = await call('/admin/growth/email/switch', {method: 'POST', body: new URLSearchParams({name: 'MAIL', state: 'off'})});
  assert.equal(pressed.status, 303);
  const after = await (await call('/admin/growth/email?tab=settings')).text();
  assert.ok(after.includes('role="switch" aria-checked="false" aria-label="MAIL"'), 'the page shows the pressed state');
  assert.equal(env.MAIL, 'on');
});

// Why (5 Nov 2026): the overlay is applied where env enters the Worker; a new entry point that forgets it would send by the deployed value while Admin shows the pressed one. The entry points that can send mail are
// requests (fetch) and cron (scheduled); the queue and email handlers only record bounces and receive test mail.
test('both entry points that can send mail lay the pressed switches over env', () => {
  const source = readFileSync(new URL('../../../workers/www/index.js', import.meta.url), 'utf8');
  assert.match(source, /async function metered\([^)]*\) \{[^]*?await withSwitches\(env\.STATS \? \{\.\.\.env, STATS: meter\(env\.STATS, tally\)\}/);   // a request: the switch read is metered too
  assert.match(source, /TIMERS_OWN_CRON\) return runTimers\(event, rawEnv[^\n]*\n\s*const env = await withSwitches\(rawEnv\)/);   // cron: after the 47 trigger, which sends no mail and must touch nothing else
});

test('a press that cannot be saved says so (503) instead of an unexplained error', async () => {
  const env = {...setup(), STATS: {prepare: () => ({bind: () => ({run: async () => { throw new Error('D1_ERROR: no such table: mail_switch'); }})})}};
  const response = await press(env, {name: 'MAIL', state: 'off'});
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Not saved.*migration 0137/);
});

test('the card says when the deploy disagrees with a press, and when the stored state could not be read', async () => {
  const env = setup();
  await press(env, {name: 'MARKETING_MAIL', state: 'on', confirmed: '1'});
  const html = page({...await collect(await withSwitches(env), {days: 7}), confirm: ''}, null, null, null, [], null, 'settings');
  assert.ok(html.includes('(the deploy says off)'));
  const held = page({...await collect(env, {days: 7}), switches: (await collect(env, {days: 7})).switches.map(row => ({...row, held: true, on: false, pressed: false})), confirm: ''}, null, null, null, [], null, 'settings');
  assert.ok(held.includes('the stored state could not be read, so it is held off'));
});
