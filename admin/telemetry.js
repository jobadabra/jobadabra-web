// The owner's /admin/growth/app page: the problems users hit, the setup funnel and the channels, from shared/telemetry.js.
// Same key or cookie as /admin. Guarded by test/unit/shared/telemetry.test.js.
import {filterLinks} from './admin.js';
import {viewer} from '../shared/auth.js';
import {trendChip} from './admin.js';
import {appTrends} from './trends.js';
import {feedbackList} from '../shared/feedback.js';
import {tabCard} from '../shared/tab-handoff.js';
import {flags} from '../shared/guard.js';
import {report as knowledgeReport} from '../shared/knowledge.js';
import {esc} from '../shared/html.js';
import {remember} from '../shared/auth.js';
import {CHIP_STYLE, chip as valueChip} from './chip.js';
import {KEEP_DAYS, text, normal, problems, channels, STOP_REASONS, funnel, daily} from '../shared/telemetry.js';

const chip = (data, key) => (data.trends?.[key] ? trendChip(data.trends[key].label, data.trends[key].values, data.trends[key]) : '');   // its weeks (admin/trends.js)
const STEP_LABELS = {ai: 'AI', cv: 'CV'};
const OS_NAMES = {darwin: 'macOS', win32: 'Windows', linux: 'Linux'};

