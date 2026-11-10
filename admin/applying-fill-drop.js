// A pool site's fill regression on /admin/form-filling/lab: its last run filled fewer of the form's fields than its own best run's share would have.
// A report beside the reach regression, never a gate: it does not enter Needs a fix (admin/applying-order.js). Guard: test/unit/admin/applying/applying-fill-drop.test.js.
import {isHold} from './applying-status.js';

// Why (10 Nov 2026, brief lr): measured on the pool's runs that day, two runs in a row filled the same count 59% of the time, one field apart 19%, two or more 22%;
// on one build, 15 of 22 pairs the same and 5 one field apart. One field is the noise of a form, so a drop counts from one field past it.
export const NOISE_FIELDS = 1;

const FORM = new Set(['form', 'ready']);
const counts = run => {
  const filled = run?.filled, left = run?.left_n ?? run?.left;
  // Why (10 Nov 2026, lr review): a held run (an eligibility stop reaches 'form' before any field) has no fill share, as in admin/applying-fixed.js shareOf.
  return FORM.has(run?.reached) && !run.hold && !isHold(run.note) && Number.isInteger(filled) && Number.isInteger(left) && filled + left > 0 ? {filled, total: filled + left, share: filled / (filled + left), day: run.day} : null;
};
const shown = item => ({filled: item.filled, total: item.total, share: Math.round(100 * item.share), day: item.day});

/**
 * The fill regression of one pool site, from its kept runs (oldest first; rows of applying_runs or the page's run objects).
 * Invariant: only a last run that reached the form is judged (a stop before it is the reach regression's), against the best share of the earlier runs, measured on
 * the last run's form size, so a form that grew or shrank is compared fairly and says so (formChanged).
 * @returns {{fields: number, best: object, last: object, formChanged: boolean} | null} null when the last run is within NOISE_FIELDS of its best.
 */
export function fillDrop(runs) {
  const last = counts(runs?.at?.(-1));
  if (!last) return null;
  const best = runs.slice(0, -1).map(counts).filter(Boolean).reduce((top, item) => (!top || item.share > top.share ? item : top), null);
  if (!best || best.share <= last.share) return null;
  const fields = Math.round((best.share - last.share) * last.total);
  return fields > NOISE_FIELDS ? {fields, best: shown(best), last: shown(last), formChanged: best.total !== last.total} : null;
}

/** The words of a fill regression, for the pool row and its tooltip: "fills 4 fields fewer than its best". */
export const fillDropText = drop => `fills ${drop.fields} field${drop.fields === 1 ? '' : 's'} fewer than its best`;
/** The row's tooltip: both runs' counts, whether the form changed size, and the noise that is not shown. */
export const fillDropTitle = drop => `Best run ${drop.best.day}: ${drop.best.filled} of ${drop.best.total} fields (${drop.best.share}%). Last run ${drop.last.day}: ${drop.last.filled} of ${drop.last.total} (${drop.last.share}%).`
  + (drop.formChanged ? ` The form changed from ${drop.best.total} to ${drop.last.total} fields: the site may have changed, not our build.` : '')
  + ` A drop of ${NOISE_FIELDS} field is normal noise and is not shown.`;

/** fillDrop with its words, as the page sends it to the browser (the page's script is a string: it gets the words, not these functions). */
export const fillDropRow = runs => { const drop = fillDrop(runs); return drop && {...drop, text: fillDropText(drop), title: fillDropTitle(drop)}; };
