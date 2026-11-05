// The four state cards of /admin/testing/self-healing, one per pinned GitHub issue they replace (owner, 5 Nov 2026: "turn this pinned issues into dashboards/tabs/pages in Admin … and will
// remove them from GH issue list"): Top issues (#1892, the snapshot's `ranking`), Finder scorecard (#341, `scorecard`), Verdict audit (#2736, ci_state `verdict-audit`) and Judged noise (#274,
// ci_state `noise-register`). Pure: stored data in, HTML out; the owner's buttons are plain forms handled by admin/selfheal.js. Test: test/unit/admin/selfheal-state-cards.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';

// ---------- Top issues: the open findings ranked by the loop (desktop/e2e/selfheal-stats.mjs, jobadabra repo) ----------
const BANDS = ['P0', 'P1', 'P2', 'P3'];
const TONE = {P0: 'bad', P1: 'bad', P2: 'warn', P3: 'off'};
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;
const age = days => (days === null || days === undefined ? '' : days <= 0 ? 'today' : `${days} d ago${days >= 7 ? ' ⚠️' : ''}`);

/** One ranked finding. The snapshot is written by another repo's job: every value is escaped and the link must be a GitHub issue. */
function row(item, index) {
  const band = Object.hasOwn(TONE, item.priority) ? item.priority : 'P3';
  const link = ISSUE_URL.test(String(item.url)) ? `<a href="${esc(item.url)}">#${esc(item.number)}</a>` : `#${esc(item.number)}`;
  const notes = [item.needsPerson ? chip('🙋 needs a person', 'warn') : '', item.clean ? chip('clean last run', 'good') : ''].filter(Boolean).join(' ');
  const seen = [item.build ? `<code>${esc(item.build)}</code>` : '?', esc(age(item.days))].filter(Boolean).join(' · ');
  return `<tr><td class="n">${index + 1}</td><td>${chip(band, TONE[band])}</td><td>${link} ${esc(item.title)} ${notes}</td><td>${esc(item.platform)}</td><td class="n">${esc(item.score)}</td><td class="muted">${seen}</td></tr>`;
}

/** The card, or '' when the snapshot has no ranking yet (published before 5 Nov 2026). */
export function topIssuesSection(live) {
  const top = live?.ranking;
  if (!top || !Array.isArray(top.rows)) return '';
  const counts = BANDS.map(band => chip(`${band} · ${Number(top.counts?.[band]) || 0}`, TONE[band])).join(' ');
  const body = top.rows.length
    ? `<div class="wrap"><table><tr><th>#</th><th>Priority</th><th>Finding</th><th>Platform</th><th>Score</th><th>Last build seen on</th></tr>${top.rows.map(row).join('')}</table></div>`
    : `<p>${chip('✔ nothing open', 'good')}</p>`;
  return `<section class="card" id="top-issues"><h2>🔥 Top issues</h2><small class="muted">The open findings, most important first · re-ranked after every Finder run · ${esc(Number(top.open) || 0)} open</small>
<p>${counts}</p>${body}
<small class="muted"><b>P0</b> would keep a build from beta or stable · <b>P1</b> seen again and again, or high and confirmed · <b>P2</b> worth a look · <b>P3</b> seen once, or already clean in the latest run. Score = severity × sightings this week (× 2 when a person confirmed it).</small></section>`;
}

// ---------- Finder scorecard: per detector real vs false and why, severity changes, change since the last snapshot (desktop/e2e/lib/finder-scorecard.mjs) ----------
const pct = value => (value === null || value === undefined ? '–' : `${value}%`);
const delta = (now, was) => (now == null || was == null || now === was ? '' : ` <span class="${now > was ? 'up' : 'down'}">${now > was ? '▲' : '▼'} ${Math.abs(now - was)}</span>`);
const precisionTone = precision => (precision === null || precision === undefined ? 'off' : precision >= 70 ? 'good' : precision >= 40 ? 'warn' : 'bad');
const causes = list => Object.entries(list || {}).filter(([, n]) => n).map(([why, n]) => `${esc(why.replace(/^fp:/, ''))} ${esc(n)}`).join(', ');

/** The card from `live.scorecard`; `previous` is the older snapshot's scorecard (or null). '' when the snapshot has none yet. */
export function scoreSection(card, previous = null) {
  if (!card || !Array.isArray(card.detectors)) return '';
  const was = source => (previous?.detectors || []).find(row => row.source === source);
  const rows = card.detectors.map(row => `<tr><td>${esc(row.detector)}</td><td class="n">${esc(row.filed)}</td><td class="n">${esc(row.real)}</td><td class="n">${esc(row.falsePositive)}</td><td class="n">${esc(row.open)}</td>
<td>${chip(esc(pct(row.precision)), precisionTone(row.precision))}${delta(row.precision, was(row.source)?.precision)}</td><td class="muted">${causes(row.causes) || '–'}</td><td class="n">${esc(row.severityChanged?.judged ?? 0)}</td></tr>`).join('');
  const t = card.totals || {}, y = card.yield || {};
  const week = (label, w) => (w ? `${label}: ${esc(w.real)} real · ${esc(w.falsePositive)} false` : '');
  return `<section class="card" id="scorecard"><h2>🎯 Finder scorecard</h2><small class="muted">As of ${esc(card.at)} · precision ${esc(pct(t.precision))} over ${esc(t.filed ?? 0)} filed · ${[week('this week', y.thisWeek), week('week before', y.lastWeek)].filter(Boolean).join(' · ')}${previous ? ' · arrows: change since the last snapshot' : ''}</small>
<div class="wrap"><table><tr><th>Detector</th><th>Filed</th><th>Real</th><th>False</th><th>Open</th><th>Precision</th><th>Why false</th><th>Severity changed</th></tr>${rows}</table></div></section>`;
}

