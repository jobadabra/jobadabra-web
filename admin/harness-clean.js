// What the site keeps of the "harness" upload (owner, 4 Nov 2026: a new tab "Agent harness" with "some details about each run"; sent daily by tools/harness-stats.mjs in the public repo, kind "harness" of /agent-coding/data).
// A card is {plan, layers, sources, runs} (and `demo: true` only from tools/page-shot-seeds.mjs: the page then wears a "Demo data" ribbon, owner 4 Nov 2026: the real page never invents history): the CI fixer's plan rows, the context layers, the sources and the last run records (schema v1 written by the fixer's own run). Everything is clamped here, so the page can draw it: a record is DATA, never HTML.
// Words (agreed with the fixer's pane, 4 Nov 2026): verdict = the loop's (fix, fixed-already, not-reproducible, needs-human, false-positive, answer; none when the run stopped before one); stop = the driver's fixed word (ready, time, rounds, same-failure, refused, conflict, round-failed, no-change, wall, dispatch, bad-deadline) or '' - READY is a stop word, not a verdict.
// A malformed run record is dropped and counted (`dropped`), never stored half-read. Test: test/unit/admin/ai/ai-harness.test.js.
const count = value => Math.min(1e7, Math.max(0, Math.round(Number(value) || 0)));
const minutes = value => Math.min(1e5, Math.max(0, Math.round((Number(value) || 0) * 10) / 10));
/** Printable text only, cut to `max`: control characters (a log's escape codes, newlines) become spaces. It is escaped again when drawn. */
export const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const word = (value, max, pattern = /[^a-z0-9_-]/g) => (typeof value === 'string' ? value.toLowerCase().replace(pattern, '').slice(0, max) : '');
const name = value => (typeof value === 'string' ? value.replace(/[^A-Za-z0-9 ()·./,+:_-]/g, '').trim().slice(0, 60) : '');

export const RUN_URL = /^https:\/\/github\.com\/jobadabra\/jobadabra\/actions\/runs\/\d{1,20}$/;
const STATES = ['done', 'doing', 'next'], SOURCES = ['linear', 'feedback'];
const WHEN = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?Z$/;

/** One run record (schema v1) -> the clamped record, or null when it is not a v1 record of a real GitHub run of the fixer. */
export function cleanRun(record, now = new Date()) {
  if (!record || typeof record !== 'object' || record.v !== 1 || record.workflow !== 'ai-fixer') return null;
  const id = String(record.run_id ?? '');
  if (!/^\d{1,20}$/.test(id) || typeof record.url !== 'string' || !RUN_URL.test(record.url) || !record.url.endsWith(`/${id}`)) return null;
  const at = typeof record.started === 'string' && WHEN.test(record.started) ? Date.parse(record.started) : NaN;   // Why (4 Nov 2026, review): a date in the future would stay pinned as the "last run" and one with month 99 would vanish unseen
  if (!Number.isFinite(at) || at > now.getTime() + 3600000) return null;
  const list = (value, cap) => (Array.isArray(value) ? value.slice(0, cap) : []);
  return {id, url: record.url, started: new Date(at).toISOString(), minutes: minutes(record.minutes),
    source: SOURCES.includes(record.source) ? record.source : 'other', ref: typeof record.ref === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(record.ref) ? record.ref : '', round: count(record.round),
    engine: name(record.engine), model: name(record.model), turns: count(record.turns), calls: count(record.calls), tokensIn: count(record.tokens_in), tokensOut: count(record.tokens_out),
    steps: list(record.steps, 60).map(step => word(step?.action, 20, /[^a-z_]/g)).filter(Boolean),
    verdict: word(record.verdict, 24) || 'none', reason: text(record.reason, 400),
    files: list(record.changed_files, 20).map(file => (typeof file === 'string' ? file.replace(/[^A-Za-z0-9 ._/@+-]/g, '').slice(0, 120) : '')).filter(Boolean),
    pr: Number.isInteger(record.pr) && record.pr > 0 && record.pr < 1e7 ? record.pr : null, stop: word(record.stop, 20), errors: list(record.errors, 5).map(error => text(error, 200)).filter(Boolean)};
}

const cleanRows = (rows, cap) => (Array.isArray(rows) ? rows.slice(0, cap) : []).map(row => ({n: count(row?.n), name: name(row?.name), state: STATES.includes(row?.state) ? row.state : 'next', pr: count(row?.pr)})).filter(row => row.n && row.name);

/** The harness card as the site keeps it, or null when the body is not an object. Runs: newest first, one per run id, at most 60. */
export function cleanHarness(card, now = new Date()) {
  if (!card || typeof card !== 'object') return null;
  const raw = Array.isArray(card.runs) ? card.runs.slice(0, 100) : [], seen = new Set(), read = raw.map(record => cleanRun(record, now));
  const runs = read.filter(run => run && !seen.has(run.id) && seen.add(run.id)).sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0)).slice(0, 60);
  return {demo: card.demo === true, plan: {rows: cleanRows(card.plan?.rows, 12), web: cleanRows(card.plan?.web, 6)},
    layers: (Array.isArray(card.layers) ? card.layers.slice(0, 6) : []).map(layer => ({id: name(layer?.id).slice(0, 4), name: name(layer?.name), present: layer?.present === true, note: name(layer?.note)})).filter(layer => layer.id && layer.name),
    sources: (Array.isArray(card.sources) ? card.sources.slice(0, 12) : []).map(source => ({name: name(source?.name), built: source?.built === true, key: source?.key === 'set' || source?.key === 'missing' ? source.key : ''})).filter(source => source.name),
    runs, dropped: count(card.dropped) + (raw.length - read.filter(Boolean).length)};
}
