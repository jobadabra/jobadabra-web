// Testing → Scheduled's two pictures above the table (owner, 1 Nov 2026: "apart from this table, let's provide also a nice graph, a nice visual representation"):
// one bar of every scheduled job by its last run (the Overview's summaryBar, same colours), and a 24-hour timeline: one row per job, one tick per start in the next 24 hours,
// and above the rows how many jobs start in each hour. Built from the decorated snapshot rows alone (admin/schedules.js decorate): no second reader, no table, no AI.
// Why a timeline and not a 14-day heat strip (1 Nov 2026): the snapshot keeps a job's newest 14 runs, so an hourly job covers 14 hours; its strip would be hatched "not stored" for 13 of 14 days.
// Status is never colour alone: a job's label carries ✓ / ✕ / ◷ / ◌ (and ⚠ when a start was missed). Guard: test/unit/admin/schedules.test.js.
import {esc} from '../shared/html.js';
import {clock, matches, parseCron} from '../shared/schedules-model.js';
import {summaryBar, BAR_STYLE} from './testing-overview-map.js';

const HOUR = 3600000, WINDOW_HOURS = 24;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const GLYPH = {green: '✓', red: '✕', none: '◷', off: '◌'};
const STATE_WORD = {green: 'last run green', red: 'last run red', none: 'no run yet', off: 'disabled'};

/** Every start of `crons` in (from, from + 24 h], oldest first. Walks the 24 hours and each cron's own minutes (at most 25 × 60 checks), not every minute of 32 days. */
export function startsIn(crons, from) {
  const end = from.getTime() + WINDOW_HOURS * HOUR, base = Math.floor(from.getTime() / HOUR) * HOUR, found = new Set();
  for (const cron of crons) {
    const parsed = parseCron(cron); if (!parsed) continue;
    for (let h = 0; h <= WINDOW_HOURS; h++) for (const minute of parsed.minute) {
      const at = base + h * HOUR + minute * 60000;
      if (at > from.getTime() && at <= end && matches(parsed, new Date(at))) found.add(at);
    }
  }
  return [...found].sort((a, b) => a - b).map(at => new Date(at));
}

const pos = (date, now) => ((date - now) / (WINDOW_HOURS * HOUR)) * 100;
const axis = now => {   // a line and a label at every third Zurich hour
  const first = Math.ceil(now.getTime() / HOUR) * HOUR, marks = [];
  for (let at = first; at < now.getTime() + WINDOW_HOURS * HOUR; at += HOUR) { const date = new Date(at), label = clock(date); if (Number(label.slice(0, 2)) % 3 === 0) marks.push({label, left: pos(date, now)}); }
  return marks;
};

