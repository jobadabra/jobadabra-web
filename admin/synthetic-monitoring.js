// /admin/testing/synthetic-monitoring: the checks that test the live app on the clock, with no code change and no commit behind them (owner, 1 Nov 2026: "Add a separate tab on the Admin -> Testing,
// to be called Synthetic Monitoring"). One table, one row per probe: what it checks, how often, the last result and the last 14 days. The Worker's own probe rounds (shared/synthetic.js) and the
// scheduled workflows that look at something live (the Scheduled tab's snapshot). Both are read by the readers that already exist; no query of its own, no AI. Guard: test/admin/synthetic-monitoring.test.js.
import {viewer, remember} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {PROBES, ROUND_MINUTES, readCard, readDaysByProbe} from '../shared/synthetic.js';
import {words} from '../shared/schedules-model.js';
import {CHIP_STYLE} from './chip.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';
import {read as readSchedules} from './schedules.js';
import {lastOf} from './testing-overview-data.js';
import {daysTo, historyOf, MAP_DAYS} from './testing-overview-history.js';
import {cellHtml, dayHeads, MAP_STYLE} from './testing-overview-map.js';
import {lastChip} from './testing-overview.js';
import {PUBLIC_REPO} from '../shared/repos.js';

const REPO = PUBLIC_REPO;
/** What each Worker probe checks, in a few words (the row shows it small and muted); a probe added to shared/synthetic.js without a line here fails the guard test. The full sentence is OWN_DETAIL (the tooltip). */
export const OWN_WHAT = {
  site: 'The website answers',
  index: 'The employer index holds jobs',
  license: 'The licence check answers',
  'free-ai': 'Free AI models and caps are readable',
  updates: 'The update feed offers both installers',
  broker: 'The AI broker answers',
};
export const OWN_DETAIL = {
  site: 'The public website answers with the Jobadabra page',
  index: 'The employer index pack still holds employers and jobs',
  license: 'A fixed test install gets a plan answer back (the licence check)',
  'free-ai': 'The same test install can list Free AI models and read its caps',
  updates: 'The update feed offers the newest release with the Mac and Windows installers',
  broker: 'The AI broker answers, has its day meters, and an engine to run on',
};
/** The scheduled workflows that look at something live (not fixed or recorded inputs); each row reads the Scheduled tab's snapshot. */
export const WORKFLOWS = [
  {wf: 'release-guard.yml', label: 'Release · Guard Latest', what: 'Only a desktop release holds "Latest"', detail: 'Only a desktop release holds "Latest", the one the Download link and the updater follow'},
  {wf: 'schedule-watchdog.yml', label: 'Schedule watchdog', what: 'The timers started their runs on time', detail: "The Worker's timers started the scheduled runs on time"},
  {wf: 'fresh-install-smoke.yml', label: 'Fresh-install smoke', what: 'The newest installer installs and opens', detail: 'The newest stable installer still installs on a clean Mac and Windows runner and opens the Jobs list'},
  {wf: 'stable-canary.yml', label: 'Stable canary', what: 'The stable build works against the live world', detail: "The stable build still works against the live world: Notion's API, the job sites' forms, certificates"},
  {wf: 'watch-live.yml', label: 'Daily watch list', what: 'Watched employer forms still fill', detail: 'Watched employer forms still fill, recorded live (held, never Submit)'},
];

const none = why => ({state: 'none', why});
/** One Worker probe's last result: red when it is down (2 reds in a row, the rule that alerts) or the rounds stopped, else green; a single miss is noted, not red. */
function ownLast(card, probe, now) {
  if (!card) return none('the probe tables are not readable from the Worker right now');
  if (card.stale) return {state: 'red', word: 'no round', at: card.lastRoundAt, note: 'no probe round for over 45 min'};
  const found = (card.probes || []).find(item => item.probe === probe.id);
  if (!found) return none('no round has stored this probe yet');
  // Why (1 Nov 2026, owner: "it's too hard to read. too much text"): one status per row; "100% up in 24 h" and a single miss go in the chip's tooltip, only a reason for red stays visible.
  const why = found.state === 'down' ? found.reason : !found.ok ? `one miss: ${found.reason}` : found.uptime24h != null ? `${found.uptime24h}% up in 24 h` : '';
  return {state: found.state === 'down' ? 'red' : 'green', at: found.at, why, note: found.state === 'down' ? found.reason : ''};
}

