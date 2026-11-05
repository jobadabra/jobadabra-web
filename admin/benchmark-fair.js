// The fair round on /admin/form-filling/benchmark (owner, 27 Oct 2026: "the one score that every filling fix is judged by"): the same AI for
// every tool (Haiku 5.5), forms we never tested or fixed on, a blind judge. Two kinds of round: the fixed set (a fix is measured before and
// after on it) and a weekly new set. Each row is one tool on one form in one repeat, split right / wrong / empty-but-answerable / not reached;
// score = right / (right + wrong + empty + not reached). Rows of the old rounds (round 'old') never mix in. Names arrive as data.
// Guard: test/unit/admin/benchmark-fair.test.js.
import {esc} from '../shared/html.js';
import {shareTone} from './applying-tiles.js';

export const ROUND = /^(old|fixed|week-\d{4}-W\d{2})$/;
export const isFair = row => (row.round || 'old') !== 'old';
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const split = rows => rows.reduce((t, r) => ({right: t.right + r.right, wrong: t.wrong + r.wrong, empty: t.empty + r.empty, unreached: t.unreached + (r.unreached || 0)}),
  {right: 0, wrong: 0, empty: 0, unreached: 0});
const scoreOf = t => share(t.right, t.right + t.wrong + t.empty + t.unreached);
const group = (rows, key) => { const map = new Map(); for (const row of rows) map.set(key(row), [...(map.get(key(row)) || []), row]); return map; };
// fixed first, then the weeks newest first
export const roundOrder = (a, b) => (a === 'fixed' ? -1 : b === 'fixed' ? 1 : b.localeCompare(a));
export const roundLabel = key => (key === 'fixed' ? 'Fixed set' : key.startsWith('week-') ? `New set, week ${key.slice(5)}` : key);

// rows (fair only) -> {rounds: {key: {at, forms, tools: [{tool, ours, build, score, low, high, reps, forms, right, wrong, empty, unreached}], grid}}}
export function fairSummary(rows) {
  const rounds = {};
  for (const [key, list] of group(rows.filter(isFair), row => row.round)) {
    const forms = [...new Set(list.map(row => row.form))].sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    const tools = [...group(list, row => row.tool)].map(([tool, own]) => {
      // ours: only the newest build in this round (a before/after on the fixed set adds a build; the older one stays in "builds")
      const newest = own.filter(r => r.ours).map(r => r.at).sort().at(-1), build = own.find(r => r.ours && r.at === newest)?.build;
      const mine = own.filter(r => !r.ours || r.build === build);
      const perRep = [...group(mine, r => r.rep || 1).values()].map(rep => scoreOf(split(rep))).filter(v => v != null);
      const t = split(mine);
      return {tool, ours: Boolean(own[0].ours), build: build || '', score: perRep.length ? Math.round(10 * perRep.reduce((a, b) => a + b, 0) / perRep.length) / 10 : null,
        low: perRep.length ? Math.min(...perRep) : null, high: perRep.length ? Math.max(...perRep) : null, reps: perRep.length, forms: new Set(mine.map(r => r.form)).size, ...t, rows: mine};
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.tool.localeCompare(b.tool));
    const grid = Object.fromEntries(tools.map(t => [t.tool, Object.fromEntries([...group(t.rows, r => r.form)].map(([form, rs]) => [form, {...split(rs), score: scoreOf(split(rs))}]))]));
    const builds = [...group(list.filter(r => r.ours), r => r.build)].map(([build, rs]) => ({build, at: rs.map(r => r.at).sort().at(-1), score: scoreOf(split(rs)), ...split(rs)}))
      .sort((a, b) => a.at.localeCompare(b.at));
    rounds[key] = {at: list.map(r => r.at).sort().at(-1), forms, tools: tools.map(({rows: _r, ...t}) => t), grid, builds};
  }
  return {rounds};
}

export const pickRound = (fair, asked) => { const keys = Object.keys(fair?.rounds || {}).sort(roundOrder); return keys.includes(asked) ? asked : keys[0] || null; };
const pct = v => (v == null ? '–' : `${v}%`);
const tone = v => shareTone(v == null ? null : Math.round(v));

export function fairBlock(fair, asked) {
  const key = pickRound(fair, asked); if (!key) return '';
  const r = fair.rounds[key], keys = Object.keys(fair.rounds).sort(roundOrder);
  const links = keys.length > 1 ? `<p class="filters">${keys.map(k => k === key ? `<b>${esc(roundLabel(k))}</b>` : `<a href="?round=${encodeURIComponent(k)}">${esc(roundLabel(k))}</a>`).join(' · ')}</p>` : '';
  const rows = r.tools.map(t => `<tr class="${t.ours ? 'ours' : ''}"><td>${esc(t.tool)}${t.ours && t.build ? ` <span class="muted">build ${esc(t.build)}</span>` : ''}</td>
<td class="num ${tone(t.score)}">${pct(t.score)}</td><td class="num muted">${t.reps > 1 ? `${t.low}–${t.high}` : '–'}</td><td class="num good">${t.right}</td>
<td class="num ${t.wrong ? 'bad' : ''}">${t.wrong}</td><td class="num">${t.empty}</td><td class="num">${t.unreached}</td><td class="num">${t.forms}</td><td class="num">${t.reps}</td></tr>`).join('');
  const names = r.tools.map(t => t.tool);
  const cell = (tool, form) => { const c = r.grid[tool]?.[form]; return c ? `<td class="cell ${tone(c.score)}">${pct(c.score)}${c.wrong ? `<span class="x bad" title="${c.wrong} wrong">✗${c.wrong}</span>` : ''}</td>` : '<td class="cell muted">n/a</td>'; };
  const builds = r.builds.length > 1 ? `<section class="card"><h2>Our builds on this set</h2><p class="muted">A fix counts only if this score moves.</p><table><tr><th>Build</th><th>Date</th><th class="num">Score</th><th class="num">Wrong</th><th class="num">Empty</th><th class="num">Not reached</th></tr>${
    [...r.builds].reverse().map(b => `<tr><td>${esc(b.build)}</td><td class="nowrap">${esc(b.at.slice(0, 10))}</td><td class="num ${tone(b.score)}">${pct(b.score)}</td><td class="num ${b.wrong ? 'bad' : ''}">${b.wrong}</td><td class="num">${b.empty}</td><td class="num">${b.unreached}</td></tr>`).join('')}</table></section>` : '';
  return `<section class="card"><h2>Fair round · ${esc(roundLabel(key))}</h2>${links}
<p class="muted">The same AI for every tool (Haiku 5.5), ${r.forms.length} forms we never tested or fixed on, a blind judge that never sees the tool. As of ${esc(r.at.slice(0, 10))}.
Score = right ÷ (right + wrong + empty though the facts answer it + not reached). Spread: the lowest and highest repeat.</p>
<table><tr><th>Tool</th><th class="num">Score</th><th class="num">Spread</th><th class="num">Right</th><th class="num">Wrong</th><th class="num">Empty, facts answer it</th><th class="num">Not reached</th><th class="num">Forms</th><th class="num">Repeats</th></tr>${rows}</table></section>
<section class="card"><h2>Per form</h2><p class="muted">Score per form and tool, all repeats together. ✗ = wrong answers.</p>
<table><tr><th>Form</th>${names.map(n => `<th class="cell">${esc(n)}</th>`).join('')}</tr>${r.forms.map(f => `<tr><td>${esc(f)}</td>${names.map(n => cell(n, f)).join('')}</tr>`).join('')}</table></section>${builds}`;
}
