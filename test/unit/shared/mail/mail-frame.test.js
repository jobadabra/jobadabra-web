// The branded frame (shared/mail-frame.js): every template goes through it with the logo, the footer with the stop and settings links and a plain-text twin; at most one orange button; no Pro or
// product-news line while the owner's marketing flag is off; and a template without a title (the frame's input) or a sender that skips send() fails. Fake sender and fake D1.
import {LIGHT} from '../../../../shared/mail-palette.js';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {mailOf} from '../../../../shared/mail-registry.js';
import {sourceFiles} from '../../../lib/source-files.js';
import {send, settingsLink, stopLink} from '../../../../shared/mail.js';
import {TEMPLATES} from '../../../../shared/mail-templates.js';
import {createAccount} from '../../../../shared/pro.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const setup = (extra = {}) => { const sent = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }}, ...extra}; return {e, sent}; };
const now = new Date('2026-10-17T10:00:00Z');
const matches = [{title: 'Senior Site Reliability Engineer', company: 'Example Bank', place: 'Zürich', mode: 'Hybrid', fit: 86, url: 'https://x.example/1'}, {title: 'Platform Engineer', company: 'Northwind', fit: 81}];
// One sample of data per template: a new template without a sample fails the coverage test below.
const SAMPLES = {
  'message': {subject: 'Rejection from Acme', html: '<b>Acme said no</b>', text: 'Acme said no', buttons: [{text: 'Open the job', url: 'https://x.example/job'}, {text: 'See why', url: 'https://x.example/why'}], confirmUrl: 'https://x.example/confirm'},
  'account-code': {code: '482913'},
  'digest': {matches, total: 3},
  'welcome': {confirmUrl: 'https://www.jobadabra.top/confirm?a=0123456789abcdef&t=abc'},
  'confirm-resend': {confirmUrl: 'https://www.jobadabra.top/confirm?a=0123456789abcdef&t=abc'},
  'feedback-update': {kind: 'fixed', on: '2026-10-28', excerpt: 'Setup stops at Connect LinkedIn…', message: 'Thank you: this is fixed in 0.9.12.'},
  'trial-left': {left: 4},
  'trial-ending': {days: 2, pricingUrl: 'https://www.jobadabra.top/pricing'},
  'always-on-paused': {reason: 'trial-over', pricingUrl: 'https://www.jobadabra.top/pricing', pro: false},
  'always-on-test': {},
  'pro-launch': {price: '29', launch: '19', pricingUrl: 'https://www.jobadabra.top/pricing'},
  'release': {version: '0.8.42', month: 'October 2026', headline: 'One main change', sections: [{title: 'A change', text: 'See *Jobs*.'}], updateUrl: 'https://www.jobadabra.top/download'},
};

test('every template has a sample here (a new template must be added to this test)', () => assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(TEMPLATES).sort()));

