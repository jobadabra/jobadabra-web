// Ready to send, phase 1, the Worker's side (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): the owner's app pushes tonight's batch (url, kit, CV, letter, contact) encrypted into R2; a container reads
// it with a one-night token, fills each form and posts only counts; the owner's page asks what is ready. A fill night never presses Submit: its outcomes never include "submitted"; only a Full automation night (task auto, a Pro Always on install, api/ready-auto.js) may, through the container's one gate.
// Ready to send's own routes are the owner's install (env.READY_OWNER); an Always on install reaches the readiness and auto nights only (api/ready-read-access.js, api/ready-auto.js). READY_TO_SEND = off answers 404. The data is deleted on Done, after 24 h (sweep, from the cron) and on Delete everything.
// Counts, hosts and states stay 30 days for the morning measure; never a field value or an address. Guard: test/unit/api/ready/ready-to-send.test.js.
import {equal, tokenFor} from '../shared/guard.js';   // tokenFor: the night token is checked in batchOf
import {installOf} from '../shared/hosted.js';
import {open, seal} from './hosted-state.js';
import {relay} from './ready-ai.js';
import {makeLink, viaLink} from './ready-link.js';
import {fillAgain} from './ready-again.js';
import {ENDED, LIVE, progress, stop} from './ready-line.js';
import {runNow} from './ready-tick.js';
import {whyOf} from './ready-why.js';
import {closeNight, morning, readyToken} from './ready-morning.js';
import {dropKept, jobsWithKept, keptPut, keptKey, videoGet} from './ready-kept.js';
import {mailNight} from './ready-mail.js';
import {checkRead, keepRead, takeReads, taskOf} from './ready-read.js';
import {autoRefusal, checkItem, checkSubmit, claimAttempt, keepSubmit, kitOf, reserve, takeSubmits} from './ready-auto.js';
import {MICRO_PER_SECOND, addMicro, chargeContainer, claimedRefusal, creditRefusal, isPro, proofOf, publicHost, readerOf, reserveOwn, reserveReads, strictNow} from './ready-read-access.js';
export {readyToken};

export const readyOn = env => env.READY_TO_SEND === 'on' && !!env.HOSTED_STATE && !!env.READY_OWNER;
const notSetUp = () => json({ok: false, error: 'Ready to send is not set up on the server yet (READY_KEK).'}, 503);   // the batch is sealed with its own Worker secret, never shared with Always on
export const MAX_JOBS = 15, MAX_BYTES = 8 * 1024 * 1024, KEEP_HOURS = 24, RUN_HOURS = 3, COUNTS_KEEP_DAYS = 30, DEFAULT_CAP_USD = 1;
export const OUTCOMES = ['prepared', 'partial', 'wall', 'no-form', 'closed', 'failed'];   // what a container may report; never "submitted"
const FACTS = ['profile', 'standard', 'search', 'cvFacts', 'knowledge'];
const HOUR = 3600 * 1000;
const label = install => `ready:${install}`, keyOf = (install, batch) => `ready/${install}/${batch}.json`;
const json = (data, status = 200) => Response.json(data, {status});
const notFound = () => new Response('Not found', {status: 404});
const deny = () => json({ok: false, error: 'unauthorized'}, 401);
const bad = error => json({ok: false, error}, 400);
const cap = env => Math.round((Number(env.READY_NIGHT_MAX_USD) > 0 ? Number(env.READY_NIGHT_MAX_USD) : DEFAULT_CAP_USD) * 1e6);
const num = value => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : null);

