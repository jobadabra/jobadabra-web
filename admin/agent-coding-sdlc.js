// The SDLC tab of /admin/agents/agent-coding (owner, 1 Nov 2026: "the entire harness/workflow of our development ... speccing, plan, build, maintain" and "what brings value and it's fast / value but slow /
// slow and don't bring value / fast and brings no value"). Three cards: the path (hooks → push gate → PR checks → main → beta/nightly → bugs the owner saw), the four phases, and the Checks grid
// (every check by cost and real catches). Pure: rows in, HTML out; report only, nothing here blocks. Data: kinds gate + ci + sdlc (admin/agent-coding.js). Test: test/unit/admin/agent-coding-sdlc.test.js.
import {esc} from '../shared/html.js';
import {TIP_STYLE, TOOLTIP} from '../shared/scoutingcharts.js';
import {HOOKS, STYLE, TABS_STYLE, tabs, weeksOf, weekWords, sum, pct, round1, bar, legend, chip, note, card} from './agent-coding-page.js';

const WINDOW_WEEKS = 4;   // the grid pools the last 4 weeks: one week has too few runs for the slow checks
const MIN_RUNS = 20;      // under this a check is "too few runs", never put in a corner
// Why (1 Nov 2026): a corner is a plain rule the owner can read: slow = a minute or more per run; valuable = at least one real catch (a red a product or test fix followed) per 100 runs.
const SLOW_SECS = 60, VALUE_PER_100 = 1;
export const CORNERS = {
  faster: {word: 'Make faster', icon: '⏱', note: 'slow, but it catches real bugs', color: '#f2c14e', order: 1},
  remove: {word: 'Remove?', icon: '✂', note: 'slow, and nothing real caught', color: '#e5484d', order: 0},
  quiet: {word: 'Cheap, quiet', icon: '·', note: 'fast, and nothing real caught', color: '#8d949c', order: 2},
  keep: {word: 'Keep', icon: '✓', note: 'fast, and it catches real bugs', color: '#5ec47a', order: 3},
  few: {word: 'Too few runs', icon: '…', note: `under ${MIN_RUNS} runs in 4 weeks`, color: '#5b6470', order: 4},
};
const LAYERS = {push: 'Push gate', pr: 'PR checks', main: 'Main', night: 'Beta / nightly'};
const LAYER_COLORS = {push: '#6aa8ff', pr: '#b48cff', main: '#f2c14e', night: '#5ec47a'};
const CATCH_KEYS = ['product', 'test', 'ci', 'form', 'flaky', 'rebase', 'nofix'];

/** One entry per check over the given weeks: {layer, name, runs, stops, real, form, flaky, secs, perRun} from the push-gate upload (stops of a form check are form, any other stop is real) and the sdlc upload (real = product or test fix followed). */
export function checksOf(weeks) {
  const all = new Map(), at = (layer, name) => { const key = `${layer}|${name}`; if (!all.has(key)) all.set(key, {layer, name, runs: 0, stops: 0, real: 0, form: 0, flaky: 0, secs: 0}); return all.get(key); };
  for (const week of weeks) {
    for (const day of week.gate) for (const [name, step] of Object.entries(day.steps)) { const c = at('push', name); c.runs += step.runs; c.stops += step.fails; c.secs += step.secs; c[step.cls === 'form' ? 'form' : 'real'] += step.fails; }
    for (const day of week.sdlc) for (const layer of ['pr', 'main', 'night']) for (const [name, step] of Object.entries(day.layers[layer] || {})) {
      const c = at(layer, name); c.runs += step.runs; c.stops += step.fails; c.secs += step.secs; c.real += step.catches.product + step.catches.test; c.form += step.catches.form; c.flaky += step.catches.flaky;
    }
  }
  return [...all.values()].map(c => ({...c, perRun: c.runs ? c.secs / c.runs : 0}));
}
/** The corner of one check: 'few' under MIN_RUNS, else slow (>= SLOW_SECS per run) x valuable (real catches per 100 runs >= VALUE_PER_100). */
export function cornerOf(check) {
  if (check.runs < MIN_RUNS) return 'few';
  const slow = check.perRun >= SLOW_SECS, valuable = check.real > 0 && check.real / check.runs * 100 >= VALUE_PER_100;
  return valuable ? (slow ? 'faster' : 'keep') : (slow ? 'remove' : 'quiet');
}

const seconds = value => (value >= 90 ? `${round1(value / 60)} min` : `${round1(value)} s`);
const hours = secs => (secs >= 3600 ? `${round1(secs / 3600)} h` : `${Math.round(secs / 60)} min`);

