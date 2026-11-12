// The page of /admin/job-search/benchmark (owner, 20 Oct 2026): our job search against other tools on the same random role × city searches, read from ONE snapshot. Every tool, persona and job-system name is data;
// none is written here. Colours are the shared rule (admin/applying-tiles.js). Guard: test/unit/admin/benchmark/benchmark-search.test.js.
import {esc} from '../shared/html.js';
import {filterLinks} from './admin.js';
import {CHIP_STYLE, chip} from './chip.js';
import {kindsChart} from './jobsearch-charts.js';
import {figure, VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';
import {shareTone} from './applying-tiles.js';
import {PUBLISH_STYLE, panel, searchSection} from './benchmark-publish.js';

const pct = value => (value == null ? '–' : `${value}%`);
const clock = seconds => (seconds == null ? '–' : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
const money = cents => `$${(cents / 100).toFixed(2)}`;
// The round to show: the one asked for, else the newest.
export const pickRound = (snapshot, asked) => { const keys = Object.keys(snapshot?.rounds || {}).sort(); return keys.includes(asked) ? asked : keys.at(-1) || null; };

const CSS = `:root{--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a;--red:#e5484d}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1px;margin:0 0 16px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.tile{background:var(--card);padding:14px 16px}.tile b{display:block;font-size:28px;line-height:1.2}.tile .what{display:block;font-size:14px}.tile .note{display:block;margin-top:4px;color:var(--muted);font-size:12px}
.good{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}.tile.good b,.tile.warn b,.tile.bad b{color:inherit}
td.cell{white-space:nowrap;text-align:center}tr.ours td:first-child{font-weight:700}.filters{margin:8px 0 14px}h2{margin:0 0 4px}details{margin-top:8px}.wide{overflow-x:auto}`;

function tiles(view) {
  const ours = view.tools.find(tool => tool.ours), best = view.tools.find(tool => !tool.ours && !tool.withAll);
  if (!ours) return '';
  const gap = best ? ours.relevant - best.relevant : null;
  return `<div class="tiles">
<section class="tile ${shareTone(ours.relevantShare)}"><b>${ours.relevant}</b><span class="what">Relevant jobs in place</span><span class="note">${pct(ours.relevantShare)} of ${ours.found} shown, over ${ours.personas} searches</span></section>
<section class="tile ${ours.empty ? 'warn' : 'good'}"><b>${ours.empty}</b><span class="what">Searches with none</span><span class="note">of ${ours.personas}: no relevant job in the persona's place</span></section>
<section class="tile"><b>${gap == null ? '–' : `${gap > 0 ? '+' : ''}${gap}`}</b><span class="what">Against the best other tool</span><span class="note">relevant jobs in place, ours minus theirs</span></section>
<section class="tile"><b>${clock(ours.avgSeconds)}</b><span class="what">Our time per search</span><span class="note">${best ? `${esc(best.tool)}: ${clock(best.avgSeconds)}` : ''}</span></section></div>`;
}

const scoreboard = view => `<section class="card"><h2>Score per tool</h2><p class="muted">Jobs the tool showed, judged blind by an AI that sees only title, employer and place. In place = the persona's city, a short commute or remote for their country; role = their kind of job; relevant = both.</p>
<div class="wide"><table><tr><th>Tool</th><th class="num">Searches</th><th class="num">Shown</th><th class="num">In place</th><th class="num">Right role</th><th class="num">Relevant</th><th class="num">Relevant share</th><th class="num">Employers</th><th class="num">Avg time</th><th class="num">Cost</th></tr>
${view.tools.map(tool => `<tr class="${tool.ours ? 'ours' : ''}"><td>${esc(tool.tool)}${tool.ours && tool.build ? ` <span class="muted">build ${esc(tool.build)}</span>` : ''}</td><td class="num">${tool.personas}</td><td class="num">${tool.found}</td><td class="num">${tool.place}</td><td class="num">${tool.role}</td>
<td class="num ${shareTone(tool.relevantShare)}">${tool.relevant}</td><td class="num ${shareTone(tool.relevantShare)}">${pct(tool.relevantShare)}</td><td class="num">${tool.employers}</td><td class="num">${clock(tool.avgSeconds)}</td><td class="num">${money(tool.cents)}</td></tr>`).join('')}</table></div></section>`;

function grid(view) {
  const names = view.tools.map(tool => tool.tool);
  const cell = (tool, persona) => { const c = view.grid[tool]?.[persona]; return c ? `<td class="cell ${c.relevant ? 'good' : 'bad'}">${c.relevant}<span class="muted"> / ${c.found}</span></td>` : '<td class="cell muted">n/a</td>'; };
  return `<section class="card"><h2>Per search</h2><p class="muted">Relevant jobs in place / jobs shown. Red = none relevant.</p><div class="wide"><table><tr><th>Search</th><th>Kind</th>${names.map(name => `<th class="cell">${esc(name)}</th>`).join('')}</tr>
${view.personas.map(p => `<tr><td>${esc(p.persona)} <span class="muted">${esc(p.country)}</span></td><td>${chip(esc(p.kind))}</td>${names.map(name => cell(name, p.persona)).join('')}</tr>`).join('')}</table></div></section>`;
}

const kinds = view => `<section class="card"><h2>Tech and non-tech</h2><p class="muted">Relevant jobs in place per kind of role, the share of shown jobs.</p>${figure({chart: kindsChart(view), table: `<div class="wide"><table><tr><th>Tool</th><th class="num">Tech</th><th class="num">Non-tech</th></tr>
${view.tools.map(tool => { const t = view.kinds.tech?.[tool.tool], n = view.kinds['non-tech']?.[tool.tool]; const show = x => (x ? `${x.relevant} <span class="muted">(${pct(x.relevantShare)})</span>` : '–'); return `<tr class="${tool.ours ? 'ours' : ''}"><td>${esc(tool.tool)}</td><td class="num">${show(t)}</td><td class="num">${show(n)}</td></tr>`; }).join('')}</table></div>`})}</section>`;

const beyond = view => ((view.beyond || []).length ? `<section class="card"><h2>Relevant jobs we add beyond each rival</h2><p class="muted">Ours with every source on: jobs the judge found relevant and in place that this rival did not show. A search where the rival's own search failed is not counted for it (last column), so its total is not a smaller number made to look complete.</p>
<table><tr><th>Rival</th><th class="num">Jobs we add</th><th class="num">Searches not counted</th></tr>${view.beyond.map(([rival, n, missing]) => `<tr><td>${esc(rival)}</td><td class="num">${missing >= view.beyondSearches ? '–' : n}</td><td class="num ${missing ? 'warn' : 'muted'}">${missing ? `${missing} of ${view.beyondSearches}` : '–'}</td></tr>`).join('')}</table></section>` : '');
const missed = view => (view.missed.length ? `<section class="card"><h2>Relevant jobs we miss, by job system</h2><p class="muted">Jobs another tool showed that the judge found relevant and in place, and ours did not show: where they came from (the other tool's own provider name).</p>
<table><tr><th>Job system</th><th class="num">Jobs we miss</th></tr>${view.missed.map(([system, n]) => `<tr><td>${esc(system)}</td><td class="num">${n}</td></tr>`).join('')}</table></section>` : '');

const METHOD = `<section class="card"><details><summary>How this is measured</summary>
<ul><li>The same random role × city personas for both tools, run on the same day (within the hour per persona); the pick is seeded and recorded.</li>
<li>The other tool runs out of the box on a GitHub runner from a pinned release; only its role keywords and place are filled in, by script, the same rule for every persona.</li>
<li>Ours runs as shipped, on a throwaway install with a fictional candidate. Compared: jobs found in places, before any scoring, so neither tool's own scoring AI is in the comparison.</li>
<li>Both lists are pooled per persona, shuffled and judged blind; every rule applies to both. No posting texts are kept, only titles, employers and places.</li>
<li>Biases: the other tool's example config leans to AI and tech; keywords are the English job title; single runs.</li></ul></details></section>`;

export function page(snapshot, {round, published, confirm} = {}) {
  const key = pickRound(snapshot, round), view = key ? snapshot.rounds[key] : null, keys = Object.keys(snapshot?.rounds || {}).sort().reverse();
  const body = !view ? `<section class="card"><h2>No data yet</h2><p class="muted">The bake-off's search-bench publish step sends every scored round here (<code>PUT /benchmark-search/data</code>); the first round fills this page.</p></section>`
    : `${published ? panel({kind: 'search', round: key, part: searchSection(key, view, snapshot.at), published, ask: confirm === 'publish'}) : ''}${keys.length > 1 ? filterLinks(keys.map(k => [k, k, `?round=${encodeURIComponent(k)}`]), key) : ''}${tiles(view)}${scoreboard(view)}${grid(view)}${kinds(view)}${missed(view)}${beyond(view)}${METHOD}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Benchmark Job Search · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CSS}${PUBLISH_STYLE}${CHIP_STYLE}${VIZ_STYLE}</style></head><body><main>
<header><h1>🏁 Benchmark Job Search</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC${key ? ` · round ${esc(key)}` : ''}` : ''}</span></header>
${body}</main>${VIZ_TOOLTIP}</body></html>`;
}
