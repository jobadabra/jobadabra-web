// Why each mail came, in its footer (shared/mail-footer.js; spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md, "Every mail says why it came", PR 5):
// the sentence for each owner. Owner, 6 Nov 2026 ("Keep promise, cut extras"): an app mail says only that the person chose it, wherever it was written.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address, notify} from '../../../../api/account-email.js';
import {sendDigests} from '../../../../api/mail-held.js';
import {footerOf} from '../../../../shared/mail-footer.js';
import {MAILS, resetRuleCache} from '../../../../shared/mail-registry.js';
import {tokenFor} from '../../../../shared/guard.js';
import {mintTrialKey} from '../../../../shared/trial-key.js';

const YOURS = 'You chose this in the Jobadabra app.';

test('each owner gets its footer: Account has nothing to stop, Yours says where to change it, our news is the same for everyone and one click stops it', () => {
  for (const mail of MAILS.filter(each => !each.template)) {
    const foot = footerOf(mail.id, 'old line');
    if (mail.owner === 'account') assert.deepEqual([foot.stop, foot.change], [false, false], mail.id);
    if (mail.owner === 'yours') assert.deepEqual([foot.stop, foot.change, foot.settings], [true, true, false], mail.id);
  }
  for (const template of ['welcome', 'confirm-resend']) assert.doesNotMatch(footerOf(template).why, /Ignore/, `${template}: its body already says "Ignore this email"`);
  assert.equal(footerOf('release').why, 'News from Jobadabra, the same for everyone. Nothing here comes from your search or profile. You ticked this, and one click stops it.');
  assert.match(footerOf('digest').why, /^You get this because you turned on Always on\. .* never for marketing\.$/);
  assert.equal(footerOf('trial-left', 'old line').why, 'old line', 'the trial mails keep their line until they are redesigned');
});

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  resetRuleCache();
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0138_mail_rule.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { for (const one of list) await one.run(); }};
}
const now = new Date('2026-11-06T10:00:00Z');
const appKey = async () => `JPF1.install-aaaa.${await tokenFor('install-aaaa', {STATS_SALT: 'salt'}, 'ai')}`;
const post = async (e, key, body) => notify(new Request('https://x/api', {method: 'POST', headers: {'x-api-key': key}, body: JSON.stringify(body)}), e, now);

test('an app mail carries one plain line and the way to change it, whether the Mac or their GitHub wrote it or it waited for the digest', async () => {
  const store = new Map(), sent = [];
  const e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', UNSUB_SECRET: 'u', WAITLIST: {get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }},
    EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}};
  await address(new Request('https://x/api', {method: 'PUT', headers: {'x-api-key': await appKey()}, body: JSON.stringify({email: 'me@example.com'})}), e, now);
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x', digest_cadence = 'daily'").run();
  sent.length = 0;
  await post(e, await appKey(), {subject: 'Waiting', html: '<b>1 application waits</b>', mail: 'app-needs-you'});
  const repoKey = (await (await mintTrialKey(new Request('https://x/api', {headers: {'x-api-key': await appKey()}}), e, 'install-aaaa')).json()).key;
  await post(e, repoKey, {subject: 'Matches', html: '<b>3 new matches</b>', mail: 'app-matches'});
  await post(e, await appKey(), {subject: 'Insight', html: '<b>An insight</b>', kind: 'activity'});
  await sendDigests(e, new Date('2026-11-07T08:00:00Z'));
  assert.equal(sent.length, 3, 'the Mac\'s mail, the repo\'s mail and the digest');
  for (const mail of sent) assert.ok(mail.text.includes(`${YOURS}\n`) && !/kept no copy|Your own GitHub|Written on your Mac/.test(mail.text) && mail.text.includes("Change it in Settings → Notifications.\nCan't open the app? Stop these e-mails: "));
});
