// /admin/agents/agent-coding: how our agent codes, ships and verifies (owner, 1 Nov 2026: "the way our agent is coding, is shipping and is verifying"). Report only: it never blocks anything.
// Two uploads feed it, both PUT to /agent-coding/data with Bearer SELFHEAL_PUBLISH_KEY like the PR checks scorecard: kind "gate" (counts and seconds of the push gate, from the owner's Mac:
// tools/gate-stats-upload.mjs, once a day from ship.sh) and kind "ci" (reds, fixes, areas and CI minutes, from GitHub: agent-coding-stats.yml). One row per kind and day; a repeat replaces it.
// Only counts, seconds and short fixed labels are stored: never a branch, a path, commit text or a log. Guard: test/unit/admin/agent-coding.test.js. Page drawing: admin/agent-coding-page.js.
import {equal} from '../shared/guard.js';
import {viewer, remember} from '../shared/auth.js';
import {HOOKS, page} from './agent-coding-page.js';
import {sdlcPage} from './agent-coding-sdlc.js';
import {cleanHarness} from './harness-clean.js';
import {cleanFixer} from './harness-usage.js';

const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const count = value => Math.min(1e7, Math.max(0, Math.round(Number(value) || 0)));
const minutes = value => Math.min(1e5, Math.max(0, Math.round((Number(value) || 0) * 10) / 10));
const label = value => String(value ?? '').replace(/[^A-Za-z0-9 ()·./,+:_-]/g, '').trim().slice(0, 60);
const CLASSES = ['form', 'real', 'other'], FIXES = ['product', 'test', 'ci', 'form', 'nofix'];
const LAYERS = ['pr', 'main', 'night'], CATCHES = ['product', 'test', 'ci', 'form', 'flaky', 'rebase', 'nofix'];
const PHASES = ['merged', 'nospec', 'unmerged', 'prCommits', 'fixAfter', 'reverts', 'redMain'];
const tally = (source, keys) => Object.fromEntries(keys.map(key => [key, count(source?.[key])]));
const list = (value, cap) => (Array.isArray(value) ? value.slice(0, cap).map(minutes) : []);

