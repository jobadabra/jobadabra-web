// /admin/operations/scheduled: every scheduled CI job we run, in any repo, grouped by area, with its last run and health (owner, 20 Oct 2026), and a Notify column: the switch of the alert that job sends
// (owner, 5 Nov 2026: "a column where I can control the notifications"; the same setting as the row on Operations → Notifications, admin/notify-cells.js). Until 5 Nov the same page filtered to Testing was a tab of its own,
// at its own address; the Area filter does that now, and the Testing area still draws its start-time graph. A collector (jobs/schedules-snapshot.mjs,
// schedules-snapshot.yml, hourly) reads each repo's workflow files and latest runs and sends ONE snapshot (PUT /ops/data?kind=schedules, Bearer SELFHEAL_PUBLISH_KEY); the site keeps it in one row
// (schedules_snapshot) and this page reads that row: no GitHub call and no table scan per page load (D1 free plan). A job that moves to another repo just shows its new repo. No AI.
// Pure parts: shared/schedules-model.js. Guard: test/schedules.test.js.
import {viewer, remember} from '../shared/auth.js';
import {equal} from '../shared/guard.js';
import {esc} from '../shared/html.js';
import {readStartProblem} from '../shared/intel-start.js';
import {startLine} from './intel-start-line.js';
import {filterLinks} from './admin.js';
import {graph, GRAPH_STYLE} from './schedules-graph.js';
import {loadNightlySummary, summaryFor} from './nightly-summary.js';
import {NIGHTLY_STYLE, NIGHTLY_SCRIPT, NIGHTLY_NOSCRIPT, detailHtml, summaryLine, toggleHtml} from './nightly-summary-html.js';
import {NOTIFY_STYLE, jobCell} from './notify-cells.js';
import {readSettings} from '../shared/notify.js';
import {alertsForJob, effective} from '../shared/notify-registry.js';
import {AREAS, areaOf, missed, nextOf, stateOf, whenWords, words, RUN_DOTS} from '../shared/schedules-model.js';

const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const MAX_JOBS = 400;
const text = (value, max) => String(value ?? '').slice(0, max);

