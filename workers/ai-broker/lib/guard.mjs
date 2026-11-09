// Refuses a reply (or a failure's detail) that would carry the broker's own login out: the last layer when a prompt injection (PR text, a web page) talks a model into printing a credential.
// Design (10 Nov 2026, owner: "Match the real login"):
//   Protects: the login never leaves in an answer. The login = the Codex auth.json's tokens (Durable Object `login`) and the Claude subscription token (Worker secret CLAUDE_CODE_OAUTH_TOKEN).
//   One owner: this file. worker.js hands it those values on every check; nothing else decides what is a credential.
//   Verdict: `reply-refused: <why>` = "refused" (bd's walk): the call ends, no other engine is asked the same prompt.
//   Refused: any PIECE-long part of a login value, raw, base64 (any alignment), base64url or hex; plus the shapes refused always (a JWT, a login field name, an API key). Everything else passes, a long web link included.
// Why (10 Nov 2026, replaces #498's "copied from the caller's text" exception and the 100+ character base64-shape rule): a web search's links never sit in the caller's text, and the shape refused 4 of 9 lost Find jobs recordings (gi, run 42504935930).
// Why (28 Oct 2026, Gitar on #2375): a read-only sandbox blocks writes, not reads; shell tool off + unprivileged user + egress list + this refusal are the layers.
const MAX_REPLY = 20000;
const SHAPES = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, 'a JWT'],
  [/"?(refresh_token|access_token|id_token|OPENAI_API_KEY)"?\s*[:=]/i, 'a login field name'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
];
/**
 * The piece length matched. Why (10 Nov 2026): 24 random base64 characters are 144 bits, so no honest text holds one by chance, and the prefix every token of a kind shares (`sk-ant-oat01-`, 13) is shorter;
 * every login value is several pieces long (Claude's token ~108 characters, the OpenAI tokens 60 to 2,000), so a quarter of a token is already caught. A value shorter than a piece is skipped (no login is that short); the account id under `tokens` (a UUID) is kept: not a credential, but refusing it costs nothing.
 */
export const PIECE = 24;

/**
 * The login values the guard refuses, from the stored Codex auth.json text and the Claude token: every string under `tokens` (the account id too), the API key, the Claude token; each PIECE characters or longer.
 * A login that is not JSON is taken whole: never skipped. Never logged or returned anywhere but to refuseReply.
 */
export function loginValues(authFile, claudeToken) {
  const values = [];
  const walk = node => { if (typeof node === 'string') values.push(node); else if (node && typeof node === 'object') Object.values(node).forEach(walk); };
  if (typeof authFile === 'string' && authFile) {
    let auth = null;
    try { auth = JSON.parse(authFile); } catch { values.push(authFile); }
    if (auth && typeof auth === 'object') { walk(auth.tokens); walk(auth.OPENAI_API_KEY); }
  }
  walk(claudeToken);
  return values.filter(value => value.length >= PIECE);
}

const bytesOf = text => new TextEncoder().encode(text);
const base64 = bytes => { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/=+$/, ''); };
/** A value as it may be written out: raw, hex both cases, and base64 / base64url from each of the 3 byte alignments (the value sits at any offset of what was encoded). */
function formsOf(value) {
  const bytes = bytesOf(value), hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const forms = [value, hex, hex.toUpperCase()];
  for (const skip of [0, 1, 2]) { const encoded = base64(bytes.subarray(skip)); forms.push(encoded, encoded.replaceAll('+', '-').replaceAll('/', '_')); }
  return forms;
}

let cached = {key: null, pieces: new Set()};
/** Every PIECE-long part of every form of the values; the last set is kept while the login does not change (it rotates rarely, the check runs on every reply). */
function piecesOf(values) {
  const key = values.join('\n');
  if (cached.key === key) return cached.pieces;
  const pieces = new Set();
  for (const value of values) for (const form of formsOf(value)) for (let i = 0; i + PIECE <= form.length; i++) pieces.add(form.slice(i, i + PIECE));
  cached = {key, pieces};
  return pieces;
}

/**
 * Takes the reply text and the login values (loginValues); returns null when it is fine, else the reason the job shows ("reply-refused: <why>"). Never returns the matched text.
 * Invariant: no PIECE-long part of the login leaves, in any form formsOf lists; the fixed shapes are refused whether or not a login is known.
 */
export function refuseReply(text, login = []) {
  const s = String(text ?? '');
  if (s.length > MAX_REPLY) return `reply-refused: over ${MAX_REPLY} characters`;
  for (const [shape, what] of SHAPES) if (shape.test(s)) return `reply-refused: looks like ${what}`;
  const pieces = piecesOf(login);
  if (pieces.size) for (let i = 0; i + PIECE <= s.length; i++) if (pieces.has(s.slice(i, i + PIECE))) return 'reply-refused: holds the login';
  return null;
}
