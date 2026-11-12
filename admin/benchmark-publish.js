// "Publish to website" for the two benchmark pages (owner, 12 Nov 2026: "First I should see them more in depth in Admin, and then having a button to publish them on the website (/benchmark). Same for job search benchmarks").
// The public /benchmark shows ONLY what the owner published here: the newest row of each kind in benchmark_published (what he saw in the confirm), else the starting snapshot kept in the site's files (website/public/benchmark-start.json).
// Why (12 Nov 2026, Gitar on #584): the starting file must not be named like the route; Cloudflare serves a same-named asset before the Worker runs, and published rounds would never show.
// Nothing reaches the public page by itself: a CI round fills Admin; one confirmed press makes it public; "Unpublish" brings back the round before. Pure builders first, then the D1 state, the card and the owner-only POST.
// Public shape = allowlisted aggregates only (tool names, counts, fictional persona labels); never an answer, a listing or a URL of a job. Guard: test/unit/admin/benchmark/benchmark-publish.test.js.
import {isOwner} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {ourName, publicName} from '../shared/benchmark-names.js';

export const KINDS = ['form', 'search'];
export const PAGES = {form: '/admin/form-filling/benchmark', search: '/admin/job-search/benchmark'};
const nameOf = (tool, ours, kind) => publicName(kind, ours ? 'ours' : String(tool).toLowerCase(), String(tool));   // the name by tool + round kind lives in shared/benchmark-names.js
const keyOf = (tool, ours, form) => (ours ? (form ? 'extension' : 'ours') : String(tool).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/**
 * One fair round of Admin's form page (fair.rounds[key]) -> the public form section, counted on the forms EVERY tool ran (owner, 12 Nov 2026, "5 shared forms"): a form a tool did not run
 * is left out for all of them and listed with the tool(s) that lacked it, so no tool is scored on easier or harder pages than another. `why` is the owner's own words for the left-out line.
 */
export function formsSection(key, round, why = '') {
  const lacks = form => round.tools.filter(t => !round.grid[t.tool]?.[form]);
  const shared = round.forms.filter(form => !lacks(form).length), leftOut = round.forms.filter(form => lacks(form).length)
    .map(form => ({form, tools: lacks(form).map(t => nameOf(t.tool, t.ours, 'form')), why: text(why, 100)}));
  const tools = round.tools.map(t => {
    const sum = shared.reduce((n, form) => { const c = round.grid[t.tool][form]; return {right: n.right + c.right, wrong: n.wrong + c.wrong, empty: n.empty + c.empty, notReached: n.notReached + (c.unreached || 0)}; }, {right: 0, wrong: 0, empty: 0, notReached: 0});
    return {key: keyOf(t.tool, t.ours, true), name: nameOf(t.tool, t.ours, 'form'), ours: t.ours, score: share(sum.right, sum.right + sum.wrong + sum.empty + sum.notReached), repeats: t.reps, forms: shared.length, spread: null, ...sum};
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map(({ours: _ours, ...t}) => t);
  const build = round.tools.find(t => t.ours)?.build || '';
  return {kind: 'form', round: key, date: String(round.at || '').slice(0, 10), model: 'claude-haiku-5-5', productBuild: build, forms: shared, leftOut, tools};
}

/** One round of Admin's search page (snapshot.rounds[key]) -> the public search section: ours (the rivals' sources off) and every rival, each with its own counts; "ours with every source" stays in Admin. */
export function searchSection(key, view, snapshotAt = '') {
  const shown = view.tools.filter(t => !t.withAll), grid = view.grid || {};
  const tools = shown.map(t => ({key: keyOf(t.tool, t.ours, false), name: nameOf(t.tool, t.ours, 'search'), found: t.found, role: t.role, place: t.place, remote: null, no: null, unknown: null, relevant: t.relevant, observedPersonas: t.personas}));
  const personas = view.personas.map(p => {
    const [title, city = ''] = String(p.persona).split(' · ');
    return {title, city, country: p.country, judgedJobs: null, tools: Object.fromEntries(shown.filter(t => grid[t.tool]?.[p.persona]).map(t => [keyOf(t.tool, t.ours, false), {...grid[t.tool][p.persona], remote: null, no: null, unknown: null}]))};
  });
  return {kind: 'search', round: key, date: (/^\d{4}-\d{2}-\d{2}/.test(key) ? key : String(snapshotAt)).slice(0, 10), judgedJobs: null, returnedRows: tools.reduce((n, t) => n + t.found, 0), tools, personas};
}

/** A section with each tool's name made from its key and the round kind, so a round published (or kept in the starting file) under an older name reads the current one; the form section's "not run for" list stored names as words, so the old bare product name in it is renamed too. */
const named = (kind, section) => (!section?.tools ? section : {...section, tools: section.tools.map(t => ({...t, name: publicName(kind, t.key, t.name)})),
  ...(section.leftOut ? {leftOut: section.leftOut.map(l => ({...l, tools: l.tools.map(name => (name === 'Jobadabra' ? ourName(kind) : name))}))} : {})});

/** The results file the public page reads: the starting snapshot with each section replaced by the owner's newest published one. */
export function mergeResults(baseline, current) {
  const merged = {...baseline, ...(current.search ? {search: current.search.body} : {}), ...(current.form ? {forms: current.form.body} : {})};
  const out = {...merged};
  if (merged.search) out.search = named('search', merged.search);
  if (merged.forms) out.forms = named('form', merged.forms);
  return {...out,   // a published section replaces the starting one whole: none of its old run ids or links survive
    published: Object.fromEntries(KINDS.filter(kind => current[kind]).map(kind => [kind, {round: current[kind].round, at: current[kind].published_at}]))};
}

// ---- D1: benchmark_published (migration 0151). A missing table reads as "nothing published yet", never as an error on a public page.
export async function state(db) {
  const out = {form: {now: null, before: null}, search: {now: null, before: null}};
  if (!db) return out;
  try {
    // Why (12 Nov 2026, #584): one query for both kinds; an Admin benchmark page reads its snapshot row and this, never the runs table.
    const {results = []} = await db.prepare('SELECT kind, id, round, published_at, body FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY id DESC) AS n FROM benchmark_published) WHERE n <= 2 ORDER BY kind, id DESC').all();
    const row = r => (r ? {id: r.id, round: r.round, published_at: r.published_at, body: JSON.parse(r.body)} : null);
    for (const kind of KINDS) { const mine = results.filter(r => r.kind === kind); out[kind] = {now: row(mine[0]), before: row(mine[1])}; }
  } catch { /* table not there yet */ }
  return out;
}
export const currentOf = async db => { const s = await state(db); return {form: s.form.now, search: s.search.now}; };
const publish = (db, kind, round, body, now) => db.prepare('INSERT INTO benchmark_published (kind, round, published_at, body) VALUES (?, ?, ?, ?)').bind(kind, round, now.toISOString(), JSON.stringify(body)).run();
const unpublish = (db, kind) => db.prepare('DELETE FROM benchmark_published WHERE id = (SELECT MAX(id) FROM benchmark_published WHERE kind = ?)').bind(kind).run();

// ---- The card on each Admin page: what is public now, and the two-press Publish (the first press shows exactly what the public page will say, the second stores it; no script, no browser dialog; same pattern as admin/email-switches.js).
export const PUBLISH_STYLE = `.pub .row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:8px 0}.pub button,.pub .btn{font:inherit;font-size:14px;padding:7px 14px;border-radius:8px;border:1px solid #3a4352;background:#1c222b;color:inherit;cursor:pointer;text-decoration:none}
.pub button.go{background:#1f7a52;border-color:#4cc38a;color:#fff}.pub button.off{background:#2a1c1c;border-color:#e5484d}.pub input[type=text]{font:inherit;font-size:14px;padding:6px 8px;min-width:18em;max-width:100%;border-radius:8px;border:1px solid #3a4352;background:#12161b;color:inherit}
.pub .ask{border:1px solid #f5b54a;background:#2a2417;border-radius:10px;padding:12px 14px;margin:10px 0}.pub table{margin:8px 0}`;
const when = at => String(at || '').slice(0, 10);
const preview = (kind, part) => (kind === 'form'
  ? `<table><tr><th>Tool</th><th class="num">Score</th><th class="num">Right</th><th class="num">Wrong</th><th class="num">Empty</th><th class="num">Not reached</th></tr>${part.tools.map(t => `<tr><td>${esc(t.name)}</td><td class="num">${t.score ?? '–'}%</td><td class="num">${t.right}</td><td class="num">${t.wrong}</td><td class="num">${t.empty}</td><td class="num">${t.notReached}</td></tr>`).join('')}</table>
<p class="muted">Counted on ${part.forms.length} forms every tool ran (${part.forms.map(esc).join(', ')}).${part.leftOut.map(l => ` <b>Form ${esc(l.form)} not run for ${esc(l.tools.join(', '))}${l.why ? ` (${esc(l.why)})` : ''}.</b>`).join('')}</p>`
  : `<table><tr><th>Tool</th><th class="num">Shown</th><th class="num">Right role</th><th class="num">In place</th><th class="num">Relevant</th><th class="num">Searches</th></tr>${part.tools.map(t => `<tr><td>${esc(t.name)}</td><td class="num">${t.found}</td><td class="num">${t.role}</td><td class="num">${t.place}</td><td class="num">${t.relevant}</td><td class="num">${t.observedPersonas}</td></tr>`).join('')}</table>
<p class="muted">${part.personas.length} fictional job seekers; "Jobadabra Search Engine with every source" stays in Admin only.</p>`);

/** state = state(db); part = the section built from the round on screen; ask = ?confirm=publish; note = the owner's words for a left-out form. Returns the card's HTML. */
export function panel({kind, round, part, published, ask, note = ''}) {
  const live = published[kind].now, before = published[kind].before, isLive = live?.round === round;
  const now = live ? `Public now: round <b>${esc(live.round)}</b>, published ${esc(when(live.published_at))}.` : 'Public now: the <b>starting snapshot of 27 Oct 2026</b>. Nothing has been published from here yet.';
  const hidden = `<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="round" value="${esc(round)}">`;
  const noteField = kind === 'form' && part.leftOut.length ? `<label class="muted">Why form ${esc(part.leftOut.map(l => l.form).join(', '))} was left out <input type="text" name="note" maxlength="100" value="${esc(note)}" placeholder="e.g. Ashby bot check"></label>` : '';
  const action = path => `${PAGES[kind]}/publish${path}`;
  const back = live ? `<form method="post" action="${action('')}" class="row">${hidden}<input type="hidden" name="action" value="unpublish"><button class="off" type="submit">Unpublish</button><span class="muted">brings back ${before ? `round ${esc(before.round)}` : 'the starting snapshot of 27 Oct 2026'}</span></form>` : '';
  const go = isLive ? '<p class="muted">This round is the one on the website.</p>' : ask
    ? `<div class="ask"><b>The public page will say:</b>${preview(kind, part)}<form method="post" action="${action('')}" class="row">${hidden}<input type="hidden" name="action" value="publish"><input type="hidden" name="confirmed" value="1"><input type="hidden" name="note" value="${esc(note)}"><button class="go" type="submit">Publish now</button><a class="btn" href="${PAGES[kind]}?round=${encodeURIComponent(round)}#publish">Cancel</a></form></div>`
    : `<form method="get" action="${PAGES[kind]}#publish" class="row"><input type="hidden" name="round" value="${esc(round)}"><input type="hidden" name="confirm" value="publish">${noteField}<button class="go" type="submit">Publish to website</button></form>`;
  return `<section class="card pub" id="publish"><h2>Website · /benchmark</h2><p>${now}</p>${go}${back}</section>`;
}

// ---- POST /admin/{form-filling,job-search}/benchmark/publish: kind, round, action ('publish' | 'unpublish'), confirmed ('1'), note. Owner only, same origin; the section is rebuilt from the stored rows here, never taken from the form.
export async function publishPress(request, env, now = new Date()) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return new Response('Not found', {status: 404});
  const form = await request.formData().catch(() => new FormData()), kind = String(form.get('kind') || ''), round = String(form.get('round') || ''), action = String(form.get('action') || '');
  if (!KINDS.includes(kind) || !['publish', 'unpublish'].includes(action) || url.pathname !== `${PAGES[kind]}/publish`) return new Response('Unknown request.', {status: 400});
  const done = (hash = '') => new Response(null, {status: 303, headers: {Location: `${PAGES[kind]}?round=${encodeURIComponent(round)}${hash}#publish`, 'Cache-Control': 'no-store'}});
  try {
    if (action === 'unpublish') { await unpublish(env.STATS, kind); return done(); }
    const row = await env.STATS.prepare(`SELECT body FROM ${kind === 'form' ? 'benchmark_snapshot' : 'benchmark_search_snapshot'} WHERE id = 1`).first(), snap = row ? JSON.parse(row.body) : null;
    const rounds = kind === 'form' ? snap?.fair?.rounds : snap?.rounds, source = rounds?.[round];
    if (!source) return new Response('That round is not in the stored data.', {status: 404});
    const body = kind === 'form' ? formsSection(round, source, form.get('note')) : searchSection(round, source, snap.at);
    if (form.get('confirmed') !== '1') return done(`&confirm=publish&note=${encodeURIComponent(text(form.get('note'), 100))}`);
    await publish(env.STATS, kind, round, body, now);
    return done();
  } catch (error) {
    return new Response(`Not saved: ${error.message}. If the benchmark_published table is missing, migration 0151 has not run.`, {status: 503, headers: {'Cache-Control': 'no-store'}});
  }
}

/** GET /benchmark-results.json: the public page's data (the starting snapshot from the site's files, each section replaced by the owner's newest published one). */
export async function results(request, env) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/benchmark-start.json', request.url), {headers: request.headers}));
  if (!asset.ok) return asset;
  const merged = mergeResults(await asset.json(), await currentOf(env.STATS));
  return new Response(JSON.stringify(merged), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60'}});
}
