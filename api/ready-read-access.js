// Cloud browser runner 3/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): who may start a readiness night, and what it may cost.
// Owner, 8-9 Nov 2026 (via the coordinator, "asked via AskUserQuestion"): access "Any user, no matter Free or Pro. But within their AI credit."; "We should have a cap" = "30 reads, $0.15/day (Recommended)";
// "In the end, we care about AI credit": a read's whole cost (container seconds and the page-kind calls) comes out of the person's AI credit, the same meter as every other AI call.
// Invariants: only the readiness task opens to an Always on install; Ready to send's own routes stay the owner's.
// Design (owner, 10 Nov 2026, asked via AskUserQuestion: "The daily cap makes sense only on Free Trial and on Free AI... on Pro... They should go unlimited and as fast, within their AI credit"; "Abuse-only ceiling"):
//   - The daily cap (30 reads, $0.15) is for a night whose AI is OURS and whose account is not Pro: a Free trial on Free AI. It is taken at the batch, so the person hears it at once.
//   - Pro (any AI) has no daily cap; on our AI its credit is the bound.
//   - A claimed own key (batch.ai.key) is not trusted: the lane follows who PAYS. The night's first model call answered by Anthropic with that key flips ready_batches.own_ok; until then a trial's read takes a slot of the daily cap
//     when its result arrives, so a made-up key reads 30 forms and stops like Free AI does. Once proven, the person's reads are theirs.
//   - Every claimed key has an abuse-only ceiling (about 500 reads a day), not a product limit: a broken loop is caught, and the owner is told once a day through the switchboard (event ready-read-ceiling).
// A read is never logged here. Guard: test/unit/api/ready/ready-read-access.test.js.
import {installOf} from '../shared/hosted.js';
import {chargeCall, proLane} from '../shared/pro-ai.js';
import {allowanceOf, busyCap, count, installCap, keysOf, limitsOf, who} from '../shared/free-ai.js';
import {tokenFor} from '../shared/guard.js';
import {notify} from '../shared/notify.js';

export const DAY_READS = 30, DAY_MICRO = 150_000;   // one install's reads and micro-USD per UTC day
export const MICRO_PER_SECOND = 12;   // what the night prices a container second at (desktop/ready-fill/night.mjs costMicro), the figure result.costMicro carries
const num = value => (Number(value) > 0 ? Number(value) : 0);
export const OWN_READS = 500;   // the abuse-only ceiling on a claimed own key (owner, 10 Nov 2026: "about 500 reads/day")
export const ownReads = env => num(env.READY_READ_OWN_MAX) || OWN_READS;
export const dayReads = env => num(env.READY_READ_DAY_MAX) || DAY_READS;
export const dayMicro = env => Math.round(num(env.READY_READ_DAY_USD) * 1e6) || DAY_MICRO;
const dayOf = now => now.toISOString().slice(0, 10);

/** A form an Always on install queues is a public https page: not a bare IP, localhost or an internal name (the container must never be a way into its own network). A name is judged by its text only: the Worker cannot resolve it, so a name an attacker's own DNS points at a private address is for the container's egress to refuse. Pure. */
export function publicHost(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return false; }   // "localhost." is localhost (Gitar on #508)
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|traefik\.me)$/.test(host)) return false;   // wildcard DNS names that answer with the IP written in them
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || /^\d+$/.test(host)) return false;   // an IP literal, v6 or v4 (decimal forms included)
  return host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host);
}

/**
 * -> {install, owner} for the owner (`ownerOf`, ready.js) or any install with a valid key of its own; null otherwise. Owner, 9 Nov 2026 (asked via AskUserQuestion "Other", relayed by the coordinator): "The fact that they run on Github
 * on our hosted CloudFlare server... it doesn't care." Whether the person's Always on runs on their own GitHub or on our servers, the site cannot tell and does not need to: the credit check and the day cap bound every install.
 * READY_READ_OPEN = off closes it (a kill switch for the cost).
 */
export async function readerOf(request, env, ownerOf) {
  const owner = await ownerOf(request, env);
  if (owner) return {install: owner, owner: true};
  if (env.READY_READ_OPEN === 'off') return null;
  const install = await installOf(request, env);
  return install ? {install, owner: false} : null;
}

/** Before a readiness night is queued: the person's AI credit must not be used up (Pro credit, a credit code, or Free's trial, month and day lines). -> null, or {status, error}. */
export async function creditRefusal(env, install, now = new Date()) {
  const lane = await proLane(env, install);
  if (lane?.blocked) return {status: 402, error: lane.blocked};
  if (env.FREE_AI === 'off' && !lane) return {status: 503, error: 'Free AI is paused right now. You can add your own key in Settings → Connections → AI.'};   // the same kill switch as every Free AI call (Gitar on #508)
  if (lane || !env.WAITLIST) return null;
  const access = await who(`JPF1.${install}.${await tokenFor(install, env, 'ai')}`, env, now);
  if (!access) return null;
  const day = dayOf(now), keys = keysOf(access.who, day, day.slice(0, 7), now.toISOString().slice(0, 16));
  const [life, installMonth, installDay, tokens, microUsd, globalMonth] = await Promise.all([keys.life, keys.monthUsd, keys.dayUsd, keys.tokens, keys.usd, keys.globalMonth].map(key => count(env.WAITLIST, key)));
  const lines = limitsOf(env);
  const busy = busyCap(lines, {microUsd, globalMonth, seen: 0, allowance: allowanceOf(env)});   // Free AI's global day and month stops: every install waits, as it does for any Free AI call
  if (busy) return {status: busy.status, error: busy.message};
  const capped = installCap(lines, access, {life, installMonth, installDay, tokens});
  return capped ? {status: 402, error: capped.message} : null;
}

