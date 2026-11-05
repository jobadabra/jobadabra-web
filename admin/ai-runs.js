// /admin/ai/runs: CI fixer outcomes, reasons, achievements and PR links from the existing harness upload.
// Values are escaped, and the owner-only route uses the same stored records as Agent harness.
import {esc} from '../shared/html.js';
import {shell, chip, tokensWord} from './ai-section.js';

const VERDICT = {fix: ['good', '🛠 fix'], 'fixed-already': ['wait', '✔ fixed already'], 'not-reproducible': ['wait', '❔ not reproducible'], 'needs-human': ['warn', '🙋 needs human'], 'false-positive': ['wait', '⚪ false positive'], answer: ['plain', '💬 answer'], none: ['wait', '— no verdict']};
const HEAD = {'fixed-already': 'Already fixed', 'not-reproducible': 'Could not reproduce it', 'needs-human': 'Needs a human', 'false-positive': 'Judged a false positive', answer: 'Answered, no change', none: 'Stopped before a verdict'};
const STOP_HEAD = {time: 'Ran out of time', rounds: 'Ran out of rounds', 'same-failure': 'Same failure twice', refused: 'A wall refused the change', conflict: 'Stopped on a conflict', 'round-failed': 'A round failed', 'no-change': 'Made no change', wall: 'Hit a safety wall', dispatch: 'Could not start a round', 'bad-deadline': 'Bad deadline given'};
/** A table's own entry or undefined: a word from an upload like "constructor" must not find Object's members. */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const PR_URL = 'https://github.com/jobadabra/jobadabra/pull/';
const TIME_STYLE = 'font-size:13px';

/** The headline of a run in about five words: what happened, from its stop word, its verdict and its PR. */
export function headline(run) {
  if (run.stop === 'ready') return run.pr ? `Reached READY on PR #${run.pr}` : 'Reached READY';
  if (run.stop) return own(STOP_HEAD, run.stop) || `Stopped: ${run.stop}`;
  if (run.verdict === 'fix') return run.pr ? `Opened PR #${run.pr}` : 'Wrote a fix';
  return own(HEAD, run.verdict) || `Ended: ${run.verdict}`;
}
const ago = (at, now) => { const min = Math.max(0, Math.floor((now - Date.parse(at)) / 60000)); return min < 2 ? 'just now' : min < 120 ? `${min} min ago` : min < 2880 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / 1440)} days ago`; };
const verdictChip = run => chip(...(own(VERDICT, run.verdict) || ['plain', run.verdict]));
const stopChip = run => (run.stop === 'ready' ? chip('good', '✅ READY') : run.stop ? chip('bad', `⛔ ${run.stop}`, 'Why the driver stopped') : '');
const prLink = pr => `<a href="${PR_URL}${pr}">PR #${pr}</a>`;
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** One run's card: headline, chips, steps, the verdict's reason, achievements, errors, the rest in a toggle and the link to the full log. */
export function runCard(run, now) {
  const achievements = [run.stop === 'ready' ? chip('good', '✅ READY reached') : '', run.pr ? chip('good', `🔀 PR #${run.pr} opened`) : '', run.files.length ? chip('good', `📝 ${run.files.length} file${run.files.length === 1 ? '' : 's'} changed`) : ''].filter(Boolean);
  const source = run.source === 'other' ? '' : `${run.source}${run.ref ? ` ${run.ref}` : ''}`;
  return `<section class="card hn-run" id="run-${esc(run.id)}"><div class="ai-head"><b>${esc(headline(run))}</b>${verdictChip(run)}${stopChip(run)}${source ? chip('plain', source) : ''}<span class="muted" style="${TIME_STYLE}" title="${esc(run.started)}">${esc(ago(run.started, now))}</span></div>
<div class="ai-nums">${run.engine ? `<span>${esc(run.engine)}</span>` : ''}<span><b>${run.turns}</b> turns</span><span><b>${run.calls}</b> broker calls</span><span><b>${tokensWord(run.tokensIn)}</b> in · <b>${tokensWord(run.tokensOut)}</b> out</span><span><b>${run.minutes}</b> min</span></div>
<dl class="ai-facts"><dt>Steps</dt><dd>${run.steps.length ? `<span class="hn-steps">${run.steps.map(step => `<i>${esc(step)}</i>`).join('<u>→</u>')}</span>` : '<span class="muted">none recorded</span>'}</dd>
<dt>Reason</dt><dd>${run.reason ? esc(cut(run.reason, 160)) : '<span class="muted">none given</span>'}</dd>
<dt>Achieved</dt><dd>${achievements.length ? `<span class="ai-chips">${achievements.join('')}</span>` : '<span class="muted">nothing yet (no PR, no change)</span>'}</dd>
<dt>Errors</dt><dd>${run.errors.length ? `<span class="hn-err">${esc(run.errors[0])}</span>${run.errors.length > 1 ? ` <span class="muted">+${run.errors.length - 1} more</span>` : ''}` : '<span class="muted">none</span>'}</dd></dl>
<details><summary>Details</summary><dl class="ai-facts"><dt>Run</dt><dd>${esc(run.id)} · round ${run.round}${run.model ? ` · ${esc(run.model)}` : ''}</dd><dt>Stop</dt><dd>${run.stop ? esc(run.stop) : '<span class="muted">none</span>'}</dd>${run.pr ? `<dt>PR</dt><dd>${prLink(run.pr)}</dd>` : ''}
<dt>Full reason</dt><dd>${run.reason ? esc(run.reason) : '<span class="muted">none given</span>'}</dd>${run.errors.length ? `<dt>All errors</dt><dd>${run.errors.map(error => `<div class="hn-err">${esc(error)}</div>`).join('')}</dd>` : ''}${run.files.length ? `<dt>Files</dt><dd>${run.files.map(file => `<div><code>${esc(file)}</code></div>`).join('')}</dd>` : ''}</dl></details>
<div><a href="${esc(run.url)}">Full log on GitHub →</a></div></section>`;
}


