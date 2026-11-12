// The Overview of the Lab (owner, 12 Nov 2026: "also, let's have an overview page" · "For both Job search and Lab"; sketch https://claude.ai/artifact/FhduZ2SAEWiYfe7UAvcmLL,
// asked via AskUserQuestion: "Yes, both as sketched", "Open on Overview", "4: Night, Finish, Real, Draws"): one number per Lab tab, with the dot that tab's own verdict gives.
// labTabs() is the one place these numbers are made: the Lab's Overview tab draws them as cards, Job search → Overview as tiles (admin/headlines-search.js), so the two never disagree.
// Pure: rows in, numbers out. Guard: test/unit/admin/search/lab-overview.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {verdictBand} from './verdict-band.js';
import {VIZ_TOOLTIP, columns, figure, stacks} from './viz.js';
import {ownOf} from './search-finish.js';
import {judge} from './search-lab-draws.js';
import {eras} from './search-lab-draws-page.js';
import {byDay, summarize} from './search-lab-real.js';

const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? '—' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);
const DAY = 86400000, QUIET_DAYS = 3;
export const PRESS_LIMIT_S = 180;   // Why (CLAUDE.md "Find jobs takes ≤ 3 min wall clock"): the Real installs dot is green when the first job comes inside the press's own limit, never a new threshold
const TONE = {good: 'good', warn: 'warn', bad: 'bad', none: 'off'};

/**
 * The five Lab tabs' numbers. data: {nights: judged nights newest first (search-night-judge.js judgeAll) | null when unreadable, hand: by-hand runs, real: search reports,
 * draws: stored draws newest first, checks: session checks newest first}. Each entry: {tab, title, value, sub, status: good|warn|bad|none, series?: numbers oldest first, higherIsBetter?: false when a rise is worse, chart?: data for the card}.
 * Invariant: a tab with no data says so with status 'none', never a 0 that looks measured.
 */
export function labTabs(data, now = new Date()) {
  return [nightOf(data.nights), finishOf(data.nights, data.hand), realOf(data.real || []), drawsOf(data.draws || []), checksOf(data.checks || [], now)];
}

function nightOf(nights) {
  const base = {tab: 'night', title: 'Night search'};
  if (!nights?.length) return {...base, value: '–', sub: nights ? 'no night uploaded yet' : 'the nights could not be read', status: 'none'};
  const [last] = nights, shown = nights.slice(0, 14).reverse();
  return {...base, value: last.notRun ? 'not run' : `${last.measured} / ${last.total}`, sub: `people with a right job, night ${last.night}${last.eures === 'off' ? ' · EURES off' : ''}`,
    status: last.notRun ? 'none' : last.dropped ? 'bad' : 'good', series: shown.map(night => (night.notRun ? null : night.measured)),
    chart: shown.map(night => ({day: night.night, values: [night.notRun ? null : night.measured], tip: `${night.night}: ${night.notRun ? 'not run' : `${night.measured} of ${night.total} measured`}${night.eures === 'off' ? ' · EURES off' : ''}${night.dropped ? ' · dropped' : ''}`}))};
}

function finishOf(nights, hand = []) {
  const base = {tab: 'finish', title: 'Finish line'};
  // Why (11 Nov 2026, owner: the headline is our own sources): the newest EURES-off run, night or by hand, as the Finish line tab's own band reads it
  const runs = [...(nights || []).map(night => ({...night, hand: false})), ...(hand || []).map(run => ({...run, night: run.day, hand: true}))].sort((a, b) => String(b.night).localeCompare(String(a.night)));
  const last = runs.find(run => ownOf(run)), own = last ? ownOf(last) : null;
  if (!own) return {...base, value: '–', sub: 'no EURES-off run yet', status: 'none'};
  return {...base, value: num(own.right), sub: `right jobs from our own sources · ${own.people} of ${own.total} people · ${last.hand ? 'by hand' : 'night'} ${last.night}`,
    status: own.people === own.total ? 'good' : own.people * 2 >= own.total ? 'warn' : 'bad', chart: own};
}

function realOf(reports) {
  const base = {tab: 'real', title: 'Real installs'};
  if (!reports.length) return {...base, value: '–', sub: 'no real search reported yet', status: 'none'};
  const all = summarize(reports).all, days = byDay(reports).slice(0, 30).reverse();
  return {...base, value: clock(all.first_s), sub: `time to first job · ${num(all.searches)} searches, ${num(all.installs)} installs · 70+ in ${num(all.reached)}`,
    status: all.first_s == null ? 'warn' : all.first_s <= PRESS_LIMIT_S ? 'good' : 'warn', series: days.map(day => day.first_s), higherIsBetter: false,   // seconds: a rise is slower
    chart: days.map(day => ({day: day.day, values: [day.searches], tip: `${day.day}: ${day.searches} searches · first job ${clock(day.first_s)}`}))};
}

