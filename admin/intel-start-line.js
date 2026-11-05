// The red line on /admin/testing/e2e and /admin/testing/integrations when the Worker's last on-time start of the page's collector failed (owner, 1 Nov 2026: "Red line on the page",
// "collector not starting: <reason>"). The data is shared/intel-start.js (readStartProblem); this is only its HTML. Guard: test/unit/admin/intel-start-line.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';

/** '' when the start is fine, else a card naming the reason and when it was last tried. GitHub's own schedule still runs the collector, only late. */
export const startLine = problem => (problem
  ? `<style>${CHIP_STYLE}</style><section class="card"><p class="verdict">${chip('not starting', 'bad')} <b>collector not starting:</b> ${esc(problem.reason)}</p><p class="muted">The Worker's last try was ${esc(String(problem.at).slice(0, 16).replace('T', ' '))} UTC; until it works the page only gets GitHub's own (late) schedule.</p></section>`
  : '');
