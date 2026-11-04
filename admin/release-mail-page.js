// The owner's page for a release mail draft (/admin/growth/email?release=<version>, the link in the Telegram message): the mail as a person sees it, an editable headline and one
// button "Send to N people" (owner, 28 Oct 2026: a held draft to check and ship, never a curl). POST (same origin, owner) saves the headline or sends. Guard: test/unit/admin/release-mail.test.js.
import {isOwner, viewer} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {compose, send, validAddress} from '../shared/mail.js';
import {audienceRows} from './email-audience.js';
import {sendAll} from './release-mail.js';

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
  const data = JSON.parse(row.data), mail = compose('release', {...data, name: ''}, {stop: '#', settings: '#'}), n = await reach(env), draft = row.status === 'draft', on = env.MARKETING_MAIL === 'on';
  const note = url.searchParams.get('done') ? `<p class="pill on">${esc(url.searchParams.get('done'))}</p>` : '';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Release mail ${esc(version)} · Admin</title>
<style>body{font:15px/1.5 -apple-system,Segoe UI,Helvetica,sans-serif;background:#0f1218;color:#e8ebf0;margin:0;padding:20px;max-width:760px;margin-inline:auto}iframe{width:100%;height:720px;border:1px solid #252b36;border-radius:8px;background:#fff}
input[type=text]{font:inherit;width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #252b36;background:#161b23;color:inherit}button{font:inherit;font-weight:600;color:#fff;background:#d0612b;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}button[disabled]{opacity:.45;cursor:default}
.muted{color:#9aa3b2}.pill{display:inline-block;padding:1px 10px;border-radius:99px;border:1px solid #4cc38a;color:#4cc38a}form{margin:14px 0}</style></head><body>
<h1>What's new mail · ${esc(version)} <span class="muted">· ${esc(row.status)}</span></h1>${note}
<p class="muted">Subject: ${esc(mail.subject)}</p>
${draft ? `<form method="post"><input type="hidden" name="action" value="headline"><label>Headline<br><input type="text" name="headline" maxlength="120" value="${esc(data.headline)}"></label> <button>Save headline</button></form>` : ''}
<iframe title="The mail" srcdoc="${esc(mail.html)}"></iframe>
<form method="post"><input type="hidden" name="action" value="test"><label>Test it on your own email<br><input type="email" name="to" placeholder="you@example.com" required></label> <button type="submit">Send me a test</button></form>
<form method="post"><input type="hidden" name="action" value="send"><button${draft && on && n ? '' : ' disabled'}>Send to ${n} ${n === 1 ? 'person' : 'people'}</button>
<p class="muted">${draft ? (on ? 'Everyone with an account or on the waitlist who has not stopped product news. This sends real mail, once.' : 'MARKETING_MAIL is off, so nothing can be sent yet.') : `Sent to ${row.sent_count} on ${esc(String(row.sent_at || '').slice(0, 10))}.`}</p></form>
</body></html>`, {headers: HEAD});
}

async function releasePost(request, env, url) {
  if (!(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return notFound();
  const version = url.searchParams.get('release') || '', form = await request.formData().catch(() => new FormData()), action = String(form.get('action') || '');
  const row = await env.STATS.prepare('SELECT data FROM release_mail WHERE version = ?').bind(version).first(), draft = await env.STATS.prepare('SELECT 1 AS y FROM release_mail WHERE version = ? AND status = ?').bind(version, 'draft').first();
  let done = 'Nothing to do: this mail is not a draft.';
  if (row && action === 'test') {   // the real draft, to one address the owner types; sends nothing else
    const to = String(form.get('to') || '').trim();
    const result = validAddress(to) ? await send(env, 'release', to, {...JSON.parse(row.data), name: ''}) : {ok: false, reason: 'bad_address'};
    done = result.ok ? 'Test sent to your address.' : `Test not sent (${result.reason}).`;
  } else if (row && draft && action === 'headline') {
    const data = JSON.parse(row.data); data.headline = String(form.get('headline') || '').trim().slice(0, 120) || data.headline;
    await env.STATS.prepare('UPDATE release_mail SET data = ? WHERE version = ?').bind(JSON.stringify(data), version).run();
    done = 'Headline saved.';
  } else if (row && draft && action === 'send') {
    if (env.MARKETING_MAIL !== 'on') done = 'MARKETING_MAIL is off: nothing sent.';
    else { const result = await sendAll(env, version); done = result.sent !== undefined ? `Sent to ${result.sent}; ${result.skipped} skipped (stopped or refused).` : 'Not sent.'; }
  }
  return new Response(null, {status: 303, headers: {Location: `/admin/growth/email?release=${encodeURIComponent(version)}&done=${encodeURIComponent(done)}`, 'Cache-Control': 'no-store'}});
}
