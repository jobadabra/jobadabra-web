// /admin/testing/overview: every method we use to find bugs and keep the app stable, one card each in four rings (owner, 1 Nov 2026). The catalogue is admin/testing-overview-methods.js,
// the stored rows behind each card are resolved in admin/testing-overview-data.js; this file draws them. No AI, no new table. Guard: test/unit/admin/testing-overview.test.js.
import {viewer, remember} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {PAGES} from './admin.js';
import {chip, CHIP_STYLE} from './chip.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';
import {load, resolve} from './testing-overview-data.js';
import {daysTo} from './testing-overview-history.js';
import {healthMap, MAP_STYLE, summaryBar} from './testing-overview-map.js';
import {VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';
import {costCard, COST_STYLE} from './testing-methods-cost.js';
import {NIGHTLY_STYLE, reportLine} from './nightly-summary-html.js';

const HOUR = 3600000, DAY = 86400000;
/** "5 min ago" / "3 h ago" / "2 days ago" for a run's time; a date without a time counts whole days. */
export function ago(at, now = new Date()) {
  if (!at) return '';
  const dated = !String(at).includes('T'), diff = now.getTime() - Date.parse(dated ? `${at}T12:00:00Z` : at);
  if (!Number.isFinite(diff)) return '';
  if (dated || diff >= 2 * DAY) { const days = Math.max(0, Math.round(diff / DAY)); return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`; }
  return diff < HOUR ? `${Math.max(1, Math.round(diff / 60000))} min ago` : `${Math.round(diff / HOUR)} h ago`;
}

const STATE = {green: ['✓ green', 'good'], red: ['✕ red', 'bad'], hand: ['by hand', 'off'], none: ['◷ no run stored', 'off']};
/** The last-run chip: icon + word + time, a link to the run when there is one; "late" when a scheduled run was missed. */
export function lastChip(last, now) {
  const [state, tone] = STATE[last.state] || STATE.none, word = last.word ? `✕ ${last.word}` : state;   // word: a red that is not "red on the last run" (synthetic: "no round")
  const text = last.state === 'none' ? word : last.state === 'hand' ? `${word} · last run ${esc(ago(last.at, now))}` : [word, esc(ago(last.at, now))].filter(Boolean).join(' · ');
  const body = last.url ? `<a href="${esc(last.url)}">${chip(text, tone)}</a>` : `<span title="${esc(last.why || '')}">${chip(text, tone)}</span>`;
  return `${body}${last.late ? ` ${chip('late', 'warn')}` : ''}${last.state === 'hand' ? ` <span class="muted small">ended ${esc(last.was)}</span>` : ''}${last.note ? ` <span class="muted small">${esc(last.note)}</span>` : ''}`;
}

const CARD_CHIP = {green: ['✓ green', 'good'], red: ['✕ red', 'bad'], none: ['◷ no run', 'off']};
const lineHtml = (line, now, scheduled) => `<li><div class="what">${esc(line.label)}${line.when ? ` <span class="muted">· ${scheduled ? `<a href="${esc(scheduled)}">${esc(line.when)}</a>` : esc(line.when)}</span>` : ''}</div><div>${lastChip(line.last, now)}${line.last.explicit ? ` <span class="muted small">${esc(line.last.why)}</span>` : ''}</div></li>`;
const bugsHtml = bugs => (bugs.why ? `<div class="bugs"><span class="muted">Bugs caught</span> <b>—</b> <span class="muted small">${esc(bugs.why)}</span></div>`
  : `<div class="bugs"><span class="muted">Bugs caught</span> <b>${esc(bugs.text)}</b>${bugs.window ? ` <span class="muted small">· ${esc(bugs.window)}</span>` : ''}${bugs.detail ? ` <span class="muted small">· ${esc(bugs.detail)}</span>` : ''}</div>`);

// Why (2 Nov 2026, owner: "this thing looks very ugly, crowded"): the nightly charts left the proof cards for Testing → Report only; a card keeps one line with the numbers and a link.
// Why (1 Nov 2026, owner: "these widgets are hard to read. Let's have them one per row, rather than 3, being so crowded"): one card per row, laid out sideways: who it is on the left,
// how it runs (lines + charts) in the middle, what it caught and where to look on the right.
function cardHtml(card, now, scheduled, reportOnly) {
  if (card.kind === 'planned') return `<article class="mcard planned" id="m-${esc(card.id)}"><div class="mc-head"><h3>${card.icon} ${esc(card.title)} ${chip('◷ planned', 'off')}</h3><p class="muted">${esc(card.proves)}</p></div></article>`;
  const head = card.state === 'link' ? (card.pending ? chip('◷ being built', 'off') : '') : chip(...CARD_CHIP[card.state]);
  const lines = card.lines.filter(line => card.state !== 'link' || line.last.state !== 'none').map(line => lineHtml(line, now, scheduled)).join('');
  return `<article class="mcard" id="m-${esc(card.id)}"><div class="mc-head"><h3>${card.icon} ${esc(card.title)} ${head}</h3><p class="muted">${esc(card.proves)}</p></div>
<div class="mc-body"><ul class="lines">${lines}</ul>${reportLine(card.trends, reportOnly)}</div>
<div class="mc-side">${card.state === 'link' ? '' : bugsHtml(card.bugs)}${card.href ? `<a class="open" href="${esc(card.href)}">Open the page →</a>` : ''}</div></article>`;
}

const STYLE = `${CHIP_STYLE}
${BAND_STYLE}.band{margin-bottom:12px}
.ring{margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8d949c}
.grid{display:grid;grid-template-columns:1fr;gap:10px}.mcard{background:#14181d;border:1px solid #262c33;border-radius:14px;padding:12px 16px;display:grid;grid-template-columns:minmax(250px,300px) minmax(0,1fr) minmax(160px,210px);gap:8px 22px;align-items:start;min-width:0}
.mcard.planned{background:transparent;border-style:dashed;opacity:.8;grid-template-columns:1fr;padding:8px 16px}.mcard h3{margin:0 0 3px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mcard p{margin:0;font-size:12px}
.mc-body{display:flex;gap:10px 28px;flex-wrap:wrap;align-items:flex-start;min-width:0}.mc-body .lines{flex:1 1 280px}.mc-body .nts{flex:0 1 auto;border-top:0;margin:0;padding:0}.mc-side{display:grid;gap:6px;justify-items:start}
.lines{list-style:none;margin:0;padding:0;display:grid;gap:5px}.lines li{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:13px}
.lines .what{min-width:0}.small{font-size:12px}.bugs{font-size:13px}.open{font-size:13px;text-decoration:none}
@media (max-width:760px){.mcard{grid-template-columns:1fr}.mc-side{grid-auto-flow:column;justify-content:space-between;justify-items:start;align-items:baseline}}
h2.details{margin:26px 0 0;font-size:17px}.mcard:target{outline:2px solid #f5b54a}`;

/** The page; `model` = resolve(...) output, `at` = when the rows were read. */
export function page(model, {now = new Date()} = {}) {
  const {counts, redCards} = model;
  // Why (1 Nov 2026, owner: "here again too much text"): a short line, the red methods as chips that jump to their card, one muted note; never a sentence of names.
  const band = verdictBand({icon: counts.red ? '🔴' : '🟢', headline: counts.red ? `${counts.red} of ${counts.live} methods red on the last run` : `${counts.green} of ${counts.live} methods green on the last run`,
    chips: redCards.map(card => ({label: `${card.icon} ${card.title}`, tone: 'bad', href: `#m-${card.id}`})),
    note: [counts.none ? `${counts.none} with no stored run` : '', `${counts.planned} planned`].filter(Boolean).join(' · ')});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Overview · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}
${MAP_STYLE}${NIGHTLY_STYLE}${COST_STYLE}${VIZ_STYLE}</style></head><body><main>
<header><h1>🧪 Testing overview</h1><span class="muted">${model.rings.length} rings · ${counts.live} methods running · ${counts.planned} planned · unit tests are not listed: they are for agent development</span></header>
${band}
${summaryBar(counts)}
${healthMap(model, daysTo(now))}
${costCard(model.cost.rows, model.cost.trend, model.cost.stale)}
<h2 class="details">Each method in detail</h2>
${model.rings.map(ring => `<div class="ring">${ring.icon} ${esc(ring.title)} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· ${esc(ring.note)}</span></div>
<div class="grid">${ring.cards.map(card => cardHtml(card, now, model.scheduled, model.reportOnly)).join('')}</div>`).join('\n')}
</main>${VIZ_TOOLTIP}</body></html>`;
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const model = resolve(await load(env, now), {pages: PAGES.map(item => item.path)});
  return new Response(page(model, {now}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
