// The Admin → Testing → AI persona page, drawn from what CI uploaded (shared/agent-runs.js): the run list, and for one run its path, its notes and its video. Pure: data in, HTML out.
// Why (4 Nov 2026, owner: "a dedicated tab in admin where I'll see all the runs/paths/bugs found… and video recording for each"; sketch https://claude.ai/artifact/1AZ2ASxDKuTXTWBfPEexgz approved with
// "Nightly and replays, replays labelled" and "14 days"): the page is drawn on the server from the stored record, so the only script is the one that jumps the video to a note's second.
// Guard: test/unit/admin/ai/ai-persona.test.js.
import {esc} from '../shared/html.js';
import {PUBLIC_REPO} from '../shared/repos.js';
import {KEEP_DAYS} from '../shared/agent-runs.js';
import {CHIP_STYLE, chip} from './chip.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';

const VERDICT = {worked: ['✓ worked', 'good'], doubts: ['? doubts', 'warn'], 'could-not-finish': ['⛔ could not finish', 'bad'], bug: ['🐞 bug', 'bad']};
const JUDGE = {agrees: ['second opinion agrees', 'good'], disagrees: ['second opinion disagrees', 'muted'], unknown: ['second opinion unsure', 'warn'], unavailable: ['no second opinion', 'muted']};
const SEVERITY = {high: 'bad', medium: 'warn', low: 'muted'};

/** Seconds as m:ss; '' for a missing or negative value. */
export const mmss = seconds => (Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '');
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const pct = value => `${Math.round(value * 1000) / 10}%`;
const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null);   // Why (4 Nov 2026, code review): a stored word like "constructor" must not find Object.prototype's keys
const verdictChip = verdict => { const [text, tone] = own(VERDICT, verdict) || ['? unknown', 'muted']; return chip(esc(text), tone); };
const kindChip = kind => chip(esc(kind === 'replay' ? 'replay' : 'night'), kind === 'replay' ? 'warn' : 'good');

/** A goal's steps with a run of the same step shown once and counted: [{did, times, failed}]. A row of another goal, or not an object, is left out. */
export function pathOf(trace, goal) {
  const steps = [];
  for (const row of (Array.isArray(trace) ? trace : []).filter(item => item && typeof item === 'object' && String(item.goal) === String(goal))) {
    const did = String(row.did || row.action || '?'), last = steps.at(-1);
    if (last && last.did === did && last.failed === Boolean(row.failed)) last.times += 1;
    else steps.push({did, times: 1, failed: Boolean(row.failed)});
  }
  return steps;
}

const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const list = value => (Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []);

/**
 * A stored record made safe to draw (it is written by another repo's job and only its size and its run id are checked on upload): arrays are arrays of objects, a verdict or a second opinion is one of ours or
 * "unknown", a screenshot number is 1..99, and a note is `playable` (a jump button and a dot) only when the video exists and the note's second lies inside it.
 */
export function tidy(record, hasVideo = false) {
  const secs = hasVideo ? num(record.video?.secs) : 0;
  const notes = list(record.notes).map(note => {
    const sec = Number(note.videoSec), shot = Number(note.shot);
    return {...note, shot: Number.isInteger(shot) && shot >= 1 && shot <= 99 ? shot : 0, playable: secs > 0 && Number.isFinite(sec) && sec >= 0 && sec <= secs, videoSec: sec};
  });
  return {secs, notes, trace: list(record.trace), goals: list(record.goals).map(goal => ({...goal, verdict: own(VERDICT, goal.verdict) ? goal.verdict : 'unknown'}))};
}

/** The pressed control as a box over its screenshot, in percent of the window the agent had (so it fits at any width); '' when the note has none. */
export function boxOf(control) {
  const win = control?.window;
  if (!win?.w || !win?.h || !(control.w > 0) || !(control.h > 0)) return '';
  return `<i class="box" style="left:${pct(control.x / win.w)};top:${pct(control.y / win.h)};width:${pct(control.w / win.w)};height:${pct(control.h / win.h)}"></i>`;
}

