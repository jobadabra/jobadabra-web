// /admin/testing/red-main: the main e2e suites that are red now, since which commit, the breaking PR and the bisect that found it. Kept in ci_state `red-main` (admin/ci-state.js),
// replaced by CI (tools/e2e_bisect.py, public repo) and read by every session's PR check (GET /ci-state/red-main, public: suite names, PR numbers and SHAs only).
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): this was one GitHub issue per red suite, "Red main: <suite>".
import {viewer} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {readState} from './ci-state.js';

const STATUS = {bisecting: ['warn', '◐ bisecting'], found: ['bad', '✖ red'], 'not-found': ['bad', '✖ red, PR not found']};
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : null);
const short = sha => esc(String(sha || '').slice(0, 7));
const PR_URL = 'https://github.com/jobadabra/jobadabra/pull/';
const hoursSince = (at, now) => { const ms = now - Date.parse(at || ''); return Number.isFinite(ms) ? (ms < 86400000 * 2 ? `${Math.max(1, Math.round(ms / 3600000))} h` : `${Math.round(ms / 86400000)} d`) : '?'; };

function row(red, now) {
  const [tone, label] = own(STATUS, red.status) || STATUS.bisecting;
  const pr = red.pr && Number.isInteger(red.pr.number) ? `<a href="${PR_URL}${red.pr.number}">#${red.pr.number}</a> <code>${esc(red.pr.branch)}</code><div class="muted">${esc(String(red.pr.title || '').slice(0, 100))}</div>` : '<span class="muted">not found yet</span>';
  const trail = Array.isArray(red.tested) && red.tested.length ? `green at ${short(red.good)}; ${red.tested.map(([sha, result]) => `${short(sha)} ${esc(result || 'unknown')}`).join(', ')}` : red.good ? `green at ${short(red.good)}` : '';
  return `<tr><td><code>${esc(red.suite)}</code></td><td>${chip(esc(label), tone)}</td><td>${short(red.since)}<div class="muted">${esc(hoursSince(red.sinceAt, now))} ago${/^https:\/\/github\.com\//.test(String(red.run)) ? ` · <a href="${esc(red.run)}">run</a>` : ''}</div></td><td>${pr}</td><td class="muted">${trail || '–'}</td></tr>`;
}

/** The page from the stored list (null: never written). `now` is epoch ms. */
export function page(state, now = Date.now()) {
  const reds = Array.isArray(state?.reds) ? state.reds : [];
  const verdict = !state ? `<p>${chip('no data yet', 'off')} CI writes this list after each main e2e check.</p>`
    : reds.length ? `<p>${chip(`✖ ${reds.length} red`, 'bad')} Main's e2e is red: <b>tools/beta-release.sh refuses a beta</b> while a safety or data step is among them. Fix the breaking PR now (skill fix-failing-e2e).</p>`
      : `<p>${chip('✔ main is green', 'good')} No e2e suite is red on main.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Red main · Admin</title><link rel="icon" href="/favicon-32.png">
<style>${CHIP_STYLE}:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px}.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}td{padding:6px 4px;border-top:1px solid var(--line);vertical-align:top}</style></head><body><main>
<header><h1>🚨 Red main</h1><span class="muted">${state?.at ? `updated ${esc(String(state.at).slice(0, 16).replace('T', ' '))} UTC` : 'no data yet'}</span></header>
<section class="card">${verdict}</section>
${reds.length ? `<section class="card"><h2>Red suites</h2><div class="wrap"><table><tr><th>Suite</th><th>State</th><th>Red since</th><th>Breaking PR</th><th>Bisect</th></tr>${reds.map(red => row(red, now)).join('')}</table></div></section>` : ''}
</main></body></html>`;
}

/** GET /admin/testing/red-main (admins and the owner read it). */
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  return new Response(page(await readState(env, 'red-main', null), now.getTime()), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
