// Floors that only rise (cr's G2, 10 Nov 2026; sa's rule: "the card draws them and computes nothing"): the verdict carries what the check decided about each person's numbers against their own held floor, and the
// site keeps it in fixed shape. Two row-independent verdict fields, kept on the stored night:
//   measure  "<12 hex>"  the scoreboard lock's fingerprint (a new one starts a new series)
//   floors   {checked: false, why} | {checked: true, series, red: [{persona, number, floor, now, spread, below}], levels: {<persona>: {<number>: {floor, now, spread, below}}}, last_green: {run, sha} | null, merges: [<subject>]}
// `merges` comes once per night (cr, 10 Nov 2026: 54 red numbers x 20 merges each could pass the 64 KB cap), newest last; `eures_inout` is a fraction 0-1.
// Numbers: right (right jobs, higher is better), eures_inout (out / in share, higher is better), first_s (seconds to first job, lower is better: its floor is a ceiling). `floor` is null until 3 measured nights.
// A word outside the lists is dropped, a count that is not a number is null, text is one short line. Pure. The alert is cr's check (desktop/e2e/ci-alert.mjs), never this file. Guard: test/unit/admin/search/search-floors.test.js.
export const NUMBERS = ['right', 'eures_inout', 'first_s'];
export const MAX_RED = 54, MAX_MERGES = 10, MAX_PERSONAS = 40;   // 3 numbers x 18 people can all be red
const line = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const real = value => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7 ? Math.round(value * 1000) / 1000 : null);
const whole = value => (Number.isInteger(value) && value >= 0 && value < 1e6 ? value : null);
const persona = value => (Number.isInteger(value) && value > 0 && value < 100 ? value : null);

/** A verdict's `measure` -> the 12-hex fingerprint, or null. */
export const cleanMeasure = value => (typeof value === 'string' && /^[0-9a-f]{12}$/.test(value) ? value : null);

const level = raw => (plain(raw) ? {floor: real(raw.floor), now: real(raw.now), spread: real(raw.spread), below: whole(raw.below)} : null);

/** A verdict's `floors` -> the shape above, or null when it is not an object or says neither checked true nor false. */
export function cleanFloors(raw) {
  if (!plain(raw) || typeof raw.checked !== 'boolean') return null;
  if (!raw.checked) return {checked: false, why: line(raw.why, 120)};
  const red = (Array.isArray(raw.red) ? raw.red : []).filter(item => plain(item) && persona(item.persona) && NUMBERS.includes(item.number)).slice(0, MAX_RED).map(item => ({
    persona: item.persona, number: item.number, floor: real(item.floor), now: real(item.now), spread: real(item.spread), below: whole(item.below)}));
  const levels = {};
  for (const [key, numbers] of Object.entries(plain(raw.levels) ? raw.levels : {}).slice(0, MAX_PERSONAS)) {
    if (!/^\d{1,2}$/.test(key) || !plain(numbers)) continue;
    levels[key] = Object.fromEntries(NUMBERS.filter(number => level(numbers[number])).map(number => [number, level(numbers[number])]));
  }
  const green = plain(raw.last_green) && /^\d{1,15}$/.test(String(raw.last_green.run ?? '')) ? {run: String(raw.last_green.run), sha: /^[0-9a-f]{7,40}$/.test(String(raw.last_green.sha ?? '')) ? raw.last_green.sha : ''} : null;
  const merges = (Array.isArray(raw.merges) ? raw.merges : []).slice(-MAX_MERGES).map(merge => line(merge, 100)).filter(Boolean);   // newest last: keep the newest 10
  return {checked: true, series: line(raw.series, 120), red, levels, last_green: green, merges};
}
