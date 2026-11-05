// Draws /admin/agents/agent-coding from the stored days (admin/agent-coding.js): a verdict band, then one card per stat (stopped pushes, what fixed a red, CI/tooling share, fix circles, CI minutes).
// Pure: rows [{kind, day, card: JSON string, updated_at}] + a clock in, HTML out. Weeks start on Monday (UTC), newest first. No AI; every colour pairs with a word or icon.
import {esc} from '../shared/html.js';
import {columns, figure, VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';

const WEEKS = 8;
// Why (1 Nov 2026, the owner's yes on the layer-0 counter): the four hooks ~/.claude/hooks/count-blocks.sh counts; a block is a count per fixed label, never text.
export const HOOKS = ['guard-primary-checkout', 'background-tee', 'foreground-long-run', 'session-cap'];
export const COLORS = {form: '#f2c14e', real: '#e5484d', other: '#8d949c', product: '#5ec47a', test: '#6aa8ff', ci: '#b48cff', nofix: '#5b6470', flaky: '#d98ad9', rebase: '#7fb8c9', ok: '#5ec47a'};
export const WORDS = {form: 'form', real: 'real suite red', other: 'other', product: 'product code', test: 'test / harness drift', ci: 'CI config / tools', nofix: 'no fix seen', flaky: 'flaky (green on re-run)', rebase: 'after a rebase (cause unclear)'};
export const monday = day => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const weekWords = start => `${MONTHS[Number(start.slice(5, 7)) - 1]} ${Number(start.slice(8))}`;
export const sum = (list, pick) => list.reduce((total, item) => total + (pick(item) || 0), 0);
export const pct = (part, whole) => (whole ? Math.round(part / whole * 100) : 0);
export const pick = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0);
export const round1 = value => Math.round(value * 10) / 10;

// The weeks (newest first) with the days of each kind that fall in them.
// The two tabs of the page (v2, 1 Nov 2026: "This should be probably a separate tab. SDLC"): the weekly view and the whole path.
export const tabs = active => `<nav class="tabs" aria-label="Agent coding views"><a href="/admin/agents/agent-coding"${active === 'weekly' ? ' class="on" aria-current="page"' : ''}>Weekly</a><a href="/admin/agents/agent-coding?tab=sdlc"${active === 'sdlc' ? ' class="on" aria-current="page"' : ''}>SDLC · the whole path</a></nav>`;
export const TABS_STYLE = `.tabs{display:flex;gap:6px;margin:6px 0 14px;border-bottom:1px solid #262c33}.tabs a{padding:8px 16px;border:1px solid #262c33;border-bottom:0;border-radius:10px 10px 0 0;color:#8d949c;text-decoration:none;font-size:14px;margin-bottom:-1px}.tabs a.on{background:#14181d;color:#e6e8ea;font-weight:600;box-shadow:inset 0 2px 0 #f2c14e}.tabs a:focus-visible{outline:2px solid #f2c14e;outline-offset:-2px}`;