// The owner: his install key AND the owner secret (x-ready-owner = the Worker secret READY_OWNER_SECRET). The install id travels to the site in reports and lookups, so it names the owner but proves nothing;
// without the secret set, or sent, no owner route opens (owner, 17 Oct 2026). The night token and the 10-minute link are other credentials and do not pass here.
async function ownerOf(request, env) {
  const given = request.headers.get('x-ready-owner') || '';
  if (!env.READY_OWNER_SECRET || !given || !equal(given, env.READY_OWNER_SECRET)) return null;
  const install = await installOf(request, env);
  return install && equal(install, env.READY_OWNER) ? install : null;
}
// A night token: good only while its batch is running (or capped, to read "stop") and unexpired.
export async function batchOf(env, bearer, now = new Date()) {
  const [tag, id, token] = String(bearer || '').replace(/^Bearer /, '').split('.');
  if (tag !== 'RR1' || !id || !token || !equal(token, await tokenFor(id, env, 'ready-run'))) return null;
  const row = await env.STATS.prepare('SELECT * FROM ready_batches WHERE id = ?').bind(id).first();
  return row && ['running', 'capped'].includes(row.state) && row.expires_at && Date.parse(row.expires_at) > now.getTime() ? row : null;
}
// The runner starts the night: the token the container gets. -> the token, or null when the batch is not waiting.
export async function start(env, id, now = new Date()) {
  const changed = await env.STATS.prepare("UPDATE ready_batches SET state = 'running', expires_at = ? WHERE id = ? AND state = 'queued'").bind(new Date(now.getTime() + RUN_HOURS * HOUR).toISOString(), id).run();
  return changed.meta?.changes ? readyToken(env, id) : null;
}

const readBlob = async (env, install, id) => {
  const object = await env.HOSTED_STATE.get(keyOf(install, id));
  return object ? JSON.parse(new TextDecoder().decode(await open(env, label(install), new Uint8Array(await object.arrayBuffer()), 'READY_KEK'))) : null;
};
const writeBlob = (env, install, id, data) => seal(env, label(install), new TextEncoder().encode(JSON.stringify(data)), 'READY_KEK').then(bytes => env.HOSTED_STATE.put(keyOf(install, id), bytes));
const stamp = at => at.toISOString();

