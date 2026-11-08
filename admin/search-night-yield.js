// The step yield of the nightly Search check (owner, 8 Nov 2026: "Can I get in Admin these stats as well?", about the jobadabra PR "P1 Each Find jobs step's jobs and seconds are measured"): per persona and step of
// the Find jobs run (scoring, job_boards, employer_sites, free_job_apis), the seconds it ran, the jobs it brought, how many were in the person's places and how many of those scored 70 or more.
// The public tool (jobadabra tools/persona-search/gate.py) writes them into each verdict row as `step_yield` (a list of {step, seconds, jobs, local, scored, fit70, local_fit70}); a row without the list claims
// nothing and the card is not drawn (an older night, or a press build before P1). REPORT ONLY: it never touches a night's verdict. Counts and seconds only, no job or employer text. Pure.
// Why (8 Nov 2026): a step's rate is per step-minute and the steps run beside each other, so the rates never add up to the run; the summary's rate is its total local jobs over its total timed seconds, a step no persona timed shows "not timed yet", never 0.
import {esc} from '../shared/html.js';
import {median} from './product-quality.js';

export const MAX_STEPS = 8;
const FIELDS = ['seconds', 'jobs', 'local', 'scored', 'fit70', 'local_fit70'];
const whole = value => (Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : null);
const isNum = value => typeof value === 'number' && Number.isFinite(value);

/** A verdict row's `step_yield` -> the stored list ([{step, seconds, jobs, local, scored, fit70, localFit70}], whole numbers or null; seconds keep one decimal), or null when there is none (no zeros are made up). */
export function cleanStepYield(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = raw.filter(item => item && typeof item === 'object' && !Array.isArray(item) && /^[a-z][a-z_ ]{0,39}$/.test(String(item.step ?? ''))).slice(0, MAX_STEPS);
  return rows.map(item => ({step: item.step, seconds: isNum(item.seconds) && item.seconds >= 0 && item.seconds <= 1e5 ? Math.round(item.seconds * 10) / 10 : null,
    ...Object.fromEntries(FIELDS.slice(1).map(key => [key === 'local_fit70' ? 'localFit70' : key, whole(item[key])]))}));
}

const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const words = step => step.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()).replace(/\bapis\b/i, 'APIs');
// Why (Gitar, #497): null = never timed ("not timed yet"); a step timed at 0 s HAS a time but no rate, so it shows a dash, never the words that contradict its "0 s".
const perMinute = (local, seconds) => (!isNum(seconds) ? null : seconds > 0 && isNum(local) ? Math.round((local * 600) / seconds) / 10 : '–');
const rate = value => (value == null ? '<span class="muted">not timed yet</span>' : value === '–' ? '–' : `${value}/min`);
const seconds = value => (value == null ? '–' : `${value} s`);
const total = (rows, key) => rows.reduce((sum, row) => sum + (row[key] || 0), 0);

/** One summary row per step over the personas that have it: personas, median seconds, total jobs, local jobs, local fit 70+, local per minute (over the personas that timed it). */
export function summarise(rows) {
  const steps = [];
  for (const row of rows) for (const item of row.stepYield || []) if (!steps.includes(item.step)) steps.push(item.step);
  return steps.map(step => {
    const mine = rows.flatMap(row => (row.stepYield || []).filter(item => item.step === step)), timed = mine.filter(item => isNum(item.seconds));
    return {step, personas: mine.length, seconds: median(timed.map(item => item.seconds)), jobs: total(mine, 'jobs'), local: total(mine, 'local'), localFit70: total(mine, 'localFit70'),
      perMinute: timed.length ? perMinute(total(timed, 'local'), total(timed, 'seconds')) : null};
  });
}

/**
 * The step-yield card of one night.
 * @param {object[]} rows the night's judged rows ({label, stepYield})
 * @param {string} night the night's date (YYYY-MM-DD)
 * @returns {string} HTML; '' when no row carries a step yield
 */
export function stepYieldSection(rows, night) {
  if (!rows.some(row => row.stepYield?.length)) return '';
  const head = '<tr><th>Step</th><th class="num">Seconds</th><th class="num">Jobs</th><th class="num">Local</th><th class="num">Local fit 70+</th><th class="num">Local per minute</th></tr>';
  const summary = summarise(rows).map(item => `<tr><td><b>${esc(words(item.step))}</b> <span class="muted">${item.personas} candidate${item.personas === 1 ? '' : 's'}</span></td><td class="num">${seconds(item.seconds)}</td>`
    + `<td class="num">${num(item.jobs)}</td><td class="num">${num(item.local)}</td><td class="num">${num(item.localFit70)}</td><td class="num">${rate(item.perMinute)}</td></tr>`).join('');
  const each = rows.flatMap(row => (row.stepYield || []).map(item => `<tr><td>${esc(row.label)}</td><td>${esc(words(item.step))}</td><td class="num">${seconds(item.seconds)}</td><td class="num">${num(item.jobs)}</td>`
    + `<td class="num">${num(item.local)}</td><td class="num">${num(item.localFit70)}</td><td class="num">${rate(perMinute(item.local, item.seconds))}</td></tr>`)).join('');
  return `<section class="card" id="step-yield"><h2>What each step brought, night ${esc(night)}</h2><div class="scroll"><table class="wide">${head}${summary}</table></div>
<p class="muted">Median seconds per candidate; jobs, local jobs (in the person's places) and local jobs scored 70+ added up over the candidates. A step is credited with the jobs it found, even when a later step scored them. Steps run beside each other, so the rates do not add up to the run.</p>
<details><summary>Every candidate</summary><div class="scroll"><table class="wide"><tr><th>Candidate</th><th>Step</th><th class="num">Seconds</th><th class="num">Jobs</th><th class="num">Local</th><th class="num">Local fit 70+</th><th class="num">Local per minute</th></tr>${each}</table></div></details></section>`;
}
