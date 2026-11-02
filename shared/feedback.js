// What users sent through POST /api/feedback (api/feedback.js), read for the owner's pages and the product brain's signals.
// Guarded by test/shared/feedback.test.js.


// The owner's list on /telemetry (key only): newest first, with the contact when one was given.
export async function feedbackList(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return ((await db.prepare('SELECT at, version, platform, install, text, contact, ref, screen, shot, logs, notified FROM feedback WHERE day >= ? ORDER BY at DESC LIMIT 200')
    .bind(from).all()).results || []);
}

// The last feedback, for the product brain's signals (api/signals.js): newest first.
export async function recentFeedback(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return ((await db.prepare('SELECT at, version, text, contact != \'\' AS canReply FROM feedback WHERE day >= ? ORDER BY at DESC LIMIT 30')
    .bind(from).all()).results || []);
}

// How many of the last `days` days' feedback did not reach the owner's Telegram (a refused send, or no bot secrets): the counter on /admin. Old rows ('') are not counted.
export async function undelivered(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE day >= ? AND (notified LIKE 'failed%' OR notified = 'off')").bind(from).first();
  return row?.n || 0;
}

// The R2 key and type of one kept file, or null: kind 'screen' | 'logs' of the feedback with this ref (only the owner's route asks).
export async function fileOf(db, ref, kind) {
  if (!/^[0-9a-f]{16}$/.test(String(ref))) return null;
  const row = await db.prepare('SELECT shot, logs FROM feedback WHERE ref = ?').bind(ref).first();
  if (kind === 'screen' && row?.shot) return {key: `feedback/${ref}/screen.${row.shot}`, type: row.shot === 'jpg' ? 'image/jpeg' : 'image/png'};
  if (kind === 'logs' && row?.logs) return {key: `feedback/${ref}/logs.txt`, type: 'text/plain; charset=utf-8'};
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
  if (env.STATS) await env.STATS.prepare("UPDATE feedback SET shot = '', logs = 0 WHERE at < ? AND (shot != '' OR logs = 1)").bind(new Date(cutoff).toISOString()).run();
  return old.length;
}
