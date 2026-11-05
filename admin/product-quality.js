// The product-quality model behind /admin/testing/report-only (owner, 5 Nov 2026: "report only page, doesn't really have insights. It doesn't tell me how we're doing. What is our AI quality,
// or our speed... It should tell me what's the quality of our product... using graphs"). Five areas a job seeker feels (form filling, AI quality, speed, reliability, bugs), each ONE number,
// a daily series and a plain-words better / same / worse against the 7 days before; the verdict counts the areas on target. Pure functions: admin/product-quality-data.js reads, this file judges.
// Facts only (owner's rule): a source that is missing or empty is "not measured", never 0 and never a guess; real-user numbers from fewer than 3 installs are "Too few installs (n)", never a
// percentage (shared/thin-data.js, owner 5 Nov 2026: "Too few installs (n)"). No blended score (owner, 5 Nov 2026: "Areas on target"). Guard: test/unit/admin/report/product-quality.test.js.
//
// An area = {id, area, question, kind: 'line'|'columns', value: string|null, unit, label, trend: 'better'|'same'|'worse'|'new'|'none'|'thin' (new = no earlier week to compare with), word, tone: 'good'|'warn'|'bad'|'none', delta, bar, series, subs: string[], src}
// series: line = [{day, value: number|null, n?}] (oldest first, one per day, null = no data that day); columns = [{day, found, escaped}].
export const WINDOW = 30, WEEK = 7;
export const WORDS = {better: '↑ better', same: '→ same', worse: '↓ worse', new: '• first week', none: 'not measured', thin: 'too few installs'};

const isNum = value => typeof value === 'number' && Number.isFinite(value);
export const round = (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Pooled mean of the points with a number, weighted by `n` (default 1): 87% of 40 fields and 90% of 10 are 87.6%, not 88.5%. null when no point has a number. */
export function pooled(points) {
  let sum = 0, weight = 0;
  for (const point of points) if (isNum(point?.value)) { const n = isNum(point.n) && point.n > 0 ? point.n : 1; sum += point.value * n; weight += n; }
  return weight ? sum / weight : null;
}

/** The median of numbers (null when empty). */
export function median(values) {
  const sorted = values.filter(isNum).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The last 7 days of a series and the 7 before, pooled: {now, before} (each null with no number in its window). */
export function weeks(series) {
  return {now: pooled(series.slice(-WEEK)), before: pooled(series.slice(-2 * WEEK, -WEEK))};
}

/** better | same | worse from two numbers; `tolerance` is the change that still counts as "same". null when either number is missing. */
export function judge(now, before, {higherIsBetter = true, tolerance = 0} = {}) {
  if (!isNum(now) || !isNum(before)) return null;
  const change = now - before;
  if (Math.abs(change) <= tolerance) return 'same';
  return (change > 0) === higherIsBetter ? 'better' : 'worse';
}

/**
 * The tone of an area. none without a number; bad below its bar. An area WITHOUT a bar has no target to be "on": it is on target while it is not getting worse (said in the spec), so a worse week
 * is "warn" (to watch) and only a change beyond twice its tolerance (`big`) is "bad" (slipping); with a bar, a worse week that is still above it is "warn". Else good.
 */
export function toneOf(trend, value, {bar = null, higherIsBetter = true, big = false} = {}) {
  if (trend === 'none' || trend === 'thin') return 'none';
  if (bar != null && isNum(value) && (higherIsBetter ? value < bar : value > bar)) return 'bad';
  if (trend === 'worse') return bar == null && big ? 'bad' : 'warn';
  return 'good';
}

/** An area with no number: the reason goes in `label`, the sources it would have used in `src`. */
export const notMeasured = (base, why) => ({...base, value: null, unit: '', label: why, trend: 'none', word: WORDS.none, tone: 'none', delta: 'not measured', bar: null, series: [], subs: base.subs || []});

/** The change line under a number: "+3 pts vs last 7 days"; when the week before has no number, it says so instead of inventing one. */
export function deltaText(now, before, unit, digits = 0) {
  if (!isNum(now) || !isNum(before)) return 'no earlier week to compare with';
  const change = round(now - before, digits);
  if (change === 0) return `±0${unit} vs last 7 days`;
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}${unit} vs last 7 days`;
}

/**
 * The verdict over the areas: how many are on target, which slip, which to watch, which are not measured.
 * @param {object[]} areas
 * @returns {{icon: string, headline: string, chips: {area: string, tone: string, word: string}[], counts: {good: number, warn: number, bad: number, none: number}}}
 */
export function verdictOf(areas) {
  const by = tone => areas.filter(item => item.tone === tone), names = list => list.map(item => item.area).join(', ');
  const [good, warn, bad, none] = ['good', 'warn', 'bad', 'none'].map(by);
  const few = none.filter(item => item.trend === 'thin'), unmeasured = none.filter(item => item.trend !== 'thin');
  const parts = [`${good.length} of ${areas.length} areas on target`, bad.length && `${names(bad)} slipping`, warn.length && `${names(warn)} to watch`, unmeasured.length && `${names(unmeasured)} not measured`, few.length && `${names(few)}: too few installs`].filter(Boolean);
  const icon = none.length === areas.length ? '⚪' : bad.length ? '🟠' : warn.length ? '🟡' : none.length ? '🟡' : '🟢';
  return {icon, headline: parts.join(' · '), chips: areas.map(item => ({area: item.area, tone: item.tone, word: item.word})), counts: {good: good.length, warn: warn.length, bad: bad.length, none: none.length}};
}
