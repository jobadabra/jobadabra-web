// Which engine answers first, and in what order the others follow (docs/superpowers/specs/2026-11-01-ai-broker-design.md, section 2).
// Why (1 Nov 2026, owner: "support claude, codex, or Free AI with just a flag change"): one `ENGINE` var in wrangler.jsonc names the engine that answers first; the rest follow in the fixed ORDER.
import {freeAiConfigured} from './fallback.mjs';

/** The engines a caller or the ENGINE var may ask for first. There is no paid-API engine (owner, 3 Nov 2026: no API keys): `claude-api` is not a name the broker knows. */
export const CHOICES = ['codex', 'claude', 'free-ai'];

/** The engines that may move for doing worse (lib/adapt.mjs): the two subscriptions. */
export const SUBS = ['codex', 'claude'];

/** Fixed order: the two subscriptions, then Free AI with its own day cap. `claude` is the Claude subscription (4/7). */
export const ORDER = ['codex', 'claude', 'free-ai'];

/**
 * Whether an engine can be tried at all in this environment (a step that is not configured is skipped, never failed). Codex's login state is checked by its own step.
 * `claude` (the Claude subscription) needs its token as a Worker secret.
 */
export const configured = (engine, env) => engine === 'codex' ? true : engine === 'claude' ? Boolean(env.CLAUDE_CODE_OAUTH_TOKEN) : engine === 'free-ai' && freeAiConfigured(env);

/**
 * The chain for this environment: `ENGINE` first, the others in ORDER. Unset = codex (today's behaviour). An unknown value is never guessed:
 * the chain stays the default and `warning` says so (shown in /health). `requested` is one call's own choice (body.engine, validated by the caller) and wins over ENGINE for that call;
 * `only` keeps that engine alone, `subs` the two subscriptions (SUBS) with that one first.
 */
export function chainOf(env, requested, demoted = [], only = false, subs = false) {
  const wanted = String(requested ?? env.ENGINE ?? '').trim();
  if (!wanted) return {first: 'codex', chain: behind(ORDER, demoted, env), warning: null};
  if (!CHOICES.includes(wanted)) return {first: 'codex', chain: behind(ORDER, demoted, env), warning: `unknown ENGINE "${wanted.slice(0, 30)}" (codex, claude, free-ai); using codex`};
  // Why (1 Nov 2026, owner: "a CI workflow wants specifically to work with claude. Another one with codex"): `only` is that engine alone, no fallback; the caller gets a refusal naming the reason instead of another engine's answer (a Claude-vs-Codex comparison must not silently mix).
  if (only && requested !== undefined) return {first: wanted, chain: [wanted], warning: null};
  // Why (10 Nov 2026, owner on jobadabra#3703: "Claude should be at any times a replacement. Free AI is good, except when we need higher intelligence models"): `subs` is the two
  // subscriptions alone, the named one first: the night Search check goes on to Claude when Codex is out, and is refused (never answered by Free AI) when both are.
  if (subs && SUBS.includes(wanted)) return {first: wanted, chain: [wanted, ...SUBS.filter(engine => engine !== wanted)], warning: null};
  return {first: wanted, chain: behind([wanted, ...ORDER.filter(engine => engine !== wanted)], demoted, env), warning: null};
}

// A demoted subscription goes right behind the other subscription when that one is configured and was behind it; with no other subscription there is nowhere to move.
function behind(chain, demoted, env) {
  let out = [...chain];
  for (const engine of demoted) {
    const other = SUBS.find(name => name !== engine);
    if (!SUBS.includes(engine) || !configured(other, env) || out.indexOf(engine) > out.indexOf(other)) continue;
    out = out.filter(name => name !== engine);
    out.splice(out.indexOf(other) + 1, 0, engine);
  }
  return out;
}

const dayKey = day => `answered:${day}`, statKey = day => `stats:${day}`;

/**
 * Counts what happened to one engine in this UTC day (kept in storage so an eviction does not reset it): outcome `ok` (answered), `ranOut` (its allowance was used up), `busy` (all its slots were taken for too long, the call went on to the next engine; 3 Nov 2026) or `failed`; `ms` is the answering time.
 * Why (1 Nov 2026, owner: "report if one is doing worse than the other"): /health and the admin AI cost page compare engines by these counts; quality itself is each job's own check, grouped by the `engine` in the reply.
 */
export async function recordOutcome(storage, day, engine, outcome, ms = 0) {
  await storage.transaction(async tx => {
    const stats = await tx.get(statKey(day)) || {};
    const row = stats[engine] ||= {ok: 0, ranOut: 0, failed: 0, ms: 0};
    row[outcome] = (row[outcome] || 0) + 1;   // `busy` is newer than the stored rows
    if (outcome === 'ok') row.ms += Math.round(ms);
    await tx.put(statKey(day), stats);
    if (outcome === 'ok') { const counts = await tx.get(dayKey(day)) || {}; counts[engine] = (counts[engine] || 0) + 1; await tx.put(dayKey(day), counts); }
  });
}

/** For /health: the configured first engine, the chain with each engine's state, today's answered calls and average answer time per engine. No secret. */
export async function engineHealth(storage, env, day, now = Date.now()) {
  const {first, chain, warning} = chainOf(env), counts = await storage.get(dayKey(day)) || {}, stats = await storage.get(statKey(day)) || {};
  const claude = await storage.get('claude:state') || {}, adapt = await storage.get('adapt') || {};
  const state = name => name !== 'claude' ? undefined : !configured('claude', env) ? 'not-configured' : (claude.invalidUntil || 0) > now ? 'token-invalid' : (claude.limitUntil || 0) > now ? 'ran-out' : 'ready';
  return {engine: first, chain: chain.map(name => {
    const row = stats[name] || {ok: 0, ranOut: 0, failed: 0, ms: 0};
    return {name, configured: configured(name, env), ...(state(name) ? {state: state(name)} : {}), answeredToday: counts[name] || 0, ranOutToday: row.ranOut, busyToday: row.busy || 0, failedToday: row.failed, avgMs: row.ok ? Math.round(row.ms / row.ok) : null,
      ...(name === 'claude' && claude.limits ? {limits: claude.limits} : {}), ...(name === 'claude' && claude.lastError ? {lastError: {at: new Date(claude.lastError.at).toISOString(), text: claude.lastError.text}} : {}), ...((adapt.demoted?.[name] || 0) > now ? {demotedUntil: new Date(adapt.demoted[name]).toISOString()} : {})};
  }), ...(warning ? {warning} : {})};
}