// The newest build a problem was seen on, and whether that is the newest build any install reports now (versions: "0.7.12,0.7.16").
// 20 Oct 2026: 9 of 18 problems filed as issues were fixed already and seen only on old builds; nothing here told them apart.
export function newestBuild(versions, installs = []) {
  // App versions compare by number (0.7.10 > 0.7.9); a missing part counts as 0.
  const parts = v => String(v || '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const newest = list => list.reduce((best, v) => (newer(v, best) ? v : best), '');
  const seen = newest(String(versions || '').split(',').map(v => v.trim()).filter(Boolean));
  const current = newest(installs.map(row => String(row.version || '')).filter(Boolean));
  return {seen, current, old: !!seen && !!current && newer(current, seen)};
}

export function page(data) {
  const {rows, installs} = data;
  const count = kind => rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.n, 0);
  const range = filterLinks([1, 7, 30].map(n => [n, n === 1 ? 'today' : `${n} days`, `?days=${n}`]), data.days);
  const tiles = [['🖥️ Machines reporting', data.unique, `${data.everSeen} ever seen` + (data.platforms.length ? ' · ' + data.platforms.map(p => `${p.n} ${esc(OS_NAMES[p.platform] || p.platform)}`).join(', ') : '')], ['🤖 AI engine', (data.engines || []).filter(e => e.engine !== 'unknown').reduce((sum, e) => sum + e.n, 0), (data.engines || []).filter(e => e.n).map(e => `${e.n} ${esc(e.label)}`).join(' · ') || 'no health report yet'], ['💥 Crashes', count('crash')], ['🔁 Failed runs', count('run_failed')], ['🧩 Form issues', count('form_issue')]];
  const built = row => newestBuild(row.versions, installs);
  const ordered = [...rows.filter(row => !built(row).old), ...rows.filter(row => built(row).old)];   // current problems first, each part as it was
  const table = ordered.map(row => `<tr${built(row).old ? ' class="old"' : ''}><td><span class="kind ${row.kind}">${esc(row.kind.replace('_', ' '))}</span></td>
    <td><details><summary>${esc(row.summary)}</summary><pre>${esc(JSON.stringify(JSON.parse(row.sample || '{}'), null, 1))}</pre></details></td>
    <td><b>${row.users}</b></td><td>${row.n}</td><td title="${esc(row.versions)}">${built(row).old ? `<span class="muted">old builds only · ${esc(built(row).seen)}</span>` : `<span class="newest">on ${esc(built(row).seen || '?')}</span>`}</td><td class="muted">${esc(String(row.last).slice(0, 16).replace('T', ' '))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>App · Admin</title><link rel="icon" href="/favicon-32.png">
<style>${CHIP_STYLE}
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--red:#e5776b;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0 0 6px;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}.tile b{display:block;font-size:32px;margin-top:4px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 4px}
td{padding:8px 4px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}summary{cursor:pointer}
.funnel td{vertical-align:middle;padding:7px 14px 7px 0;white-space:nowrap}.funnel td.step{width:120px}.funnel td.bar{width:100%;white-space:normal}.funnel td.bar div{background:var(--amber);height:12px;border-radius:6px}.funnel td.n{text-align:right;font-variant-numeric:tabular-nums}.funnel tr:last-child td.bar div{background:var(--teal)}
.machines{font-size:14px}.machines td,.machines th{white-space:nowrap;padding:10px 18px 10px 0;vertical-align:middle}.machines td.vs{white-space:normal;line-height:2}.machines .v{display:inline-block;white-space:nowrap;margin:0 4px 0 0;padding:0 8px;border-radius:99px;background:var(--line);color:var(--muted);font-size:12px}.machines .v.now{background:var(--amber);color:#000;font-weight:700;font-size:13px}.machines td.num{font-variant-numeric:tabular-nums}
.newest{display:inline-block;white-space:nowrap;padding:0 8px;border-radius:99px;background:var(--amber);color:#000;font-weight:700;font-size:12px}tr.old td{opacity:.6}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted);margin:8px 0 0}.kind{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--line);white-space:nowrap}
.kind.crash{color:var(--red)}.kind.run_failed{color:var(--amber)}.kind.form_issue{color:var(--teal)}
</style></head><body><main>
<header><h1>🖥️ App</h1><span class="muted">${range}</span></header>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${value}</b>${note ? `<small class="muted">${note}</small>` : ''}</div>`).join('')}</div>
<section class="card" style="margin-bottom:12px"><h2>Problems, most users first${chip(data, 'problems')}</h2><table><tr><th>Kind</th><th>Problem (click for a sample)</th><th>Users</th><th>Times</th><th>Newest build</th><th>Last</th></tr>
${table || '<tr><td colspan="6" class="muted">No problems reported. 🎉</td></tr>'}</table></section>
${tabCard(data.tabs)}
<section class="card" style="margin-bottom:12px"><h2>🖥️ Machines${chip(data, 'machines')}</h2><small class="muted">one row per install: the version it runs now, and every version it has run (id shown as a short prefix)</small>
<div style="overflow-x:auto"><table class="machines"><tr><th>Install</th><th>OS</th><th>Country</th><th>Use</th><th>Version</th><th>First seen</th><th>Last seen</th><th>Earlier versions</th></tr>${data.machines.map(m => `<tr><td><code>${esc(String(m.install).slice(0, 6))}</code></td><td>${esc(OS_NAMES[m.platform] || m.platform)}</td><td>${esc(m.country || '–')}</td><td class="muted">${esc(m.use)}${m.days > 1 ? ` · ${m.days} days` : ''}</td><td><span class="v now">${esc(m.current)}</span></td><td class="muted num">${esc(String(m.first || '').slice(0, 10))}</td><td class="muted num">${esc(String(m.last || '').slice(0, 16).replace('T', ' '))}</td><td class="vs">${m.versions.filter(v => v !== m.current).map(v => `<span class="v">${esc(v)}</span>`).join('') || '<span class="muted">–</span>'}</td></tr>`).join('')
  || '<tr><td colspan="8" class="muted">No machine has reported yet.</td></tr>'}</table></div></section>
<section class="card" style="margin-bottom:12px"><h2>How it helped${chip(data, 'helped')}</h2><small class="muted">all ${data.reporting} installs reporting, their latest totals</small>
<div class="tiles" style="margin:10px 0 0">${[['🎯 Jobs matched', 'matches'], ['⭐ Good fits (70+)', 'goodFits'], ['🧩 Forms filled', 'formsFilled'],
  ['📨 Applications', 'applied'], ['💬 Human replies', 'replies'], ['📞 Screenings', 'screenings'], ['🧑‍💻 Interviews', 'interviews'], ['🏆 Offers', 'offers']]
  .map(([label, name]) => { const n = data.outcomes?.counted?.[name] || 0;
    return `<div class="tile"><span class="muted">${label}</span><b>${n ? data.outcomes[name] : '–'}</b>${n && n < data.reporting
      ? `<small class="muted">${n} of ${data.reporting} installs</small>` : ''}</div>`; }).join('')}</div>