/** The graph section: the status bar, then the 24-hour timeline. `jobs` = decorated scheduled jobs (crons set) of one area. */
export function graph(jobs, now = new Date()) {
  const live = jobs.filter(job => job.state !== 'off');
  const count = state => jobs.filter(job => job.state === state).length;
  const bar = summaryBar({green: count('green'), red: count('red'), none: count('none'), planned: count('off'), live: live.length},
    {title: `${plural(jobs.length, 'scheduled job')} · by their last run`, none: '◷ no run yet', planned: '◌ disabled',
      note: `${live.length ? Math.round(100 * count('green') / live.length) : 0}% of the jobs that run are green on their last run · ${jobs.filter(job => job.missed).length} missed a start.`});
  const rows = live.map(job => ({job, starts: startsIn(job.crons, now)})), shown = rows.filter(row => row.starts.length).sort((a, b) => a.starts[0] - b.starts[0] || (a.job.name || a.job.file).localeCompare(b.job.name || b.job.file));
  const later = rows.filter(row => !row.starts.length);
  const perHour = Array.from({length: WINDOW_HOURS}, (_, i) => shown.reduce((sum, row) => sum + row.starts.filter(date => date - now >= i * HOUR && date - now < (i + 1) * HOUR).length, 0)), peak = Math.max(1, ...perHour);
  const marks = axis(now);
  const lines = marks.map(mark => `<u style="left:${mark.left.toFixed(2)}%"></u>`).join('');
  const rowHtml = ({job, starts}) => `<div class="tl-row${job.state === 'red' ? ' is-red' : ''}"><span class="tl-name" title="${esc(`${job.name || job.file} · ${STATE_WORD[job.state]}${job.missed ? ' · missed a start' : ''}`)}"><b class="gl">${GLYPH[job.state]}</b>${job.missed ? '<b class="gl warn" aria-label="missed a start">⚠</b>' : ''} <a href="https://github.com/${esc(job.repo)}/actions/workflows/${esc(job.file)}">${esc(job.name || job.file)}</a></span>
<span class="tl-track">${starts.map(date => `<i class="t t-${job.state}" style="left:${pos(date, now).toFixed(2)}%" title="${esc(`${job.name || job.file} · ${clock(date)}`)}"></i>`).join('')}</span></div>`;
  const timeline = `<section class="card tl"><h2>Next 24 hours · when each job starts</h2>
<div class="keys"><span><i class="t t-green"></i>${GLYPH.green} last run green</span><span><i class="t t-red"></i>${GLYPH.red} last run red</span><span><i class="t t-none"></i>${GLYPH.none} no run yet</span><span>⚠ missed a start</span><span class="muted">one tick = one start · times are Europe/Zurich · starts can be a few minutes late</span></div>
<div class="scroll"><div class="tl-body"><div class="tl-lines">${lines}</div>
<div class="tl-row tl-axis"><span class="tl-name muted">now ${esc(clock(now))}</span><span class="tl-track">${marks.map(mark => `<em style="left:${mark.left.toFixed(2)}%">${esc(mark.label)}</em>`).join('')}</span></div>
<div class="tl-row tl-load"><span class="tl-name muted">Starts per hour</span><span class="tl-track">${perHour.map((n, i) => `<s style="left:${(i / WINDOW_HOURS * 100).toFixed(2)}%;width:${(100 / WINDOW_HOURS).toFixed(2)}%" title="${esc(`${clock(new Date(now.getTime() + i * HOUR))} + 1 h · ${plural(n, 'start')}`)}"><b style="height:${Math.round(100 * n / peak)}%"></b></s>`).join('')}</span></div>
${shown.map(rowHtml).join('') || '<p class="muted">No job starts in the next 24 hours.</p>'}</div></div>
${later.length ? `<small class="muted">${plural(later.length, 'job')} start later than 24 hours from now: ${esc(later.map(row => row.job.name || row.job.file).join(', '))}.</small>` : ''}</section>`;
  return `${bar}${timeline}`;
}

export const GRAPH_STYLE = `${BAR_STYLE}
.sbar,.tl{margin-bottom:16px}.tl .scroll{overflow-x:auto}.tl-body{position:relative;min-width:680px}.tl-lines{position:absolute;left:210px;right:8px;top:0;bottom:0;pointer-events:none}.tl-lines u{position:absolute;top:0;bottom:0;border-left:1px solid #262c33}
.tl-row{display:flex;align-items:center;height:20px;position:relative}.tl-name{flex:0 0 210px;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;padding-right:8px}.tl-name a{color:#f4efe3;text-decoration:none}.tl-name a:hover{color:#f5b54a}
.tl-row.is-red .tl-name a{color:#ff8f84}.tl-name .gl{display:inline-block;width:14px;text-align:center;font-size:12px}.tl-name .gl.warn{color:#f5b54a;width:auto}
.tl-track{flex:1;position:relative;height:100%;margin-right:8px}.t{position:absolute;top:4px;width:3px;height:12px;margin-left:-1px;border-radius:1px;display:inline-block}.keys .t{position:static;margin:0;width:3px}
.t-green{background:#3fb68b}.t-red{background:#e5484d}.t-none,.t-off{background:#8d949c}.tl-axis{height:18px}.tl-axis em{position:absolute;top:2px;transform:translateX(-50%);font-style:normal;font-size:11px;color:#8d949c}
.tl-load{height:44px;margin-bottom:6px}.tl-load s{position:absolute;top:0;bottom:0;text-decoration:none;display:flex;align-items:flex-end;padding:0 1px;box-sizing:border-box}.tl-load s b{display:block;width:100%;background:#3a4048;border-radius:2px 2px 0 0;min-height:1px}.tl-load s:hover b{background:#f5b54a}
@media(max-width:600px){.tl-body{min-width:460px}.tl-name{flex-basis:118px}.tl-lines{left:118px}}`;