/** The list: a band, then one row per kept run, newest first. `runs`: listRuns() rows. */
export function listHtml(runs) {
  const goals = runs.reduce((sum, run) => sum + num(run.worked) + num(run.doubts) + num(run.stuck) + num(run.bug), 0);
  const stuck = runs.reduce((sum, run) => sum + num(run.stuck), 0), bugs = runs.reduce((sum, run) => sum + num(run.bug), 0);
  const band = verdictBand({icon: '🤖', headline: runs.length ? `${plural(runs.length, 'run')} kept, ${goals - stuck} of ${plural(goals, 'goal')} reached an answer` : 'No run is kept yet',
    chips: [...(stuck ? [{label: `${stuck} could not finish`, tone: 'bad'}] : []), ...(bugs ? [{label: `${bugs} with a bug`, tone: 'warn'}] : [])],
    note: `The nightly run and the replays, kept ${KEEP_DAYS} days with their video.`});
  const rows = runs.map(run => `<tr><td><a href="?run=${esc(run.run)}"><b>${esc(run.run)}</b></a><div class="muted small">${esc(String(run.at || '').slice(0, 16).replace('T', ' '))}</div></td>
<td>${kindChip(run.kind)}</td><td class="small">${esc(run.commit || '')}${run.plan ? `<div class="muted">${esc(run.plan)}</div>` : ''}</td>
<td>${Number(run.worked) ? chip(`✓ ${esc(run.worked)}`, 'good') : ''} ${Number(run.doubts) ? chip(`? ${esc(run.doubts)}`, 'warn') : ''} ${Number(run.stuck) ? chip(`⛔ ${esc(run.stuck)}`, 'bad') : ''} ${Number(run.bug) ? chip(`🐞 ${esc(run.bug)}`, 'bad') : ''}</td>
<td>${esc(run.notes)}</td><td class="small">${esc(run.minutes)} min · ${esc(run.calls)} calls</td>
<td>${run.video ? chip(`▶ ${(Number(run.videoBytes) / 1048576).toFixed(1)} MB`, 'good') : chip('none', 'muted')}</td></tr>`).join('');
  return `${band}<section class="card"><table class="runs"><thead><tr><th>Run</th><th>Kind</th><th>App</th><th>Goals</th><th>Notes</th><th>Cost</th><th>Video</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Nothing yet: the next night or replay fills it.</td></tr>'}</tbody></table></section>`;
}

const noteHtml = (note, run) => {
  const judge = own(JUDGE, note.judge) || ['no second opinion', 'muted'], at = mmss(note.videoSec);
  return `<article class="note"><h3>${chip(esc(note.severity || '?'), own(SEVERITY, note.severity) || '')} ${esc(note.title)} ${note.filed ? chip('filed as an issue', 'good') : ''} ${chip(esc(judge[0]), judge[1])}</h3>
<p class="muted small">${esc(note.type)} · ${esc(note.kind)} · ${esc(note.view)}${note.playable ? ` · <button type="button" class="jump" data-t="${Math.floor(note.videoSec)}">▶ ${at}</button>` : ''}</p>
<dl><dt>Expected</dt><dd>${esc(note.expected)}</dd><dt>Saw</dt><dd>${esc(note.observed)}</dd><dt>Why a bug</dt><dd>${esc(note.why)}</dd></dl>
${note.shot ? `<div class="shot"><img src="/admin/ai-persona/file?run=${esc(run)}&amp;name=shot-${note.shot}.png" alt="the screen when the agent noted this" loading="lazy">${boxOf(note.control)}</div>` : ''}</article>`;
};

