// Checks a GitHub Actions OIDC run token (RS256) so only a live run of the owner's own repo can use the broker's Codex login, or call the site's CI routes (Send to AI: admin/feedback-ai.js).
// Moved here from workers/ai-broker/lib/oidc.mjs (3 Nov 2026, fd 7/7): admin/ may import only shared/, and two copies of a signature check would drift; the broker re-exports it.
// Why (28 Oct 2026, owner): the login must never be a GitHub secret (public repo, ~50 parallel jobs: OpenAI's CI rules); jobs prove who they are with the token GitHub mints per run.
// A fork's pull_request run gets no OIDC token at all, so a fork can never spend the owner's allowance.
const ISSUER = 'https://token.actions.githubusercontent.com';
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const json = s => JSON.parse(new TextDecoder().decode(b64(s)));

/**
 * Verifies a run token. Takes the JWT, {jwks: () => Promise<{keys}>, audience (one name or a list), repository, now (ms)}; returns the claims, or throws Error('oidc: <reason>').
 * Checks signature (RS256 against the issuer's published key), issuer, audience, expiry and that the token's repository is one of those allowed (`repository` is one name or a list: the public repo and,
 * since 31 Oct 2026, the private site repo whose scheduled jobs write on the Codex plan).
 */
export async function verifyRunToken(jwt, {jwks, audience, repository, now = Date.now()}) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('oidc: not a JWT');
  let header, claims;
  try { header = json(parts[0]); claims = json(parts[1]); } catch { throw new Error('oidc: unreadable token'); }
  if (header.alg !== 'RS256') throw new Error('oidc: algorithm must be RS256');
  const key = (await jwks()).keys.find(k => k.kid === header.kid);
  if (!key) throw new Error('oidc: unknown signing key');
  const publicKey = await crypto.subtle.importKey('jwk', key, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64(parts[2]), signed))) throw new Error('oidc: bad signature');
  if (claims.iss !== ISSUER) throw new Error('oidc: wrong issuer');
  if (![].concat(audience).includes(claims.aud)) throw new Error('oidc: wrong audience');
  if (!(claims.exp * 1000 > now)) throw new Error('oidc: expired');
  if (![].concat(repository).includes(claims.repository)) throw new Error('oidc: wrong repository');
  return claims;
}

/** GitHub's published signing keys, cached for an hour per isolate. Takes a fetch; returns the JWKS reader verifyRunToken wants. */
export function githubJwks(fetchImpl = fetch) {
  let cached = null, at = 0;
  return async () => {
    if (!cached || Date.now() - at > 3600000) { cached = await (await fetchImpl(`${ISSUER}/.well-known/jwks`)).json(); at = Date.now(); }
    return cached;
  };
}