// What the collector sent, cut to known fields: {schema: 1, at, repos: [{name, private, ok}], jobs: [{repo, file, name, about, crons, source, manual, disabled, weeklyMin, billedMin, ai, recent: [{at, conclusion, mins, url}]}]}
export function clean(body) {
  if (!Array.isArray(body?.jobs) || body.jobs.length > MAX_JOBS || !/^\d{4}-\d{2}-\d{2}T/.test(body.at || '')) return null;
  const num = value => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : 0);
  return {schema: 1, at: body.at, repos: (body.repos || []).slice(0, 10).map(repo => ({name: text(repo.name, 80), private: Boolean(repo.private), ok: repo.ok !== false})),
    jobs: body.jobs.filter(job => job?.repo && job?.file).map(job => ({repo: text(job.repo, 80), file: text(job.file, 80), name: text(job.name, 120), about: text(job.about, 200), crons: (job.crons || []).slice(0, 8).map(cron => text(cron, 60)),
      source: ['github', 'worker', 'both'].includes(job.source) ? job.source : 'github', manual: Boolean(job.manual), disabled: Boolean(job.disabled), ai: Boolean(job.ai), weeklyMin: num(job.weeklyMin), billedMin: num(job.billedMin),
      recent: (job.recent || []).slice(0, RUN_DOTS).map(run => ({at: text(run.at, 30), conclusion: run.conclusion ? text(run.conclusion, 20) : null, mins: num(run.mins), url: /^https:\/\/github\.com\//.test(run.url || '') ? text(run.url, 200) : ''}))}))};
}
export async function ingest(request, env) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  const raw = await request.text();
  if (raw.length > 600000) return new Response('Too large', {status: 413});
  let body; try { body = JSON.parse(raw); } catch { return new Response('Not JSON', {status: 400}); }
  const snapshot = clean(body);
  if (!snapshot) return new Response('Unexpected shape', {status: 400});
  await env.STATS.prepare('INSERT INTO schedules_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return new Response(JSON.stringify({ok: true, jobs: snapshot.jobs.length}), {headers: {'Content-Type': 'application/json'}});
}
export async function read(env) {
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM schedules_snapshot WHERE id = 1').first() : null; return row ? JSON.parse(row.body) : null; } catch { return null; }
}

// ---- the page ----
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const STATE_IDS = ['all', 'red', 'green', 'off'];
const stamp = (at, now) => whenWords(new Date(at), now);
// Every job with what the page needs: area, state, missed, next start, the schedule in words.
export const decorate = (snapshot, now = new Date()) => (snapshot?.jobs || []).map(job => ({...job, area: areaOf(job.file), state: stateOf(job), missed: missed(job, now), next: nextOf(job.crons, now), schedule: job.crons.map(cron => words(cron, now))}));
export const counts = jobs => ({all: jobs.length, red: jobs.filter(job => job.state === 'red').length, missed: jobs.filter(job => job.missed).length, billed: jobs.reduce((sum, job) => sum + (job.billedMin || 0), 0)});

const dots = job => `<div class="dots" title="oldest to newest">${Array.from({length: RUN_DOTS}, (_, i) => job.recent[RUN_DOTS - 1 - i]).map(run => `<i class="${!run ? 'c' : !run.conclusion ? 'x' : run.conclusion === 'success' ? '' : run.conclusion === 'failure' || run.conclusion === 'timed_out' ? 'r' : 'x'}"></i>`).join('')}</div>`;
const chip = job => (job.state === 'off' ? '<span class="chip o">disabled</span>' : job.state === 'red' ? '<span class="chip r">red</span>' : job.state === 'green' ? '<span class="chip g">green</span>' : '<span class="chip o">no run yet</span>')
  + (job.missed ? ' <span class="chip w">missed a run</span>' : '');
const sourceNote = job => (job.source === 'worker' ? ' · started by the Worker cron' : job.source === 'both' ? ' · Worker cron + GitHub backup' : '');
// Why (2 Nov 2026, owner: "move this to a separate page, or an expanded detailed row, on a full row. Now it's too crowded"): the cell keeps one line and a toggle; the 14-night blocks sit in a full-width row under it.
// Why (#330, Gitar): the id has the repo too; two repos may schedule the same file name, and getElementById would open the first row's detail for both.
const nightCell = (jobs, id) => (jobs.length ? `${summaryLine(jobs)}${toggleHtml(jobs, id)}` : '<span class="muted">–</span>');
const COLUMNS = 9, REPORT_ONLY = '/admin/testing/report-only';
function row(job, now, summary = null, notify = null) {
  const mine = summaryFor(summary, job.file), id = `nd-${`${job.repo}-${job.file}`.replace(/[^a-z0-9]+/gi, '-')}`, last = job.recent.find(run => run.conclusion) || job.recent[0], url = `https://github.com/${esc(job.repo)}/actions/workflows/${esc(job.file)}`;
  return `<tr class="${job.state === 'red' ? 'red' : ''}"><td><b><a href="${url}">${esc(job.name || job.file)}</a></b><div class="muted small">${esc(job.about)}</div></td><td><span class="repo">${esc(job.repo.split('/').pop())}</span></td>
<td>${job.schedule.map(esc).join('<br>')}<div class="muted small">${job.next ? `next ${esc(whenWords(job.next, now))}` : ''}${esc(sourceNote(job))}</div></td>
<td>${chip(job)}<div class="muted small">${last ? `${esc(stamp(last.at, now))}${last.mins ? ` · ${esc(num(last.mins))} min` : ''}` : ''}</div></td><td>${dots(job)}</td><td>${nightCell(mine, id)}</td><td class="num">${num(job.billedMin)}</td>
<td>${job.ai ? '<a href="/admin/ai/costs">ai-cost →</a>' : '<span class="muted">no AI</span>'}</td><td>${jobCell(alertsForJob(job.file, job.repo.split('/').pop()), alert => effective(alert, notify?.settings.get(alert.id)), notify?.back || '/admin/operations/scheduled', Boolean(notify?.canEdit))}</td></tr>${detailHtml(mine, COLUMNS, id, REPORT_ONLY)}`;
}
const STATES = [['all', 'All'], ['red', 'Red'], ['green', 'Green'], ['off', 'Disabled']];
const CSS = `.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:30px;margin:4px 0;font-variant-numeric:tabular-nums}.tile.bad b{color:#e5484d}.tile.warn b{color:#e0a43a}
.filter-rows{margin:6px 0}.wrap{overflow-x:auto}table{min-width:900px}tr.area td{padding-top:16px}tr.red td:first-child{box-shadow:inset 3px 0 0 #e5484d}.repo{font-size:11px;border:1px solid #262c33;border-radius:6px;padding:0 6px;white-space:nowrap}
.dots{display:flex;gap:3px;margin-top:3px}.dots i{width:8px;height:8px;border-radius:50%;background:#3fb68b}.dots i.r{background:#e5484d}.dots i.x{background:#5b626a}.dots i.c{background:none;border:1px solid #5b626a}
.chip{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#0b0d10}.chip.g{background:#3fb68b}.chip.r{background:#e5484d}.chip.o{background:#8d949c}.chip.w{background:#e0a43a}.small{font-size:12px}`;

// notify = {settings, canEdit, back}: the owner's alert settings behind the Notify column (admin/notify-cells.js); without it the column shows the registry's defaults, read only.
// problem: why the Worker could not start schedules-snapshot.yml on its last try (readStartProblem), drawn as the red "collector not starting" line the e2e and integrations pages show.
export function page(snapshot, {repo = 'all', state = 'all', area = 'all', now = new Date(), problem = null, summary = null, notify = null} = {}) {
  const graphOn = area === 'testing';   // Why (5 Nov 2026): the Testing tab of this page went; its start-time graph shows when the Area filter is Testing
  const head = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Scheduled · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CSS}${NIGHTLY_STYLE}${graphOn ? GRAPH_STYLE : ''}${NOTIFY_STYLE}</style>${NIGHTLY_NOSCRIPT}</head><body><main><header><h1>⏰ Scheduled</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · refreshed hourly` : ''}</span></header>${startLine(problem)}${body}</main><script>${NIGHTLY_SCRIPT}</script></body></html>`;
  if (!snapshot) return head('<section class="card"><h2>No data yet</h2><p class="muted">The workflow <code>schedules-snapshot.yml</code> publishes every scheduled job once an hour; the first run fills this page.</p></section>');
  const all = decorate(snapshot, now), scheduled = all.filter(job => job.crons.length), manual = all.filter(job => !job.crons.length && job.manual), c = counts(scheduled);
  const repos = ['all', ...new Set(all.map(job => job.repo.split('/').pop()))];
  const shown = scheduled.filter(job => (repo === 'all' || job.repo.split('/').pop() === repo) && (state === 'all' || job.state === state) && (area === 'all' || job.area === area));
  const link = (r, s, a = area) => `?repo=${encodeURIComponent(r)}&state=${s}&area=${a}`;
  const tile = (label, value, sub, cls = '') => `<section class="card tile ${cls}"><span class="muted">${esc(label)}</span><b>${esc(value)}</b><span class="muted">${esc(sub)}</span></section>`;
  const areaTiles = AREAS.map(area => { const mine = scheduled.filter(job => job.area === area.id), red = mine.filter(job => job.state === 'red').length;
    return tile(area.label, `${mine.length - red}/${mine.length}`, `green · ${red} red`, red ? 'bad' : ''); }).join('');
  const sections = AREAS.map(area => { const mine = shown.filter(job => job.area === area.id); if (!mine.length) return '';
    const red = scheduled.filter(job => job.area === area.id && job.state === 'red').length;
    return `<tr class="area"><td colspan="9"><b>${esc(area.label)}</b> <span class="muted small">${esc(area.hint)}</span> <span class="chip ${red ? 'r' : 'g'}">${scheduled.filter(job => job.area === area.id).length} jobs · ${red} red</span>${area.link ? ` <a class="small" href="${area.link}">${area.link} →</a>` : ''}</td></tr>${mine.map(job => row(job, now, summary, notify)).join('')}`; }).join('');
  // Why (1 Nov 2026, owner): the tile read a confident 0 while jobadabra-lab, a private repo, was not read (a token that could not see it). An unread private repo makes the sum a lower bound; unread public repos bill 0 anyway, but the collector cannot tell them apart (it records an unread repo as private).
  const unreadPrivate = (snapshot.repos || []).filter(r => r.private && r.ok === false).map(r => r.name.split('/').pop());
  const billedTile = (billed, unread) => unread.length ? tile('Billed min / week', `≥ ${num(billed)}`, `${unread.join(', ')} not read: ${unread.length > 1 ? 'their' : 'its'} minutes are missing`, 'warn') : tile('Billed min / week', num(billed), 'Mac ×10, Windows ×2; public repos are free');
  const failed = (snapshot.repos || []).filter(r => r.ok === false).map(r => r.name);
  return head(`<div class="tiles">${tile('Scheduled jobs', num(c.all), `plus ${num(manual.length)} by hand only`)}${tile('Red now', num(c.red), 'last finished run failed', c.red ? 'bad' : '')}${tile('Missed a run', num(c.missed), 'a due start never began', c.missed ? 'warn' : '')}${billedTile(c.billed, unreadPrivate)}</div>
<div class="tiles">${areaTiles}</div>${graphOn ? graph(scheduled.filter(job => job.area === 'testing'), now) : ''}${failed.length ? `<p class="muted">Could not read: ${esc(failed.join(', '))}. Their jobs show the last known data or are missing.</p>` : ''}
<div class="filter-rows">${filterLinks([['all', 'All', link(repo, state, 'all')], ...AREAS.map(item => [item.id, item.label, link(repo, state, item.id)])], area, 'Area')}${filterLinks(repos.map(r => [r, r === 'all' ? 'All' : r, link(r, state)]), repo, 'Repo')}${filterLinks(STATES.map(([value, name]) => [value, name, link(repo, value)]), state, 'State')}</div>
<section class="card wrap"><table><tr><th>Job</th><th>Repo</th><th>Schedule · next start (Europe/Zurich)</th><th>Last run</th><th>Last 14</th><th>Last night</th><th class="num">Min/wk</th><th>AI cost</th><th>Notify</th></tr>${sections || '<tr><td colspan="9" class="muted">No job matches.</td></tr>'}</table></section>
<details><summary>Run by hand only (${num(manual.length)})</summary><p class="muted small">Workflows with workflow_dispatch and no schedule.</p>${manual.length ? `<ul>${manual.map(job => `<li><a href="https://github.com/${esc(job.repo)}/actions/workflows/${esc(job.file)}">${esc(job.name || job.file)}</a> <span class="repo">${esc(job.repo.split('/').pop())}</span> ${chip(job)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</details>`);
}

// The Overview tile: how many jobs, how many red or missed.
export const headline = async (env, now = new Date()) => {
  const snapshot = await read(env);
  if (!snapshot) return [{label: 'Scheduled jobs', value: 'No data', sub: 'the snapshot job publishes hourly', status: 'none'}];
  const c = counts(decorate(snapshot, now).filter(job => job.crons.length));
  return [{label: 'Scheduled jobs', value: `${num(c.all - c.red)} of ${num(c.all)} green`, sub: `${num(c.red)} red · ${num(c.missed)} missed a run`, status: c.red ? 'bad' : c.missed ? 'warn' : 'good'}];
};

// /admin/operations/scheduled
export async function view(request, env) {
  const who = await viewer(request, env);
  if (!who) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const state = STATE_IDS.includes(url.searchParams.get('state')) ? url.searchParams.get('state') : 'all', snapshot = await read(env), problem = await readStartProblem(env.STATS, 'schedules-snapshot.yml');
  const known = new Set((snapshot?.jobs || []).map(job => job.repo.split('/').pop())), repo = known.has(url.searchParams.get('repo')) ? url.searchParams.get('repo') : 'all';
  const area = AREAS.some(item => item.id === url.searchParams.get('area')) ? url.searchParams.get('area') : 'all';
  return new Response(page(snapshot, {repo, state, area, problem, summary: await loadNightlySummary(env), notify: {settings: await readSettings(env), canEdit: who.role === 'superadmin', back: `/admin/operations/scheduled${url.search && !url.searchParams.has('key') ? url.search : ''}`}}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
