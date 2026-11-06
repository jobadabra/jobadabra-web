// The six areas of the product-quality board, each built from ALREADY-READ inputs (admin/product-quality-data.js reads; admin/product-quality.js holds the judging helpers). A missing or empty source
// gives "not measured" with its reason; real-user numbers under 3 installs give "Too few installs (n)". Guard: test/unit/admin/report/product-quality.test.js.
//
// inputs = {days: 'YYYY-MM-DD'[] (oldest first, 30), fill, nightly, answers, searches, probes, crashes, sentry, newProblems, snapshot, finders, searchNights}; each is null when its source could not be read.
import {judge, median, notMeasured, round, toneOf, deltaText, verdictOf, weeks, WEEK, WORDS} from './product-quality.js';
import {MIN_INSTALLS} from '../shared/thin-data.js';
import {search} from './product-quality-search.js';

const isNum = value => typeof value === 'number' && Number.isFinite(value);
const trendOf = (now, before, options) => judge(now, before, options) ?? 'new';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lastWeek = days => new Set(days.slice(-WEEK)), weekBefore = days => new Set(days.slice(-2 * WEEK, -WEEK)), fortnight = days => new Set(days.slice(-2 * WEEK));
const daily = (days, byDay) => days.map(day => (byDay.has(day) ? {day, ...byDay.get(day)} : {day, value: null}));
const thin = (base, installs, forms) => ({...base, value: null, unit: '', label: `Too few installs (${installs})`, trend: 'thin', word: WORDS.thin, tone: 'none', bar: null, series: [], delta: `${plural(forms, 'real report')} from ${plural(installs, 'install')}; a number needs ${MIN_INSTALLS}+`});

function finish(base, {value, unit, label, now, before, tolerance = 0, higherIsBetter = true, bar = null, digits = 0, series, subs, src}) {
  const trend = trendOf(now, before, {tolerance, higherIsBetter}), big = isNum(now) && isNum(before) && Math.abs(now - before) > 2 * tolerance;
  return {...base, value: String(round(value, digits)), unit, label, trend, word: WORDS[trend], tone: toneOf(trend, value, {bar, higherIsBetter, big}), delta: deltaText(now, before, unit.trim() === '%' ? ' pts' : unit, digits), bar, series, subs, src: src || base.src};
}

/** Form filling: the share of required fields real users' forms got filled, per day; the benchmark as the line beneath. */
export function formFilling({days, fill}) {
  const base = {id: 'form', area: 'Form filling', question: 'Does it fill what the form asks?', kind: 'line', subs: [], src: 'real users (fill cards), the benchmark'};
  if (!fill) return notMeasured(base, 'fill cards could not be read');
  const subs = [fill.benchmark && !['No data', '–'].includes(fill.benchmark.value) && `Benchmark, ours vs best other tool: ${fill.benchmark.value}`].filter(Boolean);
  if (!fill.rows.length) return notMeasured({...base, subs}, 'no real fill reported in the last 30 days');
  if (!fill.rows.some(row => fortnight(days).has(row.day))) return notMeasured({...base, subs}, 'no real fill in the last 14 days');   // before the thin check: no recent data is not "too few installs (0)"
  if (fill.sample && fill.sample.enough === false) return thin({...base, subs}, fill.sample.installs, fill.sample.forms);
  const byDay = new Map(fill.rows.filter(row => row.required > 0).map(row => [row.day, {value: (100 * row.filled) / row.required, n: row.required}]));
  const series = daily(days, byDay), {now, before} = weeks(series);
  if (now == null) return notMeasured({...base, subs}, 'no real fill in the last 7 days');
  const sample = fill.sample ? `${plural(fill.sample.forms, 'form')} from ${plural(fill.sample.installs, 'install')}, last 14 days` : '';
  return finish({...base, subs}, {value: now, unit: '%', label: 'required fields filled by real users (last 7 days)', now, before, tolerance: 1, series, subs, src: `real users${sample ? ` · ${sample}` : ''} · fill cards, benchmark`});
}