// Takes the listed jobs' data out of a batch (all of them when `jobs` is null): the blob shrinks or goes, the rows keep their counts. -> how many jobs were cleared.
async function clear(env, install, id, jobs, now) {
  const data = await readBlob(env, install, id).catch(() => null);
  if (data) {
    const left = jobs ? data.jobs.filter(job => !jobs.includes(job.id)) : [];
    if (left.length) await writeBlob(env, install, id, {...data, jobs: left}); else await env.HOSTED_STATE.delete(keyOf(install, id));
  }
  await dropKept(env, install, id, jobs, now).catch(() => {});   // the kept video and hand-off (api/ready-kept.js) go with the data
  const marks = jobs ? jobs.map(() => '?').join(',') : '';
  const changed = await env.STATS.prepare(`UPDATE ready_jobs SET cleared_at = ? WHERE batch = ? AND cleared_at IS NULL${jobs ? ` AND job IN (${marks})` : ''}`).bind(stamp(now), id, ...(jobs || [])).run();
  const open_ = await env.STATS.prepare('SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ? AND cleared_at IS NULL').bind(id).first();
  if (!open_.n) { await env.STATS.prepare("UPDATE ready_batches SET state = 'deleted', deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(stamp(now), id).run(); await closeNight(env, id); }   // nothing left to hold: the container closes its tabs
  return changed.meta?.changes || 0;
}

// What the nightly run cost, on the owner's /admin/ai/costs beside the other scheduled jobs (job id 'ready-fill'; a readiness night's reads are 'ready-read', owner 9 Nov 2026: "we care about AI credit").
export async function reportNight(env, row, now) {
  const usd = row.cost_micro / 1e6, calls = (await env.STATS.prepare('SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ?').bind(row.id).first()).n;
  await env.STATS.prepare(`INSERT INTO ai_cost_runs (job, run_id, day, at, usd, calls, repo, provider) VALUES (?, ?, ?, ?, ?, ?, '', 'anthropic')
    ON CONFLICT (job, run_id) DO UPDATE SET day = excluded.day, at = excluded.at, usd = excluded.usd, calls = excluded.calls`).bind(row.task === 'readiness' ? 'ready-read' : row.task === 'auto' ? 'ready-auto' : 'ready-fill', row.id, stamp(now).slice(0, 10), stamp(now), usd, calls).run().catch(() => {});
}

// POST (the owner's install key): tonight's batch. GET (a night token): the container reads it decrypted.
async function batch(request, env, now) {
  if (request.method === 'GET') {
    const row = await batchOf(env, request.headers.get('authorization'), now);
    if (!row) return deny();
    const data = await readBlob(env, row.install, row.id);
    // Only the rows still queued: the whole night at first, one form after a Fill again (api/ready-again.js), so the others keep their results.
    const queued = new Map((await env.STATS.prepare("SELECT job, turn FROM ready_jobs WHERE batch = ? AND state = 'queued' AND cleared_at IS NULL").bind(row.id).all()).results.map(each => [each.job, each.turn]));   // turn: which press (the container fills each once)
    return json({ok: true, line: true, task: row.task, sentAt: row.created_at, stop: row.state === 'capped' || !data, night: row.night, contact: data?.contact || {}, readyBy: data?.readyBy || '', facts: data?.facts || {}, jobs: (data?.jobs || []).filter(job => queued.has(job.id)).map(job => ({...job, turn: queued.get(job.id)}))});
  }
  if (request.method !== 'POST') return json({ok: false, error: 'Use GET or POST'}, 405);
  const reader = await readerOf(request, env, ownerOf);   // the owner, or an Always on install (api/ready-read-access.js): the latter for the readiness and auto tasks only
  if (!reader) return deny();
  const install = reader.install;
  if (!env.READY_KEK) return notSetUp();
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ok: false, error: 'too large'}, 413);
  let given;
  try { given = JSON.parse(text); } catch { return bad('Send JSON'); }
  const task = taskOf(given?.task);   // fill (none named), readiness (api/ready-read.js) or auto (api/ready-auto.js); anything else is refused
  if (!task) return bad('bad task');
  if (!reader.owner && task === 'fill') return deny();
  const autoNo = task === 'auto' ? await autoRefusal(env, install) : null;   // a Pro account, READY_AUTO on: the owner's install too, it gets no other way in
  if (autoNo) return json({ok: false, error: autoNo.error}, autoNo.status);
  const jobs = Array.isArray(given?.jobs) ? given.jobs : [];
  const good = job => typeof job?.id === 'string' && /^[\w.:-]{1,64}$/.test(job.id) && /^https:\/\/[^\s/]+/.test(String(job.url)) && String(job.url).length <= 2000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(given?.night)) || !jobs.length || jobs.length > MAX_JOBS || !jobs.every(good) || new Set(jobs.map(job => job.id)).size !== jobs.length) return bad('bad batch');
  if (task !== 'fill' && !reader.owner && !jobs.every(job => publicHost(job.url))) return bad('bad batch');   // an Always on install's forms are public pages: never our container's own network (code review of 3/4)
  const items = task === 'auto' ? jobs.map(job => checkItem(job)) : [];   // every job carries the Mac's own queued item; the site never makes one (spec "auto")
  if (items.some(item => !item)) return bad('bad item');
  let strict = task === 'auto' ? 0 : 1;   // the daily cap can apply to this night (ready_batches.strict): not a Pro account's (api/ready-read-access.js, "Design") An auto night is Pro's: no daily cap, the ~500 ceiling is at /reserve.
  if (task === 'readiness') {   // the lane follows who pays: a claimed own key is not trusted, only an answer from Anthropic proves it (aiCall); until then a trial's reads take the daily cap as their results arrive
    const own = /^sk-ant-[\w-]{20,300}$/.test(String(given.ai?.key || '')), pro = await isPro(env, install);
    strict = pro ? 0 : 1;
    const refused = (own ? null : await creditRefusal(env, install, now)) || (own ? (pro ? null : await claimedRefusal(env, install, given.ai.key, now)) || await reserveOwn(env, install, jobs.length, now) : pro ? null : await reserveReads(env, install, jobs.length, now));
    if (refused) return json({ok: false, error: refused.error, ...(refused.limit ? {limit: refused.limit, used: refused.used} : {})}, refused.status);
  }
  const old = await env.STATS.prepare('SELECT id, state FROM ready_batches WHERE install = ? AND night = ? AND task = ?').bind(install, given.night, task).first();
  // Why (code review of cs 2/4): replacing an auto night deleted its rows, so its attempts and sealed outcomes, and its container's token; a night that started or pressed is never replaced
  if (old && task === 'auto' && (old.state !== 'queued' || await env.STATS.prepare('SELECT 1 AS n FROM ready_jobs WHERE batch = ? AND attempt IS NOT NULL').bind(old.id).first())) return json({ok: false, error: 'this night already started'}, 409);
  if (old) { await clear(env, install, old.id, null, now); await env.STATS.batch([env.STATS.prepare('DELETE FROM ready_jobs WHERE batch = ?').bind(old.id), env.STATS.prepare('DELETE FROM ready_batches WHERE id = ?').bind(old.id)]); }
  const id = crypto.randomUUID();
  const reading = task === 'readiness';   // a read needs the page only: no kit, letter, CV, contact or facts are sealed for it
  const kept = jobs.map((job, index) => ({id: job.id, url: job.url, title: String(job.title || '').slice(0, 200), company: String(job.company || '').slice(0, 200), fit: num(job.fit), kit: reading ? {} : job.kit || {}, letter: reading ? '' : String(job.letter || ''), cv: reading ? '' : String(job.cv || ''), letterPdf: reading ? '' : String(job.letterPdf || ''), ...(task === 'auto' ? {item: items[index], ...kitOf(job)} : {})}));
  const facts = Object.fromEntries(FACTS.map(name => [name, reading ? '' : String(given.facts?.[name] || '').slice(0, 40000)]));   // what the AI may answer from (profile, standard answers, ...): sealed with the batch, deleted with it
  const ai = /^sk-ant-[\w-]{20,300}$/.test(String(given.ai?.key || '')) ? {key: given.ai.key} : undefined;   // the user's own Claude key (BYOK): sealed with the batch, never sent back, deleted with it
  await writeBlob(env, install, id, {ai, contact: reading ? {} : given.contact || {}, readyBy: reading ? '' : String(given.readyBy || '').slice(0, 5), facts, jobs: kept});
  const fillAt = Number.isFinite(Date.parse(given.fillAt)) ? new Date(given.fillAt).toISOString() : null;   // when the night should start filling (the cron starts it then); none: at the next tick
  await env.STATS.batch([env.STATS.prepare('INSERT INTO ready_batches (id, install, night, created_at, fill_at, task, strict) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, install, given.night, stamp(now), fillAt, task, strict),
    ...kept.map(job => env.STATS.prepare('INSERT INTO ready_jobs (batch, job, host, session) VALUES (?, ?, ?, ?)').bind(id, job.id, new URL(job.url).hostname, job.item?.session ?? null))]);   // session: the auto item's, the key of its one attempt (api/ready-auto.js)
  return json({ok: true, batch: id, queued: kept.length});
}

