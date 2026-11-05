// Testing → Overview: reads the rows the other Testing pages already keep (one reader per table, each exported by its page's own module) and resolves every card of the
// catalogue (admin/testing-overview-methods.js) to its lines (cadence, last run) and its "bugs caught". Nothing is typed by hand and nothing is computed here that a page
// does not already show; a method with no stored data says why. No new table, no AI. Guard: test/unit/admin/testing-overview.test.js.
import {read as readSchedules} from './schedules.js';
import {readSnapshot as readE2e} from './e2e-intel.js';
import {readSnapshot as readIntegration} from './integration-intel.js';
import {mainRuns} from './integration-page.js';
import {snapshots} from './selfheal.js';
import {latestCard} from './pr-checks.js';
import {issues} from './sentry.js';
import {missed, words} from '../shared/schedules-model.js';
import {METHODS, PLANNED, RINGS} from './testing-overview-methods.js';
import {nightlySummary, summaryForCard} from './nightly-summary.js';
import {historyOf, MAP_DAYS} from './testing-overview-history.js';
import {readCard as readProbes, readDays as readProbeDays} from '../shared/synthetic.js';
import {PUBLIC_REPO} from '../shared/repos.js';

const DAY = 86400000, DEFAULT_REPO = PUBLIC_REPO;
const REPORT_PAGE = '/admin/testing/report-only';   // the Report only tab (owner, 2 Nov 2026): the proof cards keep a one-line link to it, not the nightly charts
const SCHEDULED_PAGE = '/admin/operations/scheduled';   // Operations → Scheduled (the Testing tab of that name went on 5 Nov 2026: one page, the Area filter)
const DONE = {success: 'green', failure: 'red', timed_out: 'red'};

/** Every stored row the cards read; a reader that fails gives null, and the cards that need it say so. */
export async function load(env, now = new Date(), {sentry = issues} = {}) {
  const [schedules, e2e, integration, healing, card, sentryList, synthetic, syntheticDays] = await Promise.all([readSchedules(env), readE2e(env.STATS), readIntegration(env.STATS), snapshots(env).catch(() => []),
    latestCard(env.STATS), env.SENTRY_AUTH_TOKEN ? sentry(env, 'users').catch(() => null) : null, readProbes(env, now), readProbeDays(env, MAP_DAYS, now)]);   // the two readers of shared/synthetic.js: no query of our own (1 Nov 2026, to)
  return {repo: env.GITHUB_REPO || DEFAULT_REPO, schedules, e2e, integration, healing: healing?.[0] || null, card, sentry: sentryList, synthetic, syntheticDays, now};
}

const runUrl = (repo, id) => `https://github.com/${repo}/actions/runs/${Number(id)}`;
const jobOf = (data, file) => (data.schedules?.jobs || []).find(job => job.file === file && job.repo === data.repo) || null;
const none = (why, explicit = false) => ({state: 'none', why, explicit});   // explicit: the catalogue itself says there is nothing to read (shown on the card); otherwise the reason is the chip's tooltip

