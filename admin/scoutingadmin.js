// The owner's /admin/job-search/scouting page: which employers the central scout finds and keeps, from shared/scouting-snapshot.js. Same key or cookie as /admin.
// Guarded by test/unit/shared/scoutingadmin.test.js.
import {FAMILIES, familyLinks, familyParam} from '../shared/engines.js';
import {viewer} from '../shared/auth.js';
import {section as nightly} from '../shared/scouting.js';
import {section as closedSites} from './closed-sites.js';
import {section as botChecks} from './bot-checks.js';
import {EUROPE} from '../shared/pool-tags.js';
import {CHART_STYLE, TOOLTIP} from '../shared/scoutingcharts.js';
import {floorFor, cellsOf, gaps, heatmap, history, runs, sources, tiles, topKind, trends} from '../shared/scoutingvisual.js';
import {section as readMethods} from '../shared/readmethods.js';
import {day, snapshot, gather} from '../shared/scouting-snapshot.js';
import {chip} from './chip.js';
import {employerKindChart, familyChart, freshnessChart, usefulChart} from './jobsearch-charts.js';
import {figure, VIZ_STYLE} from './viz.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
export const n = value => Number(value || 0).toLocaleString('en-US');
const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '—');
const rows = (list, cells, empty) => list.length ? list.map(item => `<tr>${cells(item).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
  : `<tr><td colspan="9" class="muted">${esc(empty)}</td></tr>`;
// What installs shared, per AI family (Claude = Claude Code or an Anthropic key; OpenAI = Codex or an OpenAI key).
function familySection(families) {
  if (!families) return '';
  const row = (key, label) => `<tr><td>${label}</td><td>${n(families[key].sharing7)}</td><td>${n(families[key].shared)}</td><td>${n(families[key].dead)}</td><td>${n(families[key].boardsMatched)}</td></tr>`;
  return `<section class="card"><h2>🤖 Shared by installs, per AI family</h2><small class="muted">From each install's latest health report. Unknown = shared before 9 Oct 2026, or no health report yet. The central scout and the published list are everyone's.</small>
${figure({chart: familyChart(families), table: `<table><tr><th>Family</th><th>Installs sharing (7 d)</th><th>Employer job sites shared</th><th>Dead ends reported</th><th>Board reads with matches</th></tr>
${row('claude', 'Claude')}${row('openai', 'OpenAI')}${row('unknown', 'Unknown')}</table>`})}</section>`;
}

// Steps installs skipped because another install had already done them (src/pool_served.py, shared daily): today, 7 days, 30 days, per kind.
export function servedSection(served = [], today = new Date()) {
  const kinds = [...new Set(served.map(r => r.kind))].sort(), within = (kind, back) => served.filter(r => r.kind === kind && r.day >= day(today, back)).reduce((sum, r) => sum + r.n, 0);
  const body = kinds.map(kind => `<tr><td>${chip(esc(kind))}</td><td>${n(within(kind, 0))}</td><td>${n(within(kind, 7))}</td><td>${n(within(kind, 30))}</td></tr>`).join('');
  return `<section class="card"><h2>♻️ Steps skipped thanks to other installs</h2><small class="muted">Work an install did not repeat because the pool already had the answer (e.g. a place another install placed). Counts per fixed kind, from the daily share.</small>
<table><tr><th>Kind</th><th>Today</th><th>7 days</th><th>30 days</th></tr>${body || '<tr><td colspan="4">Nothing reported yet.</td></tr>'}</table></section>`;
}

// A section folded away under its title: the numbers stay one click from the charts (owner, 19 Oct 2026: "too much of raw numbers/text/tables").
const fold = (title, html) => `<details class="fold"><summary>${title}</summary>${html}</details>`;

export function page(data, url = new URL('https://www.jobadabra.top/admin/job-search/scouting'), today = new Date()) {
  const {feeds} = data;
  const nonIt = feeds.filter(feed => !['software', 'unknown'].includes(topKind(feed))).length;
  const past = history(data.daily, today);
  const growth = past.week ? feeds.length - past.week.feeds : null;
  const failing = feeds.filter(feed => (feed.fresh?.fails || 0) >= 3);
  const up = feeds.filter(feed => feed.fresh?.trend === 'up').length, down = feeds.filter(feed => feed.fresh?.trend === 'down').length;
  const emptyNow = feeds.filter(feed => feed.fresh && !feed.fresh.jobs).length;
  // Coverage: feeds by the kind they mostly hire for, and by region.
  const kinds = {}, grid = {};
  for (const feed of feeds) {
    const kind = topKind(feed);
    kinds[kind] = (kinds[kind] || 0) + 1;
    for (const region of feed.regions?.length ? feed.regions : ['unknown']) grid[`${kind}|${region}`] = (grid[`${kind}|${region}`] || 0) + 1;
  }
  const regions = [...new Set(Object.keys(grid).map(key => key.split('|')[1]))].sort();
  // And by European country (where its jobs are, src/scout_index.py countries): a kind under its country's floor in a country is a gap the scout
  // aims at (owner, 19 Oct 2026: "Scout where the list is thin", every industry in every European country).
  const cells = cellsOf(feeds);
  const byCountry = Object.fromEntries(Object.entries(cells).map(([cell, [count]]) => [cell, count]));
  const thin = (kind, country) => !['other', 'unknown'].includes(kind) && (byCountry[`${kind}|${country}`] || 0) < floorFor(country);
  const verdict = !feeds.length ? 'No employer list published yet: the central scout publishes every 6 hours.'
    : `${n(feeds.length)} employers in the central list${growth == null ? '' : `, ${growth >= 0 ? '+' : ''}${n(growth)} this week`}; `
      + `${n(data.sharing7)} install${data.sharing7 === 1 ? '' : 's'} sharing this week; ${pct(nonIt, feeds.length)} hire mostly outside IT.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Scouting · Admin</title><link rel="icon" href="/favicon-32.png">
<style>.card{padding:16px;margin-bottom:12px;min-width:0}td{padding:7px 4px;vertical-align:top;overflow-wrap:anywhere}th{padding:6px 4px}
.verdict{background:#1d1a12;border:1px solid #5a4620;border-radius:14px;padding:14px 16px;margin-bottom:12px}
.scroll{overflow-x:auto}.countries td,.countries th{text-align:right;font-variant-numeric:tabular-nums;padding:6px 5px}.countries td:first-child,.countries th:first-child{text-align:left}.thin{color:#ef8a8a}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start}.grid2>.card{margin-bottom:0}.grid2{margin-bottom:12px}
h2.more{margin:22px 0 8px;color:#8d949c;font-weight:600}${CHART_STYLE}${VIZ_STYLE}
</style></head><body><main>
<header><div><h1>🛰️ Scouting</h1><small class="muted">The central employer list: counts, company names and job-site addresses only. <a href="/admin/growth/insights">Insights →</a>${data.family ? ` · what ${esc(FAMILIES[data.family])} installs shared` : ''}</small></div></header>
${familyLinks(url, data.family || '')}
<div class="verdict">${esc(verdict)}</div>
${tiles(data, cells, past)}
${heatmap(cells, past, data.demand || {}, data.central?.ideas_cell || '')}
${gaps(cells, data.demand || {})}
${trends(cells, past)}
${sources(data.central)}
${runs(data.central)}
${readMethods(data.reads)}
<h2 class="more">The numbers behind the charts</h2>
${fold('🇪🇺 Coverage by kind of role and country (table)', `<section class="card"><small class="muted">European employers by the kind they mostly hire for and the countries their jobs are in. Red: under the country's floor (25 big markets, 10 mid-size, 5 small), a gap the scout aims at next.</small>
<div class="scroll"><table class="countries"><tr><th>Kind</th>${EUROPE.map(country => `<th>${country.toUpperCase()}</th>`).join('')}</tr>
${rows(Object.entries(kinds).sort((a, b) => b[1] - a[1]), ([kind]) => [esc(kind), ...EUROPE.map(country => `<span class="${thin(kind, country) ? 'thin' : ''}">${n(byCountry[`${kind}|${country}`])}</span>`)], 'No employers yet.')}</table></div></section>`)}
${fold('📈 Growth (daily snapshots)', `<section class="card"><small class="muted">One snapshot a day, when the central scout publishes.</small>
<table><tr><th>Day</th><th>Employers</th><th>Outside IT</th><th>Failing</th><th>From installs</th><th>Dead ends</th></tr>
${rows(data.daily, row => [esc(row.day), n(row.feeds), n(row.non_it), n(row.failing), n(row.from_pool), n(row.dead_ends)], 'No snapshot yet: the first comes with the next publish.')}</table></section>`)}
${fold('🗺️ Coverage by kind of role and region', `<section class="card"><small class="muted">Employers by the kind they mostly hire for (their role mix) and region.</small>
${figure({chart: employerKindChart(kinds, grid, regions), table: `<div class="scroll"><table><tr><th>Kind</th><th>All</th>${regions.map(region => `<th>${esc(region)}</th>`).join('')}</tr>
${rows(Object.entries(kinds).sort((a, b) => b[1] - a[1]), ([kind, count]) => [esc(kind), n(count), ...regions.map(region => n(grid[`${kind}|${region}`]))], 'No employers yet.')}</table></div>`})}</section>`)}
${fold('🤝 The pool and discovery routes', `<div class="grid2"><section class="card"><small class="muted">What installs share (on unless switched off): every employer their scout verified and every feed and board their jobs check read, as it happens.</small>
<table><tr><td>Installs sharing, last 7 days</td><td>${n(data.sharing7)}</td></tr><tr><td>Installs sharing, last 30 days</td><td>${n(data.sharing30)}</td></tr>
<tr><td>Different employers shared (90 days)</td><td>${n(data.shared)}</td></tr></table></section>
<section class="card"><h2>🧭 Discovery routes that work</h2><small class="muted">How installs found the employers they share, and the jobs those matched for someone.</small>
<table><tr><th>Route</th><th>Employers</th><th>Jobs matched</th></tr>${rows(data.routes, row => [esc(row.how), n(row.feeds), n(row.hits)], 'Nothing shared with a route yet (share v2).')}</table></section></div>
${familySection(data.families)}${servedSection(data.served, today)}`)}
${fold(`🩺 Freshness and most useful employers · ${n(failing.length)} failing`, `<div class="grid2"><section class="card"><small class="muted">From each employer's last reads (the central scout).</small>
${figure({chart: feeds.length ? freshnessChart([['Growing (more jobs than last read)', up], ['Shrinking', down], ['No open job right now', emptyNow], ['Failing (3+ reads in a row)', failing.length]]) : '', table: `<table><tr><td>Growing (more jobs than last read)</td><td>${n(up)}</td></tr><tr><td>Shrinking</td><td>${n(down)}</td></tr>
<tr><td>No open job right now</td><td>${n(emptyNow)}</td></tr><tr><td>Failing (3+ reads in a row)</td><td>${n(failing.length)}</td></tr></table>`})}
<table><tr><th>Failing</th><th>Reads failed</th><th>Last OK</th></tr>${rows(failing.slice(0, 10), feed => [esc(feed.company), n(feed.fresh.fails), esc(feed.fresh.ok)], 'None failing.')}</table></section>
<section class="card"><h2>⭐ Most useful employers</h2><small class="muted">Most interviews, then jobs matched, across installs (last 90 days).</small>
${figure({chart: usefulChart(data.useful || []), table: `<table><tr><th>Employer</th><th>Interviews</th><th>Applied</th><th>Matched</th><th>Installs</th><th>Jobs</th></tr>${rows(data.useful, row => [esc(row.company), n(row.interviews), n(row.applied), n(row.hits), n(row.installs), n(row.jobs)], 'Nothing shared yet.')}</table>`})}</section></div>`)}
${fold('📋 Job boards by kind of role', `<section class="card"><small class="muted">Each board installs' jobs checks read, by their kind of role: how many got a match there.</small>
<div class="scroll"><table><tr><th>Board</th><th>Kind of role</th><th>Installs</th><th>Got a match</th><th>Jobs matched</th><th>Only on this board</th><th>Interviews</th><th>Failed</th></tr>${rows(data.boards || [], row => [esc(row.board), esc(row.roles || '—'), n(row.installs), n(row.matched), n(row.hits), n(Math.max(0, (row.hits || 0) - (row.dup || 0))), n(row.interviews), n(row.failed)], 'No board reads shared yet.')}</table></div></section>`)}
${fold('🧑‍🏫 Advice shown → taken', `<section class="card"><small class="muted">What the app recommended (Strategy cards, "Few new jobs" chips) and how often people took it, last 90 days.</small>
<table><tr><th>Advice</th><th>Where</th><th>Shown</th><th>Taken</th><th>Dismissed</th><th>Installs</th></tr>${rows(data.advice || [], row => [esc(row.advice), esc(row.place), n(row.shown), n(row.taken), n(row.dismissed), n(row.installs)], 'No advice reported yet.')}</table></section>`)}
${closedSites(data.closed, today)}
${botChecks(data.botChecks)}
${fold(`🕳️ Dead ends · ${n(data.deadTotal)}`, `<section class="card"><small class="muted">Employers installs found with no readable job site: skipped for 30 days by everyone.</small>
<table><tr><th>Employer</th><th>Website</th><th>Installs</th><th>Last</th></tr>${rows(data.dead, row => [esc(row.company), esc(row.host || ''), n(row.installs), esc(row.last)], 'None reported yet.')}</table></section>`)}
${fold('🧭 The central scout\'s own numbers', nightly(data.central))}
</main>${TOOLTIP}</body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  return new Response(page(await gather(env.STATS, new Date(), familyParam(url)), url), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