// POST (a night token): one job's outcome, counts only. "prepared" is the server's word and needs a filled form with nothing required left; the cost can stop the night.
async function result(request, env, now) {
  if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
  const row = await batchOf(env, request.headers.get('authorization'), now);
  if (!row) return deny();
  const given = await request.json().catch(() => null);
  const reading = row.task === 'readiness', auto = row.task === 'auto', cloud = reading || auto;   // cloud: a night that holds nothing for the morning (no mail, its container closes at its end)
  const checked = reading ? checkRead(given) : auto ? checkSubmit(given) : null;   // the batch's task decides what it may report, whatever the body says (api/ready-read.js, api/ready-auto.js)
  if (!given || (cloud ? !checked : !OUTCOMES.includes(given.state))) return bad('bad outcome');
  if (((reading && checked.read) || auto) && !env.READY_KEK) return notSetUp();
  if (auto) await claimAttempt(env, row, String(given.job), checked);
  const live = reading && checked.read && await env.STATS.prepare(`SELECT 1 AS n FROM ready_jobs WHERE batch = ? AND job = ? AND cleared_at IS NULL AND state IN ${LIVE}`).bind(row.id, String(given.job)).first();   // Why (Gitar on #504): a repeated result for a form already read must not overwrite or delete its stored read
  const liveAuto = auto && await env.STATS.prepare(`SELECT 1 AS n FROM ready_jobs WHERE batch = ? AND job = ? AND cleared_at IS NULL AND state IN ${LIVE}`).bind(row.id, String(given.job)).first();
  let kept = live ? checked : null;   // sealed BEFORE the row takes the outcome, so a take can never find a "read" row without its object (code review of 2/4)
  if (kept) { try { await keepRead(env, row, String(given.job), kept.read, now); } catch { kept = null; checked.state = 'failed'; checked.why = 'store'; } }
  if (liveAuto) { try { await keepSubmit(env, row, String(given.job), checked.outcome, now); } catch { checked.state = checked.state === 'submitted' ? 'unknown' : checked.state; checked.why = 'store'; } }   // a press already made is never reported as not made
  const filled = cloud ? null : num(given.filled), left = cloud ? null : num(given.left), state = cloud ? checked.state : given.state === 'prepared' && !(filled > 0 && left === 0) ? 'partial' : given.state;
  const micro = num(given.costMicro) || 0;
  const changed = await env.STATS.prepare(`UPDATE ready_jobs SET state = ?, filled = ?, left_empty = ?, human_check = ?, wall = ?, ms = ?, cost_micro = cost_micro + ?, at = ?, step = NULL, step_n = NULL, again_from = NULL
    WHERE batch = ? AND job = ? AND cleared_at IS NULL AND state IN ${LIVE}`).bind(state, filled, left, !cloud && given.humanCheck ? 1 : 0, cloud ? checked.why : String(given.wall || '').slice(0, 40), num(given.ms), micro, stamp(now), row.id, String(given.job)).run();
  if (!changed.meta?.changes) {   // a form the owner stopped
    if (liveAuto) await env.HOSTED_STATE.delete(keptKey(row.install, 'submit', row.id, String(given.job))).catch(() => {});   // stopped between the check and the update: nothing is kept for it
    if (kept && (await env.STATS.prepare('SELECT state FROM ready_jobs WHERE batch = ? AND job = ?').bind(row.id, String(given.job)).first())?.state !== 'read') await env.HOSTED_STATE.delete(keptKey(row.install, 'read', row.id, String(given.job))).catch(() => {});   // the form was stopped between the check and the update: its read is not kept (a row that holds a read keeps it) (api/ready-line.js) keeps what it was put back to; an unknown one is refused
    const known = await env.STATS.prepare('SELECT 1 AS n FROM ready_jobs WHERE batch = ? AND job = ?').bind(row.id, String(given.job)).first();
    return known ? json({ok: true, dropped: true, stop: false}) : json({ok: false, error: 'unknown job'}, 404);
  }
  // A read within the person's AI credit (no own Claude key): its container seconds come out of the credit meter, and today's budget can end the night (api/ready-read-access.js).
  let spent = false;
  if (auto) await chargeContainer(env, row.install, (num(given.ms) || 0) / 1000 * MICRO_PER_SECOND, now);   // a Pro night: its container seconds come out of its credit, like a read
  if (row.task === 'readiness') {
    const claimed = !!(await readBlob(env, row.install, row.id).catch(() => null))?.ai?.key;
    if (!(claimed && row.own_ok)) await chargeContainer(env, row.install, (num(given.ms) || 0) / 1000 * MICRO_PER_SECOND, now);   // our container is paid from their credit until Anthropic has answered their own key (a made-up key must not read free)
    // a Pro whose credit ran out after its batch was queued is on the Free rules again (Gitar on #510)
    if (await strictNow(env, row) && !(claimed && row.own_ok)) {   // our AI on a non-Pro account (or a key Anthropic never answered): the daily cap; a claimed key's slot (and a Pro-turned-Free one's) is taken now, an unclaimed Free one's was taken at the batch
      const refused = claimed || !row.strict ? await reserveReads(env, row.install, 1, now) : null;
      spent = (await addMicro(env, row.install, micro, now)) || !!refused;
    }
  }
  const total = row.cost_micro + micro, capped = total >= cap(env) || spent;
  if (cloud && capped) await env.STATS.prepare(`UPDATE ready_jobs SET state = ${ENDED}, wall = 'cap', at = ? WHERE batch = ? AND cleared_at IS NULL AND state IN ${LIVE}`).bind(stamp(now), row.id).run();   // a read the cap kept from starting is told to the app as a form it could not read, never left "reading"
  const waiting = (await env.STATS.prepare(`SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ? AND state IN ${LIVE}`).bind(row.id).first()).n;
  const next = capped && !cloud ? 'capped' : waiting ? row.state : 'finished';
  await env.STATS.prepare('UPDATE ready_batches SET cost_micro = ?, state = ?, finished_at = ? WHERE id = ?').bind(total, next, next === row.state ? null : stamp(now), row.id).run();
  if (next !== row.state) await reportNight(env, {...row, cost_micro: total}, now);
  if (next === 'finished') await (cloud ? closeNight(env, row.id) : mailNight(env, row, now));   // the night is over: its one morning mail (api/ready-mail.js); a capped night is mailed when its time ends (api/ready-tick.js), after the forms still filling have reported. A read night holds nothing and mails nothing: its container goes at once, not after 3 h
  return json({ok: true, stop: next !== 'running'});
}

