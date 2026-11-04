// "Send to test inbox" on /admin/growth/email (owner, 26 Oct 2026: a button that sends a template to a test inbox). POST /admin/growth/email, owner only, from the page (same origin).
// The ONLY address it ever mails is a test-account-*@jobpilotto.top inbox (admin/test-mail.js isTestAddress): any other `to` is refused, and the default is test-account-admin@. It goes through the real
// send() (list rules, 6 a day, the log), so it counts in the caps like any mail. The copy that arrives is listed on the page from test_mail. Guard: test/unit/admin/email.test.js.
import {isOwner} from '../shared/auth.js';
import {send, validAddress} from '../shared/mail.js';
import {TEMPLATES} from '../shared/mail-templates.js';
import {SAMPLES} from './email-preview.js';
import {isTestAddress} from './test-mail.js';

export const TEST_INBOX = 'test-account-admin@jobpilotto.top';
const notFound = () => new Response('Not found', {status: 404});

// -> a Response: 303 back to the page with ?test=<template>:<result> (result = "sent" or the refusal reason).
export async function testSend(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return notFound();
  const form = await request.formData().catch(() => new FormData());
  const template = String(form.get('template') || ''), to = String(form.get('to') || TEST_INBOX).trim().toLowerCase();
  if (!TEMPLATES[template]) return new Response('Unknown template.', {status: 400});
  // Why (28 Oct 2026, owner: "a possibility to test some email templates, basically what's new simulation, just on my personal email"): "Send to my email" mails one address the owner types, the sample data only; every other path stays test inboxes.
  const mine = form.get('mine') === '1';
  if (mine && !validAddress(to)) return new Response('Enter an email address like you@example.com.', {status: 400});
  if (!mine && !isTestAddress(to)) return new Response('Test mail goes only to a test-account-*@jobpilotto.top address.', {status: 400});
  const result = await send(env, template, to, SAMPLES[template]);
  return new Response(null, {status: 303, headers: {Location: `/admin/growth/email?test=${template}:${result.ok ? 'sent' : result.reason}`, 'Cache-Control': 'no-store'}});
}