// The ten checks that spent the most time, numbered 1-10: the dots and the table's first column use the same numbers (names would collide in the crowded middle of the chart).
const numbered = checks => new Map([...checks].filter(c => c.runs >= MIN_RUNS).sort((a, b) => b.secs - a.secs).slice(0, 10).map((c, i) => [`${c.layer}|${c.name}`, i + 1]));

/** The id of one check's row in the table (a dot's link points at it): layer and name, lowercased, other characters as dashes. */
export const checkId = c => `check-${c.layer}-${String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/**
 * The chart of every check (time per run x real catches per 100 runs). `small` is the same chart in a smaller viewBox for the Agent Coding Overview; `href` says where a dot goes (default: its row in the table on the same page).
 * Why (2 Nov 2026, owner: "make this graph's circles clickable or with tooltips; bring it, smaller, to the overview"): each dot is a link with the page's shared [data-tip] tooltip (keyboard focus shows it too), not a native <title>.
 */
function scatter(checks, numbers, {small = false, href = c => `#${checkId(c)}`} = {}) {
  const W = small ? 460 : 640, H = small ? 250 : 320, L = 44, B = 34, T = 12, R = 12, lo = Math.log10(0.1), hi = Math.log10(1500);
  const x = perRun => L + (Math.log10(Math.max(0.1, Math.min(1500, perRun))) - lo) / (hi - lo) * (W - L - R);
  const top = Math.max(5, ...checks.filter(c => c.runs >= MIN_RUNS).map(c => c.real / c.runs * 100)), y = per100 => T + (1 - Math.sqrt(Math.min(per100, top) / top)) * (H - T - B);   // square-root: most checks sit near zero
  const ticks = [[0.1, '0.1 s'], [1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min']], yTicks = [0, 1, 5, 20, 50].filter(v => v <= top);
  const dots = checks.filter(c => c.runs >= MIN_RUNS).map(c => ({c, cx: x(c.perRun), cy: y(c.real / c.runs * 100)})).sort((a, b) => b.c.secs - a.c.secs);
  return `<svg class="ac-scatter${small ? ' ac-small' : ''}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Every check by seconds per run (left to right, log scale) and real catches per 100 runs (bottom to top, square-root scale); the ten that spent the most time are numbered like the table">
<rect x="${x(SLOW_SECS)}" y="${T}" width="${W - R - x(SLOW_SECS)}" height="${y(VALUE_PER_100) - T}" fill="#f2c14e" opacity=".06"/><rect x="${x(SLOW_SECS)}" y="${y(VALUE_PER_100)}" width="${W - R - x(SLOW_SECS)}" height="${H - B - y(VALUE_PER_100)}" fill="#e5484d" opacity=".08"/>
<line x1="${x(SLOW_SECS)}" x2="${x(SLOW_SECS)}" y1="${T}" y2="${H - B}" stroke="#3a424b" stroke-dasharray="4 4"/><line x1="${L}" x2="${W - R}" y1="${y(VALUE_PER_100)}" y2="${y(VALUE_PER_100)}" stroke="#3a424b" stroke-dasharray="4 4"/>
${ticks.map(([v, t]) => `<text x="${x(v)}" y="${H - 16}" fill="#8d949c" font-size="11" text-anchor="middle">${t}</text>`).join('')}${yTicks.map(v => `<text x="${L - 6}" y="${y(v) + 4}" fill="#8d949c" font-size="10" text-anchor="end">${v}</text>`).join('')}
<text x="${L + 6}" y="${T + 12}" fill="#5ec47a" font-size="11">Keep</text><text x="${W - R - 4}" y="${T + 12}" fill="#f2c14e" font-size="11" text-anchor="end">Make faster</text><text x="${W - R - 4}" y="${H - B - 6}" fill="#e5484d" font-size="11" text-anchor="end">Remove?</text><text x="${L + 6}" y="${H - B - 6}" fill="#8d949c" font-size="11">Cheap, quiet</text>
<text x="${(L + W - R) / 2}" y="${H - 2}" fill="#8d949c" font-size="11" text-anchor="middle">time per run →</text><text x="10" y="${(T + H - B) / 2}" fill="#8d949c" font-size="11" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})">real catches per 100 runs</text>
${dots.map(({c, cx, cy}) => { const n = numbers.get(`${c.layer}|${c.name}`), r = n ? 9 : Math.max(3.5, Math.min(7, 2.5 + Math.sqrt(c.secs / 900)));
    const tip = `${c.name} · ${LAYERS[c.layer]} · ${seconds(c.perRun)} per run · ${round1(c.real / c.runs * 100)} real catches per 100 runs · ${c.runs} runs`;
    return `<a class="ac-dot" href="${esc(href(c))}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${LAYER_COLORS[c.layer]}" fill-opacity="${n ? 0.95 : 0.6}" stroke="#0d1013"/>${n ? `<text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" fill="#0d1013" font-size="10" font-weight="700" text-anchor="middle">${n}</text>` : ''}</a>`; }).join('')}
</svg>`;
}

function gridCard(weeks) {
  const checks = checksOf(weeks.slice(0, WINDOW_WEEKS));
  if (!checks.length) return card('grid', 'Checks: value and cost', 'every check, last 4 weeks', '<p class="muted">No upload yet.</p>');
  const rows = checks.map(c => ({...c, corner: cornerOf(c)})).sort((a, b) => CORNERS[a.corner].order - CORNERS[b.corner].order || b.secs - a.secs);
  const count = key => rows.filter(r => r.corner === key).length;
  const numbers = numbered(checks), table = rows.map(r => `<tr id="${checkId(r)}"><td class="num">${numbers.get(`${r.layer}|${r.name}`) || ''}</td><td>${esc(r.name)}</td><td><span class="ac-tag" style="--c:${LAYER_COLORS[r.layer]}">${esc(LAYERS[r.layer])}</span></td><td class="num">${r.runs}</td><td class="num">${r.stops}</td><td class="num">${r.real}</td><td class="num">${r.form || '·'}</td><td class="num">${r.flaky || '·'}</td><td class="num">${seconds(r.perRun)}</td><td class="num">${hours(r.secs)}</td><td><span class="ac-tag" style="--c:${CORNERS[r.corner].color}" title="${esc(CORNERS[r.corner].note)}">${CORNERS[r.corner].icon} ${esc(CORNERS[r.corner].word)}</span></td></tr>`).join('');
  const layers = Object.entries(LAYERS).map(([key, word]) => `<span><b style="background:${LAYER_COLORS[key]}"></b>${esc(word)}</span>`).join('');
  return card('grid', 'Checks: value and cost', 'every check, last 4 weeks pooled', `${scatter(checks, numbers)}<p class="ac-legend">${layers}<span>numbers = the ten checks that spent the most time (same numbers in the table)</span></p>
<p class="ac-corners">${['remove', 'faster', 'quiet', 'keep'].map(key => `<span class="ac-chip" style="color:${CORNERS[key].color}">${CORNERS[key].icon} ${count(key)} ${esc(CORNERS[key].word)}</span>`).join('')}</p>
<div class="ac-wide"><table><thead><tr><th class="num">#</th><th>Check</th><th>Layer</th><th class="num">Runs</th><th class="num">Stops</th><th class="num">Real catches</th><th class="num">Form</th><th class="num">Flaky</th><th class="num">Per run</th><th class="num">Time</th><th>Verdict</th></tr></thead><tbody>${table}</tbody></table></div>
${note(`Slow = ${SLOW_SECS} s or more per run. A real catch = a red that a product or test fix followed (push gate: any stop that is not a form check). Form stops and flaky stops are shown, not counted as value. A guess from the fixing commit, about ±10 points. Checks under ${MIN_RUNS} runs are not placed. "Remove?" is a question, not a verdict: a safety net that never fires (a smoke run, a login-wall guard) looks the same here as a check that does nothing.`)}`);
}

// Why (1 Nov 2026, owner's yes on the layer-0 counter): the agent's hooks log a block per fixed label; the upload carries `hooks` only on a day with a block, so "not measured yet" holds until the first block is seen.
function hooksRow(weeks, now) {
  if (!weeks.some(week => week.gate.some(day => day.hooks))) return `<tr><td>Agent hooks</td><td colspan="5" class="muted">not measured yet: no hook has blocked anything since the counter was turned on</td></tr>`;
  const per = HOOKS.map(key => [key, sum(now.gate, day => day.hooks?.[key] || 0)]), total = sum(per, item => item[1]);
  return `<tr><td>Agent hooks</td><td class="num">·</td><td class="num">${total}</td><td colspan="3">${total ? per.filter(item => item[1]).map(([key, n]) => `${esc(key)} <b>${n}</b>`).join(' · ') : '<span class="muted">no blocks this week</span>'}</td></tr>`;
}

function pathCard(weeks) {
  const now = weeks.find(week => week.sdlc.length || week.gate.length) || weeks[0];   // the newest week with an upload: on a Monday before the first upload this week is empty
  const catches = layer => CATCH_KEYS.map(key => [key, sum(now.sdlc, day => sum(Object.values(day.layers[layer] || {}), check => check.catches[key]))]);
  const layerRow = (name, runs, stops, parts, secs, extra = '') => `<tr><td>${name}</td><td class="num">${runs}</td><td class="num">${stops}</td><td class="ac-cell">${stops ? bar(parts) : '<span class="muted">no stops</span>'}</td><td class="num">${hours(secs)}</td><td>${extra}</td></tr>`;
  const gate = ['form', 'real', 'other'].map(key => [key, sum(now.gate, day => day.stopped[key])]);
  const rows = [hooksRow(weeks, now),
    now.gate.length ? layerRow('Push gate', sum(now.gate, day => day.pushes), sum(gate, g => g[1]), gate, sum(now.gate, day => day.secs)) : '',
    ...['pr', 'main', 'night'].map(layer => { const runs = sum(now.sdlc, day => sum(Object.values(day.layers[layer] || {}), c => c.runs)), stops = sum(now.sdlc, day => sum(Object.values(day.layers[layer] || {}), c => c.fails));
      return runs ? layerRow(LAYERS[layer], runs, stops, catches(layer), sum(now.sdlc, day => sum(Object.values(day.layers[layer] || {}), c => c.secs))) : ''; }),
    `<tr><td>Bugs the owner saw</td><td colspan="2" class="num">${sum(now.sdlc, day => day.bugs)}</td><td colspan="3" class="muted">issues opened with the bug label this week (they got past every layer above)</td></tr>`].join('');
  return card('path', 'The path', `week from ${esc(weekWords(now.start))}: where the work goes and what each layer stops`, `<div class="ac-wide"><table><thead><tr><th>Layer</th><th class="num">Runs</th><th class="num">Stops</th><th>What the stops were</th><th class="num">Time</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
${legend(['form', 'real', 'other'])}${legend(CATCH_KEYS.filter(key => key !== 'form'))}${note('Push gate: form = a trailer, comment, list or size check; real suite red = a suite. Other layers: what fixed each red, from the first later green commit.')}`);
}

const SIGNALS = [
  ['Spec', [['merged PRs with no spec or doc', w => sum(w.sdlc, d => d.phases.nospec), w => sum(w.sdlc, d => d.phases.merged), 'of']]],
  ['Plan', [['PRs closed unmerged', w => sum(w.sdlc, d => d.phases.unmerged)], ['commits per merged PR', w => round1(sum(w.sdlc, d => d.phases.prCommits) / (sum(w.sdlc, d => d.phases.merged) || 1))]]],
  ['Build', [['PR check stops per merged PR', w => round1(sum(w.sdlc, d => sum(Object.values(d.layers.pr || {}), c => c.fails)) / (sum(w.sdlc, d => d.phases.merged) || 1))]]],
  ['Maintain', [['fix PRs within 7 days of a merge in the same area', w => sum(w.sdlc, d => d.phases.fixAfter)], ['reverts', w => sum(w.sdlc, d => d.phases.reverts)], ['days main was red', w => sum(w.sdlc, d => d.phases.redMain)]]],
];
// Why (1 Nov 2026, Gitar on web #251): this week is only the days uploaded so far, so a count compared with a full last week always read "better" early in the week. The phases compare the last two COMPLETE weeks.
function phasesCard(weeks) {
  const [, now, before] = weeks;
  if (!now.sdlc.length) return card('phases', 'The four phases', 'spec, plan, build, maintain', '<p class="muted">No SDLC upload yet for a full week.</p>');
  const body = SIGNALS.map(([phase, signals]) => signals.map(([text, pick, whole], i) => { const a = pick(now), b = before.sdlc.length ? pick(before) : null, w = whole ? whole(now) : 0;
    const arrow = b === null ? '<span class="muted">no earlier week</span>' : a > b * 1.2 + 0.05 ? '<span class="ac-up">▲ worse than the week before</span>' : a < b * 0.8 - 0.05 ? '<span class="ac-down">▼ better than the week before</span>' : '<span class="muted">≈ same as the week before</span>';
    return `<tr>${i ? '' : `<td rowspan="${signals.length}"><b>${phase}</b></td>`}<td>${esc(text)}</td><td class="num">${a}${whole ? ` of ${w} · ${pct(a, w)}%` : ''}</td><td>${arrow}</td></tr>`; }).join('')).join('');
  return card('phases', 'The four phases', `spec, plan, build, maintain: the week from ${esc(weekWords(now.start))} against the one before`, `<div class="ac-wide"><table><tbody>${body}</tbody></table></div>${note('Signals, not verdicts: they point at the phase to look at. A PR with no spec is one that changes product files without a spec or doc file.')}`);
}

function verdict(weeks) {
  const checks = checksOf(weeks.slice(0, WINDOW_WEEKS)).map(c => ({...c, corner: cornerOf(c)})), n = key => checks.filter(c => c.corner === key);
  const lost = sum(n('remove'), c => c.secs);
  const parts = [chip(n('remove').length ? 'warn' : 'good', `${n('remove').length} slow checks caught nothing real${lost ? ` (${hours(lost)} in 4 weeks)` : ''}`), chip(n('faster').length ? 'warn' : 'good', `${n('faster').length} checks catch real bugs but are slow`), chip('good', `${n('keep').length} fast checks that catch real bugs`)];
  return `<section class="card ac-verdict"><h2>Where the time goes <span class="muted">· last ${WINDOW_WEEKS} weeks</span></h2><div class="ac-chips">${parts.join('')}</div></section>`;
}

export const STYLE2 = `.ac-scatter{width:100%;height:auto;display:block}.ac-wide{overflow-x:auto}.ac-cell{min-width:140px}.ac-corners{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.ac-chip{white-space:normal}.ac-up{color:#ff8f84}.ac-down{color:#5ec47a}td.num,th.num{text-align:right}
.ac-dot{cursor:pointer;outline:none}.ac-dot:hover circle,.ac-dot:focus circle{stroke:#fff;stroke-width:2}.ac-wide tr:target td{background:#1d2a3a}.ac-scatter.ac-small{max-width:480px}.ac-mini{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}.ac-mini>div{flex:1 1 260px;min-width:0}
.ac-wide table{width:100%;border-collapse:collapse}.ac-wide td,.ac-wide th{padding:5px 8px;border-bottom:1px solid #1d232a;font-size:13px;text-align:left;vertical-align:top}.ac-wide td.num,.ac-wide th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}`;

/** The SDLC tab: rows [{kind, day, card: JSON string, updated_at}] + a clock in, HTML out. */
export function sdlcPage(rows, now = new Date()) {
  const weeks = weeksOf(rows, now), at = rows.map(item => item.updated_at).filter(Boolean).sort().at(-1);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>SDLC · Agent coding · Agent Coding · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}${TABS_STYLE}${STYLE2}${TIP_STYLE}</style></head><body><main>
<header><h1>🧭 Agent coding</h1><span class="muted ac-top">the whole path${at ? ` · data as of ${esc(at.slice(0, 16).replace('T', ' '))} UTC` : ''} · <a href="/admin/testing/pr-checks">per-check scorecard →</a></span></header>
${tabs('sdlc')}${verdict(weeks)}${gridCard(weeks)}${pathCard(weeks)}${phasesCard(weeks)}</main>${TOOLTIP}</body></html>`;
}

/**
 * The same chart, smaller, as a card for the Agent Coding Overview (owner, 2 Nov 2026: "bring this graph, probably in a smaller size, to the overview"): each dot goes to its row on the SDLC tab, and the card links to the full chart.
 * Rows as in `sdlcPage`; '' when no check has enough runs yet. The page that shows it needs STYLE2, TIP_STYLE and TOOLTIP.
 */
export function checksCard(rows, now = new Date()) {
  const checks = checksOf(weeksOf(rows, now).slice(0, WINDOW_WEEKS));
  if (!checks.some(c => c.runs >= MIN_RUNS)) return '';
  const count = key => checks.filter(c => cornerOf(c) === key).length, link = '/admin/agents/agent-coding?tab=sdlc';
  const chips = ['remove', 'faster', 'quiet', 'keep'].map(key => `<span class="ac-chip" style="color:${CORNERS[key].color}">${CORNERS[key].icon} ${count(key)} ${esc(CORNERS[key].word)}</span>`).join('');
  return `<section class="card" id="checks"><h2>Checks: value and cost <span class="muted">· last ${WINDOW_WEEKS} weeks</span></h2><div class="ac-mini"><div>${scatter(checks, numbered(checks), {small: true, href: c => `${link}#${checkId(c)}`})}</div>
<div><p class="ac-corners">${chips}</p><p class="muted">Each circle is one check; hover or focus it for its numbers, click it for its row in the table.</p><p><a href="${link}">Open the full chart and table →</a></p></div></div></section>`;
}
