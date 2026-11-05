// The owner's page for a release mail draft (/admin/growth/email?release=<version>, the link in the Telegram message): the mail as a person sees it, an editable headline and one
// button "Send to N people" (owner, 28 Oct 2026: a held draft to check and ship, never a curl). POST (same origin, owner) saves the headline or sends. Guard: test/unit/admin/release-mail.test.js.
import {isOwner, viewer} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {compose, send, validAddress} from '../shared/mail.js';
import {audienceRows} from './email-audience.js';
import {sendAll, releaseData} from './release-mail.js';

const notFound = () => new Response('Not found', {status: 404});
const HEAD = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};

// How many of the addresses we hold would get it now (the same per-address check send() makes; MARKETING_MAIL is judged separately, as "on" here).
export const reach = async env => (await audienceRows(env)).filter(row => row.gets).length;

export async function releaseView(request, env) {
  const url = new URL(request.url), version = url.searchParams.get('release') || '';
  if (request.method === 'POST') return releasePost(request, env, url);
  if (!await viewer(request, env)) return notFound();
  const row = await env.STATS.prepare('SELECT status, data, sent_count, sent_at FROM release_mail WHERE version = ?').bind(version).first();
  if (!row) return new Response('No release mail draft for this version.', {status: 404});
  const data = await releaseData(env, {...JSON.parse(row.data), version}, {status: row.status});
  if (!data) return new Response('Release emails are available only for stable versions.', {status: 409});
  const mail = compose('release', {...data, name: ''}, {stop: '#', settings: '#'}), n = await reach(env), draft = row.status === 'draft', on = env.MARKETING_MAIL === 'on';
  const note = url.searchParams.get('done') ? `<p class="notice" role="status">${esc(url.searchParams.get('done'))}</p>` : '';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Release mail ${esc(version)} · Admin</title>
<style>
.release-review{box-sizing:border-box;max-width:840px;margin:0 auto}
.release-review *{box-sizing:border-box}
.release-review header{display:block;margin-bottom:20px}
.release-review h1{margin:8px 0 12px}.release-review h2{margin:0 0 12px}
.release-review p{overflow-wrap:anywhere}.release-review .card{margin-bottom:20px}
.release-review iframe{display:block;width:100%;height:720px;border:1px solid #262c33;border-radius:8px;background:#fff}
.release-review label{display:block;font-weight:600;margin-bottom:6px}
.release-review input[type=text],.release-review input[type=email]{font:inherit;width:100%;min-width:0;padding:10px 12px;border-radius:8px;border:1px solid #46505d;background:#1a1f26;color:#f4efe3}
.release-review input:focus-visible,.release-review button:focus-visible{outline:2px solid #f5b54a;outline-offset:3px}
.release-review button{font:inherit;font-weight:600;min-height:44px;color:#0b0d10;background:#f5b54a;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}
.release-review button[disabled]{opacity:.45;cursor:default}
.release-review form{margin:0}.release-review form>button{margin-top:12px}
.release-review .test-row{display:flex;align-items:end;gap:12px;flex-wrap:wrap}
.release-review .test-address{flex:1 1 240px;min-width:0}
.release-review .notice{padding:12px 16px;border:1px solid #4cc38a;border-radius:8px;color:#4cc38a}
@media(max-width:600px){.release-review button{width:100%}.release-review iframe{height:640px}.release-review .test-address{flex-basis:100%}}
</style></head><body><main><div class="release-review">
<header><a href="/admin/growth/email">← All email</a>
<h1>What's new mail · ${esc(version)} <span class="muted">· ${esc(row.status)}</span></h1>
<p class="muted">${draft ? 'Waiting for your approval. A test sends only to the address you enter; use Send to everyone below to publish this email.' : row.status === 'sending' ? 'Sending is in progress. Do not send this release again.' : 'This release email has already been sent.'}</p></header>${note}
<section class="card"><h2>Release preview</h2><p class="muted">Subject: ${esc(mail.subject)}</p>
${draft ? `<form method="post"><input type="hidden" name="action" value="headline"><label for="release-headline">Introduction (optional)</label><input id="release-headline" type="text" name="headline" maxlength="120" value="${esc(data.intro || '')}"><button>Save introduction</button></form><p class="muted">Save introduction changes before sending a test.</p>` : ''}
<iframe title="Release ${esc(version)} email preview" sandbox srcdoc="${esc(mail.html)}"></iframe></section>
<section class="card"><h2>Send yourself a test</h2>
<p class="muted">The saved release ${esc(version)} draft, with a TEST label. Check your inbox for this subject:</p>
<p>${esc(compose('release', {...data, name: '', test: true}).subject)}</p>
<form method="post"><input type="hidden" name="action" value="test"><div class="test-row"><div class="test-address"><label for="release-test-address">Your email address</label><input id="release-test-address" type="email" name="to" placeholder="you@example.com" autocomplete="email" required></div><button type="submit">Send test · ${esc(version)}</button></div></form></section>
<section class="card"><h2>Send to everyone</h2>
<p class="muted">${draft ? 'The release email stays a draft until you send it here. Everyone with an account or on the waitlist who has not stopped product news will receive it, once.' : row.status === 'sending' ? 'Sending is in progress. The final recipient count will appear when it finishes.' : `Sent to ${row.sent_count} on ${esc(String(row.sent_at || '').slice(0, 10))}.`}</p>
${!on ? '<p class="muted">Product news sending is switched off.</p>' : ''}
<form method="post"><input type="hidden" name="action" value="send"><button${draft && on && n ? '' : ' disabled'}>Send to ${n} ${n === 1 ? 'person' : 'people'}</button></form></section>
</div></main>
</body></html>`, {headers: HEAD});
}

async function releasePost(request, env, url) {
  if (!(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return notFound();
  const version = url.searchParams.get('release') || '', form = await request.formData().catch(() => new FormData()), action = String(form.get('action') || '');
  const row = await env.STATS.prepare('SELECT data, status FROM release_mail WHERE version = ?').bind(version).first(), draft = await env.STATS.prepare('SELECT 1 AS y FROM release_mail WHERE version = ? AND status = ?').bind(version, 'draft').first();
  let done = 'Nothing to do: this mail is not a draft.';
  if (row && action === 'test') {   // the real draft, to one address the owner types; sends nothing else
    const to = String(form.get('to') || '').trim(), data = await releaseData(env, {...JSON.parse(row.data), version}, {status: row.status});
    if (!data) return new Response('Release emails are available only for stable versions.', {status: 409});
    const result = validAddress(to) ? await send(env, 'release', to, {...data, name: '', test: true}) : {ok: false, reason: 'bad_address'};
    done = result.ok ? `Test of release ${version} sent to ${to}. Subject: ${compose('release', {...data, test: true}).subject}. This test did not send the release to your audience.` : `Test of release ${version} not sent (${result.reason}).`;
  } else if (row && draft && action === 'headline') {
    const data = JSON.parse(row.data); data.intro = String(form.get('headline') || '').trim().slice(0, 120); data.headline = data.intro;
    await env.STATS.prepare('UPDATE release_mail SET data = ? WHERE version = ?').bind(JSON.stringify(data), version).run();
    done = 'Introduction saved.';
  } else if (row && draft && action === 'send') {
    if (env.MARKETING_MAIL !== 'on') done = 'MARKETING_MAIL is off: nothing sent.';
    else { const result = await sendAll(env, version); done = result.sent !== undefined ? `Sent to ${result.sent}; ${result.skipped} skipped (stopped or refused).` : 'Not sent.'; }
  }
  return new Response(null, {status: 303, headers: {Location: `/admin/growth/email?release=${encodeURIComponent(version)}&done=${encodeURIComponent(done)}`, 'Cache-Control': 'no-store'}});
}
