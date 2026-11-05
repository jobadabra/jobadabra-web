// The "Random draws" tab of /admin/job-search/lab (owner, 18 Oct 2026): one report row per daily CI draw, newest first, and the trend of jobs in places per draw (red = weak).
// Counts and seconds only (admin/search-lab-draws.js); every row says CI, so a Mac run is never compared with it. Guard: test/unit/admin/search/search-lab-draws.test.js.
import {esc} from '../shared/html.js';
import {TIME_NAMES} from './search-lab-judge.js';
import {judge} from './search-lab-draws.js';

const TONE = {usual: ['Usual', 'good'], weak: ['Weak', 'bad'], failed: ['FAILED', 'bad']};
const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);

export function trend(rows) {   // oldest left; bar height = jobs in places against the busiest draw shown
  const shown = rows.slice(0, 30).reverse(), top = Math.max(1, ...shown.map(row => row.in_places ?? 0));
  return `<div class="spark" aria-label="jobs in places per draw">${shown.map(row => `<i class="${row.verdict === 'usual' ? '' : 'weak'}" style="height:${Math.max(4, Math.round(100 * (row.in_places ?? 0) / top))}%" title="${esc(row.draw_date)}: ${num(row.in_places)}"></i>`).join('')}</div>`;
}

// The search robot's draw (26 Oct 2026, admin/search-lab-draws.js): the role it made up, the place in the note's words, the path and engine, and the funnel in one muted line.
const PATH_NAMES = {'field-change': 'field change, 2nd search', again: 'same search again'};
const where = row => (row.place_kind === 'region' ? `${row.place} (from ${row.city})` : row.place_kind === 'remote' ? `remote, from ${row.city}, ${row.country}` : row.place_kind === 'country' ? `all of ${row.country} (from ${row.city})` : `${row.city}, ${row.country}`);
function funnelLine(row) {
  let f = null;
  try { f = row.funnel ? JSON.parse(row.funnel) : null; } catch { f = null; }
  const parts = f ? [f.kinds?.length ? `kind ${f.kinds.join(', ')}` : null, f.employers_picked != null ? `${num(f.employers_picked)} employers` : null, `${num(f.boards_read)} boards`,
    `${num(f.web_searches)} web searches`, f.looked != null ? `${num(f.looked)} jobs listed` : null].filter(Boolean) : [];
  if (row.ai_usd != null) parts.push(`AI $${Number(row.ai_usd).toFixed(2)}`);
  return parts.length ? `<div class="why">${parts.map(esc).join(' · ')}</div>` : '';
}

export function drawsSection(all) {
  const rows = judge(all), weak = rows.filter(row => row.verdict !== 'usual').length;
  const body = rows.map(row => {
    const [word, tone] = TONE[row.verdict], failed = row.verdict === 'failed';
    const chips = [(row.source || 'ci').toUpperCase(), PATH_NAMES[row.path], row.engine === 'free' ? 'Free AI' : null].filter(Boolean).map(chip => `<span class="chip">${esc(chip)}</span>`).join(' ');
    return `<tr><td>${esc(row.draw_date)}</td><td><b>${esc(row.role || row.family)}</b>${row.role ? ` <span class="muted">${esc(row.family)}</span>` : ''} · ${esc(where(row))} ${chips}${funnelLine(row)}</td>
<td><span class="state ${tone}">${word}</span>${row.why.length ? `<div class="why">${row.why.map(esc).join('<br>')}</div>` : ''}</td>
<td class="num">${failed ? '–' : clock(row.first_s)}</td><td class="num">${failed ? '–' : clock(row.tenth_s)}</td><td class="num">${failed ? '–' : clock(row.fit_s)}</td>
<td class="num">${failed ? '–' : `${num(row.in_places)} · ${num(row.scored)} · ${num(row.fit70)}`}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No draw yet. The daily CI job (.github/workflows/random-draw.yml) uploads one each day.</td></tr>';
  return `<section class="card"><h2>${rows.length} draws, ${weak} weak or failed</h2><div class="sparkwrap">${trend(rows)}<span class="muted">jobs in places per draw, last 30 (red = weak or failed)</span></div></section>
<section class="card"><h2>Each daily draw</h2><div class="scroll"><table><tr><th>Date</th><th>Draw</th><th>State</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.tenth_s}</th><th class="num">${TIME_NAMES.fit_s}</th><th class="num">In places · scored · 70+</th></tr>${body}</table></div></section>
<section class="card"><h2>How a draw is judged</h2><p class="muted">A random role kind with a role the AI makes up, in a city, a country, a region or remote, on a first search, a field change then a 2nd search, or the same search again; a fictional CV, a fresh throwaway install on CI (data-centre address: a board that refuses is "not reached", never worked around). <b>Weak</b>: no relevant job reached, fewer than 10 jobs in places, or under half the role family's median once it has 5 earlier draws. Never mixed with the six candidates or the Real installs.</p></section>`;
}

export const DRAWS_CSS = `.spark{display:flex;align-items:flex-end;gap:3px;height:56px}.spark i{display:block;flex:1;background:#5fb3ff;opacity:.75;border-radius:2px 2px 0 0}.spark i.weak{background:#ff8a80;opacity:1}
.sparkwrap{display:flex;flex-direction:column;gap:6px}.tabs{display:flex;gap:8px;margin-bottom:12px}.tabs a{padding:4px 12px;border:1px solid #2a2f37;border-radius:999px;color:#8d949c;text-decoration:none;font-size:13px}.tabs a.on{color:#e6e9ed;border-color:#5fb3ff}`;