function workflowLast(data, file) {
  const job = jobOf(data, file);
  if (!data.schedules) return none('the schedules snapshot has not arrived yet');
  if (!job) return none('the schedules snapshot does not list this workflow');
  const run = (job.recent || []).find(item => DONE[item.conclusion]);
  return run ? {state: DONE[run.conclusion], at: run.at, url: run.url || '', late: missed(job, data.now)} : none('no finished run stored');
}
function e2eLast(data, kinds) {
  if (!data.e2e) return none('the e2e snapshot has not arrived yet');
  const run = (data.e2e.latest || []).find(item => kinds.includes(item.kind) && ['success', 'failure'].includes(item.conclusion));
  return run ? {state: run.conclusion === 'success' ? 'green' : 'red', at: run.day, url: runUrl(data.repo, run.runId)} : none('none of the newest stored e2e runs is of this kind');
}
function suiteLast(data, suite) {
  if (!data.e2e) return none('the e2e snapshot has not arrived yet');
  const rows = (data.e2e.suiteNights || []).filter(row => row.suite === suite);
  if (!rows.length) return none('no night result of this suite is stored yet');
  const newest = rows.reduce((best, row) => (row.runId > best.runId ? row : best));
  return {state: rows.filter(row => row.runId === newest.runId).every(row => row.green) ? 'green' : 'red', at: newest.day, url: runUrl(data.repo, newest.runId)};
}
function integrationLast(data) {
  if (!data.integration) return none('the integration snapshot has not arrived yet');
  const runs = mainRuns(data.integration, '30d', data.now).runs;
  const run = runs.reduce((best, item) => (!best || item.runId > best.runId ? item : best), null);
  return run ? {state: run.green ? 'green' : 'red', at: run.day, url: runUrl(data.repo, run.runId), note: `${run.layer} layer on main`} : none('no main run in 30 days');
}
/** The probe rounds: red "no round" when none ran for 45 min (never a stale green), red when a probe is down (2 reds in a row, the rule that alerts), else green; the note names what is down. */
function syntheticLast(data) {
  const card = data.synthetic;
  if (!card) return none('the probe tables are not readable from the Worker right now');
  const down = (card.probes || []).filter(probe => probe.state === 'down').map(probe => probe.label);
  if (card.stale) return {state: 'red', word: 'no round', at: card.lastRoundAt, note: card.lastRoundAt ? 'no probe round for over 45 min' : 'no probe round is stored'};
  return {state: down.length ? 'red' : 'green', at: card.lastRoundAt, note: down.length ? `${down.join(', ')} down` : `all ${plural(card.probes.length, 'probe', 'probes')} up`};
}
/** One line's last run: {state: green|red|none, at, url, note}; exported for the Synthetic Monitoring tab (one reader of the same rows). */
export function lastOf(data, line) {
  const last = line.last || {};
  if (last.none) return none(last.none, true);
  if (last.e2e) return e2eLast(data, last.e2e);
  if (last.suite) return suiteLast(data, last.suite);
  if (last.integration) return integrationLast(data);
  if (last.synthetic) return syntheticLast(data);
  return line.wf ? workflowLast(data, line.wf) : none('no run to read');
}

/** One line: its label, the cadence (the cron in words when the workflow has one, else the catalogue's trigger), and the last run. */
function lineOf(data, line) {
  const job = line.wf ? jobOf(data, line.wf) : null;
  if (line.byHand) return {label: line.label, when: 'by hand, for debugging', last: byHand(lastOf(data, line))};
  const when = job?.crons?.length ? job.crons.map(cron => words(cron, data.now)).join(' · ') : line.when || (line.wf ? 'by hand' : '');
  return {label: line.label, when, last: lastOf(data, line)};
}
/** A by-hand line's last run: the same run, but state `hand` (grey, information) with what it ended as in `was`. Why (1 Nov 2026, owner: "let's fix this"): site-replays.yml has had no schedule since 17 Oct, and a by-hand run 5 days old made the Real-site pool card red. */
const byHand = last => (['green', 'red'].includes(last.state) ? {...last, state: 'hand', was: last.state} : last);

