// The owner's /stats page: visitors, Download clicks and sign-ups per day, from the tables api/downloads.js fills.
// /stats opens with ?key=<STATS_KEY> (Worker secret; Keychain jobadabra.site.stats_key), then remembers it in a cookie. Guarded by test/unit/workers/www/stats.test.js.
import {viewer, remember} from '../shared/auth.js';   // admins (invited) read this page too
import {esc} from '../shared/html.js';
import {filterLinks} from './admin.js';
import {report, signups} from '../shared/traffic.js';
import {TOOLTIP} from '../shared/scoutingcharts.js';
import {perDayChart, fillDays, PERDAY_STYLE} from './stats-chart.js';

const today = (now = new Date()) => now.toISOString().slice(0, 10);

const pct = (part, whole) => whole ? `${Math.round(part / whole * 1000) / 10}%` : '–';

function bars(title, rows, unit) {
  const max = Math.max(1, ...rows.map(row => row.n));
  const body = rows.length ? rows.map(row => `<div class="bar"><span>${esc(row.name)}</span>
    <i style="--w:${Math.round(row.n / max * 100)}%"></i><b>${row.n}</b></div>`).join('') : '<p class="muted">Nothing yet</p>';
  return `<section class="card"><h2>${title}</h2><small class="muted">${unit}</small>${body}</section>`;
}

export function page(data, list) {
  const {visits, downloads} = data;
  const range = filterLinks([7, 30, 90].map(n => [n, `${n} days`, `?days=${n}`]), data.days);
  const tiles = [
    ['👀 Visitors', visits.visitors || 0, `${visits.views || 0} page views`],
    ['⬇️ Downloaders', downloads.people || 0, `${downloads.clicks || 0} clicks`],
    ['🎯 Conversion', pct(downloads.people || 0, visits.visitors || 0), 'visitors who download'],
    ['✉️ Pro waitlist', list.length, 'sign-ups, all time']];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Website · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}
.tile b{display:block;font-size:32px;margin:4px 0 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
${PERDAY_STYLE}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;background:var(--amber)}.legend i.t{background:var(--teal)}
.bar{display:grid;grid-template-columns:minmax(0,9em) 1fr 3em;gap:8px;align-items:center;margin-top:8px}
.bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar i{height:10px;width:var(--w);background:var(--amber);border-radius:5px}.bar b{text-align:right}
table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:6px 4px;border-top:1px solid var(--line);overflow-wrap:anywhere}
</style></head><body><main>
<header><h1>🌐 Website</h1><span class="muted">${range}</span></header>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${esc(value)}</b><small class="muted">${esc(note)}</small></div>`).join('')}</div>
<section class="card" style="margin-bottom:12px"><h2>Per day</h2><small class="legend muted"><i></i>visitors<i class="t"></i>downloaders</small>
${perDayChart(fillDays(data.perDay, data.from, today())) || '<p class="muted">Nothing yet</p>'}</section>
<div class="grid">
${bars('🔘 Download button', data.buttons, 'people who clicked it')}
${bars('💻 Platform', data.platforms, 'downloaders')}
${bars('🧭 Downloaders came from', data.dlSources, 'people')}
${bars('🔗 Visitors came from', data.sources, 'people')}
${bars('🌍 Country', data.countries, 'visitors')}
${bars('📄 Pages', data.pages, 'page views')}
${bars('🖥️ Device', data.devices, 'visitors')}
<section class="card"><h2>✉️ Pro waitlist</h2><small class="muted">newest first</small><table>
${list.map(row => `<tr><td>${esc(row.email)}</td><td class="muted">${esc(row.role)}</td><td class="muted">${esc(row.at.slice(0, 10))}</td></tr>`).join('') || '<tr><td class="muted">No sign-ups yet</td></tr>'}
</table></section></div>
<p class="muted">Since ${esc(data.from)} (UTC). People = unique per day, no cookies. More (referrers, speed): Cloudflare → Web Analytics.</p>
</main>${TOOLTIP}</body></html>`;
}


// GET /stats?days=30
export async function stats(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const [data, list] = await Promise.all([report(env.STATS, days, now), signups(env.WAITLIST)]);
  return new Response(page(data, list), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex'}});
}
