// "Open in Jobadabra" only for an app that can open it (owner, 5 Nov 2026: the button sent a 0.9.6 install to the website). shared/app-needs.js holds the first app version of each feature; send() reads the
// version the account's installs last reported (telemetry) and swaps an open button for "Update Jobadabra" when it is older. Unknown version = no claim: the button stays and /open copes. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {NEEDS, appButton, appCan, versionAtLeast} from '../../../../shared/app-needs.js';
import {send} from '../../../../shared/mail.js';
import {createAccount} from '../../../../shared/pro.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0002_telemetry.sql', '0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0134_mail_on.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const now = new Date('2026-11-05T10:00:00Z');
const OPEN = 'https://www.jobadabra.top/open?view=jobs', DOWNLOAD = 'https://www.jobadabra.top/download';
const jobs = {total: 1, matches: [{title: 'SRE', company: 'Acme', fit: 80, url: 'https://x.example/1'}]};
async function mailTo(versions, template = 'digest', data = jobs) {
  const sent = [], e = {MAIL: 'on', MARKETING_MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async m => { sent.push(m); return {messageId: 'm1'}; }}};
  const account = await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x'").run();   // Why (#436): the release mail goes only to a confirmed address that has answered the card (shared/mail-lists.js)
  e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) SELECT email_hash, 'releases', 'card', 'x' FROM pro_accounts").run();
  versions.forEach((version, i) => {
    e.STATS.db.prepare('INSERT INTO pro_devices (install, account, added_at, last_seen) VALUES (?, ?, ?, ?)').run(`inst${i}`, account, now.toISOString(), now.toISOString());
    for (const [n, v] of [].concat(version).entries()) e.STATS.db.prepare("INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data) VALUES ('2026-11-05', ?, 'health', ?, ?, 'darwin', 'f', 's', '{}')").run(`2026-11-0${n + 1}T00:00:00Z`, `inst${i}`, v);
  });
  assert.equal((await send(e, template, 'me@example.com', data, {now})).ok, true);
  return sent[0];
}

test('versionAtLeast compares numbers, not text (0.9.6 < 0.9.12)', () => {
  assert.equal(versionAtLeast('0.9.6', '0.9.12'), false);
  assert.equal(versionAtLeast('0.9.12', '0.9.12'), true);
  assert.equal(versionAtLeast('0.10.0', '0.9.12'), true);
  assert.equal(versionAtLeast('', '0.9.12'), null);
  assert.equal(versionAtLeast('beta', '0.9.12'), null);
  assert.equal(versionAtLeast('0.9.12-beta.1', '0.9.12'), true);   // a suffix is ignored
  assert.equal(versionAtLeast('v0.9.12', '0.9.12'), null);          // a prefix is not a version we read: no claim
});

test('appCan: false below the feature version, true from it, null when the version is unknown', () => {
  assert.equal(appCan('open', '0.9.11'), false);
  assert.equal(appCan('open', NEEDS.open), true);
  assert.equal(appCan('open', null), null);
  assert.throws(() => appCan('nope', '1.0.0'), /unknown feature/);
});

test('appButton: only an /open link changes, only for a known older app', () => {
  const open = {label: 'Open in Jobadabra', url: OPEN};
  assert.deepEqual(appButton(open, '0.9.6'), {label: 'Update Jobadabra', url: DOWNLOAD});
  assert.deepEqual(appButton(open, '0.9.12'), open);
  assert.deepEqual(appButton(open, null), open);
  const other = {label: 'See Pro', url: 'https://www.jobadabra.top/pricing'};
  assert.deepEqual(appButton(other, '0.9.6'), other);
  assert.equal(appButton(null, '0.9.6'), null);
});

test("the owner's case: an install on 0.9.6 gets 'Update Jobadabra' to the download page, not 'Open in Jobadabra'", async () => {
  const mail = await mailTo(['0.9.6']);
  assert.ok(mail.html.includes(`href="${DOWNLOAD}"`) && mail.html.includes('>Update Jobadabra</a>'));
  assert.ok(!mail.html.includes('/open?view=') && !mail.html.includes('Open in Jobadabra'));
  assert.ok(mail.text.includes(`Update Jobadabra: ${DOWNLOAD}`) && !mail.text.includes('/open?view='));
});

test('an install that can open it still gets the Open button; the newest version it reported counts', async () => {
  for (const versions of [['0.9.12'], [['0.9.6', '0.9.12']]]) {
    const mail = await mailTo(versions);
    assert.ok(mail.html.includes(`href="${OPEN}"`) && mail.html.includes('>Open in Jobadabra</a>'), JSON.stringify(versions));
  }
});

test('several installs: one that can open is enough', async () => {
  const mail = await mailTo(['0.9.6', '0.9.12']);
  assert.ok(mail.html.includes('>Open in Jobadabra</a>'));
});

test('no version known (no installs, no report): the Open button stays, nothing is guessed', async () => {
  const mail = await mailTo([]);
  assert.ok(mail.html.includes(`href="${OPEN}"`));
});

test('a notification mail from the app (message) swaps every /open button for an old app, and leaves other links', async () => {
  const data = {subject: 'Interview', html: '<p>Hi</p>', text: 'Hi', buttons: [{text: 'Open the sessions', url: 'https://www.jobadabra.top/open?view=sessions'}, {text: 'See the job', url: 'https://x.example/job'}]};
  const old = await mailTo(['0.9.6'], 'message', data);
  assert.ok(old.html.includes('>Update Jobadabra</a>') && !old.html.includes('/open?view=sessions') && old.html.includes('https://x.example/job'));
  const fresh = await mailTo(['0.9.12'], 'message', data);
  assert.ok(fresh.html.includes('/open?view=sessions'));
});

test("the release mail's 'Open Jobadabra App' button is swapped the same way", async () => {
  const data = {version: '0.9.13', month: 'November 2026', sections: [{title: 'A change', text: 'See *Jobs*.'}]};
  const old = await mailTo(['0.9.6'], 'release', data);
  assert.ok(!old.html.includes('/open?view=') && old.html.includes('>Update Jobadabra</a>') && !old.text.includes('/open?view='));
  const fresh = await mailTo(['0.9.12'], 'release', data);
  assert.ok(fresh.html.includes('>Open Jobadabra App</a>'));
});
