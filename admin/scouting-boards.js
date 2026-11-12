// The "Job boards with 3+ local jobs" card of /admin/job-search/scouting (12 Nov 2026, owner via sa: per country and kind of work, how many boards the Scout published, how that moved,
// when each country was last measured). Data: shared/board-counts.js (counts only, never a board's address). The 30 test profiles' cells (shared/test-profiles.json) are outlined; one at 0 is red.
// Guard: test/unit/admin/scouting-boards.test.js.
import {EUROPE} from '../shared/pool-tags.js';
import {PROFILE_CELLS} from '../shared/board-counts.js';
import {reachLegend, reachMap} from '../shared/board-reach.js';
import {countryName} from '../shared/scoutingvisual.js';
import {CHIP_STYLE, chip} from './chip.js';
import {columns, figure, tipOf} from './viz.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
// The pool's role families (shared/pool-tags.js FAMILIES) in words; src/pool_tags.py says what each covers.
export const FAMILY_NAMES = {photography: 'Photography', video_film: 'Video & film', graphic_design: 'Graphic design', writing_content: 'Writing & content', marketing_social: 'Marketing & social',
  retail_sales: 'Retail sales', b2b_sales: 'B2B sales', customer_service: 'Customer service', warehouse: 'Warehouse', driving_delivery: 'Driving & delivery', kitchen: 'Kitchen',
  service_hotel: 'Hotel & service', nursing_care: 'Nursing & care', medical: 'Medical', pharmacy_lab: 'Pharmacy & lab', teaching: 'Teaching', childcare: 'Childcare',
  accounting_finance: 'Accounting & finance', admin_office: 'Office & admin', hr_recruiting: 'HR & recruiting', legal: 'Legal', construction: 'Construction',
  electrical_mechanical: 'Electrical & mechanical', cleaning_facility: 'Cleaning & facility', security_guard: 'Security', software_dev: 'Software', sre_devops_cloud: 'DevOps & cloud',
  data_ai: 'Data & AI', product_project: 'Product & project', it_support: 'IT support'};
const familyName = family => FAMILY_NAMES[family] || family;
const DAY = 86400000;
const isoDay = (now, back = 0) => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10);

/** A country's last measured day as a chip: today or yesterday green, up to 7 days amber, older red (its boards leave at 30 days), never measured a grey "–" (the key says so). */
export function lastChip(day, now) {
  if (!day) return chip('–', 'off');
  const ago = Math.round((Date.parse(isoDay(now)) - Date.parse(day)) / DAY);
  return chip(esc(ago <= 0 ? 'today' : `${ago} d`), ago <= 1 ? 'good' : ago <= 7 ? 'warn' : 'bad');
}

/** The last 30 days, oldest first: each day's snapshot or a gap (null, a hollow column: no publish wrote one), with today taken from the live counts. */
export function days30(history, now, live) {
  const byDay = new Map(history.map(row => [row.day, row]));
  return Array.from({length: 30}, (_, i) => {
    const day = isoDay(now, 29 - i), row = i === 29 ? {total: live.total, profiles: live.profiles} : byDay.get(day) || {total: null, profiles: null};
    const tip = row.total == null ? `${day}: no snapshot that day` : `${day}${i === 29 ? ' (now)' : ''}: ${row.total} boards · ${row.profiles} of ${PROFILE_CELLS.length} test profiles with a board`;
    return {day, values: [row.total, row.profiles], tip};
  });
}

// Why (12 Nov 2026, bw shots): 24 country columns ran past a 1440 px card and, on a phone, the family names scrolled away; small header chips and a pinned first column.
const BOARDS_STYLE = `${CHIP_STYLE}.bd-grid td,.bd-grid th{text-align:center;font-variant-numeric:tabular-nums;padding:5px 2px;min-width:32px}.bd-grid th.f{text-align:left;white-space:nowrap;position:sticky;left:0;z-index:1;background:#14181d;padding-right:8px}
.bd-grid th small{display:block;font-weight:400;margin-top:3px}.bd-grid th small .chip{padding:0 5px;font-size:11px}.bd-grid td.p{box-shadow:inset 0 0 0 2px #3987e5;border-radius:6px}.bd-grid td.z{color:#5b636c}.bd-grid td.n{background:#184f95;color:#f4efe3;border-radius:6px}
.bd-grid td.n.hi{background:#3987e5;color:#0b0d10}.bd-key{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#8d949c;margin-top:8px}.bd-key i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:5px}`;

