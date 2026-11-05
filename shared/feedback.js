// What users sent through POST /api/feedback (api/feedback.js), read for the owner's pages and the product brain's signals.
// Guarded by test/unit/shared/feedback/feedback.test.js.

// The text files a feedback may carry besides the screenshot: the body field, its R2 name, the row flag (0/1) it sets, its cap and its type. One table, read by the endpoint, the owner's file route
// and the daily purge, so a new kind is one line. Why (2 Nov 2026, owner: "send the content/data from that page … and a snapshot of the entire profile"): `page` is the screen's own data,
// `profile` the person's own opt-in snapshot of their Profile.
export const TEXT_FILES = {
  logs: {name: 'logs.txt', max: 200 * 1024, type: 'text/plain; charset=utf-8'},
  page: {name: 'page.json', max: 200 * 1024, type: 'application/json; charset=utf-8'},
  profile: {name: 'profile.json', max: 200 * 1024, type: 'application/json; charset=utf-8'},
};

// The owner's list on /telemetry (key only): newest first, with the contact when one was given.
export async function feedbackList(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return ((await db.prepare('SELECT at, version, platform, install, text, contact, ref, screen, shot, logs, page, profile, notified, state, state_at, state_note, impact, impact_ai, impact_why, fixed_in, pr_url, linear_url, tell_mode, tell_mail, told, seen_at, ai_run_url FROM feedback WHERE day >= ? ORDER BY at DESC LIMIT 200')
    .bind(from).all()).results || []);
}

// The last feedback, for the product brain's signals (api/signals.js): newest first, without what the owner dismissed or marked a false positive (3 Nov 2026: noise is not a signal).
export async function recentFeedback(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return ((await db.prepare('SELECT at, version, text, contact != \'\' AS canReply FROM feedback WHERE day >= ? AND state NOT IN (\'dismissed\', \'false_positive\') ORDER BY at DESC LIMIT 30')
    .bind(from).all()).results || []);
}

// How many of the last `days` days' still-open feedback did not reach the owner's Telegram (a refused send, or no bot secrets): the counter on /admin. Old rows ('') are not counted.
export async function undelivered(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE day >= ? AND state IN ('new', 'ai_running', 'ai_pr') AND (notified LIKE 'failed%' OR notified = 'off')").bind(from).first();
  return row?.n || 0;
}

// The R2 key and type of one kept file, or null: kind 'screen' | 'logs' | 'page' | 'profile' of the feedback with this ref (only the owner's route asks).
export async function fileOf(db, ref, kind) {
  if (!/^[0-9a-f]{16}$/.test(String(ref))) return null;
  const row = await db.prepare('SELECT shot, logs, page, profile FROM feedback WHERE ref = ?').bind(ref).first();
  if (kind === 'screen' && row?.shot) return {key: `feedback/${ref}/screen.${row.shot}`, type: row.shot === 'jpg' ? 'image/jpeg' : 'image/png'};
  if (Object.hasOwn(TEXT_FILES, kind) && row?.[kind]) return {key: `feedback/${ref}/${TEXT_FILES[kind].name}`, type: TEXT_FILES[kind].type};
  return null;
}

export const KEEP_FILES_DAYS = 90;
// Daily (scheduled in workers/www/index.js): files older than 90 days leave R2 and their row stops pointing at them. -> how many objects were deleted
export async function purgeFiles(env, now = new Date()) {
  if (!env.FEEDBACK_FILES) return 0;
  const cutoff = now.getTime() - KEEP_FILES_DAYS * 86400000, old = [];
  let cursor;
  do {
    const page = await env.FEEDBACK_FILES.list({prefix: 'feedback/', cursor});
    for (const object of page.objects) if (new Date(object.uploaded).getTime() < cutoff) old.push(object.key);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  for (let i = 0; i < old.length; i += 1000) await env.FEEDBACK_FILES.delete(old.slice(i, i + 1000));
  if (env.STATS) await env.STATS.prepare("UPDATE feedback SET shot = '', logs = 0, page = 0, profile = 0 WHERE at < ? AND (shot != '' OR logs = 1 OR page = 1 OR profile = 1)").bind(new Date(cutoff).toISOString()).run();
  return old.length;
}