/** The table's rows from the stored readings: {data: {schedules, synthetic, syntheticDaysByProbe, repo, now}} -> {rows, counts, red}. */
export function model(data) {
  const job = file => (data.schedules?.jobs || []).find(item => item.file === file && item.repo === data.repo);
  const own = PROBES.map(probe => ({id: probe.id, label: probe.label, what: OWN_WHAT[probe.id] || '', detail: OWN_DETAIL[probe.id] || '', cadence: `every ${60 / ROUND_MINUTES.length} min`, last: ownLast(data.synthetic, probe, data.now),
    days: historyOf({...data, syntheticDays: data.syntheticDaysByProbe?.[probe.id] ?? null}, [{last: {synthetic: true}}]), href: ''}));
  const flows = WORKFLOWS.map(item => ({id: item.wf, label: item.label, what: item.what, detail: item.detail, cadence: (job(item.wf)?.crons || []).map(cron => words(cron, data.now)).join(', ') || 'no schedule listed',
    last: lastOf(data, {wf: item.wf}), days: historyOf(data, [{wf: item.wf}]), href: `https://github.com/${data.repo}/actions/workflows/${item.wf}`}));
  const rows = [...own, ...flows];
  const red = rows.filter(row => row.last.state === 'red').map(row => row.label);
  return {rows, red, counts: {all: rows.length, red: red.length, green: rows.filter(row => row.last.state === 'green').length, none: rows.filter(row => row.last.state === 'none').length}};
}

const rowHtml = (row, now) => `<tr class="${row.last.state === 'red' ? 'is-red' : ''}"><th scope="row"${row.detail ? ` title="${esc(row.detail)}"` : ''}><b class="nm">${row.href ? `<a href="${esc(row.href)}">${esc(row.label)}</a>` : esc(row.label)}</b><div class="muted what">${esc(row.what)}</div></th>
<td class="when">${esc(row.cadence)}</td><td class="res">${lastChip(row.last, now)}</td>${row.days.map(cellHtml).join('')}</tr>`;

const STYLE = `${CHIP_STYLE}${BAND_STYLE}
.band{margin-bottom:12px}.sm .when{white-space:nowrap;font-size:12px;color:#8d949c;padding-right:12px}.sm .res{white-space:nowrap;padding-right:12px}
.sm th .nm{font-size:15px;font-weight:650}.sm th .nm a{color:#f4efe3}.sm th .what{font-size:12px;font-weight:400;white-space:normal;max-width:300px}
.sm tr.group th{padding:14px 0 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8d949c}
.sm .legend{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;font-size:12px;color:#8d949c;margin:2px 0 8px}.sm .legend .c{width:14px;height:14px;font-size:10px;vertical-align:-2px;margin-right:3px}`;

/** The page. `data` = the three stored readings plus {repo, now}; nothing here reads or writes. */
export function page(data) {
  const {rows, red, counts} = model(data), now = data.now, days = daysTo(now);
  const band = verdictBand({icon: counts.red ? '🔴' : '🟢', headline: `${counts.red || counts.green} of ${counts.all} live checks ${counts.red ? 'red' : 'green'}`,
    chips: rows.filter(row => row.last.state === 'red').map(row => ({label: row.label, tone: 'bad', title: row.last.note || row.last.why || ''})),
    note: counts.none ? `${counts.none} with no stored run` : ''});
  const group = title => `<tr class="group"><th colspan="${days.length + 3}">${title}</th></tr>`;
  const ownRows = rows.slice(0, PROBES.length), flowRows = rows.slice(PROBES.length);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Synthetic Monitoring · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}
${MAP_STYLE}</style></head><body><main>
<header><h1>📡 Synthetic Monitoring</h1></header>
${band}
<section class="card hmap sm"><h2>Last ${days.length} days</h2>
<div class="legend"><span><i class="c c-green">✓</i>green</span><span><i class="c c-red">✕</i>red</span><span><i class="c c-none"></i>no run</span><span><i class="c c-unknown"></i>not stored</span><span>· a probe is red after 2 misses in a row</span></div>
<div class="scroll"><table><thead><tr><th class="m">Check</th><th>How often</th><th>Last result</th>${dayHeads(days)}</tr></thead>
<tbody>${group('📡 Live services · every 15 min')}${ownRows.map(row => rowHtml(row, now)).join('')}
${group('⏰ Scheduled jobs on live things')}${flowRows.map(row => rowHtml(row, now)).join('')}</tbody></table></div>
<p class="muted small">Fixed or recorded inputs are on <a href="/admin/testing/scheduled">Scheduled</a>.</p></section>
</main></body></html>`;
}

/** What the page reads: the Worker's probe rounds and the Scheduled tab's snapshot, each through the reader that already exists. */
export async function load(env, now = new Date()) {
  const [schedules, synthetic, syntheticDaysByProbe] = await Promise.all([readSchedules(env), readCard(env, now), readDaysByProbe(env, MAP_DAYS, now)]);
  return {repo: env.GITHUB_REPO || REPO, schedules, synthetic, syntheticDaysByProbe, now};
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  return new Response(page(await load(env, now)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