// POST (a night token): one model call for the night's AI answers (api/ready-ai.js); its cost counts toward the night's cap.
async function aiCall(request, env, now) {
  if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
  const row = await batchOf(env, request.headers.get('authorization'), now);
  if (!row) return deny();
  const byok = (await readBlob(env, row.install, row.id).catch(() => null))?.ai?.key || '';
  const stopped = () => env.STATS.prepare('UPDATE ready_batches SET ai_stopped = 1 WHERE id = ?').bind(row.id).run();
  return relay(request, env, row, async (micro, answered = true) => {
    const total = (await env.STATS.prepare('SELECT cost_micro FROM ready_batches WHERE id = ?').bind(row.id).first()).cost_micro + micro;
    if (byok && answered) await env.STATS.prepare('UPDATE ready_batches SET own_ok = 1, own_proof = ? WHERE id = ? AND own_ok = 0').bind(await proofOf(byok), row.id).run();   // Anthropic answered with their key: the reads are theirs, not ours (a made-up key is refused by Anthropic, so `answered` is false)
    const spent = row.task === 'readiness' && !byok && await strictNow(env, row) ? await addMicro(env, row.install, micro, now) : false;   // the page-kind call counts against today's budget too, on our AI and a non-Pro account (or a Pro whose credit ran out)
    const capped = total >= cap(env) || spent;
    await env.STATS.prepare('UPDATE ready_batches SET cost_micro = ?, state = ? WHERE id = ?').bind(total, capped ? 'capped' : row.state, row.id).run();
    if (capped) await reportNight(env, {...row, cost_micro: total}, now);
  }, {byok, stopped, now});
}

