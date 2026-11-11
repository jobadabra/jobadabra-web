// /admin/job-search/lab (owner, 18 Oct 2026; sketch https://claude.ai/artifact/FsAAKdxxXF2wXpD1nbHAuC): does a new user get relevant jobs fast, in any role and place, and did our last change make it
// better or worse? Four tabs: Real installs (the default), Random draws, Night search, Session checks. The old 6-recording replay and its tabs (Replays, Needs a fix, Fixed, History) were retired
// (owner, 10 Nov 2026: "retire it"): its stored rows stay in the database, nothing reads or writes them. Counts and seconds only: no job, company or CV text. Owner only (a 404 otherwise).
// Guard: test/unit/admin/search/search-lab.test.js.
import {viewer} from '../shared/auth.js';
import {remember} from '../shared/auth.js';
import {draws} from './search-lab-draws.js';
import {DRAWS_CSS, drawsSection} from './search-lab-draws-page.js';
import {VISUALS_CSS} from './search-lab-visuals.js';
import {canSend, realRows, realSection} from './search-lab-real.js';
import {checks} from './session-checks.js';
import {checksSection} from './session-checks-page.js';
import {CHIP_STYLE} from './chip.js';
import {nights, reference} from './search-night.js';
import {judgeAll} from './search-night-judge.js';
import {NIGHT_CSS, nightSection} from './search-night-page.js';
import {FINISH_STYLE, finishSection} from './search-finish-page.js';
import {handRuns} from './search-night-hand.js';
import {weeks} from './search-week.js';

export const TABS = [['real', 'Real installs'], ['draws', 'Random draws'], ['night', 'Night search'], ['finish', 'Finish line'], ['checks', 'Session checks']];
const CSS = `.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:28px;margin:4px 0}
.scroll{overflow-x:auto}.state{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.state.good{background:#16341f;color:#6fdc8c}.state.bad{background:#40181a;color:#ff8a80}.state.wait{background:#262c33;color:#b9c0c7}
.why{color:#8d949c;font-size:12px;margin-top:4px}.chip{display:inline-block;border:1px solid #2a2f37;border-radius:999px;padding:1px 9px;font-size:12px;color:#8d949c}
.down{color:#ff8a80}h2{margin:0 0 8px}td.num span{font-size:11px}`;

export function page(drawRows = [], tab = 'real', real = [], sending = null, sessionChecks = [], nightRows = [], nightRef = {}, hand = [], week = null) {
  const shown = TABS.some(([key]) => key === tab) ? tab : 'real';
  const sections = {night: () => nightSection(nightRows, nightRef, hand), finish: () => finishSection(nightRows, hand, nightRef, week), checks: () => checksSection(sessionChecks), draws: () => drawsSection(drawRows), real: () => realSection(real, sending)};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Lab Job Search · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CHIP_STYLE}${CSS}${DRAWS_CSS}${VISUALS_CSS}${NIGHT_CSS}${FINISH_STYLE}</style></head><body><main>
<header><h1>🔬 Lab Job Search</h1><span class="muted">fictional candidates and real installs · counts and seconds only</span></header>
<nav class="tabs">${TABS.map(([key, name]) => `<a href="?tab=${key}" class="${shown === key ? 'on' : ''}">${name}</a>`).join('')}</nav>
${sections[shown]()}
</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const tab = TABS.some(([key]) => key === url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'real';   // Why (10 Nov 2026, owner): a bookmark of a retired tab (lab, needs, fixed, history) or any unknown tab opens Real installs
  let drawRows = [];
  try { drawRows = env.STATS && tab === 'draws' ? await draws(env.STATS) : []; } catch { drawRows = []; }
  let real = [];
  try { real = env.STATS && tab === 'real' ? await realRows(env.STATS) : []; } catch { real = []; }
  let sessionChecks = [];
  try { sessionChecks = env.STATS && tab === 'checks' ? await checks(env.STATS) : []; } catch { sessionChecks = []; }
  let nightRows = [];
  try { nightRows = env.STATS && (tab === 'night' || tab === 'finish') ? judgeAll(await nights(env)) : []; } catch (error) { console.error(`night search: nights unreadable: ${error?.message || error}`); nightRows = null; }   // Why (6 Nov 2026, review): null says "could not be read"; [] would say "no night uploaded yet", the silent miss this tab exists to end
  let nightRef = {};
  try { nightRef = env.STATS && (tab === 'night' || tab === 'finish') ? await reference(env) : {}; } catch (error) { console.error(`night search: reference unreadable: ${error?.message || error}`); nightRef = {}; }   // the weekly reference is the tab's extra column: unreadable = "no reference yet", never a broken tab
  const hand = env.STATS && (tab === 'night' || tab === 'finish') ? await handRuns(env) : [];   // never throws: no by-hand run is []
  let week = null;
  try { week = env.STATS && tab === 'finish' ? (await weeks(env))[0] || null : null; } catch (error) { console.error(`search week: unreadable: ${error?.message || error}`); week = null; }   // Why (11 Nov 2026): an unreadable week is "no week yet", never a broken tab
  let sending = null;
  try { sending = env.STATS && tab === 'real' ? await canSend(env.STATS) : null; } catch { sending = null; }
  return new Response(page(drawRows, tab, real, sending, sessionChecks, nightRows, nightRef, hand, week), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
