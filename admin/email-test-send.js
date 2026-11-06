// "Send to test inbox" on /admin/growth/email (owner, 26 Oct 2026: a button that sends a template to a test inbox). POST /admin/growth/email, owner only, from the page (same origin).
// The default is a test-account-*@jobpilotto.top inbox; the owner may enter a personal address. Release tests use the real pinned stable draft, other templates use samples. All go through the real
// send() as a test (list rules, the log as test:<template>, outside the per-address cap: owner, 5 Nov 2026, "test emmail are aside of this cap"; the 3,000 a day still counts it). The copy that arrives is listed on the page from test_mail. Guard: test/unit/admin/email.test.js.
import {isOwner} from '../shared/auth.js';
import {send, validAddress} from '../shared/mail.js';
import {TEMPLATES} from '../shared/mail-templates.js';
import {SAMPLES} from './email-preview.js';
import {isTestAddress} from './test-mail.js';
import {latestStableVersion, releaseData} from './release-mail.js';

export const TEST_INBOX = 'test-account-admin@jobpilotto.top';
const notFound = () => new Response('Not found', {status: 404});

// -> a Response: 303 back to the page with ?test=<template>:<result> (result = "sent" or the refusal reason).
export async function testSend(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return notFound();
  const form = await request.formData().catch(() => new FormData());
  const template = String(form.get('template') || ''), to = String(form.get('to') || TEST_INBOX).trim().toLowerCase();
  if (!TEMPLATES[template]) return new Response('Unknown template.', {status: 400});
  // Why (5 Nov 2026, owner: the release email must show and test the real latest stable changelog): "Send to my email" mails one address the owner types, the selected release content (other templates use samples); every other path stays test inboxes.
  const mine = form.get('mine') === '1';
  if (mine && !validAddress(to)) return new Response('Enter an email address like you@example.com.', {status: 400});
  if (!mine && !isTestAddress(to)) return new Response('Test mail goes only to a test-account-*@jobpilotto.top address.', {status: 400});
  let data = SAMPLES[template];
  if (template === 'release') {
    const version = String(form.get('release') || await latestStableVersion(env) || '');
    const row = version && await env.STATS.prepare('SELECT data,status FROM release_mail WHERE version = ?').bind(version).first();
    data = row && await releaseData(env, {...JSON.parse(row.data), version}, {status: row.status});
    if (data) data = {...data, name: '', test: true};
  }
  const result = data ? await send(env, template, to, data, {test: true, ownerTest: true}) : {ok: false, reason: 'no_release'};
  if (template === 'release' && data && form.get('detail') === '1') {
    const done = result.ok ? `Test of release ${data.version} sent to ${to}. The broadcast is unchanged.` : `Test of release ${data.version} not sent (${result.reason}).`;
    return new Response(null, {status: 303, headers: {Location: `/admin/growth/email?${new URLSearchParams({release: data.version, done})}`, 'Cache-Control': 'no-store'}});
  }
  return new Response(null, {status: 303, headers: {Location: `/admin/growth/email?test=${template}:${result.ok ? 'sent' : result.reason}&destination=${mine ? 'personal' : 'inbox'}${form.get('detail') === '1' ? `&template=${template}` : ''}#test-result-${template}`, 'Cache-Control': 'no-store'}});
}