// ---------- Verdict audit: five random verdicts a week, ticked right or wrong by the owner ----------
const rate = score => (score && score.right + score.wrong ? `${score.right} of ${score.right + score.wrong} right` : 'nothing ticked');

const button = (item, value, label, on) => `<form method="post" action="/admin/testing/self-healing#audit"><input type="hidden" name="action" value="tick"><input type="hidden" name="key" value="${esc(item.key)}"><input type="hidden" name="value" value="${on ? '' : value}"><button type="submit" class="btn${on ? ` on-${value}` : ''}" aria-pressed="${on}">${label}</button></form>`;

function itemRow(item, owner) {
  const ticks = owner ? `<div class="ticks">${button(item, 'right', '👍 right', item.tick === 'right')}${button(item, 'wrong', '👎 wrong', item.tick === 'wrong')}</div>` : (item.tick ? chip(item.tick === 'right' ? '👍 right' : '👎 wrong', item.tick === 'right' ? 'good' : 'bad') : chip('not ticked', 'off'));
  return `<li><div><b>${esc(item.word)}</b> · ${esc(String(item.what || '').slice(0, 90))} <span class="muted">(${esc(item.where)})</span></div><div class="muted">${esc(String(item.why || '').slice(0, 300))}</div>${ticks}</li>`;
}

/** The card: this week's open audit with its buttons (owner) or its ticks (admins), then the closed audits' scores. '' when no audit was ever stored. */
export function auditSection(state, owner = false) {
  const audits = Array.isArray(state?.audits) ? state.audits : [];
  if (!audits.length) return '';
  const [latest, ...older] = audits;
  const open = !latest.closed, done = (latest.items || []).filter(item => item.tick).length;
  const closed = (open ? older : audits).filter(audit => audit.closed);
  const history = closed.length ? `<p class="muted">Earlier: ${closed.slice(0, 6).map(audit => `${esc(audit.week)} ${chip(esc(rate(audit.score)), audit.score && audit.score.right + audit.score.wrong ? (audit.score.right / (audit.score.right + audit.score.wrong) >= 0.8 ? 'good' : 'warn') : 'off')}`).join(' ')}</p>` : '';
  return `<section class="card" id="audit"><h2>🎯 Verdict audit</h2><small class="muted">Was the verdict right? ${open ? `${done} of ${(latest.items || []).length} ticked · week of ${esc(latest.week)} · the next audit reports the accuracy` : `week of ${esc(latest.week)} closed: ${esc(rate(latest.score))}`}</small>
${open ? `<ol class="audit">${(latest.items || []).map(item => itemRow(item, owner)).join('')}</ol>` : ''}${history}</section>`;
}

/** The buttons and notes the state cards share (owner-pressed Forget and tick forms, change arrows of the scorecard). */
export const STATE_STYLE = `${CHIP_STYLE}.btn{background:transparent;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:3px 10px;font:inherit;font-size:13px;cursor:pointer}.btn:hover{border-color:var(--amber)}.btn:focus-visible{outline:2px solid var(--amber)}
.btn.on-right{border-color:#2d5a3b;color:#5ec47a}.btn.on-wrong{border-color:#6b2a2c;color:#e5484d}form{display:inline}.ticks{display:flex;gap:8px;margin-top:6px}.audit{margin:8px 0 0;padding-left:20px}.audit li{margin-top:12px}.up{color:#5ec47a}.down{color:#e5484d}`;

// ---------- Judged noise: what was judged noise before an issue was opened; Forget lets one be filed again ----------
const SHOWN = 15;
const NOISE_TONE = {'false-positive': 'off', harness: 'off', real: 'good', 'needs-human': 'warn'};
const noiseTone = word => (Object.hasOwn(NOISE_TONE, word) ? NOISE_TONE[word] : 'off');

const forget = item => `<form method="post" action="/admin/testing/self-healing#noise"><input type="hidden" name="action" value="forget"><input type="hidden" name="id" value="${esc(item.id)}"><button type="submit" class="btn">Forget</button></form>`;

/** The card: the newest SHOWN entries, each with its verdict chip and why; `owner` adds the Forget buttons. '' when the store was never written. */
export function noiseSection(state, owner = false) {
  const entries = Array.isArray(state?.entries) ? state.entries : null;
  if (!entries) return '';
  const rows = entries.slice(-SHOWN).reverse().map(item => `<tr><td class="muted">${esc(item.date)}</td><td>${esc(item.view)}</td><td>${esc(item.title)}</td><td>${chip(esc(item.word), noiseTone(item.word))}</td><td class="muted">${esc(String(item.why || '').slice(0, 140))}</td>${owner ? `<td>${forget(item)}</td>` : ''}</tr>`).join('');
  return `<section class="card" id="noise"><h2>🧹 Judged noise</h2><small class="muted">${esc(entries.length)} remembered, the latest ${Math.min(entries.length, SHOWN)} below · the Finder drops these without a new judgement${owner ? ' · Forget lets one be filed again' : ''}</small>
${rows ? `<div class="wrap"><table><tr><th>Date</th><th>Page</th><th>Finding</th><th>Verdict</th><th>Why</th>${owner ? '<th></th>' : ''}</tr>${rows}</table></div>` : `<p>${chip('✔ nothing remembered', 'good')}</p>`}</section>`;
}
