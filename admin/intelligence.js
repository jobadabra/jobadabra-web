// The owner's /admin/growth/insights page: what the installs teach about the job search, from shared/intelligence.js. Same key or cookie as /admin.
// Guarded by test/unit/shared/intelligence.test.js.
import {filterLinks, trendChip} from './admin.js';
import {viewer} from '../shared/auth.js';
import {insightTrends} from './trends.js';
import {stepCostChart} from './email-charts.js';
import {figure, VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';
const chip = (data, key) => (data.trends?.[key] ? trendChip(data.trends[key].label, data.trends[key].values, data.trends[key]) : '');   // its weeks (admin/trends.js)
import {REASONS, MIN_PEOPLE, REASON_TEXT, day, pct, store, hints, report} from '../shared/intelligence.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

export function page(data) {
  const dismissTotals = REASONS.map(reason => [reason, data.dismiss.filter(row => row.reason === reason).reduce((sum, row) => sum + row.n, 0)]).filter(([, n]) => n);
  const dismissAll = dismissTotals.reduce((sum, [, n]) => sum + n, 0);
  const range = filterLinks([7, 30, 90].map(n => [n, `${n} days`, `?days=${n}`]), data.days);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Insights · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--red:#e5776b;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0 0 6px;font-size:15px}a{color:var(--amber)}.muted{color:var(--muted)}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px;min-width:0}
table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 4px}
td{padding:8px 4px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.bar{height:8px;border-radius:99px;background:var(--amber);min-width:2px}
${VIZ_STYLE}</style></head><body><main>
<header><div><h1>🧠 Insights</h1><small class="muted">Counts only, by coarse tags: no job title, company or text. A role word is named only once ${MIN_PEOPLE}+ people chose it.</small></div>
<div class="muted">Last ${range} · <a href="/intelligence">Public page</a></div></header>
<section class="card"><h2>🔎 Is the search too narrow?${chip(data, 'coverage')}</h2><small class="muted">Share of postings in people's wanted places that their role keywords catch (reports from each crawl), by role and region.</small>
<table><tr><th>Role</th><th>Region</th><th>Reports</th><th>Keywords catch</th></tr>
${data.coverage.map(row => `<tr><td>${esc(row.role)}</td><td>${esc(row.region)}</td><td>${row.reports}</td><td>${pct(row.share)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No crawl reports yet.</td></tr>'}</table>
<table><tr><th>Role word the keywords miss</th><th>Postings per report</th><th>Reports</th></tr>
${data.missed.map(row => `<tr><td>${esc(row.term)}</td><td>${row.perReport}</td><td>${row.reports}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</table></section>
<section class="card"><h2>➕ Role words people accept${chip(data, 'terms')}</h2><small class="muted">From the card's one-click add. This becomes the starter keyword pack for new searches.</small>
<table><tr><th>Word</th><th>People</th><th>Role / region</th></tr>
${data.terms.map(row => `<tr><td>${esc(row.term)}</td><td><b>${row.n}</b></td><td class="muted">${esc(row.where.slice(0, 4).join(' · '))}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">No word chosen by ${MIN_PEOPLE}+ people yet${data.hiddenTerms ? ` (${data.hiddenTerms} chosen by fewer)` : ''}.</td></tr>`}</table></section>
<section class="card"><h2>🙅 Why jobs are dismissed${chip(data, 'dismiss')}</h2><small class="muted">${data.hints.length ? `Shipped to apps as scoring hints: ${esc(data.hints.map(h => `${h.reason} ${Math.round(h.share * 100)}%`).join(', '))}.` : 'No scoring hint shipped yet (needs 50+ dismissals, a reason at 30%+).'}</small><br><small class="muted">The one-tap reason after Dismiss. If most reasons are "seniority", the filters or the extraction need work.</small>
<table>${dismissTotals.map(([reason, n]) => `<tr><td style="width:110px">${esc(reason)}</td><td><div class="bar" style="width:${Math.round(n / dismissAll * 100)}%"></div></td><td style="width:80px"><b>${n}</b> · ${Math.round(n / dismissAll * 100)}%</td></tr>`).join('') || '<tr><td class="muted">No reasons yet.</td></tr>'}</table></section>
<section class="card"><h2>🎯 Does the score predict action?${chip(data, 'scores')}</h2><small class="muted">Per fit-score band: the share of jobs that were acted on (saved, applied or past it), dismissed, or reached a call or interview. If the 80+ band is not clearly better than 60–79, the scoring rubric needs fixing.</small>
<table><tr><th>Score band</th><th>Jobs seen</th><th>Acted on</th><th>Dismissed</th><th>Reached a call / interview</th></tr>
${data.scores.map(row => `<tr><td>${esc(row.bucket)}</td><td>${row.total}</td><td>${pct(row.acted)}</td><td>${pct(row.dismissed)}</td><td>${pct(row.interviewed)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No snapshots yet.</td></tr>'}</table></section>
<section class="card"><h2>📬 Do higher scores get replies?${chip(data, 'replies')}</h2><small class="muted">Of the applications people marked, the share that got a reply, a call or an offer, per fit-score band (shown from 20 outcomes). Calibrates the scoring.</small>
<p><b>${data.calibration.status === 'ok' ? '✅' : data.calibration.status === 'thin' ? '⏳' : '⚠️'} ${esc(data.calibration.note)}</b></p>
<table><tr><th>Score band</th><th>Outcomes marked</th><th>Reply or better</th></tr>
${data.replies.map(row => `<tr><td>${esc(row.bucket)}</td><td>${row.total}</td><td>${pct(row.rate)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No marked outcomes yet.</td></tr>'}</table></section>
<section class="card"><h2>🧭 Which sources give useful jobs?${chip(data, 'sources')}</h2><small class="muted">Per source kind (job systems, job boards, aggregators): the share of jobs scored 70+, acted on or dismissed, how many acted ones got a call, and how many hours after posting the jobs were found. "other" is every company site.</small>
<table><tr><th>Source</th><th>Jobs seen</th><th>Scored 70+</th><th>Acted on</th><th>Dismissed</th><th>Heard back (of acted)</th><th>Hours posted → found</th></tr>
${data.sources.map(row => `<tr><td>${esc(row.board)}</td><td>${row.seen}</td><td>${pct(row.goodShare)}</td><td>${pct(row.actedShare)}</td><td>${pct(row.dismissedShare)}</td><td>${pct(row.heardShare)}</td><td>${row.hours == null ? '—' : Math.round(row.hours)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No snapshots yet.</td></tr>'}</table></section>
<section class="card"><h2>🛰️ Scouting</h2><small class="muted">The central employer list (its growth, the pool, coverage, freshness) has its own page: <a href="/admin/job-search/scouting">Scouting →</a></small></section>
<section class="card"><h2>✏️ Answers people change${chip(data, 'fixes')}</h2><small class="muted">Questions the filler answered that the person then edited by hand, once ${MIN_PEOPLE}+ people and 10+ fills have reported them. The top of this list is where the alias or profile mapping is wrong.</small>
<table><tr><th>Question wording</th><th>Filled</th><th>Changed by hand</th></tr>
${data.fixes.map(row => `<tr><td>${esc(row.label)}</td><td>${row.filled}</td><td><b>${pct(row.rate)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing reported by enough people yet.</td></tr>'}</table></section>
<section class="card"><h2>🕳️ Why fields stay empty${chip(data, 'empty')}</h2><small class="muted">Fields the filler left empty, by reason (all boards). "No answer" means the profile has nothing for it; "not taken" means the field refused the value; "real click" and "no option" are dropdowns.</small>
<table><tr><th>Reason</th><th>Fields</th><th>Share</th></tr>
${data.reasons.map(row => `<tr><td>${esc(REASON_TEXT[row.reason] || row.reason)}</td><td>${row.n}</td><td>${pct(row.share)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing reported yet.</td></tr>'}</table></section>
<section class="card"><h2>💸 What the AI costs us${chip(data, 'cost')}</h2><small class="muted">Included AI through the relay (founder and friend keys today, Pro later): money per step and per user per active day. This is what a pass price and a credit budget must cover.</small>
<table><tr><th>Users</th><th>Total</th><th>Per user per active day</th><th>Median · 95th · max</th><th>Per user per month</th></tr>
<tr><td>${data.cost.users}</td><td>$${data.cost.total.toFixed(2)}</td><td>$${data.cost.perUserDay.mean.toFixed(3)}</td><td>$${data.cost.perUserDay.median.toFixed(3)} · $${data.cost.perUserDay.p95.toFixed(3)} · $${data.cost.perUserDay.max.toFixed(3)}</td><td><b>$${data.cost.monthPerActiveUser.toFixed(2)}</b></td></tr></table>
${figure({chart: stepCostChart(data.cost.steps), table: `<table><tr><th>Step</th><th>Calls</th><th>Cost</th><th>Per call</th></tr>
${data.cost.steps.map(row => `<tr><td>${esc(row.action)}</td><td>${row.calls}</td><td>$${row.usd.toFixed(3)}</td><td>$${row.perCall.toFixed(4)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No relay calls yet. Steps are labelled by the app, so an older app shows as "other".</td></tr>'}</table>`})}</section>
</main>${VIZ_TOOLTIP}</body></html>`;
}
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const asked = Number(new URL(request.url).searchParams.get('days'));
  const data = await report(env.STATS, [7, 30, 90].includes(asked) ? asked : 30, now);
  data.trends = await insightTrends(env.STATS, now).catch(() => null);
  return new Response(page(data), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
