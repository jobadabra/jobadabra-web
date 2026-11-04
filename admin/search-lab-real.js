// The Lab Job Search "Real installs" tab (owner, 18 Oct 2026: "register real users' job searches and see their results"): what installs with Technical reports on
// sent after each Find jobs run (kind 'search', shared/search-report.js): per role family, the median time to the first job, the 10th and the first 70+, jobs
// in places and scoring 70+, how many searches it took to reach a 70+, set beside the lab's median so a real number has the lab's to be read against.
// A city is shown only when 3+ installs share it (k >= 3, read time). Counts, seconds and fixed words only. Guard: test/unit/admin/search-lab-real.test.js.
import {esc} from '../shared/html.js';
import {KIND_NAMES} from '../shared/pool-labels.js';
import {TIME_NAMES} from './search-lab-judge.js';
import {TONE_COLOR, median} from './search-lab-visuals.js';

export const MIN_CITY_INSTALLS = 3, DAYS = 90;
const FAMILY_NAMES = {...KIND_NAMES, sales_retail: 'Retail sales'};
const fmt = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);

// The kept 'search' reports of the last 90 days: [{install, day, ...fields}].
export async function realRows(db, now = new Date()) {
  const from = new Date(now.getTime() - DAYS * 86400000).toISOString().slice(0, 10);
  const rows = (await db.prepare("SELECT install, day, data FROM telemetry WHERE kind = 'search' AND day >= ? ORDER BY day").bind(from).all()).results || [];
  return rows.flatMap(row => { try { return [{install: row.install, day: row.day, ...JSON.parse(row.data)}]; } catch { return []; } });
}

const stats = list => ({
  installs: new Set(list.map(r => r.install)).size, searches: list.length,
  first_s: median(list.map(r => r.first_s)), tenth_s: median(list.map(r => r.tenth_s)), fit_s: median(list.map(r => r.first_fit70_s)),
  in_places: median(list.map(r => r.in_places)), fit70: median(list.map(r => r.fit70)),
  reached: list.filter(r => r.first_fit70_s != null).length, runs_to_fit70: median(list.map(r => r.runs_to_fit70)),
  failed: list.filter(r => r.result === 'failed').length, stopped: list.filter(r => r.result === 'stopped').length,
});

// One row per day, newest first (owner, 20 Oct 2026: "improve day by day, just by users using it").
export function byDay(reports) {
  const days = new Map();
  for (const r of reports) days.set(r.day, [...(days.get(r.day) || []), r]);
  return [...days.entries()].map(([day, list]) => ({day, ...stats(list)})).sort((a, b) => (a.day < b.day ? 1 : -1));
}

// How many installs seen in the last 30 days run a build that sends search reports (0.8.0 and later): zero reports with zero senders means "no build yet", not "broken".
const sends = version => { const [major, minor] = String(version || '').split('.').map(Number); return major > 0 || minor >= 8; };
export async function canSend(db, now = new Date()) {
  const from = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = (await db.prepare('SELECT install, version, MAX(at) AS last FROM telemetry WHERE day >= ? GROUP BY install').bind(from).all()).results || [];
  return {installs: rows.length, canSend: rows.filter(r => sends(r.version)).length};
}

// Pure: reports in, the overall line, one line per role family, and the cities shared by 3+ installs.
export function summarize(reports) {
  const families = new Map(), cities = new Map();
  for (const r of reports) {
    const family = FAMILY_NAMES[r.family] ? r.family : 'other';
    families.set(family, [...(families.get(family) || []), r]);
    if (r.city && r.country) { const key = `${r.city}|${r.country}`; cities.set(key, [...(cities.get(key) || []), r]); }
  }
  return {
    all: stats(reports),
    families: [...families.entries()].map(([family, list]) => ({family, name: FAMILY_NAMES[family], ...stats(list)})).sort((a, b) => b.searches - a.searches),
    cities: [...cities.entries()].map(([key, list]) => ({city: key.split('|')[0], country: key.split('|')[1], ...stats(list)})).filter(c => c.installs >= MIN_CITY_INSTALLS).sort((a, b) => b.installs - a.installs),
  };
}