export function weeksOf(rows, now) {
  const first = monday(now.toISOString().slice(0, 10)), out = [];
  for (let back = 0; back < WEEKS; back++) { const date = new Date(`${first}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 7 * back); out.push({start: date.toISOString().slice(0, 10), gate: [], ci: [], sdlc: []}); }
  for (const row of rows) { const week = out.find(item => item.start === monday(row.day)); if (week && week[row.kind]) week[row.kind].push(JSON.parse(row.card)); }
  return out;
}

export const bar = parts => { const total = sum(parts, part => part[1]) || 1;
  return `<div class="ac-bar" role="img" aria-label="${esc(parts.map(([key, n]) => `${WORDS[key]} ${n}`).join(', '))}">${parts.filter(part => part[1]).map(([key, n]) => `<i style="width:${n / total * 100}%;background:${COLORS[key]}" title="${esc(WORDS[key])}: ${n}"></i>`).join('')}</div>`; };
export const legend = keys => `<p class="ac-legend">${keys.map(key => `<span><b style="background:${COLORS[key]}"></b>${esc(WORDS[key])}</span>`).join('')}</p>`;
export const chip = (kind, text) => `<span class="ac-chip ${kind}">${{good: '✓', warn: '▲', circle: '🌀', wait: '…'}[kind]} ${esc(text)}</span>`;
export const empty = what => `<p class="muted">No ${esc(what)} upload yet.</p>`;
export const note = text => `<p class="muted ac-note">${text}</p>`;
export const card = (id, title, sub, body) => `<section class="card" id="${id}"><h2>${title} <span class="muted">· ${sub}</span></h2>${body}</section>`;
export const row = (week, body) => `<div class="ac-row"><span class="ac-week">${esc(weekWords(week.start))}</span>${body}</div>`;

function gateCard(weeks) {
  const data = weeks.filter(week => week.gate.length);
  if (!data.length) return card('gate', 'Stopped pushes: form or real', 'push gate on the owner\'s Mac', empty('push-gate'));
  const rows = weeks.map(week => { const stopped = ['form', 'real', 'other'].map(key => [key, sum(week.gate, day => day.stopped[key])]), n = sum(stopped, item => item[1]), pushes = sum(week.gate, day => day.pushes);
    return row(week, week.gate.length ? `${bar(stopped)}<span class="ac-num">${n} of ${pushes} · ${pct(stopped[0][1], n)}% form</span>` : '<span class="muted">no upload</span>'); }).join('');
  const steps = {};
  for (const week of data) for (const day of week.gate) for (const [name, step] of Object.entries(day.steps)) { const at = steps[name] ||= {runs: 0, fails: 0, secs: 0, cls: step.cls}; at.runs += step.runs; at.fails += step.fails; at.secs += step.secs; }
  const table = Object.entries(steps).sort((a, b) => b[1].fails - a[1].fails || b[1].secs - a[1].secs).map(([name, s]) => `<tr><td>${esc(name)}</td><td><span class="ac-tag" style="--c:${COLORS[s.cls]}">${esc(WORDS[s.cls])}</span></td><td class="num">${s.runs}</td><td class="num">${s.fails}</td><td class="num">${Math.round(s.secs / 60)} min</td></tr>`).join('');
  return card('gate', 'Stopped pushes: form or real', 'stops of the push gate per week', `${rows}${legend(['form', 'real', 'other'])}
<details open><summary>Every push check, the ones that stopped most pushes first</summary><table><thead><tr><th>Check</th><th>Kind</th><th>Runs</th><th>Stops</th><th>Time</th></tr></thead><tbody>${table}</tbody></table></details>`);
}

function fixedCard(weeks) {
  const data = weeks.filter(week => week.ci.length);
  if (!data.length) return card('fixed', 'What fixed a red', 'from the first green commit after it', empty('CI'));
  const keys = ['product', 'test', 'ci', 'form', 'nofix'];
  const rows = weeks.map(week => { const parts = keys.map(key => [key, sum(week.ci, day => day.reds[key])]), n = sum(parts, part => part[1]);
    return row(week, n ? `${bar(parts)}<span class="ac-num">${n} reds · ${pct(parts[0][1], n)}% product</span>` : '<span class="muted">no reds</span>'); }).join('');
  return card('fixed', 'What fixed a red', 'first green commit after it, per week', `${rows}${legend(keys)}${note('A guess from the files and the subject of the fixing commit, about ±10 points. Reds on PRs that never merged are not seen.')}`);
}

function shareCard(weeks) {
  const data = weeks.filter(week => week.ci.length);
  if (!data.length) return card('share', 'PRs that change CI or tooling', '.github, tools, the e2e harness', empty('CI'));
  const rows = weeks.map(week => { const merged = sum(week.ci, day => day.prs.merged), ci = sum(week.ci, day => day.prs.ci);
    return row(week, merged ? `<div class="ac-bar"><i style="width:${pct(ci, merged)}%;background:${COLORS.ci}"></i></div><span class="ac-num">${ci} of ${merged} · ${pct(ci, merged)}%</span>` : '<span class="muted">no merged PRs</span>'); }).join('');
  return card('share', 'PRs that change CI or tooling', 'merged per week, touching .github, tools or the e2e harness', rows);
}

function circlesCard(weeks) {
  const data = weeks.filter(week => week.ci.length);
  if (!data.length) return card('circles', 'Fix PRs per area', 'three in one week is a circle', empty('CI'));
  const totals = {};
  for (const week of data) for (const day of week.ci) for (const [area, n] of Object.entries(day.fixPrs)) totals[area] = (totals[area] || 0) + n;
  const perWeek = (week, area) => sum(week.ci, day => day.fixPrs[area]);
  const areas = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 10);
  const head = weeks.map(week => `<th class="num">${esc(weekWords(week.start))}</th>`).join('');
  const body = areas.map(area => `<tr><td><code>${esc(area)}</code></td>${weeks.map(week => { const n = perWeek(week, area); return `<td class="num${n >= 3 ? ' ac-circle' : ''}">${n >= 3 ? `🌀 ${n}` : n || '·'}</td>`; }).join('')}</tr>`).join('');
  return card('circles', 'Fix PRs per area', 'three or more in one week is a circle (🌀)', `<table class="ac-grid"><thead><tr><th>Area</th>${head}</tr></thead><tbody>${body || '<tr><td colspan="9" class="muted">No fix PRs.</td></tr>'}</tbody></table>
${note('A fix PR is a merged PR with "fix" in its title or branch; its area is the first two folders of the product files it changes.')}`);
}

function minutesCard(weeks) {
  const data = weeks.filter(week => week.ci.length);
  if (!data.length) return card('minutes', 'CI minutes per push', 'wall clock, not billed', empty('CI'));
  const stats = week => { const wall = week.ci.flatMap(day => day.wall).sort((a, b) => a - b), queue = week.ci.flatMap(day => day.queue).sort((a, b) => a - b), total = sum(wall, v => v); return {wall, queue, total}; };
  const chart = columns(weeks.slice().reverse().map(week => { const {wall, queue, total} = stats(week);   // oldest first; a week with no push is a hollow column, never a zero
    return {day: week.start, values: wall.length ? [round1(pick(wall, .5)), round1(pick(wall, .9))] : [null, null], tip: `week of ${weekWords(week.start)} · ${wall.length ? `${wall.length} pushes · median ${round1(pick(wall, .5))} min · slowest 1 in 10 ${round1(pick(wall, .9))} min · waiting for a runner ${round1(pick(queue, .5))} min · ${pct(sum(week.ci, day => day.cancelledMin), total)}% in cancelled runs` : 'no data'}`}; }),
    [{name: 'Median', tone: 's1'}, {name: 'Slowest 1 in 10', tone: 's2'}], {labelEvery: 1});
  const body = weeks.map(week => { const {wall, queue, total} = stats(week);
    return `<tr><td>${esc(weekWords(week.start))}</td>${wall.length ? `<td class="num">${wall.length}</td><td class="num">${round1(pick(wall, .5))} min</td><td class="num">${round1(pick(wall, .9))} min</td><td class="num">${round1(pick(queue, .5))} min</td><td class="num">${pct(sum(week.ci, day => day.cancelledMin), total)}%</td>` : '<td colspan="5" class="muted">no data</td>'}</tr>`; }).join('');
  return card('minutes', 'CI minutes per push', 'wall clock from start to end, not billed minutes', `${figure({chart, table: `<table><thead><tr><th>Week</th><th class="num">Pushes</th><th class="num">Median</th><th class="num">Slowest 1 in 10</th><th class="num">Waiting for a runner</th><th class="num">In cancelled runs</th></tr></thead><tbody>${body}</tbody></table>`})}
${note('Per push = all pull-request runs of one commit added together. Waiting for a runner is the longest time from a run being created to starting, per push (the median of those is shown).')}`);
}

function verdict(weeks) {
  const [now] = weeks, stopped = ['form', 'real', 'other'].map(key => sum(now.gate, day => day.stopped[key])), n = sum(stopped, v => v);
  const circles = new Set(); for (const day of now.ci) for (const [area, count] of Object.entries(day.fixPrs)) if (sum(now.ci, d => d.fixPrs[area]) >= 3) circles.add(area);
  const reds = ['product', 'test', 'ci', 'form', 'nofix'].map(key => sum(now.ci, day => day.reds[key])), redN = sum(reds, v => v);
  const parts = [now.gate.length ? chip(pct(stopped[0], n) >= 50 ? 'warn' : 'good', n ? `${pct(stopped[0], n)}% of stopped pushes were form` : 'no stopped pushes') : chip('wait', 'push gate: no upload'),
    now.ci.length ? chip(redN && pct(reds[0], redN) < 50 ? 'warn' : 'good', redN ? `${pct(reds[0], redN)}% of fixed reds were product code` : 'no reds fixed') : chip('wait', 'CI: no upload yet'),
    now.ci.length ? chip(circles.size ? 'circle' : 'good', circles.size ? `${circles.size} area${circles.size > 1 ? 's' : ''} with 3+ fixes` : 'no circles') : ''];
  return `<section class="card ac-verdict"><h2>This week <span class="muted">· from ${esc(weekWords(now.start))}</span></h2><div class="ac-chips">${parts.join('')}</div></section>`;
}

export const STYLE = `.ac-chips{display:flex;flex-wrap:wrap;gap:8px}.ac-chip{border:1px solid #262c33;border-radius:999px;padding:4px 12px;font-size:13px;white-space:nowrap}.ac-chip.good{color:#5ec47a;border-color:#2d5a3b}.ac-chip.warn{color:#f2c14e;border-color:#6b5a21}.ac-chip.circle{color:#ff8f84;border-color:#7a3430}.ac-chip.wait{color:#8d949c}
.ac-row{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;padding:5px 0;font-size:13.5px}.ac-week{color:#8d949c}.ac-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.ac-bar{height:14px;border-radius:7px;background:#1b2027;display:flex;overflow:hidden;min-width:60px}.ac-bar i{display:block;height:100%}.ac-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 0;font-size:12px;color:#8d949c}.ac-legend b{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
.ac-tag{border:1px solid var(--c);color:var(--c);border-radius:999px;padding:1px 8px;font-size:12px;white-space:nowrap}.ac-note{font-size:12px;margin:10px 0 0}.ac-grid td.num{min-width:40px}.ac-circle{color:#ff8f84;font-weight:600}
details{margin-top:12px}summary{cursor:pointer;color:#8d949c;font-size:13px}.ac-top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
@media (max-width:700px){.ac-row{grid-template-columns:52px 1fr}.ac-row .ac-num{grid-column:2}}`;

export function page(rows, now = new Date()) {
  const weeks = weeksOf(rows, now), at = rows.map(item => item.updated_at).filter(Boolean).sort().at(-1);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Agent coding · Agent Coding · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}${TABS_STYLE}${VIZ_STYLE}</style></head><body><main>
<header><h1>🧭 Agent coding</h1><span class="muted ac-top">weekly · last ${WEEKS} weeks${at ? ` · data as of ${esc(at.slice(0, 16).replace('T', ' '))} UTC` : ''} · <a href="/admin/testing/pr-checks">per-check scorecard →</a></span></header>
${tabs('weekly')}${verdict(weeks)}
${gateCard(weeks)}${fixedCard(weeks)}${shareCard(weeks)}${circlesCard(weeks)}${minutesCard(weeks)}</main>${VIZ_TOOLTIP}</body></html>`;
}
