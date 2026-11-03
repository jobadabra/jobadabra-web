// Which install a key names, for the two routes an Always-on repo on GitHub may call: GET /api/trial/status and POST /api/notify/email.
// Why (3 Nov 2026, owner: "Free AI key, I think it's a security and cost risk to let it be copied and mass distribute outside the Jobadabra app"): a repo on GitHub must not hold a key that spends Free AI.
// The app's AI key (JPF1.<install>.<token>, purpose 'ai') spends the install's Free AI budget. The repo key (JPT1.<handle>.<mac>) carries NO install id: <handle> is a random value the site maps to the install in KV,
// so a copy of it names nothing the app's own keys can be derived from (JOB-270, found by the code review of the first version, 3 Nov 2026).
// Minting the repo key needs the install's own AI key, so only the app can ask. Every AI route (shared/free-ai.js, hosted.js, pro.js, promo.js) reads only JPF1 with purpose 'ai': a JPT1 key is refused there by construction.
// Guard: test/shared/trial-key.test.js.
import {authorize, digestOf, equal, tokenFor} from './guard.js';

const parseAi = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };
const handleOf = async (handle, env) => `trialkey:${await digestOf(handle)}`;

/** The install a trial-status or notify request names, by the key in x-api-key (the app's JPF1 key or an Always-on repo's JPT1 key).
 *  -> {ok, who, install} or null (unknown tag, bad token, a handle nobody minted, a revoked install). */
export async function installOfTrialKey(key, env) {
  const [tag, first, second] = String(key || '').split('.');
  if (tag === 'JPF1') { const given = parseAi(key); const access = given && await authorize(env, given.install, given.token, 'ai'); return access?.ok ? {...access, install: given.install} : null; }
  if (tag !== 'JPT1' || !/^[0-9a-f]{32}$/.test(first || '') || !second || !env.WAITLIST) return null;
  if (!equal(second, await tokenFor(first, env, 'trial'))) return null;
  const install = await env.WAITLIST.get(await handleOf(first, env));
  if (!install) return null;
  const access = await authorize(env, install, await tokenFor(install, env, 'ai'), 'ai');   // the install's own state (revoked or not); the token never leaves this function
  return access.ok ? {...access, install} : null;
}

/** POST /api/install-token {install, purpose: 'trial'} with x-api-key = the install's own JPF1 key: the repo key for that install, the same one every time (the handle is kept per install).
 *  -> a Response: {ok: true, key: 'JPT1.<handle>.<mac>'}, or 401 without proof of the install, or 503 without KV. */
export async function mintTrialKey(request, env, install) {
  const given = parseAi(request.headers.get('x-api-key'));
  if (!given || given.install !== install || !(await authorize(env, install, given.token, 'ai')).ok) return Response.json({ok: false, error: 'unauthorized'}, {status: 401});
  const kv = env.WAITLIST;
  if (!kv) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  let handle = await kv.get(`trialkey-of:${install}`);
  if (!handle) {
    handle = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    await kv.put(await handleOf(handle, env), install);
    await kv.put(`trialkey-of:${install}`, handle);
  }
  return Response.json({ok: true, key: `JPT1.${handle}.${await tokenFor(handle, env, 'trial')}`});
}
