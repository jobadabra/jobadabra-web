// The chart-first top of /admin/job-search/scouting (owner, 19 Oct 2026: "where we're strong, where we're weak", "add more graphs", "too much of raw
// numbers/text/tables"): tiles with trends, the kind × European country heat map, the gaps installs search in, each kind's trend, which source
// fills which kind, and the central scout's last runs. Counts only. Charts: shared/scoutingcharts.js. Tests: test/unit/shared/scoutingvisual.test.js.
import {C, bars, columns, esc, inkOn, n, shade, sparkline, STEPS, tile} from './scoutingcharts.js';
import {EUROPE} from './pool-tags.js';
import {KINDS, KIND_NAMES} from './pool-labels.js';

export const FLOOR = 25;   // employers per kind and country the scout aims for in the big markets (src/scout_cells.py FLOOR)
export const BIG = ['de', 'gb', 'fr', 'it', 'es', 'pl', 'nl'], SMALL = ['lu', 'md', 'bg', 'hr', 'ee'];   // src/scout_cells.py BIG, SMALL
// The floor follows the country's size (owner, 20 Oct 2026): 25 big markets, 10 mid-size, 5 small. Written as the engine's floor_for.
export const floorFor = country => (BIG.includes(country) ? FLOOR : SMALL.includes(country) ? 5 : 10);
// A count on the colour scale of the big markets: a cell at its own floor takes the colour of 25.
const scaled = (count, country) => Math.round((count * FLOOR) / floorFor(country));
export {KINDS};   // src/role_kinds.py KINDS (shared/pool-labels.js)
export const AIMED = KINDS.filter(kind => !['software', 'other'].includes(kind));   // the kinds the scout fills (src/scout_cells.py AIMED)
const LABEL = {...KIND_NAMES, unknown: 'Not counted yet'};
export const kindName = kind => LABEL[kind] || kind;
const names = (() => { try { return new Intl.DisplayNames(['en'], {type: 'region'}); } catch { return null; } })();
export const countryName = code => { try { return names?.of(code.toUpperCase()) || code.toUpperCase(); } catch { return code.toUpperCase(); } };
const cellName = cell => { const [kind, country] = String(cell || '').split('|'); return kind && country ? `${kindName(kind)} · ${countryName(country)}` : ''; };
const signed = value => (value > 0 ? `+${n(value)}` : value < 0 ? `−${n(-value)}` : '±0');

