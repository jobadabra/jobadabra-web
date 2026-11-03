// POST /api/feedback: feedback from the Jobadabra app ("Send feedback…"), kept in D1 (migrations 0003 + 0124) and sent at once to the owner's Telegram (the Brain bot).
// It may carry the app window's screenshot (≤ 2 MB) and the redacted logs (≤ 200 KB): both go to the private R2 bucket FEEDBACK_FILES for 90 days and are read only on /admin.
// At most 10 a day per install. The owner's list is admin/feedback.js; shared/feedback.js reads what is kept. Guarded by test/shared/feedback.test.js and feedback-files.test.js.
// Why (2 Nov 2026, owner: "I should get a telegram message when a new feedback is received"): the send's answer is READ and written on the row (`notified`): before, only a network error
// was caught, so a refusal by Telegram (bad chat id, 4xx) vanished and nobody could tell whether the owner had been told.
import {escTags} from '../shared/html.js';
import {TEXT_FILES} from '../shared/feedback.js';
import {suggestImpact} from '../shared/feedback-impact.js';
import {telegram} from '../shared/telegram.js';

const PER_INSTALL_PER_DAY = 10;
// Why (2 Nov 2026, owner: "the app version, the OS platform, the installation id"): the platform field carries the OS version and architecture too ("win32 10.0.19045 x64"), so 40 characters, not 20.
// Why (2 Nov 2026, Gitar on #334): the endpoint is open and the install id is the client's own, so a caller changing it per request could fill R2 and the owner's chat with photos.
// The words are always kept; files (and so the photo) stop for the day past this many feedbacks that carried one.
export const FILES_PER_DAY = 100;
export const MAX_SHOT_BYTES = 2 * 1024 * 1024, MAX_LOGS_BYTES = TEXT_FILES.logs.max;
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

// Messages to the owner: the words first (with the logs link), then the screenshot as a photo under it. -> 'sent' | 'off' | 'failed: <why>'
async function tell(env, fetcher, row, shot) {
  if (!(env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID)) return 'off';
  const have = [row.shot && 'Screenshot', row.logs && 'Logs', row.page && 'Screen data', row.profile && 'Profile'].filter(Boolean);
  const link = have.length ? `\n\n📎 <a href="https://www.jobadabra.top/admin/feedback/inbox#${row.ref}">${have.join(' · ')} on /admin</a>` : '';
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

export async function feedback(request, env, fetcher = fetch, now = new Date(), ctx = null) {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const text = clip(body.text, 2000).trim();
  const install = clip(body.install, 64);
  if (!text || !/^[\w-]{8,64}$/.test(install)) return Response.json({ok: false, error: 'give a message'}, {status: 400});
  // Why (owner, 3 Nov 2026: "this should be mandatory for every feedback sent"): every row says which build and which system it came from, so a bug can be reproduced and an answer can be matched
  // to the build that fixes it. Text only (a number or an object is not a version); the e-mail stays optional. Every app build sends both, so this refuses only a caller that is not the app.
  const version = typeof body.version === 'string' ? clip(body.version, 30).trim() : '', platform = typeof body.platform === 'string' ? clip(body.platform, 40).trim() : '';
  if (!version || !platform) return Response.json({ok: false, error: 'give the app version and platform: update the app and try again'}, {status: 400});
  const day = now.toISOString().slice(0, 10);
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM feedback WHERE day = ? AND install = ?').bind(day, install).first() || {n: 0};
  if (n >= PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  const ref = hex(), skipped = [], kept = {};   // kept: text kind -> the text to store
  let shot = null;
  const carried = [...(body.screenshot ? ['screenshot'] : []), ...Object.keys(TEXT_FILES).filter(kind => body[kind])];
  const withFiles = carried.length ? (await env.STATS.prepare("SELECT COUNT(*) AS n FROM feedback WHERE day = ? AND (shot != '' OR logs = 1 OR page = 1 OR profile = 1)").bind(day).first())?.n || 0 : 0;
  if (withFiles >= FILES_PER_DAY || (carried.length && !env.FEEDBACK_FILES)) { skipped.push(...carried); carried.length = 0; }
  if (carried.includes('screenshot')) { shot = decodeShot(body.screenshot); if (!shot) skipped.push('screenshot'); }
  for (const kind of carried) {
    if (kind === 'screenshot') continue;
    if (typeof body[kind] === 'string' && new TextEncoder().encode(body[kind]).length <= TEXT_FILES[kind].max) kept[kind] = body[kind]; else skipped.push(kind);
  }
  try {
    if (shot) await env.FEEDBACK_FILES.put(`feedback/${ref}/screen.${shot.type}`, shot.bytes, {httpMetadata: {contentType: shot.type === 'jpg' ? 'image/jpeg' : 'image/png'}});
    for (const [kind, text] of Object.entries(kept)) await env.FEEDBACK_FILES.put(`feedback/${ref}/${TEXT_FILES[kind].name}`, text, {httpMetadata: {contentType: TEXT_FILES[kind].type}});
  } catch (error) {
    console.log('feedback files not kept', error.message);
    skipped.push(...(shot ? ['screenshot'] : []), ...Object.keys(kept));
    shot = null; for (const kind of Object.keys(kept)) delete kept[kind];
  }
  const row = {at: now.toISOString(), day, install, version, platform,
    text, contact: clip(body.contact, 200).trim(), ref, screen: clip(body.screen, 60).trim(), shot: shot?.type || '', logs: kept.logs ? 1 : 0, page: kept.page ? 1 : 0, profile: kept.profile ? 1 : 0};
  await env.STATS.prepare('INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, screen, shot, logs, page, profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.at, row.day, row.install, row.version, row.platform, row.text, row.contact, row.ref, row.screen, row.shot, row.logs, row.page, row.profile).run();
  const notified = await tell(env, fetcher, row, shot);
  await env.STATS.prepare('UPDATE feedback SET notified = ? WHERE ref = ?').bind(notified, ref).run().catch(error => console.log('feedback notified not saved', error.message));
  if (notified.startsWith('failed')) console.log('feedback notify failed', notified);
  // The AI's suggested impact (shared/feedback-impact.js) runs after the answer is ready when a context is given (the Worker), else before it returns (tests); it never fails the request.
  const suggest = suggestImpact(env, ref, now);
  if (ctx?.waitUntil) ctx.waitUntil(suggest); else await suggest;
  return Response.json({ok: true, ...(skipped.length ? {skipped: [...new Set(skipped)]} : {})});
}
