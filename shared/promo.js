// Pro promo codes (owner, 25 Oct 2026): POST /api/pro/redeem checks the typed code against the hashes of the codes made on /admin/growth/promo-codes, counts the use against that code's cap and end
// date, and from then on /api/pro/status says Pro for that install while the code is neither revoked nor past its end date. No account, no e-mail, no AI credit; a code of kind 'credit' adds AI credit instead (shared/promo-credit.js). Only a hash of the code is checked; the code is also kept encrypted (PROMO_CODE_KEY) for the owner's page, never in plain text.
// Hidden (404) while PRO_PLAN is off. Guards: test/unit/shared/promo.test.js.
import {authorize, digestOf, equal, flag} from './guard.js';
import {accountOf, promoOn} from './pro.js';
import {redeemCredit} from './promo-credit.js';

export const TRIES_PER_INSTALL = 5, TRIES_PER_IP = 20;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 characters: no 0/O/1/I, and 256 divides by 32, so a random byte maps evenly
const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };
const json = (body, status = 200) => Response.json(body, {status});

export const normalize = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashOf = async (env, code) => digestOf(`${env.STATS_SALT || env.STATS_KEY || 'dev'}:promo:${normalize(code)}`);
// A new code: 12 characters in groups of 4.
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map(b => ALPHABET[b % 32]).join('').replace(/(.{4})(?=.)/g, '$1-');
}
// A code the owner types himself (owner, 25 Oct 2026): letters, digits and dashes, at least 8 of them once normalised (so "ab-cd" and "AB CD" are one code). -> an error text, or null when it is fine.
export const MIN_CODE = 8;
export function customError(code) {
  const text = String(code || '').trim();
  if (!/^[A-Za-z0-9-]+$/.test(text)) return 'A code can only have letters, digits and dashes.';
  if (normalize(text).length < MIN_CODE) return `A code needs at least ${MIN_CODE} letters or digits.`;
  return null;
}
// The code for the owner's page: AES-GCM under a key derived from the Worker secret PROMO_CODE_KEY. No key (or a wrong one) -> nothing is stored / shown, never a plain code.
const aesKey = async env => env.PROMO_CODE_KEY ? crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`promo:${env.PROMO_CODE_KEY}`)), 'AES-GCM', false, ['encrypt', 'decrypt']) : null;
const b64 = bytes => btoa(String.fromCharCode(...bytes)), unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export async function sealCode(env, code) {
  const key = await aesKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12)), data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(code)));
  return `${b64(iv)}.${b64(data)}`;
}
export async function openCode(env, sealed) {
  try {
    const key = await aesKey(env), [iv, data] = String(sealed || '').split('.');
    return key && iv && data ? new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, key, unb64(data))) : null;
  } catch { return null; }
}
export const endOfDay = date => `${date}T23:59:59.999Z`;
const live = (code, now) => !code.revoked_at && Date.parse(code.ends_at) > now.getTime();

// Does this install have Pro by a code that is still good? Keeps "last used" fresh (at most one write an hour).
export async function promoActive(env, install, now = new Date()) {
  if (!env.STATS || !install) return false;
  const row = await env.STATS.prepare('SELECT c.revoked_at, c.ends_at, u.last_seen FROM pro_promo_uses u JOIN pro_promo_codes c ON c.id = u.code WHERE u.install = ?').bind(install).first().catch(() => null);
  if (!row || !live(row, now)) return false;
  if (now.getTime() - Date.parse(row.last_seen) > 3600_000) await env.STATS.prepare('UPDATE pro_promo_uses SET last_seen = ? WHERE install = ?').bind(now.toISOString(), install).run().catch(() => {});
  return true;
}

// Counts one try for `key` in an hour bucket (KV, as the checkout does); -> true when it is over `limit`.
async function over(env, key, limit, now) {
  const slot = `promo:${key}:${now.toISOString().slice(0, 13)}`, used = Number(await env.WAITLIST?.get(slot)) || 0;
  if (used >= limit) return true;
  await env.WAITLIST?.put(slot, String(used + 1), {expirationTtl: 7200});
  return false;
}

// POST /api/pro/redeem {code} with x-api-key: JPF1.<install>.<token> -> {ok: true, already?, credit?: euros (a credit code)} or {ok: false, error: 'wrong' | 'expired' | 'used_up' | 'limit' | 'pro_only' (a credit code on a Free install)}.
export async function redeem(request, env, now = new Date()) {
  if (!promoOn(env) || !env.STATS) return new Response('Not found', {status: 404});
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const given = parseKey(request.headers.get('x-api-key')), access = given && await authorize(env, given.install, given.token, 'ai');
  if (!access?.ok) return json({ok: false, error: 'unauthorized'}, 401);
  const typed = normalize((await request.json().catch(() => ({}))).code);
  if (await over(env, `i:${access.who}`, TRIES_PER_INSTALL, now) || await over(env, `ip:${await digestOf(request.headers.get('CF-Connecting-IP') || 'unknown')}`, TRIES_PER_IP, now)) return json({ok: false, error: 'limit'}, 429);
  const hash = await hashOf(env, typed), codes = (await env.STATS.prepare('SELECT * FROM pro_promo_codes').all()).results || [];
  let hit = null;
  for (const code of codes) if (equal(code.code_hash, hash)) hit = code;   // every hash is compared, so the time does not say which one matched
  if (!typed || !hit || hit.revoked_at) {
    await flag(env, 'promo-wrong', access.who, '', now);
    return json({ok: false, error: 'wrong'}, 400);
  }
  if (!live(hit, now)) return json({ok: false, error: 'expired'}, 400);
  const mine = await accountOf(env, given.install);
  const pro = (mine && mine.status === 'active' && mine.plan === 'pro') || await promoActive(env, given.install, now);
  // AI credit, the plan unchanged (shared/promo-credit.js), for Pro only (owner, 27 Oct 2026: "Only Pro can add AI credit, because if they need that ... they need to pay the
  // Pro version"): a Free install hears pro_only and keeps its code untouched.
  if (hit.kind === 'credit') {
    if (!pro) return json({ok: false, error: 'pro_only'}, 400);
    const result = await redeemCredit(env, given.install, hit, now);
    return json(result, result.ok ? 200 : 400);
  }
  if (pro) return json({ok: true, already: true});
  await env.STATS.prepare('DELETE FROM pro_promo_uses WHERE install = ?').bind(given.install).run();   // an old, dead code of this install gives way
  const made = await env.STATS.prepare('INSERT INTO pro_promo_uses (install, code, at, last_seen) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM pro_promo_uses WHERE code = ?) < ?')
    .bind(given.install, hit.id, now.toISOString(), now.toISOString(), hit.id, hit.cap).run();
  if (!((made?.meta?.changes ?? made?.changes ?? 0) > 0)) return json({ok: false, error: 'used_up'}, 400);
  return json({ok: true});
}