// labRows = judge(all): the lab's newest searches, for the median to read a real one against.
export function realSection(reports, labRows = [], sending = null) {
  const s = summarize(reports);
  const senders = sending ? `<p class="muted">${sending.canSend} of ${sending.installs} installs seen in the last 30 days run a build that sends search reports (0.8.0 and later).</p>` : '';
  if (!reports.length) return `<section class="card"><h2>Real installs</h2><p class="muted">No real search reported yet. Installs on the build that sends search reports, with Technical reports on, send one report per Find jobs run; it fills here as they arrive.</p>${senders}</section>`;
  const lab = field => median(labRows.filter(r => r.state !== 'failed').map(r => r.now[field]));
  const tile = (field, labField) => `<section class="card lv-tile lv-lead" style="--tone:${TONE_COLOR.info}"><span class="muted">⏱ ${TIME_NAMES[labField]}</span><b>${clock(s.all[field])}</b><span class="muted">lab median ${clock(lab(labField))}</span><span class="muted">${s.all.searches} searches, ${s.all.installs} installs</span></section>`;
  const body = s.families.map(f => `<tr><td><b>${esc(f.name)}</b></td><td class="num">${f.installs}</td><td class="num">${f.searches}</td><td class="num">${clock(f.first_s)}</td><td class="num">${clock(f.tenth_s)}</td><td class="num">${clock(f.fit_s)}</td>
<td class="num">${fmt(f.in_places)} · ${fmt(f.fit70)}</td><td class="num">${f.reached} of ${f.searches}${f.runs_to_fit70 == null ? '' : ` · in ${fmt(f.runs_to_fit70)} search${f.runs_to_fit70 === 1 ? '' : 'es'}`}</td></tr>`).join('');
  const days = byDay(reports).map(d => `<tr><td>${esc(d.day)}</td><td class="num">${d.searches}</td><td class="num">${d.installs}</td><td class="num">${d.failed} · ${d.stopped}</td><td class="num">${clock(d.first_s)}</td><td class="num">${clock(d.fit_s)}</td><td class="num">${d.reached} of ${d.searches}</td></tr>`).join('');
  const cities = s.cities.length ? `<h2>Places shared by ${MIN_CITY_INSTALLS}+ installs</h2><div class="scroll"><table><tr><th>City</th><th class="num">Installs</th><th class="num">Searches</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.fit_s}</th></tr>
${s.cities.map(c => `<tr><td>${esc(c.city)}, ${esc(c.country)}</td><td class="num">${c.installs}</td><td class="num">${c.searches}</td><td class="num">${clock(c.first_s)}</td><td class="num">${clock(c.fit_s)}</td></tr>`).join('')}</table></div>`
    : `<p class="muted">Cities appear here once ${MIN_CITY_INSTALLS} or more installs share one.</p>`;
  return `<div class="lv-tiles lv-leads">${tile('first_s', 'first_s')}${tile('fit_s', 'fit_s')}</div>
<section class="card"><h2>By kind of role</h2><div class="scroll"><table><tr><th>Role family</th><th class="num">Installs</th><th class="num">Searches</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.tenth_s}</th><th class="num">${TIME_NAMES.fit_s}</th><th class="num">In places · 70+ (median)</th><th class="num">Reached a 70+ job</th></tr>${body}</table></div>
<p class="muted">Medians over the last ${DAYS} days. Counts and seconds only; never a job, company, CV or typed word.</p>${senders}</section>
<section class="card"><h2>Day by day</h2><div class="scroll"><table><tr><th>Day</th><th class="num">Searches</th><th class="num">Installs</th><th class="num">Failed · stopped</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.fit_s}</th><th class="num">Reached a 70+ job</th></tr>${days}</table></div></section><section class="card">${cities}</section>`;
}
