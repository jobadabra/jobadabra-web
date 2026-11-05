// /admin/testing/report-only: every report-only job on one page, grouped, each with its last 14 nights (owner, 1-2 Nov 2026: "a specific page dedicated to report-only jobs (the measurements,
// the AI quality, the wall-clock... and so on)"). Test layers: the e2e journeys and the integration tests are the proofs; a measurement runs nightly and only reports. So the proof cards
// (Testing → Overview) keep only proof plus a one-line link here. ONE reader per source: the nightly summary (admin/nightly-summary.js) and the self-healing snapshots
// (admin/report-only-finders.js); this file groups and draws them with the renderer the Scheduled rows use (admin/nightly-summary-html.js). No AI, no new table.
// Guard: test/unit/admin/report/report-only.test.js.
import {viewer, remember} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {CHIP_STYLE} from './chip.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';
import {loadNightlySummary, lastDays} from './nightly-summary.js';
import {NIGHTLY_STYLE, trendHtml} from './nightly-summary-html.js';
import {finderJobs} from './report-only-finders.js';
import {QUALITY_STYLE, board} from './product-quality-html.js';
import {VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';
import {loadQuality} from './product-quality-data.js';
import {snapshots} from './selfheal.js';

/** The groups, in page order; `jobs` are job ids (admin/nightly-summary.js, admin/report-only-finders.js). A job in no group is a failing test, so a new measurement cannot be forgotten. */
export const GROUPS = [
  {id: 'ai', icon: '🎯', title: 'AI quality', note: 'Are the answers of the AI right and steady?', jobs: ['quality-ai', 'prompt-cases']},
  {id: 'speed', icon: '⏱️', title: 'Wall clock', note: 'Minutes from start to end of a run, per day.', jobs: ['beta-clock', 'night-clock']},
  {id: 'explorers', icon: '🧭', title: 'Explorers', note: 'Clicks every safe control and walks the app at random.', jobs: ['interactions', 'wander']},
  {id: 'finders', icon: '📐', title: 'Finders', note: 'Real bugs each finder filed in the 7 days to that day.', jobs: ['finder-layout', 'finder-review', 'finder-interactions']},
  {id: 'planted', icon: '🧬', title: 'Planted bugs', note: 'Plant a bug: does the Finder or a suite still notice?', jobs: ['planted-ui', 'planted-code']},
  {id: 'real', icon: '🌍', title: 'Real services', note: 'The suite that talks to the real Notion.', jobs: ['notion-real']},
  {id: 'agents', icon: '🤖', title: 'Agent coding', note: 'Areas with 3+ fix PRs in 7 days (going in circles).', jobs: ['agent-coding']},
];

/** The model: the groups with their jobs resolved (a listed id nobody built is dropped), and the jobs no group lists (must stay empty). */
export function model(summary, healing, now = new Date()) {
  const days = summary?.days || lastDays(now), jobs = [...(summary?.jobs || []), ...finderJobs(healing, days)], byId = new Map(jobs.map(job => [job.id, job]));
  const groups = GROUPS.map(group => ({...group, jobs: group.jobs.map(id => byId.get(id)).filter(Boolean)}));
  const listed = new Set(GROUPS.flatMap(group => group.jobs));
  return {groups, unlisted: jobs.filter(job => !listed.has(job.id)).map(job => job.id), jobs};
}

const STYLE = `${CHIP_STYLE}${BAND_STYLE}${NIGHTLY_STYLE}${VIZ_STYLE}${QUALITY_STYLE}.band{margin-bottom:12px}
.group{margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8d949c}.group .muted{text-transform:none;letter-spacing:0;font-weight:400}
.rjob:target{outline:2px solid #f5b54a}
.rjob .src{margin-top:6px;font-size:12px}`;

const jobHtml = job => `<section class="card rjob" id="r-${esc(job.id)}">${trendHtml(job)}${job.files?.length ? `<div class="muted src">from ${job.files.map(file => `<code>${esc(file)}</code>`).join(' · ')}</div>` : ''}</section>`;

/** The page; `built` = model(...), `quality` = qualityModel(...) (the board on top; the nightly jobs stay beneath). */
export function page(built, quality = null) {
  const withData = built.jobs.filter(job => job.value !== '–'), off = built.jobs.filter(job => job.status === 'bad');
  const band = verdictBand({icon: off.length ? '🟠' : '🟢', headline: off.length ? `${off.length} of ${withData.length} numbers off their bar` : `${withData.length} numbers measured, none off their bar`,
    chips: off.map(job => ({label: job.title, tone: 'bad', href: `#r-${job.id}`})), note: 'Measured nightly, report only: none of these blocks a merge. The proofs are on Overview, E2E and Integrations.'});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Report only · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}</style></head><body><main>
<header><h1>📊 Report only</h1><span class="muted">${built.groups.length} groups · ${built.jobs.length} measurements · last 14 days</span></header>
${quality ? `${board(quality)}<div class="qhead">⚙️ Did the nightly jobs run <span class="muted">· the measurements behind it</span></div>` : ''}${band}
${built.groups.map(group => `<div class="group">${group.icon} ${esc(group.title)} <span class="muted">· ${esc(group.note)}</span></div><div class="rgrid">${group.jobs.map(jobHtml).join('')}</div>`).join('\n')}
</main>${quality ? VIZ_TOOLTIP : ''}</body></html>`;
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const [summary, healing] = await Promise.all([loadNightlySummary(env, now), snapshots(env).catch(() => [])]);
  return new Response(page(model(summary, healing, now), await loadQuality(env, now, healing)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