/** One run: a band, the video with a marker per note, the path per goal, the notes. `record`: the stored run.json; `has`: {video: bool}. */
export function runHtml(record, has = {}) {
  const clean = tidy(record, has.video), run = String(record.run), secs = clean.secs, notes = clean.notes, known = clean.goals.filter(goal => goal.verdict !== 'unknown');
  const reached = known.filter(goal => goal.verdict !== 'could-not-finish').length;
  const band = verdictBand({icon: '🤖', headline: `Run ${run}: ${reached} of ${plural(known.length, 'goal')} reached an answer`,
    chips: [{label: record.kind === 'replay' ? `replay${record.plan ? ` · ${record.plan}` : ''}` : 'night', tone: record.kind === 'replay' ? 'warn' : 'good'}, {label: plural(notes.length, 'note'), tone: notes.length ? 'warn' : 'muted'}, {label: `${record.cost?.calls ?? 0} calls · ${record.cost?.minutes ?? 0} min`, tone: 'muted'}],
    note: `App ${record.commit || '?'} · ${String(record.at || '').slice(0, 16).replace('T', ' ')} · stopped: ${record.stopped || '?'}`});
  const dots = notes.filter(note => note.playable).map(note => `<button type="button" class="dot" data-t="${Math.floor(note.videoSec)}" style="left:${pct(note.videoSec / secs)}" title="${esc(note.title)} · ${mmss(note.videoSec)}"></button>`).join('');
  const video = has.video ? `<section class="card"><h2>Video</h2><video id="run-video" controls preload="metadata" src="/admin/ai-persona/file?run=${esc(run)}&amp;name=video.webm"></video>
<div class="line" aria-label="notes on the timeline">${dots}</div><p class="muted small">${secs ? `${mmss(secs)} long; a dot is a note, click it to jump.` : ''}</p></section>` : '<section class="card"><h2>Video</h2><p class="muted">No video was kept for this run.</p></section>';
  const goals = clean.goals.map(goal => `<details class="goal" ${goal.verdict === 'worked' ? '' : 'open'}><summary>${verdictChip(goal.verdict)} <b>${esc(goal.label)}</b> <span class="muted small">${esc(goal.group)} · ${esc(goal.steps)} steps</span></summary>
<p class="muted small">${esc(goal.summary)}</p><ol class="steps">${pathOf(clean.trace, goal.n).map(step => `<li${step.failed ? ' class="failed"' : ''}>${esc(step.did)}${step.times > 1 ? ` <span class="muted">×${step.times}</span>` : ''}</li>`).join('')}</ol></details>`).join('');
  return `<p><a href="?">← All runs</a> · <a href="https://github.com/${PUBLIC_REPO}/actions/runs/${esc(run)}">the GitHub run</a></p>${band}${video}<section class="card"><h2>Path</h2>${goals}</section>
<section class="card"><h2>Notes (what it argued was a bug)</h2>${notes.map(note => noteHtml(note, run)).join('') || '<p class="muted">It noted nothing.</p>'}</section>`;
}

export const STYLE = `${CHIP_STYLE}${BAND_STYLE}
.runs td,.runs th{padding:8px 10px;text-align:left;vertical-align:top}.runs a{color:#f4efe3}.small{font-size:12px}
.goal{border-top:1px solid #2a2f37;padding:8px 0}.goal summary{cursor:pointer}.steps{margin:6px 0 0 18px;padding:0}.steps li{padding:1px 0}.steps li.failed{color:#e5484d}
.note{border-top:1px solid #2a2f37;padding:10px 0}.note h3{font-size:15px;margin:0 0 4px}.note dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:8px 0}.note dt{color:#8d949c}.note dd{margin:0}
.shot{position:relative;display:inline-block;max-width:100%;border:1px solid #2a2f37;border-radius:6px;overflow:hidden}.shot img{display:block;max-width:100%;height:auto}
.box{position:absolute;border:2px solid #e5484d;border-radius:4px;box-shadow:0 0 0 2px rgba(229,72,77,.35);pointer-events:none}
#run-video{width:100%;max-height:70vh;background:#000;border-radius:6px}.line{position:relative;height:18px;margin:8px 0 2px;border-radius:9px;background:#1a1e24}
.dot{position:absolute;top:2px;width:14px;height:14px;margin-left:-7px;border:0;border-radius:50%;background:#e5484d;cursor:pointer}.jump{border:1px solid #2a2f37;border-radius:999px;background:none;color:inherit;font:inherit;padding:0 8px;cursor:pointer}
@media (max-width:640px){.note dl{grid-template-columns:1fr}.runs{display:block;overflow-x:auto}}`;

export const SCRIPT = `document.addEventListener('click',e=>{const b=e.target.closest('[data-t]'),v=document.getElementById('run-video');if(!b||!v)return;v.currentTime=Number(b.dataset.t);v.play();v.scrollIntoView({block:'nearest'})});`;

/** The whole document around `body`. */
export const documentHtml = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>AI persona</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}</style></head><body><main>
<header><h1>🤖 AI persona</h1></header>
${body}
</main><script>${SCRIPT}</script></body></html>`;