// Why (12 Nov 2026, owner picked "Map + totals only" for the website; Admin keeps names): the same tile map as /coverage with counts, a violet dot where a multi-country
// board reaches, and each multi-country board by name. Colours from .vz (admin/viz-core.js), so light and dark both read.
const REACH_STYLE = `.reach-map{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:4px;max-width:420px}.reach-map .tile{aspect-ratio:1;border-radius:5px;display:grid;place-content:center;text-align:center;font:600 11px/1.15 ui-monospace,Menlo,monospace;position:relative;color:var(--vz-text)}
.reach-map .tile b{font-size:11px;font-weight:600}.reach-map .tile small{font-weight:500;font-size:10.5px}.vz .h0{background:var(--vz-track);color:var(--vz-muted)}.vz .h2{background:color-mix(in oklab,var(--s1) 35%,var(--vz-card))}.vz .h4{background:color-mix(in oklab,var(--s1) 65%,var(--vz-card))}
.vz .h6{background:var(--s1);color:var(--vz-ink)}.reach-map .tile.shared::after{content:"";position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--s6);box-shadow:0 0 0 1.5px var(--vz-card)}
.reach-key{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12.5px;color:var(--vz-muted);margin-top:8px}.reach-key span{display:inline-flex;align-items:center;gap:5px}.reach-key i{display:inline-block;width:12px;height:12px;border-radius:3px}.reach-key i.dot{border-radius:50%;background:var(--s6)}
.reach-wrap{display:flex;gap:18px 28px;flex-wrap:wrap;align-items:flex-start}.reach-wrap table{min-width:260px}`;

/** Local vs multi-country boards on the tile map, with each multi-country board's name, hosts and countries (Admin only: names never reach the website). */
export function reachBlock(reach) {
  if (!reach?.boards) return '';
  const rows = reach.multi.map(board => `<tr><td><b>${esc(board.brand)}</b><br><small class="muted">${board.hosts.map(esc).join(', ')}</small></td><td>${board.countries.map(c => c.toUpperCase()).join(' · ')}</td></tr>`).join('');
  const table = reach.multi.length ? `<table><tr><th>Multi-country board</th><th>Countries</th></tr>${rows}</table>` : '<p class="muted">No brand measured in 2+ countries yet.</p>';
  return `<style>${REACH_STYLE}</style><h3 class="vz-sub">Across Europe: ${reach.local} local · ${reach.multi.length} multi-country</h3>
<small class="muted">Grouped by brand: acme-jobs.at and acme-jobs.es would be one board in two countries. The website shows this map without numbers, dots or names.</small>
<div class="vz"><div class="reach-wrap"><div>${reachMap(reach)}<div class="reach-key">${reachLegend()}</div></div>${table}</div></div>`;
}

/**
 * The card. `boards` = gatherBoards (shared/board-counts.js): {total, cells, last, profiles, history, start}; `start` is the Worker's last start of the discovery workflow ({at, ok, reason} or null).
 * Rows: every family with a board or a test profile; columns: every country with a board or a test profile, Europe's order first. Zero reads as zero: a profile cell at 0 is a red chip.
 */