/** AI quality: how often the AI gives the same score twice (the nightly pairs), with the fixed prompt cases and the answers real users kept beneath. */
export function aiQuality({nightly, answers}) {
  const base = {id: 'ai', area: 'AI quality', question: 'Are the AI answers right and steady?', kind: 'line', subs: [], src: 'the nightly quality night · prompt cases · real answers'};
  if (!nightly) return notMeasured(base, 'the nightly summary could not be read');
  const job = nightly.jobs.find(item => item.id === 'quality-ai'), cases = nightly.jobs.find(item => item.id === 'prompt-cases');
  const subs = [cases && cases.value !== '–' && `Prompt cases: ${cases.value} right, ${String(cases.sub).split(' · ')[0]}`, keptLine(answers)].filter(Boolean);
  if (!job || job.value === '–') return notMeasured({...base, subs}, job?.sub || 'no live quality night stored yet');
  const series = job.series.map(point => ({day: point.day, value: point.value == null ? null : 100 * point.value})), {now, before} = weeks(series);
  if (now == null) return notMeasured({...base, subs}, 'no live quality night in the last 7 days');
  return finish({...base, subs}, {value: now, unit: '%', label: 'same score twice, within 8 (last 7 nights)', now, before, tolerance: 2, bar: job.bar ? round(100 * job.bar.value, 4) : null, series, subs});
}

// "AI answers kept on a field: 91% (Claude 93%, OpenAI 88%)" from this week's answer calls; null without any call.
function keptLine(answers) {
  const rows = ['claude', 'openai'].map(family => [family === 'claude' ? 'Claude' : 'OpenAI', answers?.[family]?.now]).filter(([, now]) => now?.fields && isNum(now.keptRate));
  if (!rows.length) return null;
  const fields = rows.reduce((sum, [, now]) => sum + now.fields, 0), kept = rows.reduce((sum, [, now]) => sum + now.keptRate * now.fields, 0);
  return `AI answers kept on a field: ${Math.round((100 * kept) / fields)}% (${rows.map(([name, now]) => `${name} ${Math.round(100 * now.keptRate)}%`).join(', ')})`;
}

// The median call time of the family with the most calls this week ("≤ 10 s"), and the website's live answer time.
function speedSubs({answers, probes}) {
  const top = ['claude', 'openai', 'unknown'].map(family => answers?.[family]?.now).filter(now => now?.calls && now.median).sort((a, b) => b.calls - a.calls)[0];
  const site = probes?.card?.probes?.find(item => item.probe === 'site' && isNum(item.ms));
  return [top && `Median AI answer call: ${top.median}`, site && `Website answers in ${site.ms} ms (live check)`].filter(Boolean);
}

/** Speed: how long a real search takes to show the first job (median, seconds); lower is better. */
export function speed({days, searches, answers, probes}) {
  const base = {id: 'speed', area: 'Speed', question: 'How long does a job seeker wait?', kind: 'line', subs: speedSubs({answers, probes}), src: 'real searches (technical reports) · AI call times · live checks'};
  if (!searches) return notMeasured(base, 'search reports could not be read');
  if (!searches.rows.length) return notMeasured(base, 'no real search reported in the last 30 days');
  const recent = searches.rows.filter(row => fortnight(days).has(row.day));
  if (!recent.length) return notMeasured(base, 'no real search in the last 14 days');   // before the thin check: no recent data is not "too few installs (0)"
  const installs = new Set(recent.map(row => row.install).filter(Boolean)).size;   // the fill-card rule: installs in the last 14 days
  if (installs < MIN_INSTALLS) return thin(base, installs, recent.length);
  const at = set => searches.rows.filter(row => set.has(row.day)).map(row => row.s), nowValues = at(lastWeek(days));
  const now = median(nowValues), before = median(at(weekBefore(days)));
  if (now == null) return notMeasured(base, 'no real search in the last 7 days');
  const byDay = new Map();
  for (const row of searches.rows) if (days.includes(row.day)) byDay.set(row.day, [...(byDay.get(row.day) || []), row.s]);
  const series = daily(days, new Map([...byDay].map(([day, values]) => [day, {value: median(values), n: values.length}])));
  return finish(base, {value: now, unit: ' s', label: 'to the first job found (median of real searches, last 7 days)', now, before, tolerance: Math.max(1, 0.1 * (before ?? 0)), higherIsBetter: false, series, subs: base.subs, src: `${plural(searches.rows.length, 'real search')}, ${plural(installs, 'install')} · AI call times · live checks`});
}

