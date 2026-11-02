// The owner's /admin/growth/feedback page: live, newest on top. Same key or cookie as /admin. Guarded by test/shared/feedback.test.js.
import {viewer, remember} from '../shared/auth.js';
import {feedbackList, undelivered, fileOf} from '../shared/feedback.js';

// GET /feedback: the owner's live page (same key or cookie as /stats). It polls /feedback?json=1 every 10 s and puts
// new messages on top, marked, so feedback can be read as it arrives. Everything is escaped on the page (textContent).
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (url.searchParams.has('json')) {
    const rows = await feedbackList(env.STATS, 90, now).catch(() => []);
    return Response.json({rows, undelivered: await undelivered(env.STATS, 90, now).catch(() => 0), now: now.toISOString()}, {headers: {'Cache-Control': 'no-store'}});
  }
  return new Response(PAGE, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

// GET /admin/growth/feedback/file?ref=<16 hex>&kind=screen|logs: one kept file, for the owner only (the same login as the page). Served as an inert type, never cached.
export async function file(request, env) {
  if (!await viewer(request, env) || !env.STATS || !env.FEEDBACK_FILES) return new Response('Not found', {status: 404});
  const url = new URL(request.url), kept = await fileOf(env.STATS, url.searchParams.get('ref'), url.searchParams.get('kind')).catch(() => null);
  const object = kept && await env.FEEDBACK_FILES.get(kept.key);
  if (!object) return new Response('Not found', {status: 404, headers: {'Cache-Control': 'no-store'}});
  return new Response(object.body, {headers: {'Content-Type': kept.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"}});
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Feedback · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px 48px}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:16px}
h1{margin:0;font-size:24px}a{color:var(--amber)}.muted{color:var(--muted)}.live{font-size:13px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:6px}
.live.on .dot{background:var(--green);animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.35}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.card.fresh{border-color:var(--amber)}.meta{font-size:12px;color:var(--muted);margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap}
.warn{color:var(--amber);font-weight:700}.shot{display:block;max-width:240px;max-height:160px;border:1px solid var(--line);border-radius:8px;margin-top:10px}
.files{margin-top:10px;font-size:13px}.logs{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 ui-monospace,monospace;max-height:420px;overflow:auto;background:#0b0d10;border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:6px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}.reply{margin-top:8px;font-size:13px}.badge{color:var(--amber);font-weight:700}
</style></head><body><main>
<header><h1>💬 Feedback</h1><span class="muted"><span class="live" id="live"><span class="dot"></span><span id="state">connecting…</span></span></span></header>
<p class="warn" id="alert" hidden></p>
<div id="list"><p class="muted">Loading…</p></div>
<script>
const list = document.getElementById('list'), state = document.getElementById('state'), live = document.getElementById('live');
let known = null;
const make = (row, fresh) => {
  const card = document.createElement('div'), meta = document.createElement('div'), text = document.createElement('div');
  card.className = 'card' + (fresh ? ' fresh' : ''); meta.className = 'meta'; text.className = 'text';
  const parts = [String(row.at).slice(0, 16).replace('T', ' ') + ' UTC', row.version + ' · ' + row.platform, 'install ' + String(row.install).slice(0, 8)];
  if (fresh) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'NEW'; meta.append(b); }
  for (const part of parts) { const s = document.createElement('span'); s.textContent = part; meta.append(s); }
  text.textContent = row.text;
  card.append(meta, text);
  card.id = row.ref || '';
  if (row.notified === 'sent') { /* delivered: nothing to say */ } else if (row.notified) {
    const flag = document.createElement('div'); flag.className = 'warn reply';
    flag.textContent = row.notified === 'off' ? '⚠ Telegram is not set up: you were not told about this one.' : '⚠ Not delivered to Telegram (' + row.notified.replace(/^failed: /, '') + ')';
    card.append(flag);
  }
  if (row.ref && row.shot) {
    const link = document.createElement('a'), img = document.createElement('img'), href = '/admin/growth/feedback/file?ref=' + encodeURIComponent(row.ref) + '&kind=screen';
    link.href = href; link.target = '_blank'; link.rel = 'noopener'; img.className = 'shot'; img.alt = 'Screenshot of the app window'; img.loading = 'lazy'; img.src = href; link.append(img); card.append(link);
  }
  if (row.ref && row.logs) {
    const files = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    files.className = 'files'; summary.textContent = 'Logs'; pre.className = 'logs'; files.append(summary, pre);
    files.addEventListener('toggle', async () => {
      if (!files.open || pre.dataset.loaded) return;
      pre.textContent = 'Loading…';
      try { const r = await fetch('/admin/growth/feedback/file?ref=' + encodeURIComponent(row.ref) + '&kind=logs', {cache: 'no-store'}); pre.textContent = r.ok ? await r.text() : 'Gone (kept 90 days).'; pre.dataset.loaded = '1'; }
      catch (error) { pre.textContent = 'Could not load the logs.'; }
    });
    card.append(files);
  }
  if (row.contact) { const reply = document.createElement('div'); reply.className = 'reply'; reply.textContent = '↩︎ ' + row.contact; card.append(reply); }
  return card;
};
const cards = new Map();   // one card per message, kept across polls: an open Logs viewer and a loaded screenshot stay as they are
async function refresh() {
  try {
    const response = await fetch('?json=1', {cache: 'no-store'});
    if (!response.ok) throw new Error(response.status);
    const {rows, undelivered} = await response.json();
    const alert = document.getElementById('alert'); alert.hidden = !undelivered; alert.textContent = '⚠ ' + undelivered + ' feedback message' + (undelivered === 1 ? '' : 's') + ' did not reach your Telegram.';
    const firstLoad = known === null, seen = new Set(known || []);
    const keyOf = row => row.at + row.install;
    list.replaceChildren(...(rows.length ? rows.map(row => { if (!cards.has(keyOf(row))) cards.set(keyOf(row), make(row, known && !seen.has(keyOf(row)))); return cards.get(keyOf(row)); }) : [Object.assign(document.createElement('p'), {className: 'muted', textContent: 'No feedback yet.'})]));
    known = rows.map(keyOf);
    if (firstLoad && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    state.textContent = 'live · ' + rows.length + ' message' + (rows.length === 1 ? '' : 's') + ' · updated ' + new Date().toLocaleTimeString();
    live.classList.add('on');
  } catch (error) { state.textContent = 'offline, retrying…'; live.classList.remove('on'); }
}
// Every 60 s while the tab is visible, and once when it becomes visible again (a timer that ignored a hidden tab kept reading D1 all night: 11 Oct 2026, test/poll-timers.test.js).
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
</script></main></body></html>`;