${Object.keys(data.outcomes?.counted || {}).length ? '' : '<small class="muted">No counts yet: they arrive with each install\'s next daily report.</small>'}</section>
<section class="card" style="margin-bottom:12px"><h2>📣 Channels${chip(data, 'channels')}</h2><small class="muted">where installs came from (last ${data.days < 30 ? 30 : data.days} days): finished setup, and active = reported on 2+ days</small>
<div style="overflow-x:auto"><table class="machines"><tr><th>Channel</th><th>Machines</th><th>Finished setup</th><th>Active</th></tr>${(data.channels || []).map(c => `<tr><td>${esc(c.source)}</td><td class="num">${c.machines}</td><td class="num">${c.done}</td><td class="num">${c.active}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No machine has reported yet.</td></tr>'}</table></div>
<small class="muted" style="display:block;margin-top:6px">A channel comes from the Terminal command's link (<code>?utm_source=reddit-devops</code>) or, for a download button, from the click on the same network in the 7 days before the app's first start (since 7 Oct 2026). "direct" = typed or bookmarked; "unknown" = no such click, or installed before 7 Oct 2026.</small></section>
<section class="card" style="margin-bottom:12px"><h2>🚦 Setup funnel${chip(data, 'setup')}</h2><small class="muted">installs that reached each step (last ${data.days < 30 ? 30 : data.days} days)${data.funnel?.medianMinutes != null ? ` · median time to finish: ${data.funnel.medianMinutes} min` : ''}${data.funnel?.trial ? ` · ${data.funnel.trial} used Free AI` : ''}</small>
${data.funnel?.started ? `<table class="funnel">${data.funnel.reached.map(({step, n}, i, all) => {
  const lost = i ? all[i - 1].n - n : 0;
  return `<tr><td class="step"><span class="muted">${i + 1}</span> ${esc(STEP_LABELS[step] || step.charAt(0).toUpperCase() + step.slice(1))}</td>
  <td class="bar"><div style="width:${Math.max(2, Math.round(n / all[0].n * 100))}%"></div></td>
  <td class="n"><b>${n}</b></td><td class="muted n">${Math.round(n / all[0].n * 100)}%</td><td class="n" style="color:var(--red)">${lost ? `−${lost}` : ''}</td></tr>`;
}).join('')}</table><small class="muted" style="display:block;margin-top:6px">% of the ${data.funnel.reached[0].n} installs that started · red: lost since the step before</small>`
  : '<p class="muted">No setups reported yet.</p>'}
${Object.keys(data.funnel?.stopped || {}).length ? `<h2 style="margin-top:14px">Why they stopped</h2><table>${Object.entries(data.funnel.stopped)
  .map(([at, reasons]) => `<tr><td style="width:110px">${esc(at)}</td><td>${Object.entries(reasons).sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${esc(STOP_REASONS[why] || why)} <b>×${n}</b>`).join(' · ')}</td></tr>`).join('')}</table>` : ''}</section>
<section class="card" style="margin-top:12px"><h2>🧬 What installs ask and where they stall${chip(data, 'asks')}</h2>
<small class="muted">Questions no answer matched, reported by ${3} or more installs (the form's own wording), and where applications got to per board (last 7 days).</small>
<table style="margin-top:8px"><tr><th>Question</th><th>Kind</th><th>Times</th><th>Installs</th><th>Boards</th></tr>
${(data.knowledge?.questions || []).slice(0, 15).map(row => `<tr><td>${esc(row.label)}</td><td>${valueChip(esc(row.kind))}</td><td>${row.n}</td><td>${row.installs}</td><td class="muted">${esc((row.boards || []).slice(0, 3).join(', '))}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">No question has reached 3 installs yet.</td></tr>'}</table>
<table style="margin-top:8px"><tr><th>Board</th><th>How applications went (told by users, last 7 days)</th></tr>
${Object.entries((data.knowledge?.outcomes || []).reduce((all, row) => { (all[row.board] ||= []).push(valueChip(`${esc(row.outcome)} <b>×${row.n}</b>`)); return all; }, {})).slice(0, 12)
  .map(([board, parts]) => `<tr><td>${esc(board)}</td><td>${parts.join(' · ')}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No outcomes told yet.</td></tr>'}</table>
<table style="margin-top:8px"><tr><th>Board</th><th>Where applications got to</th></tr>
${Object.entries((data.knowledge?.flows || []).reduce((all, row) => { (all[row.board] ||= []).push(valueChip(`${esc(row.state)} <b>×${row.n}</b>`)); return all; }, {})).slice(0, 12)
  .map(([board, parts]) => `<tr><td>${esc(board)}</td><td>${parts.join(' · ')}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No flow outcomes yet.</td></tr>'}</table></section>
<section class="card" style="margin-top:12px"><h2>🛡️ Access guard${chip(data, 'guard')}</h2>
<small class="muted">Who hit a limit or touched a decoy (last 7 days; installs are shown only as a short digest). ${data.guard ? data.guard.honeypots : 0} honeypot fingerprints planted.</small>
<table style="margin-top:8px"><tr><th>What</th><th>Who</th><th>Times</th></tr>
${(data.guard?.seen || []).map(row => `<tr><td>${valueChip(esc(row.kind))}</td><td><code>${esc(row.who)}</code></td><td>${row.n}</td></tr>`).join('')
  || '<tr><td colspan="3" class="muted">Nothing odd. 🎉</td></tr>'}</table>
${(data.guard?.revoked || []).length ? `<small class="muted">Revoked: ${(data.guard.revoked).map(row => `<code>${esc(row.who)}</code> (${esc(row.reason)})`).join(' · ')}</small>` : ''}</section>
<section class="card" style="margin-top:12px"><h2>💬 Feedback${chip(data, 'feedback')}</h2><p style="margin:6px 0 0">${(data.feedback || []).length
  ? `${(data.feedback || []).length} message${(data.feedback || []).length === 1 ? '' : 's'} in the last ${data.days < 30 ? 30 : data.days} days · <a href="/admin/feedback/inbox">Open Feedback →</a>`
  : '<span class="muted">No feedback yet.</span> <a href="/admin/feedback/inbox">Feedback →</a>'}</p></section>
<p class="muted">Since ${esc(data.from)} (UTC). Scrubbed on each Mac before sending; no answers, CV, emails, names or keys. Kept ${KEEP_DAYS} days.</p>
</main></body></html>`;
}

// GET /telemetry?days=7 (same key or cookie as /stats)
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  if (new URL(request.url).searchParams.has('key')) return remember(new URL(request.url), env, request);
  const days = [1, 7, 30].includes(Number(new URL(request.url).searchParams.get('days'))) ? Number(new URL(request.url).searchParams.get('days')) : 7;
  try {
    const [data, feedback, setup, byChannel] = await Promise.all([problems(env.STATS, days, now), feedbackList(env.STATS, Math.max(days, 30), now).catch(() => []),
      funnel(env.STATS, Math.max(days, 30), now).catch(() => null), channels(env.STATS, Math.max(days, 30), now).catch(() => [])]);
    const guardData = await flags(env.STATS, 7, now).catch(() => null), learned = await knowledgeReport(env.STATS, 7, now).catch(() => null), trends = await appTrends(env.STATS, now).catch(() => null);
    return new Response(page({...data, feedback, funnel: setup, channels: byChannel, guard: guardData, knowledge: learned, trends}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
  } catch (error) {  // e.g. the table isn't there yet: say what to do, not a blank error
    return new Response(`App reports can't be read yet: ${esc(error.message)}. Apply the database migrations: cd site && npx wrangler@4 d1 migrations apply www-stats --remote`,
      {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}