/** Reliability: the share of live check results that passed (one result per probe per round), per day, last 7 days against the 7 before (bar 99%); crash reports and open Sentry issues beneath. */
export function reliability({days, probes, crashes, sentry}) {
  const base = {id: 'reliability', area: 'Reliability', question: 'Does it stay up and not crash?', kind: 'line', subs: [], src: 'live checks every 5 minutes · crash reports · Sentry'};
  const subs = [crashes ? `${plural(crashes.now.n, 'crash report')} from ${plural(crashes.now.installs, 'install')} in 7 days (${crashes.before.n} the week before)` : 'Crash reports: not measured',
    sentry == null ? 'Sentry: not measured' : `${sentry >= 50 ? '50+' : sentry} unresolved Sentry issue${sentry === 1 ? '' : 's'}`];
  if (!probes) return notMeasured({...base, subs}, 'live checks could not be read');
  if (!probes.rows.length) return notMeasured({...base, subs}, 'no live check round stored in the last 30 days');
  const byDay = new Map(probes.rows.filter(row => row.n > 0).map(row => [row.day, {value: (100 * row.good) / row.n, n: row.n}]));
  const series = daily(days, byDay), {now, before} = weeks(series);
  if (now == null) return notMeasured({...base, subs}, 'no live check round in the last 7 days');
  return finish({...base, subs}, {value: now, digits: 1, unit: '%', label: 'live checks passed, last 7 days', now, before, tolerance: 0.3, bar: 99, series, subs});
}

/** Bugs: found (e2e reds that caught a product bug, plus what the finders filed in 7 days) against escaped (new problems a real user's app reported), per day. */
export function bugs({days, snapshot, newProblems, finders}) {
  const base = {id: 'bugs', area: 'Bugs', question: 'What do we find before users do?', kind: 'columns', subs: [], src: 'tests that caught a product bug · finders · new problems reported by real users'};
  const missing = [!snapshot && 'the e2e snapshot', !newProblems && 'user problem reports'].filter(Boolean);
  if (missing.length) return notMeasured(base, `${missing.join(' and ')} could not be read`);
  const found = new Map(), escaped = new Map(newProblems.map(row => [row.day, row.n]));
  const breaks = new Set();   // one CI break copied onto 32 suites is one bug (admin/e2e-intel.js): a run and its failing line count once
  for (const row of snapshot.caught || []) {
    const key = `${row.runId}|${row.line}`;
    if (row.runId != null && breaks.has(key)) continue;
    breaks.add(key); found.set(row.day, (found.get(row.day) || 0) + 1);
  }
  const series = days.map(day => ({day, found: found.get(day) || 0, escaped: escaped.get(day) || 0}));
  const sum = (key, from, to) => series.slice(from, to).reduce((total, point) => total + point[key], 0);
  const caught = sum('found', -WEEK), out = sum('escaped', -WEEK), outBefore = sum('escaped', -2 * WEEK, -WEEK), total = caught + (finders || 0);
  const trend = judge(out, outBefore, {higherIsBetter: false}), tone = out > total ? 'bad' : out > 0 ? 'warn' : 'good';
  return {...base, value: String(total), unit: ' found', label: `in the last 7 days · ${out} reached a user`, trend, word: WORDS[trend], tone, bar: null, series,
    delta: `${out} reached a user vs ${outBefore} the week before`, subs: [`Tests caught ${caught} · finders filed ${finders == null ? 'not measured' : finders} (a rolling 7 days, not per day)`]};
}

/** What the owner asked for that nothing collects yet (shown as dashed "not measured" cards; proposals, nothing built). */
export const GAPS = [
  {area: 'App speed a user feels', question: 'click → screen, median per day', why: 'Not collected: the app reports no timing for opening a screen. It could be one timing field on its existing health report.'},
  {area: 'AI quality per step', question: 'right / total per prompt', why: 'Not collected: prompt cases are stored as one total per night, not per prompt.'},
];

/** The six areas, in page order (Search, owner 6 Nov 2026, sits after Speed: both are about finding jobs). */
export const areasOf = inputs => [formFilling(inputs), aiQuality(inputs), speed(inputs), search(inputs), reliability(inputs), bugs(inputs)];

/** What the page draws: the areas, the verdict over them, the two things nothing collects yet. */
export function qualityModel(inputs) {
  const areas = areasOf(inputs);
  return {areas, verdict: verdictOf(areas), gaps: GAPS};
}