const num = value => (Number(value) || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

// Where a red was caught, in the owner's words (admin/e2e-intel.js KINDS).
const WHERE = {pr: 'before merge', 'after-merge': 'after merge', scheduled: 'scheduled', nightly: 'night', beta: 'beta', soak: 'RC soak', canary: 'stable canary', harness: 'harness tests'};

/** "Bugs caught" for a card: {text, window} from stored data, or {why} when no data holds it. */
function bugsOf(data, bugs) {
  if (bugs.none) return {why: bugs.none};
  if (bugs.checks) {
    if (!data.card) return {why: 'no PR-check scorecard stored yet'};
    const found = bugs.checks.map(file => jobOf(data, file)).filter(Boolean).map(job => data.card.checks.find(check => check.name === job.name)).filter(Boolean);
    return found.length ? {text: plural(found.reduce((sum, check) => sum + check.realCatches, 0), 'real catch', 'real catches'), window: `${data.card.days} days`} : {why: 'not in the latest PR-check scorecard (no pull-request runs)'};
  }
  if (bugs.detector) {
    const last7 = data.healing?.periods?.last7;
    if (!last7) return {why: 'the self-healing snapshot has no 7-day view yet'};
    const row = (last7.byDetector || []).find(item => item.detector === bugs.detector);
    return {text: plural((row?.fixed || 0) + (row?.queued || 0), 'real bug', 'real bugs'), window: '7 days'};
  }
  if (bugs.caught) {
    if (!data.e2e) return {why: 'the e2e snapshot has not arrived yet'};
    const from = new Date(data.now.getTime() - 29 * DAY).toISOString().slice(0, 10);
    // One run per red: the stored rows are one per failing suite, platform and line (admin/e2e-intel.js caught), so a run red on Mac and Linux would count twice (Gitar, #255).
    // Why (2 Nov 2026, owner: "has this caught bug been counted?"): every run kind, the same rows as the E2E scorecard (isCatch); PR runs alone missed what main, the night and the beta caught once PRs stopped running e2e (1 Nov).
    const reds = new Map((data.e2e.caught || []).filter(row => row.day >= from).map(row => [row.runId, row.kind]));
    const where = [...reds.values()].reduce((counts, kind) => counts.set(kind, (counts.get(kind) || 0) + 1), new Map());
    const detail = [...where].map(([kind, n]) => [WHERE[kind] || kind || 'unknown', n]).sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => `${name} ${n}`).join(' · ');
    return {text: plural(reds.size, 'red that caught a bug', 'reds that caught a bug'), window: '30 days', ...(detail ? {detail} : {})};
  }
  if (bugs.mutation) return data.healing?.quality?.mutation?.note ? {text: data.healing.quality.mutation.note} : {why: 'no planted-bug run is stored yet'};
  if (bugs.recall) {
    const recall = data.healing?.recall;
    return recall ? {text: `${recall.caught} of ${recall.planted} planted UI bugs caught`, detail: recall.missed?.length ? `missed: ${recall.missed.join(', ')}` : ''} : {why: 'no interactions night has measured it yet'};
  }
  if (bugs.sentry) {
    if (!data.sentry) return {why: 'Sentry is not reachable from the Worker right now'};
    const users = data.sentry.reduce((sum, item) => sum + (Number(item.userCount) || 0), 0);
    return {text: `${plural(data.sentry.length, 'unresolved issue', 'unresolved issues')} · ${plural(users, 'user', 'users')} hit`, window: '14 days'};
  }
  return {why: 'no data'};
}

const rank = {red: 3, green: 2, none: 1, hand: 0};   // hand: a by-hand line never decides a card
const cardState = lines => lines.map(line => line.last.state).reduce((worst, state) => (rank[state] > rank[worst] ? state : worst), 'none');

/** The page's model: the rings in order, each with its method cards (live ones resolved, planned ones grey) and a count of live cards by verdict. */
export function resolve(data, {pages = []} = {}) {
  const nightly = nightlySummary({snapshot: data.e2e}, data.now || new Date());   // the e2e snapshot this page already loaded: no second read (owner, 1 Nov 2026: the nightly numbers fold into the cards)
  const live = METHODS.map(method => {
    const lines = method.lines.map(line => lineOf(data, line));
    const linked = pages.includes(method.href);   // a card links only to a page in the menu: GTM readiness and Testing → Scheduled land in their own PRs (1 Nov 2026)
    return {...method, kind: 'live', lines, state: method.linkOnly ? 'link' : cardState(lines), bugs: bugsOf(data, method.bugs), days: method.linkOnly ? [] : historyOf(data, method.lines.filter(line => !line.byHand)), trends: summaryForCard(nightly, method.id), href: linked ? method.href : '', pending: !linked};
  });
  const rings = RINGS.map(ring => ({...ring, cards: [...live.filter(card => card.ring === ring.id), ...PLANNED.filter(card => card.ring === ring.id).map(card => ({...card, kind: 'planned'}))]}));
  const counted = live.filter(card => card.state !== 'link'), count = state => counted.filter(card => card.state === state).length;   // a link-only card (GTM readiness) has its own page and no verdict here
  return {rings, scheduled: pages.includes(SCHEDULED_PAGE) ? SCHEDULED_PAGE : '', reportOnly: pages.includes(REPORT_PAGE) ? REPORT_PAGE : '', red: counted.filter(card => card.state === 'red').map(card => card.title), redCards: counted.filter(card => card.state === 'red').map(card => ({id: card.id, icon: card.icon, title: card.title})), counts: {green: count('green'), red: count('red'), none: count('none'), live: counted.length, planned: PLANNED.length}};
}