export function boardsSection(boards, now = new Date()) {
  const {total = 0, cells = {}, last = {}, profiles = 0, history = [], start = null, paused = false} = boards || {};
  const profileAt = new Map();
  for (const cell of PROFILE_CELLS) { const key = `${cell.family}|${cell.country}`; profileAt.set(key, [...(profileAt.get(key) || []), cell.id]); }
  const used = Object.keys(cells).map(key => key.split('|'));
  const order = country => (EUROPE.includes(country) ? EUROPE.indexOf(country) : 100);
  const countries = [...new Set([...used.map(([, c]) => c), ...PROFILE_CELLS.map(cell => cell.country)])].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const familyTotal = family => countries.reduce((sum, c) => sum + (cells[`${family}|${c}`] || 0), 0);
  const families = [...new Set([...used.map(([f]) => f), ...PROFILE_CELLS.map(cell => cell.family)])].sort((a, b) => familyTotal(b) - familyTotal(a) || familyName(a).localeCompare(familyName(b)));
  const zero = PROFILE_CELLS.length - profiles, withBoards = new Set(used.map(([, c]) => c)).size;
  const cell = (family, country) => {
    const count = cells[`${family}|${country}`] || 0, profile = profileAt.get(`${family}|${country}`);
    const tip = `${familyName(family)} · ${countryName(country)}: ${count} board${count === 1 ? '' : 's'} with 3+ local jobs${profile ? ` · test profile${profile.length > 1 ? 's' : ''} ${profile.join(', ')}` : ''}`;
    if (profile) return `<td class="p"${tipOf(tip)}>${chip(String(count), count ? 'good' : 'bad')}</td>`;
    return `<td class="${count ? `n${count >= 3 ? ' hi' : ''}` : 'z'}"${tipOf(tip)}>${count || '·'}</td>`;
  };
  const head = `<tr><th class="f">Kind of work</th>${countries.map(c => `<th scope="col" title="${esc(countryName(c))}">${c.toUpperCase()}<small>${lastChip(last[c], now)}</small></th>`).join('')}</tr>`;
  const grid = `<div class="scroll"><table class="bd-grid">${head}${families.map(f => `<tr><th class="f" scope="row">${esc(familyName(f))}</th>${countries.map(c => cell(f, c)).join('')}</tr>`).join('')}</table></div>
<div class="bd-key"><span><i style="box-shadow:inset 0 0 0 2px #3987e5"></i>a test profile's work and country</span><span><i style="background:#184f95"></i>1–2 boards</span><span><i style="background:#3987e5"></i>3+ boards</span><span>under each country: when its boards were last measured (– never)</span></div>`;
  const days = days30(history, now, {total, profiles});
  const chart = columns(days, [{name: 'Boards published', tone: 's1'}, {name: `Test profiles with a board (of ${PROFILE_CELLS.length})`, tone: 's3'}], {whole: true, gapLabel: 'no snapshot that day', labelEvery: 5});
  const trendTable = `<table><tr><th>Day</th><th>Boards</th><th>Test profiles with a board</th></tr>${[...days].reverse().map(d => `<tr><td>${esc(d.day)}</td><td>${d.values[0] ?? '—'}</td><td>${d.values[1] ?? '—'}</td></tr>`).join('')}</table>`;
  const lead = [[`${total} boards`, total ? '' : 'bad'], [`${withBoards} countries`, ''], [`${profiles} of ${PROFILE_CELLS.length} test profiles have a board`, zero ? 'warn' : 'good'], ...(zero ? [[`${zero} test profiles at 0`, 'bad']] : [])];
  // A disabled workflow is the pause (GitHub's Disable button): grey "paused", never the red refusal its Worker starts then get.
  const discovery = paused ? chip('discovery paused: workflow disabled in GitHub', 'off') : !start ? chip('discovery timer: not started yet', 'off') : start.ok ? chip(esc(`discovery started ${start.at.slice(0, 16).replace('T', ' ')} UTC`), 'good') : chip(esc(`discovery start refused: ${start.reason}`), 'bad');
  return `<style>${BOARDS_STYLE}</style><section class="card" id="boards"><h2>📋 Job boards with 3+ local jobs</h2><small class="muted">Boards the central scout measured and published: each one listed 3+ jobs located in its country. Per role family × country; a board covering several families counts in each. A board not measured for 30 days leaves.</small>
<p class="vz-lead">${discovery}</p>
${figure({lead, chart, table: trendTable, label: 'Show the days'})}
${reachBlock(boards?.reach)}
<h3 class="vz-sub">Per kind of work and country</h3>${grid}</section>`;
}