function drawsOf(stored) {
  const base = {tab: 'draws', title: 'Random draws'};
  if (!stored.length) return {...base, value: '–', sub: 'no draw yet', status: 'none'};
  const {now} = eras(judge(stored)), ok = now.filter(row => row.verdict !== 'failed');   // the robot's draws, as the Random draws band counts them
  const relevant = ok.filter(row => row.fit70 > 0).length, shown = now.slice(0, 30).reverse();
  return {...base, value: `${relevant} / ${now.length}`, sub: 'draws that reached a relevant (70+) job', status: relevant === 0 ? 'bad' : relevant < now.length / 2 ? 'warn' : 'good',
    series: shown.map(row => row.in_places ?? 0), chart: shown.map(row => ({day: row.draw_date, values: [row.verdict === 'failed' ? null : row.in_places ?? 0], tip: `${row.draw_date} · ${row.role || row.family}: ${num(row.in_places)} in the places · ${num(row.fit70)} at 70+`}))};
}

function checksOf(rows, now) {
  const base = {tab: 'checks', title: 'Session checks'};
  if (!rows.length) return {...base, value: '–', sub: 'no session check yet', status: 'none'};
  const days = Math.floor((now - Date.parse(rows[0].run_at)) / DAY), sessions = new Set(rows.map(row => row.session)).size;
  return {...base, value: num(rows.length), sub: `checks by ${sessions} session${sessions === 1 ? '' : 's'} · last ${rows[0].run_at.slice(0, 10)}${days > QUIET_DAYS ? ` · quiet ${days} days` : ''}`, status: days > QUIET_DAYS ? 'warn' : 'good'};
}

const CHART_NAMES = {night: 'People with a right job', real: 'Searches a day', draws: 'Jobs in the places'};

function cardChart(entry) {
  if (entry.tab === 'finish' && entry.chart) {
    const own = entry.chart;
    return stacks([{label: 'People', text: `${own.people} of ${own.total}`, parts: [{value: own.people, tone: entry.status === 'good' ? 'good' : 'bad'}, {value: own.total - own.people, tone: 'off'}], tip: `${own.people} of ${own.total} people have at least one right job`}],
      [[entry.status === 'good' ? 'good' : 'bad', 'with a right job'], ['off', 'without']]);
  }
  if (!Array.isArray(entry.chart) || !entry.chart.length) return '';
  return columns(entry.chart, [{name: CHART_NAMES[entry.tab], tone: 's1'}], {whole: true, labelEvery: Math.max(1, Math.ceil(entry.chart.length / 5))});
}

/** The Lab's Overview tab: a band from the night (the Lab's question in one line), then one card per tab with its number, its dot's word and its trend. */
export function overviewSection(data, now = new Date()) {
  const tabs = labTabs(data, now), [night] = tabs;
  const word = {good: '✓ on track', warn: '◐ watch', bad: '✕ below', none: 'no data'};
  const band = verdictBand({icon: {good: '🟢', warn: '🟠', bad: '🔴', none: '⚪'}[night.status], headline: night.status === 'none' ? `Night search: ${night.sub}` : `Last night ${night.value.replace(' / ', ' of ')} people had a right job`,
    chips: tabs.slice(1).map(entry => ({label: `${entry.title}: ${entry.value}`, tone: TONE[entry.status]})), note: 'One card per tab: its number, the verdict that tab gives, and the trend behind it. Open a tab for the detail.'});
  const cards = tabs.map(entry => `<section class="card lo-card lo-${entry.status}"><div class="lo-head"><h2>${esc(entry.title)}</h2>${chip(word[entry.status], TONE[entry.status])}</div>
<div class="lo-num"><b>${esc(entry.value)}</b><span class="muted">${esc(entry.sub)}</span></div>${figure({chart: cardChart(entry)})}<a href="?tab=${entry.tab}">Open ${esc(entry.title)} →</a></section>`).join('');
  return `${band}<div class="lo-grid">${cards}</div>${VIZ_TOOLTIP}`;
}

export const OVERVIEW_CSS = `${CHIP_STYLE}.lo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:14px;margin-top:14px}.lo-card{display:flex;flex-direction:column;gap:8px;border-top:3px solid #6b7480}
.lo-good{border-top-color:#3fcf82}.lo-warn{border-top-color:#f0b429}.lo-bad{border-top-color:#ff6b6b}.lo-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.lo-head h2{margin:0}
.lo-num{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.lo-num b{font-size:34px;font-variant-numeric:tabular-nums}.lo-card>a{font-size:13px;text-decoration:none}`;
