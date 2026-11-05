// The "Session checks" tab of /admin/job-search/lab (owner, 24 Oct 2026): the local search checks sessions ran, newest first, each with its numbers, the boards it read, what broke and the conclusion, so
// the next session starts from them. Counts, seconds, board names and two sentences (admin/session-checks.js). Guard: test/unit/admin/session-checks.test.js.
import {esc} from '../shared/html.js';

const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);

function boardsTable(boards) {
  if (!boards.length) return '';
  return `<div class="scroll"><table><tr><th>Board</th><th class="num">Listed</th><th class="num">Relevant</th><th>Note</th></tr>${boards.map(board =>
    `<tr><td>${esc(board.name)}</td><td class="num">${num(board.listed)}</td><td class="num">${board.relevant === 0 && board.listed > 0 ? `<span class="down">${num(board.relevant)}</span>` : num(board.relevant)}</td><td class="muted">${esc(board.note || '')}</td></tr>`).join('')}</table></div>`;
}

export function checksSection(rows) {
  const cards = rows.map(row => `<section class="card"><h2>${esc(row.label)} <span class="chip">${esc(row.mode)}</span> <span class="state ${row.state === 'ok' ? 'good' : 'bad'}">${row.state === 'ok' ? 'Ran' : 'FAILED'}</span></h2>
<p class="muted">${esc(row.country)}${row.role ? ` · ${esc(row.role)}` : ''} · ${esc(row.run_at.slice(0, 16).replace('T', ' '))} UTC · build ${esc(row.build || 'unknown')} · by session ${esc(row.session)}${row.prs ? ` · ${esc(row.prs)}` : ''}</p>
<div class="tiles"><div class="tile"><span class="muted">Local jobs</span><b>${num(row.local_jobs)}</b></div><div class="tile"><span class="muted">1st relevant job</span><b>${clock(row.first_s)}</b></div>
<div class="tile"><span class="muted">Scored · 70+</span><b>${num(row.scored)} · ${num(row.fit70)}</b></div><div class="tile"><span class="muted">Run time</span><b>${row.seconds == null ? '–' : clock(row.seconds)}</b></div></div>
${boardsTable(row.boards)}${row.broke ? `<p><b>What broke:</b> ${esc(row.broke)}</p>` : ''}${row.conclusion ? `<p><b>Conclusion:</b> ${esc(row.conclusion)}</p>` : ''}</section>`).join('')
    || '<section class="card"><h2>No session check yet</h2><p class="muted">After a local check, a session uploads it with <code>node tools/persona-search/publish-session-check.mjs</code> (see the skill check-job-search-locally).</p></section>';
  return `<p class="muted">Local search checks by sessions: local jobs are jobs placed in the user's city or country, never worldwide remote. Read these before running the same check again.</p>${cards}`;
}