// The owner's calls: Done (a job's data deleted), "I submitted it" (his word, from the app's Applied status), the morning's rows, the measure, Delete everything.
async function mine(request, env, now, sub) {
  const linked = sub === 'submitted' && !(await installOf(request, env)) ? await viaLink(request, env, now) : null;   // the page's "I submitted it": the link, for its own job only
  const install = linked || await ownerOf(request, env);
  if (!install) return deny();
  const latest = job => env.STATS.prepare(`SELECT b.id FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND b.task = 'fill' AND j.job = ? ORDER BY b.created_at DESC LIMIT 1`).bind(install, job).first();
  if (sub === 'data' && request.method === 'DELETE') {
    let objects = 0;
    for (const item of (await env.HOSTED_STATE.list({prefix: `ready/${install}/`})).objects || []) { await env.HOSTED_STATE.delete(item.key); objects++; }
    const {results} = await env.STATS.prepare('SELECT id FROM ready_batches WHERE install = ? AND deleted_at IS NULL').bind(install).all();
    let jobs = 0;
    for (const batch_ of results) jobs += await clear(env, install, batch_.id, null, now);
    return json({ok: true, receipt: {objects, jobs}});
  }
  if (sub === 'done' || sub === 'submitted') {
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const given = await request.json().catch(() => null), job = String(given?.job || ''), found = job && await latest(job);
    if (linked && job !== new URL(request.url).searchParams.get('job')) return deny();
    if (!found) return json({ok: false, error: 'unknown job'}, 404);
    if (sub === 'done') return json({ok: true, cleared: await clear(env, install, found.id, [job], now)});
    await env.STATS.prepare('UPDATE ready_jobs SET submitted_at = COALESCE(submitted_at, ?) WHERE batch = ? AND job = ?').bind(stamp(now), found.id, job).run();
    return json({ok: true});
  }
  if (request.method !== 'GET') return json({ok: false, error: 'Use GET'}, 405);
  if (sub === 'state') {
    const night = new URL(request.url).searchParams.get('night');
    const row = night ? await env.STATS.prepare("SELECT * FROM ready_batches WHERE install = ? AND night = ? AND task = 'fill'").bind(install, night).first()
      : await env.STATS.prepare("SELECT * FROM ready_batches WHERE install = ? AND task = 'fill' ORDER BY night DESC LIMIT 1").bind(install).first();
    if (!row) return json({ok: true, batch: null, jobs: []});
    const {results} = await env.STATS.prepare('SELECT job, host, state, filled, left_empty, human_check, wall, ms, submitted_at, cleared_at, step, step_n, started_at FROM ready_jobs WHERE batch = ? ORDER BY job').bind(row.id).all();
    const videos = await jobsWithKept(env, install, 'video', row.id).catch(() => new Set());   // Watch the fill: which rows have the night's video
    return json({ok: true, batch: {night: row.night, state: row.state, costUsd: row.cost_micro / 1e6, expiresAt: row.expires_at, aiStopped: !!row.ai_stopped, why: whyOf(env, row, results, now)}, jobs: results.map(job => ({...job, video: videos.has(job.job)}))});
  }
  if (sub === 'report') {   // the morning line: prepared / reached a form / filled completely / he submitted, per night
    const {results} = await env.STATS.prepare(`SELECT b.night, b.cost_micro, COUNT(*) AS prepared_for, SUM(j.state IN ('prepared','partial')) AS reached, SUM(j.state = 'prepared') AS complete,
      SUM(j.submitted_at IS NOT NULL) AS submitted FROM ready_batches b JOIN ready_jobs j ON j.batch = b.id WHERE b.install = ? AND b.task = 'fill' GROUP BY b.id ORDER BY b.night DESC LIMIT 30`).bind(install).all();
    return json({ok: true, nights: results.map(r => ({night: r.night, costUsd: r.cost_micro / 1e6, queued: r.prepared_for, reached: r.reached || 0, complete: r.complete || 0, submitted: r.submitted || 0}))});
  }
  return notFound();
}