/** Takes `n` reads of today's cap in one statement (a second batch cannot slip in between a check and a write). -> null, or {status: 429, limit, used, error}. */
export async function reserveReads(env, install, n, now = new Date()) {
  const day = dayOf(now), max = dayReads(env), usd = dayMicro(env);
  const changed = n <= max && await env.STATS.prepare(`INSERT INTO ready_read_days (install, day, reads) VALUES (?, ?, ?) ON CONFLICT (install, day) DO UPDATE SET reads = reads + excluded.reads
    WHERE reads + excluded.reads <= ? AND micro < ?`).bind(install, day, n, max, usd).run();
  if (changed?.meta?.changes) return null;
  const row = await env.STATS.prepare('SELECT reads, micro FROM ready_read_days WHERE install = ? AND day = ?').bind(install, day).first();
  const spent = (row?.micro || 0) >= usd;
  return {status: 429, limit: max, used: row?.reads || 0, error: spent ? "Today's cloud checks used their budget. They start again tomorrow (00:00 UTC)." : `Today's cloud checks are used up (${row?.reads || 0} of ${max} forms). They start again tomorrow (00:00 UTC).`};
}

/** Adds what a read cost to today's counter. -> true when today's budget is now used up (the night stops). */
export async function addMicro(env, install, micro, now = new Date()) {
  const day = dayOf(now);
  if (micro > 0) await env.STATS.prepare('INSERT INTO ready_read_days (install, day, micro) VALUES (?, ?, ?) ON CONFLICT (install, day) DO UPDATE SET micro = micro + excluded.micro').bind(install, day, Math.round(micro)).run();
  const row = await env.STATS.prepare('SELECT micro FROM ready_read_days WHERE install = ? AND day = ?').bind(install, day).first();
  return (row?.micro || 0) >= dayMicro(env);
}

/**
 * Books the container's seconds of one read on the person's AI credit meter: a Pro account or credit code through chargeCall (shared/pro-ai.js), a Free install on its own lines (day, month, trial: the counters
 * shared/free-ai.js enforces). The page-kind call is already booked by Free AI itself; only the container seconds are added here. Never throws: a meter that cannot be written must not lose the read.
 */
export async function chargeContainer(env, install, micro, now = new Date()) {
  micro = Math.round(micro);
  if (!(micro > 0)) return;
  try {
    const lane = await proLane(env, install);
    if (lane && !lane.blocked) return void await chargeCall(env, lane, micro, 'ready-read', now);
    if (lane || !env.WAITLIST) return;
    const access = await who(`JPF1.${install}.${await tokenFor(install, env, 'ai')}`, env, now);
    if (!access) return;
    const day = dayOf(now), keys = keysOf(access.who, day, day.slice(0, 7), now.toISOString().slice(0, 16)), kv = env.WAITLIST;
    const [installDay, installMonth, life, global] = await Promise.all([keys.dayUsd, keys.monthUsd, keys.life, keys.usd].map(key => count(kv, key)));
    await Promise.all([kv.put(keys.dayUsd, String(installDay + micro), {expirationTtl: 2 * 86400}), kv.put(keys.monthUsd, String(installMonth + micro), {expirationTtl: 40 * 86400}),
      kv.put(keys.life, String(life + micro)), kv.put(keys.usd, String(global + micro), {expirationTtl: 2 * 86400})]);
  } catch { /* the meter is best effort: the night's own cost_micro and /admin/ai/costs still carry it */ }
}

/** True for a Pro account (or a credit code) on its own credit lane: the daily cap does not apply to its nights (api/ready.js stores it as ready_batches.strict = 0). */
export const isPro = async (env, install) => !!(await proLane(env, install));

/**
 * Takes `n` reads of today's abuse-only ceiling for a claimed own key. -> null, or {status: 429, limit, used, error}. The first refusal of a day tells the owner once (switchboard event ready-read-ceiling).
 * A real user never sees it: it only catches a loop that reads without end.
 */
export async function reserveOwn(env, install, n, now = new Date()) {
  const day = dayOf(now), max = ownReads(env);
  const changed = n <= max && await env.STATS.prepare(`INSERT INTO ready_read_days (install, day, own) VALUES (?, ?, ?) ON CONFLICT (install, day) DO UPDATE SET own = own + excluded.own WHERE own + excluded.own <= ?`).bind(install, day, n, max).run();
  if (changed?.meta?.changes) return null;
  const told = await env.STATS.prepare('UPDATE ready_read_days SET own_alerted = 1 WHERE install = ? AND day = ? AND own_alerted = 0').bind(install, day).run().catch(() => null);
  if (told?.meta?.changes) await notify(env, {event: 'ready-read-ceiling', text: `☁️ A cloud readiness install reached its abuse ceiling today (${max} reads on its own AI key): ${install.slice(0, 8)}. Reads stop until 00:00 UTC; a real user does not read this many forms.`}).catch(() => {});
  const row = await env.STATS.prepare('SELECT own FROM ready_read_days WHERE install = ? AND day = ?').bind(install, day).first();
  return {status: 429, limit: max, used: row?.own || 0, error: "Today's cloud checks reached their safety limit. They start again tomorrow (00:00 UTC)."};
}
