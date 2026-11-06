// The Mails card on /admin/growth/email → Settings (admin/email-rules.js): every e-mail grouped by owner, a real switch per mail that posts to /admin/growth/email/rule
// (owner only, same origin), locked mails with no switch. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {collect} from '../../../admin/email-data.js';
import {page} from '../../../admin/email.js';
import {rulePress} from '../../../admin/email-rules.js';
import {MAILS, resetRuleCache, stoppable} from '../../../shared/mail-registry.js';
import {resetSwitchCache} from '../../../shared/mail-switches.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  resetRuleCache(); resetSwitchCache();
  const db = new DatabaseSync(':memory:');
  for (const file of ['0078_test_mail.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0093_changelog.sql', '0105_changelog_plain.sql', '0117_release_mail.sql', '0135_mail_on.sql', '0137_mail_switch.sql', '0138_mail_rule.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const ORIGIN = 'https://www.jobadabra.top';
const setup = () => ({STATS: d1(), STATS_SALT: 'salt', STATS_KEY: 'stats-key', STATS_API_KEY: 'owner-key', MAIL: 'on', MARKETING_MAIL: 'off'});
const press = (env, fields, headers = {Authorization: 'Bearer owner-key', Origin: ORIGIN}) => rulePress(new Request(`${ORIGIN}/admin/growth/email/rule`, {method: 'POST', headers, body: new URLSearchParams(fields)}), env);
const settings = async env => page({...await collect(env, {days: 7}), confirm: ''}, null, null, null, [], null, 'settings');
const card = html => html.slice(html.indexOf('id="mails"'), html.indexOf('</section>', html.indexOf('id="mails"')));

test('the card lists every mail under its owner, a switch for each unlocked one and a lock for the rest', async () => {
  const html = card(await settings(setup()));
  for (const name of ['Account', 'Yours', "Jobadabra&#39;s"]) assert.ok(html.includes(`<b>${name}</b>`), name);
  assert.equal((html.match(/role="switch"/g) || []).length, MAILS.filter(stoppable).length);
  assert.equal((html.match(/Locked: always sent/g) || []).length, MAILS.filter(mail => mail.locked).length);
  assert.equal((html.match(/aria-label="The person decides"/g) || []).length, MAILS.filter(mail => mail.owner === 'yours').length, 'owner, 6 Nov 2026: "Only the person" decides a Yours mail');
  assert.ok(html.includes('action="/admin/growth/email/rule"'));
});

test('a stop is one press, stored, and the card then shows it stopped with its time', async () => {
  const env = setup();
  const response = await press(env, {id: 'release', state: 'off'});
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/admin/growth/email?tab=settings#mails');
  assert.equal(env.STATS.db.prepare("SELECT enabled FROM mail_rule WHERE id = 'release'").get().enabled, 0);
  const html = card(await settings(env));
  assert.ok(html.includes('role="switch" aria-checked="false" aria-label="What&#39;s new"'));
  assert.match(html, /stopped \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
});

test('only the owner, from this site, can press; a locked or unknown mail is refused', async () => {
  const env = setup();
  assert.equal((await press(env, {id: 'release', state: 'off'}, {Origin: ORIGIN})).status, 404);
  assert.equal((await press(env, {id: 'release', state: 'off'}, {Authorization: 'Bearer owner-key', Origin: 'https://evil.example'})).status, 404);
  assert.equal((await press(env, {id: 'account-code', state: 'off'})).status, 400);
  assert.equal((await press(env, {id: 'nope', state: 'off'})).status, 400);
  assert.equal(env.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_rule').get().n, 0);
});

test('turning one of Jobadabra\'s mails back on asks once; an account mail goes back on in one press; a Yours mail cannot be pressed', async () => {
  const env = setup();
  await press(env, {id: 'release', state: 'off'});
  const asked = await press(env, {id: 'release', state: 'on'});
  assert.equal(asked.headers.get('Location'), '/admin/growth/email?tab=settings&confirm=release#mails');
  assert.equal(env.STATS.db.prepare("SELECT enabled FROM mail_rule WHERE id = 'release'").get().enabled, 0, 'nothing stored before the second press');
  const html = card(page({...await collect(env, {days: 7}), confirm: 'release'}, null, null, null, [], null, 'settings'));
  assert.ok(html.includes('Turn <b>What&#39;s new</b> back on?') && html.includes('name="confirmed" value="1"'));
  await press(env, {id: 'release', state: 'on', confirmed: '1'});
  assert.equal(env.STATS.db.prepare("SELECT enabled FROM mail_rule WHERE id = 'release'").get().enabled, 1);
  await press(env, {id: 'feedback-update', state: 'off'});
  assert.equal((await press(env, {id: 'feedback-update', state: 'on'})).headers.get('Location'), '/admin/growth/email?tab=settings#mails');
  assert.equal(env.STATS.db.prepare("SELECT enabled FROM mail_rule WHERE id = 'feedback-update'").get().enabled, 1);
  for (const id of ['digest', 'message', 'app-matches']) assert.equal((await press(env, {id, state: 'off'})).status, 400, id);
  assert.equal(env.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_rule WHERE id IN ('digest', 'message', 'app-matches')").get().n, 0);
});

test('an app mail shows the spec\'s suggested defaults and how many people turned it off, never a sent count it cannot have', async () => {
  const env = setup();
  env.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ('a1', 'app-matches', 'app', 'x'), ('a2', 'app-matches', 'mail-settings', 'x'), ('a3', 'service', 'settings', 'x')").run();
  const data = await collect(env, {days: 7});
  assert.deepEqual(data.offReasons.map(row => row.list), ['service'], 'a person\'s choice per app mail is not a stopped address (review of hr-31)');
  const html = card(await settings(env));
  assert.match(html, /New matches<span class="sw-says">a search finds new jobs · suggested: Mac: no e-mail; Always on: in the digest · 2 turned it off<\/span>/);
  assert.match(html, /An application needs you<span class="sw-says">[^<]*suggested: Mac: e-mail; Always on: e-mail · nobody turned it off<\/span>/);
});