// The cron: batches older than a day lose their data, counts older than 30 days go. -> {swept, purged}
export async function sweep(env, now = new Date()) {
  const out = {swept: 0, purged: 0};
  if (!readyOn(env) || !env.STATS) return out;
  const {results} = await env.STATS.prepare('SELECT id, install, task FROM ready_batches WHERE created_at < ? AND deleted_at IS NULL').bind(stamp(new Date(now.getTime() - KEEP_HOURS * HOUR))).all();
  for (const row of results) {
    // Why (code review of cs 2/4): an auto night's outcome waits for the app however long the Mac is off (a press it never hears of is the worst case); its form data still goes after a day
    if (row.task === 'auto' && await env.STATS.prepare("SELECT 1 AS n FROM ready_jobs WHERE batch = ? AND cleared_at IS NULL AND state IN ('submitted', 'not_submitted', 'unknown', 'failed')").bind(row.id).first()) { await env.HOSTED_STATE.delete(keyOf(row.install, row.id)).catch(() => {}); continue; }
    await clear(env, row.install, row.id, null, now); out.swept++;
  }
  const old = stamp(new Date(now.getTime() - COUNTS_KEEP_DAYS * 24 * HOUR));
  // Why (retro review of web #514, Gitar, 10 Nov 2026): an auto night's outcome the app has not taken (the Mac off past 30 days) is not a count to age out: its row is what tells the app a press happened ("check it"), so the purge
  // leaves those rows and their night until `takeSubmits` clears them (the sealed proof itself still ages out at 30 days: the row then reads `unknown`, never silence). `ready_attempts` is never purged: the one-attempt key
  // of a queued item must outlive every night (api/ready-auto.js), a row of ~100 bytes per press.
  await env.STATS.prepare(`DELETE FROM ready_jobs WHERE batch IN (SELECT id FROM ready_batches WHERE created_at < ?)
    AND NOT (cleared_at IS NULL AND state IN ('submitted', 'not_submitted', 'unknown', 'failed') AND batch IN (SELECT id FROM ready_batches WHERE task = 'auto'))`).bind(old).run();
  out.purged = (await env.STATS.prepare('DELETE FROM ready_batches WHERE created_at < ? AND id NOT IN (SELECT batch FROM ready_jobs)').bind(old).run()).meta?.changes || 0;
  await env.STATS.prepare('DELETE FROM ready_read_days WHERE day < ?').bind(old.slice(0, 10)).run().catch(() => {});   // the day counters of 3/4 go with the counts
  return out;
}