test('every template goes through the frame: logo, title, footer with stop + settings + site links, a plain-text twin, one orange button at most', async () => {
  for (const [name, spec] of Object.entries(TEMPLATES)) {
    const {e, sent} = setup({MARKETING_MAIL: 'on'});
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x'").run();   // news goes only to a confirmed address; Tips and tricks also needs its tick (shared/mail-lists.js)
    e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) SELECT email_hash, 'tips', 'card', 'x' FROM pro_accounts").run();
    assert.equal((await send(e, name, 'me@example.com', SAMPLES[name], {now})).ok, true, name);
    const {html, text} = sent[0];
    assert.ok(html.includes('data-jp-frame="1"') && html.includes('<title>'), `${name}: framed`);
    assert.ok(html.includes('https://www.jobadabra.top/images/logo-mark.png') && !html.includes('data:'), `${name}: hosted logo`);
    assert.ok(html.includes('>jobadabra.top</a>') && text.split('\n').includes('https://www.jobadabra.top'), `${name}: site link`);
    // The owner's personal footer and Reply-To (owner, 5 Nov 2026: "Questions? Just reply to this email. It comes straight to me."): every mail, security ones too, through the one frame.
    assert.ok(html.includes('Questions? Just reply to this email. It comes straight to me.') && html.includes('Igor, builder of Jobadabra · Geneva') && html.includes('src="https://www.jobadabra.top/images/igor-footer.png"'), `${name}: the owner's footer`);
    assert.ok(text.includes('Questions? Just reply to this email. It comes straight to me.\nIgor, builder of Jobadabra · Geneva'), `${name}: the text twin has the footer`);
    assert.equal(sent[0].replyTo, 'support@jobadabra.top', `${name}: replies go to support@`);
    assert.match(sent[0].from, /no-reply@jobadabra\.top/, `${name}: From stays no-reply@`);
    assert.ok(html.split(`background:${LIGHT.fill}`).length - 1 <= 1, `${name}: at most one yellow button`);   // the app's yellow (shared/mail-palette.js); it counted the old orange until 28 Oct 2026 and so could never fail (Gitar, #220)
    assert.ok(!/<(script|form|iframe)/i.test(html), `${name}: email-safe`);
    // Why (spec PR 5; owner, 6 Nov 2026: "Loks like essays/novels", "we shouldn't show Downlaod on user app email notifications"): two short footer lines at most;
    // Account mail has nothing to stop; Yours mail says where to change it, with a web stop; only news (and the old trial mails) offer the download.
    const owner = mailOf(name)?.owner;
    const foot = html.slice(html.lastIndexOf('<p class="jp-muted"'));
    assert.ok(foot.split('<br>').length <= (owner === 'yours' || owner === 'account' ? 2 : 3), `${name}: the footer is at most two short lines (plus the download line for news)`);
    const download = html.includes('>Download Jobadabra</a>') && text.includes('Download Jobadabra: https://www.jobadabra.top/download');
    assert.equal(download, owner !== 'yours' && owner !== 'account' && !spec.essential, `${name}: "Don't have the app?" only where the reader may not have it`);
    if (spec.essential || owner === 'account') { assert.ok(!/Stop these e/.test(html) && !sent[0].headers, `${name}: an Account mail has nothing to stop`); continue; }
    const stop = (await stopLink(e, 'me@example.com', spec.list)).replaceAll('&', '&amp;'), settings = (await settingsLink(e, 'me@example.com')).replaceAll('&', '&amp;');
    assert.ok(html.includes(`href="${stop}"`) && text.includes(`Stop these emails: ${stop.replaceAll('&amp;', '&')}`) && sent[0].headers['List-Unsubscribe'], `${name}: a stop link, in both versions and the header`);
    if (owner === 'yours') {
      assert.ok(foot.includes('You chose these in the app: Settings → Notifications.<br>') && !foot.includes('Email settings'), `${name}: where to change it, no settings page`);
      assert.equal(foot.includes('How we keep your data'), ['digest', 'always-on-paused'].includes(name), `${name}: only hosted Always on links what we store`);
    } else assert.ok(html.includes(`href="${settings}"`) && html.includes('Email settings') && text.includes(settings.replaceAll('&amp;', '&')), `${name}: news has the stop and the settings page`);
  }
});

test('the digest is job rows with a fit chip and one "Open in Jobadabra" button; the sign-in code is a big box with the security line', async () => {
  const {e, sent} = setup();
  await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  await send(e, 'digest', 'me@example.com', SAMPLES.digest, {now});
  await send(e, 'account-code', 'me@example.com', SAMPLES['account-code'], {now});
  assert.equal(sent[0].subject, '3 new job matches');
  assert.ok(sent[0].html.includes('href="https://www.jobadabra.top/open?view=jobs"'));
  assert.ok(sent[0].text.includes('https://www.jobadabra.top/open?view=jobs'));
  assert.ok(sent[0].html.includes('Example Bank · Zürich · Hybrid') && sent[0].html.includes('jp-fit') && sent[0].html.includes('Open in Jobadabra'));
  assert.match(sent[0].text, /Senior Site Reliability Engineer \(Example Bank · Zürich · Hybrid\) fit 86/);
  assert.ok(sent[1].html.includes('482913') && sent[1].html.includes('A security e-mail, sent even if you stopped others.'));
});

test('while the marketing flag is off no service mail carries a Pro or product-news line', async () => {
  for (const [name, spec] of Object.entries(TEMPLATES)) {
    if (spec.list !== 'service') continue;
    const {e, sent} = setup();
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    await send(e, name, 'me@example.com', SAMPLES[name], {now});
    assert.ok(!/\bPro\b|product news|\boffer\b|launch/i.test(sent[0].html.replace(/<title>.*?<\/title>/, '') + sent[0].text), `${name}: no sales line`);
  }
});

test('a template without a title is not sent, and no code sends mail except through send()', async () => {
  TEMPLATES.rogue = {list: 'service', subject: () => 'Rogue', text: () => 'raw', html: () => '<p>raw</p>'};
  try {
    const {e, sent} = setup();
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    assert.equal((await send(e, 'rogue', 'me@example.com', {}, {now})).ok, false);
    assert.equal(sent.length, 0);
  } finally { delete TEMPLATES.rogue; }
  const callers = sourceFiles().filter(({path}) => /EMAIL\.send\(/.test(readFileSync(path, 'utf8'))).map(({name}) => name);
  assert.deepEqual(callers, ['mail.js'], 'only shared/mail.js hands mail to the sender, so every mail is framed');
});

test("the owner's footer photo is a small round PNG served by the site (96 px, transparent corners: a mail client may ignore border-radius)", () => {
  const png = readFileSync(new URL('../../../../web/public/images/igor-footer.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 96); assert.equal(png.readUInt32BE(20), 96);   // IHDR width, height
  assert.equal(png[25], 6, 'RGBA, so the corners can be transparent');
  assert.ok(png.length < 40_000, 'small enough for a mail');
});
