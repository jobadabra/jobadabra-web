// /admin/testing/pr-checks: do our PR checks catch real bugs, and how long do they make us wait? The monthly scorecard (tools/pr-check-scorecard.mjs, pr-check-scorecard.yml) PUTs one card a month
// to /pr-checks/data (Bearer SELFHEAL_PUBLISH_KEY, like the Build log); the page draws the latest month per check plus the catches of the months before. No AI. Guard: test/unit/admin/pr-checks.test.js.
import {viewer} from '../shared/auth.js';
import {equal} from '../shared/guard.js';
import {esc} from '../shared/html.js';
import {remember} from '../shared/auth.js';
import {VIZ_STYLE, VIZ_TOOLTIP, bars, figure, stacks} from './viz.js';

const SHOWN = 6;
const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const count = value => Math.max(0, Math.round(Number(value) || 0));
const minutes = value => Math.max(0, Math.round((Number(value) || 0) * 10) / 10);

// The card from CI -> the same shape with every string cut and every number a number, or null when it is not one.
export function cleanCard(card) {
  if (!card || !Array.isArray(card.checks) || !card.checks.length || card.checks.length > 80) return null;
  const checks = card.checks.map(check => ({name: String(check?.name ?? '').slice(0, 120), runs: count(check?.runs), reds: count(check?.reds), realCatches: count(check?.realCatches),
    falseReds: count(check?.falseReds), medianMin: minutes(check?.medianMin), p90Min: minutes(check?.p90Min), addedMin: minutes(check?.addedMin), verdict: check?.verdict === 'proven' ? 'proven' : 'review'}));
  return checks.every(check => check.name) ? {days: count(card.days) || 30, checks} : null;
}

export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  if (request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 100000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  const card = cleanCard(data);
  if (!card) return new Response('Unexpected shape', {status: 400});
  await env.STATS.prepare(`INSERT INTO pr_check_months (month, card, updated_at) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET card = excluded.card, updated_at = excluded.updated_at`)
    .bind(now.toISOString().slice(0, 7), JSON.stringify(card), now.toISOString()).run();
  return json({ok: true});
}

/** The newest monthly scorecard {month, days, checks}, or null (the Testing Overview reads each check's real catches). */
export async function latestCard(db) {
  try { const row = db ? await db.prepare('SELECT month, card FROM pr_check_months ORDER BY month DESC LIMIT 1').first() : null; return row ? {month: row.month, ...JSON.parse(row.card)} : null; } catch { return null; }
}

// ---- the page ----
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthWords = month => `${MONTHS[Number(month.slice(5, 7)) - 1] || month.slice(5, 7)} ${month.slice(0, 4)}`;
const pill = verdict => verdict === 'proven' ? '<span class="pill" style="background:#7bd88f">🟢 proven</span>' : '<span class="pill" style="background:#f2c14e">🟡 review</span>';

/** The verdict as chips: how many checks proved themselves, how many are flagged for review. */
function verdictLead(checks) {
  const proven = checks.filter(check => check.verdict === 'proven').length, review = checks.length - proven;
  return [[`🟢 ${proven} proven`, 'good'], ...(review ? [[`🟡 ${review} to review`, 'warn']] : [])];
}

/** Per check one stacked bar of its red runs (real catches against false reds), then how long each makes us wait (p90 as a bar). Why (owner, 5 Nov 2026, sketch: "split: real catches | false reds per check, p90 as a bar, verdict chip"). */
function checksChart(checks) {
  const rows = checks.map(check => ({label: check.name, text: check.verdict === 'proven' ? '🟢 proven' : '🟡 review', sub: `${check.realCatches} catches · ${check.falseReds} false`,
    parts: [{value: check.realCatches, tone: 'good'}, {value: check.falseReds, tone: 'bad'}],
    tip: `${check.name} · ${check.runs} runs · real catches ${check.realCatches} · false reds ${check.falseReds} · p90 ${check.p90Min} min · adds ${check.addedMin} min to the wait`}));
  const waits = bars(checks.slice().sort((a, b) => b.p90Min - a.p90Min).map(check => ({label: check.name, value: check.p90Min, text: `p90 ${check.p90Min} min`, tip: `${check.name} · p90 ${check.p90Min} min · median ${check.medianMin} min · adds ${check.addedMin} min`})));
  return `${stacks(rows, [['good', 'real catches'], ['bad', 'false reds']])}<p class="muted vz-cap2">How long each check makes us wait (p90)</p>${waits}`;
}

// rows: [{month, card: JSON string}] newest first.
export function page(rows) {
  const months = rows.map(row => ({month: row.month, card: JSON.parse(row.card)}));
  const [latest, ...before] = months;
  const catchesIn = (card, name) => card.checks.find(check => check.name === name)?.realCatches;
  const trend = name => before.map(item => `${esc(monthWords(item.month).split(' ')[0])} ${catchesIn(item.card, name) ?? '–'}`).join(' · ') || '<span class="muted">first month</span>';
  const body = latest ? `<section class="card"><h2>${esc(monthWords(latest.month))} <span class="muted">· the last ${latest.card.days} days</span></h2>
${figure({lead: verdictLead(latest.card.checks), chart: checksChart(latest.card.checks), table: `<table><thead><tr><th>Check</th><th>Runs</th><th>Real catches</th><th>False reds</th><th>p90 min</th><th>Adds to wait</th><th>Verdict</th><th>Catches, earlier months</th></tr></thead><tbody>
${latest.card.checks.map(check => `<tr><td>${esc(check.name)}</td><td>${check.runs}</td><td>${check.realCatches}</td><td>${check.falseReds}</td><td>${check.p90Min}</td><td>${check.addedMin} min</td><td>${pill(check.verdict)}</td><td class="muted">${trend(check.name)}</td></tr>`).join('')}
</tbody></table>`})}<p class="muted">Real catch = red, then green after a later commit that changed product files (not tests or docs). False red = red then green on the same commit (flaky), or a failing setup step. A check with 0 catches is flagged 🟡 for review.</p></section>`
    : `<section class="card"><h2>No scorecard yet</h2><p class="muted">The workflow <code>pr-check-scorecard.yml</code> posts it on the 1st of each month (or by hand); the first run fills this page.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>PR checks · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.card table{width:100%;border-collapse:collapse}.card th,.card td{text-align:left;padding:6px 10px;border-bottom:1px solid #2a2f37;font-size:14px}.card td:nth-child(n+2):nth-child(-n+6){font-variant-numeric:tabular-nums}
${VIZ_STYLE}.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#0b0d10;white-space:nowrap}</style></head><body><main>
<header><h1>✅ PR checks</h1><span class="muted">monthly · per check, over 30 days</span></header>
${body}${VIZ_TOOLTIP}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let rows = [];
  try { rows = env.STATS ? (await env.STATS.prepare('SELECT month, card FROM pr_check_months ORDER BY month DESC LIMIT ?').bind(SHOWN).all()).results || [] : []; } catch { rows = []; }
  return new Response(page(rows), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