// /api/ready/<batch|result|ai|video|live|handoff|held|link|again|progress|stop|run|done|submitted|state|report|reads|data>
export async function ready(request, env, now = new Date()) {
  if (!readyOn(env)) return notFound();
  const sub = new URL(request.url).pathname.replace(/^\/api\/ready\/?/, '');
  if (sub === 'batch') return batch(request, env, now);
  if (sub === 'result') return result(request, env, now);
  if (sub === 'ai') return aiCall(request, env, now);
  if (sub === 'video' || (sub === 'handoff' && request.method === 'PUT')) {   // api/ready-kept.js: the night's container puts a form's video (Watch the fill) or its hand-off (Open in my browser)
    if (request.method === 'PUT') { const row = await batchOf(env, request.headers.get('authorization'), now); return row ? (env.READY_KEK ? keptPut(request, env, row, sub, now) : notSetUp()) : deny(); }
    const install = await ownerOf(request, env);
    return install ? videoGet(request, env, install) : deny();
  }
  if (['live', 'handoff', 'held'].includes(sub)) { const install = await ownerOf(request, env) || (sub === 'live' ? await viaLink(request, env, now) : null); return install ? morning(request, env, install, sub) : deny(); }   // the live view also opens with the 10-minute link   // the morning: the container's tabs (api/ready-morning.js)
  if (sub === 'link') {   // the owner's app asks for the 10-minute link to one form's live view
    const install = await ownerOf(request, env);
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const job = String((await request.json().catch(() => null))?.job || '');
    return /^[\w.:-]{1,64}$/.test(job) ? json({ok: true, ...(await makeLink(env, job, new URL(request.url).origin, now))}) : bad('bad job');
  }
  if (sub === 'again') {   // a row's Fill again: that form, from the night's own copy (api/ready-again.js)
    const install = await ownerOf(request, env);
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const job = String((await request.json().catch(() => null))?.job || '');
    if (!/^[\w.:-]{1,64}$/.test(job)) return bad('bad job');
    const done = await fillAgain(env, install, job, now);
    return json(done.body, done.status);
  }
  if (sub === 'progress') {   // the container: the step a form is on (api/ready-line.js); `stop` when the owner stopped it
    const night = await batchOf(env, request.headers.get('authorization'), now);
    if (!night) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const done = await progress(env, night, await request.json().catch(() => null), now);
    return json(done.body, done.status);
  }
  if (sub === 'reserve') {   // an auto night's container takes a job's one attempt before its press (api/ready-auto.js): the ceiling is counted here
    const night = await batchOf(env, request.headers.get('authorization'), now);
    if (!night) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const done = await reserve(env, night, await request.json().catch(() => null), now);
    return json(done.body, done.status);
  }
  if (sub === 'reads') {   // the app takes its reads (api/ready-read.js) and its auto outcomes (api/ready-auto.js): removed from the site once taken, so never a GET
    const reader = await readerOf(request, env, ownerOf);
    if (!reader) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const sent = await takeSubmits(env, reader.install, clear, now), reads = await takeReads(env, reader.install, clear, now);   // the outcomes first: a failure after them loses no press
    return json({...reads, submits: sent.submits, pendingSubmits: sent.pending}, 200);
  }
  if (sub === 'stop') {   // the owner, or an Always on install, stops one form ({job}) or the whole night ({}); the latter has only its readiness and auto nights to stop
    const reader = await readerOf(request, env, ownerOf), install = reader?.install;
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const job = String((await request.json().catch(() => null))?.job || '');
    if (job && !/^[\w.:-]{1,64}$/.test(job)) return bad('bad job');
    const done = await stop(env, install, job, now, reader.owner ? null : ['readiness', 'auto']);
    return json(done.body, done.status);
  }
  if (sub === 'run') {   // the owner starts his queued night now (a manual test; the cron would start it at its fill time); an Always on install starts its readiness or auto night
    const reader = await readerOf(request, env, ownerOf), install = reader?.install;
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const task = taskOf((await request.json().catch(() => null))?.task);   // none named: the fill night, as before
    if (!task) return bad('bad task');
    if (!reader.owner && task === 'fill') return deny();
    const autoNo = task === 'auto' ? await autoRefusal(env, install) : null;
    if (autoNo) return json({ok: false, error: autoNo.error}, autoNo.status);
    const done = await runNow(env, install, now, task);
    return json(done.body, done.status);
  }
  return mine(request, env, now, sub);
}