// One day of the push gate (from the Mac) -> the same shape with every number clamped, or null.
export function cleanGate(card) {
  if (!card || typeof card !== 'object') return null;
  const steps = Object.entries(card.steps && typeof card.steps === 'object' ? card.steps : {}).slice(0, 80).map(([name, step]) => [label(name), {runs: count(step?.runs), fails: count(step?.fails),
    secs: count(step?.secs), cls: CLASSES.includes(step?.cls) ? step.cls : 'other'}]).filter(([name]) => name);
  const clean = {pushes: count(card.pushes), secs: count(card.secs), stopped: tally(card.stopped, CLASSES), stoppedSecs: tally(card.stoppedSecs, CLASSES), steps: Object.fromEntries(steps)};
  return card.hooks && typeof card.hooks === 'object' ? {...clean, hooks: tally(card.hooks, HOOKS)} : clean;
}
// One day from GitHub (reds by what fixed them, fix PRs per area, CI minutes per push) -> clamped, or null.
export function cleanCi(card) {
  if (!card || typeof card !== 'object') return null;
  const areas = Object.entries(card.fixPrs && typeof card.fixPrs === 'object' ? card.fixPrs : {}).slice(0, 60).map(([name, n]) => [label(name), count(n)]).filter(([name, n]) => name && n);
  return {prs: {merged: count(card.prs?.merged), ci: count(card.prs?.ci)}, reds: tally(card.reds, FIXES), fixPrs: Object.fromEntries(areas),
    wall: list(card.wall, 500), queue: list(card.queue, 500), cancelledMin: minutes(card.cancelledMin)};
}
// One day of the SDLC upload (v2, 1 Nov 2026): per layer (pr, main, night) and check the runs, reds, seconds and what followed each red (catches by class), the phases' proxy counts, bugs the owner saw.
export function cleanSdlc(card) {
  if (!card || typeof card !== 'object') return null;
  const layers = {};
  for (const layer of LAYERS) {
    const checks = Object.entries(card.layers?.[layer] && typeof card.layers[layer] === 'object' ? card.layers[layer] : {}).slice(0, 80).map(([name, check]) => [label(name), {runs: count(check?.runs), fails: count(check?.fails),
      secs: count(check?.secs), catches: tally(check?.catches, CATCHES)}]).filter(([name]) => name);
    layers[layer] = Object.fromEntries(checks);
  }
  return {layers, phases: tally(card.phases, PHASES), bugs: count(card.bugs)};
}
// One day of the CI Agents upload (tools/ci-agents-stats.mjs, 3 Nov 2026; shown on /admin/ai/agents and /admin/ai/steps): per agent and AI step its fixed words, state, last runs and 30-day counts, every one clamped; an unknown word becomes the quiet default.
export function cleanAgents(card) {
  if (!card || typeof card !== 'object' || !Array.isArray(card.agents)) return null;
  const pick = (value, list, fallback) => (list.includes(value) ? value : fallback), counts = (source, keys) => Object.fromEntries(keys.map(key => [key, count(source?.[key])]));
  const agents = card.agents.slice(0, 30).map(item => ({id: label(item?.id), name: label(item?.name), issuesOnly: item?.issuesOnly === true, starts: label(item?.starts), acts: label(item?.acts),
    engine: pick(item?.engine, ['broker', 'api-key', 'free', 'workers-ai'], 'broker'), today: pick(item?.today, ['loop', 'one-shot'], 'one-shot'), state: pick(item?.state, ['on', 'idle', 'off'], 'idle'),
    runs: (typeof item?.runs === 'string' && /^[grsc.]{0,8}$/.test(item.runs)) ? item.runs : '', lastRun: (typeof item?.lastRun === 'string' && DAY.test(item.lastRun)) ? item.lastRun : '',
    ...(item?.prs ? {prs: counts(item.prs, ['opened', 'merged', 'closed', 'open'])} : {}), ...(item?.issues ? {issues: counts(item.issues, ['opened', 'closed'])} : {})})).filter(item => item.id && item.name);
  const steps = (Array.isArray(card.steps) ? card.steps : []).slice(0, 60).map(item => ({name: label(item?.name), file: label(item?.file), repo: pick(item?.repo, ['jobadabra', 'jobadabra-web', 'jobadabra-lab'], 'jobadabra'),
    engine: pick(item?.engine, ['broker', 'api-key', 'free', 'workers-ai'], 'broker'), ...(item?.product === true ? {product: true} : {}), ...(item?.state ? {state: pick(item.state, ['on', 'idle', 'off'], 'idle'), runs: (typeof item.runs === 'string' && /^[grsc.]{0,8}$/.test(item.runs)) ? item.runs : '', lastRun: DAY.test(item.lastRun) ? item.lastRun : ''} : {})})).filter(item => item.name && item.file);
  return agents.length ? {agents, steps} : null;
}
const CLEAN = {gate: cleanGate, ci: cleanCi, sdlc: cleanSdlc, agents: cleanAgents, harness: cleanHarness, 'harness-fixer': cleanFixer};
const DAY = /^\d{4}-\d\d-\d\d$/;

export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env) || request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 400000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  const clean = Object.hasOwn(CLEAN, data?.kind) ? CLEAN[data.kind] : null;
  if (!clean || !Array.isArray(data.days) || !data.days.length || data.days.length > 60) return new Response('Unexpected shape', {status: 400});
  const rows = data.days.map(item => ({day: String(item?.day ?? ''), card: clean(item)}));
  if (rows.some(row => !DAY.test(row.day) || !row.card)) return new Response('Unexpected shape', {status: 400});
  for (const row of rows) {
    await env.STATS.prepare(`INSERT INTO agent_coding_days (kind, day, card, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, day) DO UPDATE SET card = excluded.card, updated_at = excluded.updated_at`)
      .bind(data.kind, row.day, JSON.stringify(row.card), now.toISOString()).run();
  }
  return json({ok: true, days: rows.length});
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const since = new Date(now.getTime() - 63 * 86400000).toISOString().slice(0, 10);
  let rows = [];
  try { rows = env.STATS ? (await env.STATS.prepare('SELECT kind, day, card, updated_at FROM agent_coding_days WHERE day >= ? AND kind NOT LIKE \'harness%\' ORDER BY day').bind(since).all()).results || [] : []; } catch { rows = []; }
  return new Response(url.searchParams.get('tab') === 'sdlc' ? sdlcPage(rows, now) : page(rows, now), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