// The kind a feed mostly hires for (its role mix), 'unknown' before the central scout has counted it.
export const topKind = feed => Object.entries(feed?.kinds || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

// {'<kind>|<country>': [employers, open jobs]} over the European countries their jobs are in (src/scout_index.py countries).
export function cellsOf(feeds) {
  const cells = {};
  for (const feed of feeds) for (const country of feed.countries || []) {
    if (!EUROPE.includes(country)) continue;
    const cell = cells[`${topKind(feed)}|${country}`] ||= [0, 0];
    cell[0] += 1;
    cell[1] += Number(feed.jobs || feed.fresh?.jobs || 0);
  }
  return cells;
}

// Open jobs at the employers hiring in Europe, each employer once: a cell holds an employer's whole count in every country it hires in,
// so a sum over cells counts it once per country (20 Oct 2026: 979,528 shown for ~334k).
export const jobsInEurope = feeds => feeds.filter(feed => (feed.countries || []).some(country => EUROPE.includes(country)))
  .reduce((sum, feed) => sum + Number(feed.jobs || feed.fresh?.jobs || 0), 0);

// Installs searching each kind × country in the last 30 days, from what they share (contributions.roles + countries); a cell only with 3+.
export function demandOf(rows, least = 3) {
  const installs = {};
  for (const row of rows) {
    const kinds = new Set(String(row.roles || '').split(',').filter(Boolean).map(role => (KINDS.includes(role) ? role : 'software')));
    for (const kind of kinds) for (const country of String(row.countries || '').split(',').filter(code => EUROPE.includes(code))) (installs[`${kind}|${country}`] ||= new Set()).add(row.install);
  }
  return Object.fromEntries(Object.entries(installs).filter(([, set]) => set.size >= least).map(([cell, set]) => [cell, set.size]));
}

const employers = (cells, cell) => cells?.[cell]?.[0] || 0;
export const atFloor = cells => AIMED.reduce((sum, kind) => sum + EUROPE.filter(country => employers(cells, `${kind}|${country}`) >= floorFor(country)).length, 0);
const kindTotal = (cells, kind) => Object.entries(cells || {}).reduce((sum, [cell, [count]]) => sum + (cell.startsWith(`${kind}|`) ? count : 0), 0);

// The daily snapshots that carry cells, oldest first, and the one a week back (null before a week of history).
export function history(daily, today = new Date()) {
  const rows = [...daily].sort((a, b) => a.day.localeCompare(b.day)).map(row => {
    let cells = null;
    try { cells = row.cells ? JSON.parse(row.cells) : null; } catch { cells = null; }
    return {...row, cells};
  });
  const back = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  return {rows, withCells: rows.filter(row => row.cells), week: [...rows].reverse().find(row => row.day <= back) || null};
}

export function tiles({feeds, daily, sharing7, central}, cells, past) {
  const nonIt = feeds.filter(feed => !['software', 'unknown'].includes(topKind(feed))).length;
  const runs = central?.runs || [], last = runs[runs.length - 1];
  const jobs = jobsInEurope(feeds);
  return `<div class="tiles">
${tile('Employers in the list', n(feeds.length), {spark: past.rows.map(row => row.feeds), delta: past.week ? feeds.length - past.week.feeds : null, note: '▲▼ against a week back'})}
${tile('Hire mostly outside IT', feeds.length ? `${Math.round((100 * nonIt) / feeds.length)}%` : '—', {spark: past.rows.map(row => (row.feeds ? (100 * row.non_it) / row.feeds : null)), note: `${n(nonIt)} employers`})}
${tile('Cells at their floor', `${n(atFloor(cells))} <small class="muted">/ ${n(AIMED.length * EUROPE.length)}</small>`, {spark: past.withCells.map(row => atFloor(row.cells)), delta: past.week?.cells ? atFloor(cells) - atFloor(past.week.cells) : null, note: 'kind × European country, the target'})}
${tile('Open jobs in Europe', n(jobs), {note: 'at the employers hiring in Europe, each once'})}
${tile('Installs sharing', n(sharing7), {note: 'last 7 days'})}
${tile('Last central run', last ? `${n(last.found)} found` : '—', {spark: runs.map(run => run.found), note: last ? `${last.at.replace('T', ' ')} · ${cellName(last.cell) || 'its usual search'}` : 'no run recorded yet'})}
</div>`;
}

// The kind × country table, drawn once for /admin and for the public /coverage page (owner, 27 Oct 2026: "let's publish this graph").
// open: the public cut: counts and the week's change only, no jobs (a cell repeats an employer's whole count), no installs, no floor or AI aim;
// colour steps as classes (h0..h6) the site's own tokens paint; every field biggest first, Software & IT included (owner, 27 Oct 2026: "put Software & IT
// as the first row… descending order"), then 'other' and
// 'unknown' under plain names, 'unknown' in one neutral (hn): its colour would speak of the list's gap, not a field's strength.
const OPEN_NAMES = {other: 'Several fields', unknown: 'Field not sorted yet'};
const stepOf = value => STEPS.filter(([from]) => value >= from).length - 1;
export function heatTable(cells, past, {demand = {}, aimedCell = '', open = false} = {}) {
  const named = open ? [...[...AIMED, 'software'].sort((a, b) => kindTotal(cells, b) - kindTotal(cells, a)), 'other'] : KINDS;
  const kinds = [...named, ...(Object.keys(cells).some(cell => cell.startsWith('unknown|')) ? ['unknown'] : [])];
  const label = kind => (open && OPEN_NAMES[kind]) || kindName(kind);
  const week = past.week?.cells;
  const row = kind => `<tr><th class="kind" scope="row">${esc(label(kind))}</th>${EUROPE.map(country => {
    const cell = `${kind}|${country}`, [count, jobs] = cells[cell] || [0, 0];
    const parts = [`${label(kind)} · ${countryName(country)}: ${n(count)} employer${count === 1 ? '' : 's'}${open ? '' : `, ${n(jobs)} open jobs`}`];
    if (week) parts.push(`${signed(count - employers(week, cell))} this week`);
    if (!open && demand[cell]) parts.push(`${n(demand[cell])} installs search here`);
    if (!open && AIMED.includes(kind) && count < floorFor(country)) parts.push(`${floorFor(country) - count} short of ${floorFor(country)}`);
    if (!open && cell === aimedCell) parts.push('the AI ideas aim here now');
    const value = scaled(count, country), paint = open ? `class="${kind === 'unknown' ? 'hn' : `h${stepOf(value)}`}"` : `tabindex="0" class="${cell === aimedCell ? 'aimed' : ''}" style="background:${shade(value)};color:${inkOn(value)}"`;
    return `<td ${paint} data-tip="${esc(parts.join(' · '))}">${count || '·'}</td>`;
  }).join('')}<td class="total" data-tip="${esc(`${label(kind)} in Europe${week ? `: ${signed(kindTotal(cells, kind) - kindTotal(week, kind))} this week` : ''}`)}">${n(kindTotal(cells, kind))}</td></tr>`;
  const legend = STEPS.map(([from], i) => `<i ${open ? `class="h${i}"` : `style="background:${STEPS[i][1]}"`}></i>${i + 1 < STEPS.length ? `${from}${STEPS[i + 1][0] - 1 > from ? `–${STEPS[i + 1][0] - 1}` : ''}` : `${from}+`}`).join(' ');
  return {table: `<div class="scroll"><table class="heat"><tr><th></th>${EUROPE.map(country => `<th scope="col" title="${esc(countryName(country))}">${country.toUpperCase()}</th>`).join('')}<th scope="col">Europe</th></tr>${kinds.map(row).join('')}</table></div>`,
    legend: `Employers: ${legend}`};
}

export function heatmap(cells, past, demand, aimedCell) {
  const {table, legend} = heatTable(cells, past, {demand, aimedCell});
  return `<section class="card"><h2>🗺️ Where the list is strong or thin</h2><small class="muted">Employers by the kind they mostly hire for × the European countries their jobs are in. Bright from each country's floor (${FLOOR} big markets, 10 mid-size, 5 small); hover a cell for its jobs, this week's change and who searches there.${aimedCell ? ` Now aiming at <b>${esc(cellName(aimedCell))}</b>.` : ''}</small>
${table}
<div class="legend">${legend}<span class="gap"></span><i class="ring"></i> aimed at by the next AI ideas</div></section>`;
}

// Gaps people search in (demand under the floor) and, per kind, how many countries reach the floor.
export function gaps(cells, demand) {
  const wanted = Object.entries(demand).filter(([cell]) => employers(cells, cell) < floorFor(cell.split('|')[1]) && !cell.startsWith('software|'))
    .sort((a, b) => b[1] - a[1] || employers(cells, a[0]) - employers(cells, b[0])).slice(0, 10)
    .map(([cell, installs]) => ({label: cellName(cell), parts: [[installs, C.accent, 'installs searching']], after: `${employers(cells, cell)}/${floorFor(cell.split('|')[1])}`,
      tip: `${cellName(cell)}: ${installs} installs search here; ${employers(cells, cell)} of ${floorFor(cell.split('|')[1])} employers`}));
  const reach = KINDS.map(kind => {
    const done = EUROPE.filter(country => employers(cells, `${kind}|${country}`) >= floorFor(country)).length;
    return {label: kindName(kind), parts: [[done, AIMED.includes(kind) ? C.accent : C.gray, 'countries at their floor']], after: `${done}/${EUROPE.length}`,
      tip: `${kindName(kind)}: ${done} of ${EUROPE.length} countries are at their floor; ${n(kindTotal(cells, kind))} in Europe`};
  });
  // Why (2 Nov 2026, owner: "make these 2 widgets/cards one per row to avoid this empty space"): the two cards differ a lot in height (2 rows beside 25), so side by side the short one left a big empty area; each is full width.
  return `<section class="card"><h2>🎯 Gaps people search in</h2><small class="muted">Kind × country cells under their floor where 3+ installs searched in the last 30 days, most searched first; right: employers / floor.</small>
${bars(wanted, {empty: `No cell with 3+ installs searching is under its floor yet.`})}</section>
<section class="card"><h2>🏁 Countries at the floor, per kind</h2><small class="muted">Out of ${EUROPE.length} European countries, how many have reached their floor of employers of this kind. Gray: software, already strong.</small>
${bars(reach, {max: EUROPE.length})}</section>`;
}

// One small chart per kind: its employers in Europe over the days, now and the week's change.
export function trends(cells, past) {
  const multiple = kind => {
    const series = past.withCells.length ? past.withCells.map(row => kindTotal(row.cells, kind)) : [kindTotal(cells, kind)];   // today's publish is the last row
    const now = kindTotal(cells, kind), week = past.week?.cells ? now - kindTotal(past.week.cells, kind) : null;
    return `<div class="multiple"><small>${esc(kindName(kind))}</small><b>${n(now)}</b>${week == null ? '' : ` <span class="delta ${week >= 0 ? 'up' : 'down'}">${week >= 0 ? '▲' : '▼'} ${n(Math.abs(week))}</span>`}`
      + `${sparkline(series, {label: kindName(kind), color: AIMED.includes(kind) ? C.accent : C.gray})}</div>`;
  };
  return `<section class="card"><h2>📈 Each kind over time</h2><small class="muted">European employers of each kind, one point a day (from 19 Oct 2026); ▲▼ against a week back.</small>
<div class="multiples">${KINDS.map(multiple).join('')}</div></section>`;
}

// Which kind of source finds which kind of employer, and each source's yield.
export function sources(central) {
  const kinds = Object.entries(central?.source_kinds || {}).map(([source, byKind]) => {
    const it = byKind.software || 0, unknown = byKind.unknown || 0, total = Object.values(byKind).reduce((sum, v) => sum + v, 0);
    const top = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([kind, count]) => `${kindName(kind)} ${n(count)}`).join(', ');
    return {label: source, parts: [[total - it - unknown, C.accent, 'outside IT'], [it, C.gray, 'software'], [unknown, C.faint, 'not counted yet']], tip: `${source}: ${top}`};
  }).sort((a, b) => b.parts[0][0] - a.parts[0][0]).slice(0, 12);
  const yieldBars = (central?.sources || []).filter(source => source.probed).sort((a, b) => b.probed - a.probed).slice(0, 12)
    .map(source => ({label: source.origin, parts: [[Math.round((100 * source.found) / source.probed), C.accent, 'useful']], after: `${n(source.found)}/${n(source.probed)}`,
      tip: `${source.origin}: ${n(source.found)} useful feeds of ${n(source.probed)} probed`}));
  return `<div class="grid2"><section class="card"><h2>🧭 Which source fills which kind</h2><small class="muted">Employers in the list by the source that found them. <span style="color:${C.accent}">■</span> outside IT · <span style="color:${C.gray}">■</span> software · <span style="color:#3a414a">■</span> not counted yet. Hover for the kinds.</small>
${bars(kinds, {empty: 'Comes with the central scout\'s next publish.'})}</section>
<section class="card"><h2>🔭 Yield per source</h2><small class="muted">Share of probed candidates that gave a useful job feed; right: useful / probed.</small>
${bars(yieldBars, {max: 100, unit: '%', empty: 'Nothing probed yet.'})}</section></div>`;
}

export function runs(central) {
  const list = central?.runs || [];
  const items = list.map(run => ({value: run.found, tip: `${run.at.replace('T', ' ')} · ${run.found} found of ${run.checked} checked · ${run.added} new names · ideas: ${cellName(run.cell) || 'its usual search'}`}));
  const found = list.reduce((sum, run) => sum + run.found, 0), added = list.reduce((sum, run) => sum + run.added, 0);
  return `<section class="card"><h2>⏱️ Central scout runs</h2><small class="muted">Employers with a readable job site each run found (last ${list.length || 60} runs, every 6 hours); hover for the cell its ideas aimed at.${list.length ? ` Together: ${n(found)} found, ${n(added)} new names.` : ''}</small>
${columns(items, {label: 'Employers found per run'})}</section>`;
}