/** The Agent runs page from the latest "harness" card (null when nothing was uploaded). `now` is a Date. */
export function runsPage(card, now = new Date()) {
  const runs = (card?.runs || []).filter(run => Date.parse(run.started) >= now.getTime() - 30 * 86400000), last = runs[0];
  const ready = runs.filter(run => run.stop === 'ready').length, prs = runs.filter(run => run.pr).length, human = runs.filter(run => run.verdict === 'needs-human').length, red = runs.filter(run => run.stop && run.stop !== 'ready').length;
  const ribbon = card?.demo ? '<div class="hn-demo" role="note">🧪 <b>Demo data</b> · made-up runs to show the layout; the real page shows only what CI recorded</div>' : '';
  const verdict = `${ribbon}<section class="card"><h2>${runs.length} run${runs.length === 1 ? '' : 's'} <span class="muted">· last 30 days, the CI fixer on one item each</span></h2><div class="ai-chips">${chip(ready ? 'good' : 'wait', `✅ ${ready} READY`)}${chip(prs ? 'good' : 'wait', `🔀 ${prs} PR opened`)}${chip(human ? 'warn' : 'wait', `🙋 ${human} needs-human`)}${chip(red ? 'bad' : 'good', `⛔ ${red} stopped red`)}${card?.dropped ? chip('warn', `▲ ${card.dropped} record${card.dropped === 1 ? '' : 's'} unreadable`, 'Not a v1 record of an ai-fixer run: dropped, never shown') : ''}</div>
<p style="margin:10px 0 0;font-size:13px">${last ? `Last run: <b>${esc(headline(last))}</b> <span class="muted">· ${esc(last.source === 'other' ? '' : `${last.source} ${last.ref}`.trim())} · ${esc(ago(last.started, now.getTime()))}</span>` : '<span class="muted">No run recorded yet: the fixer writes a record per run and the daily stats run uploads it.</span>'}</p></section>`;
  const body = `<h2 class="hn-runs">Runs <span class="muted">· newest first</span></h2>${runs.length ? runs.map(run => runCard(run, now.getTime())).join('') : '<section class="card"><p class="muted" style="margin:0">No run recorded yet.</p></section>'}`;
  return shell({title: 'Agent runs', icon: '📋', heading: 'Agent runs', age: card?.at, verdict, body, style: RUN_STYLE});
}

const RUN_STYLE = `.hn-demo{border:1px dashed #f2c14e;color:#f2c14e;border-radius:8px;padding:8px 12px;font-size:13px;margin:0 0 12px}.hn-runs{margin:18px 0 8px}
.hn-run{display:grid;gap:8px;margin:0 0 12px!important}.hn-steps{display:inline-flex;flex-wrap:wrap;gap:4px 6px;align-items:center}.hn-steps i{font-style:normal;border:1px solid #262c33;border-radius:6px;padding:1px 7px;font-size:12.5px}.hn-steps u{text-decoration:none;color:#5b6470}
.hn-err{color:#ff8f84;word-break:break-word}.hn-run details summary{cursor:pointer;color:#8d949c;font-size:13px}.hn-run dd{min-width:0;word-break:break-word}`;
