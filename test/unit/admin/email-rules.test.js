// The Mails card on /admin/growth/email → Settings (admin/email-rules.js): every e-mail grouped by owner, a real switch per mail that posts to /admin/growth/email/rule
// (owner only, same origin), locked mails with no switch. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {collect} from '../../../admin/email-data.js';
import {page} from '../../../admin/email.js';
import {rulePress} from '../../../admin/email-rules.js';
import {MAILS, resetRuleCache} from '../../../shared/mail-registry.js';
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
  assert.equal((html.match(/role="switch"/g) || []).length, MAILS.filter(mail => !mail.locked).length);
  assert.equal((html.match(/Locked: always sent/g) || []).length, MAILS.filter(mail => mail.locked).length);
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
