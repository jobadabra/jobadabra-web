// POST /api/feedback: feedback from the Jobadabra app ("Send feedback…"), kept in D1 (migrations 0003 + 0124) and sent at once to the owner's Telegram (the Brain bot).
// It may carry the app window's screenshot (≤ 2 MB) and the redacted logs (≤ 200 KB): both go to the private R2 bucket FEEDBACK_FILES for 90 days and are read only on /admin.
// At most 10 a day per install. The owner's list is admin/feedback.js; shared/feedback.js reads what is kept. Guarded by test/shared/feedback.test.js and feedback-files.test.js.
// Why (2 Nov 2026, owner: "I should get a telegram message when a new feedback is received"): the send's answer is READ and written on the row (`notified`): before, only a network error
// was caught, so a refusal by Telegram (bad chat id, 4xx) vanished and nobody could tell whether the owner had been told.
import {escTags} from '../shared/html.js';

const PER_INSTALL_PER_DAY = 10;
export const MAX_SHOT_BYTES = 2 * 1024 * 1024, MAX_LOGS_BYTES = 200 * 1024;
const SHOT = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const clip = (value, max) => String(value ?? '').replace(/\s+$/g, '').slice(0, max);
const hex = () => [...crypto.getRandomValues(new Uint8Array(8))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// The screenshot as bytes, or null when it is not a PNG/JPEG data URL or is over the cap (checked on the base64 length first, so a huge body is never decoded).
export function decodeShot(value) {
  const match = SHOT.exec(String(value ?? ''));
  if (!match || match[2].length * 3 / 4 > MAX_SHOT_BYTES + 3) return null;
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return bytes.length <= MAX_SHOT_BYTES ? {bytes, type: match[1] === 'jpeg' ? 'jpg' : 'png'} : null;
}

// One Telegram call: -> '' when Telegram accepted it, else why not (never the token).
async function telegram(fetcher, env, method, body) {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/${method}`, body instanceof FormData ? {method: 'POST', body}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const answer = await response.json().catch(() => ({}));
    if (response.ok && answer.ok !== false) return {why: '', id: answer.result?.message_id};
    return {why: `${response.status} ${answer.description || ''}`.trim()};
  } catch (error) {
    return {why: `network ${String(error.message).split(env.BRAIN_BOT_TOKEN).join('<token>')}`};
  }
}

// Messages to the owner: the words first (with the logs link), then the screenshot as a photo under it. -> 'sent' | 'off' | 'failed: <why>'
async function tell(env, fetcher, row, shot) {
  if (!(env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID)) return 'off';
  const link = (row.logs || row.shot) ? `\n\n📎 <a href="https://www.jobadabra.top/admin/growth/feedback#${row.ref}">${row.logs ? 'Logs' : 'Screenshot'} on /admin</a>` : '';
  const message = `💬 <b>Feedback</b> · v${escTags(row.version)} · ${escTags(row.platform)}${row.screen ? ` · ${escTags(row.screen)}` : ''} · install ${escTags(row.install.slice(0, 8))}\n\n${escTags(row.text)}` +
    (row.contact ? `\n\n↩︎ ${escTags(row.contact)}` : '') + link;
  const first = await telegram(fetcher, env, 'sendMessage', {chat_id: env.BRAIN_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true});
  if (first.why) return `failed: ${first.why}`.slice(0, 200);
  if (!shot) return 'sent';
  const form = new FormData();
  form.set('chat_id', String(env.BRAIN_CHAT_ID));
  form.set('photo', new Blob([shot.bytes], {type: shot.type === 'jpg' ? 'image/jpeg' : 'image/png'}), `screen.${shot.type}`);
  form.set('caption', `📸 ${row.screen || 'the app window'}`);
  if (first.id) form.set('reply_to_message_id', String(first.id));
  const photo = await telegram(fetcher, env, 'sendPhoto', form);
  return photo.why ? `failed: photo ${photo.why}`.slice(0, 200) : 'sent';
}

export async function feedback(request, env, fetcher = fetch, now = new Date()) {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const text = clip(body.text, 2000).trim();
  const install = clip(body.install, 64);
  if (!text || !/^[\w-]{8,64}$/.test(install)) return Response.json({ok: false, error: 'give a message'}, {status: 400});
  const day = now.toISOString().slice(0, 10);
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM feedback WHERE day = ? AND install = ?').bind(day, install).first() || {n: 0};
  if (n >= PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  const ref = hex(), skipped = [];
  let shot = null, logs = '';
  if (body.screenshot) { shot = decodeShot(body.screenshot); if (!shot) skipped.push('screenshot'); }
  if (typeof body.logs === 'string' && body.logs) { if (new TextEncoder().encode(body.logs).length <= MAX_LOGS_BYTES) logs = body.logs; else skipped.push('logs'); }
  if ((shot || logs) && !env.FEEDBACK_FILES) { if (shot) skipped.push('screenshot'); if (logs) skipped.push('logs'); shot = null; logs = ''; }
  try {
    if (shot) await env.FEEDBACK_FILES.put(`feedback/${ref}/screen.${shot.type}`, shot.bytes, {httpMetadata: {contentType: shot.type === 'jpg' ? 'image/jpeg' : 'image/png'}});
    if (logs) await env.FEEDBACK_FILES.put(`feedback/${ref}/logs.txt`, logs, {httpMetadata: {contentType: 'text/plain; charset=utf-8'}});
  } catch (error) {
    console.log('feedback files not kept', error.message);
    if (shot) skipped.push('screenshot'); if (logs) skipped.push('logs');
    shot = null; logs = '';
  }
  const row = {at: now.toISOString(), day, install, version: clip(body.version, 30) || '?', platform: clip(body.platform, 20) || '?',
    text, contact: clip(body.contact, 200).trim(), ref, screen: clip(body.screen, 60).trim(), shot: shot?.type || '', logs: logs ? 1 : 0};
  await env.STATS.prepare('INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, screen, shot, logs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.at, row.day, row.install, row.version, row.platform, row.text, row.contact, row.ref, row.screen, row.shot, row.logs).run();
  const notified = await tell(env, fetcher, row, shot);
  await env.STATS.prepare('UPDATE feedback SET notified = ? WHERE ref = ?').bind(notified, ref).run().catch(error => console.log('feedback notified not saved', error.message));
  if (notified.startsWith('failed')) console.log('feedback notify failed', notified);
  return Response.json({ok: true, ...(skipped.length ? {skipped: [...new Set(skipped)]} : {})});
}
