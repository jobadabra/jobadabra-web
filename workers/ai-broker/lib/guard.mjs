// Refuses a Codex reply that could carry the login out: the last layer when a prompt injection (PR text, a screenshot) talks the model into printing a credential.
// Why (28 Oct 2026, Gitar on #2375): a read-only sandbox blocks writes, not reads; shell tool off + unprivileged user + egress list + this refusal are the layers.
const MAX_REPLY = 20000;
// Token-shaped: a JWT (eyJ.xxx.yyy), a long unbroken base64/url-safe run, or the login file's own field names.
const SHAPES = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, 'a JWT'],
  [/[A-Za-z0-9+/_-]{100,}={0,2}/, 'a long base64 run', 'copied'],   // 'copied': the one shape a run copied from the caller's text may pass (a link path); a login field name or a key never does
  [/"?(refresh_token|access_token|id_token|OPENAI_API_KEY)"?\s*[:=]/i, 'a login field name'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
];

/**
 * Takes the reply text and, optionally, the text the caller sent; returns null when it is fine, else the reason word the job shows ("reply-refused: <why>"). Never returns the matched text.
 * Invariant: only a long base64-shaped run may pass, and only when the caller's own text holds it verbatim; the login never sits in what a caller sends, so a run the model copied from its input cannot be the login. JWTs, login field names and keys are refused always.
 */
export function refuseReply(text, sent = '') {
  const s = String(text ?? ''), given = String(sent ?? '');
  if (s.length > MAX_REPLY) return `reply-refused: over ${MAX_REPLY} characters`;
  // Why (8 Nov 2026, Find jobs recordings of personas 6 and 12): 3 scout answers were refused as "a long base64 run" while the same prompts answered on retry; a careers-link pick copies the page's links "exactly from the list", and a link path of 100+ letters, digits, '/' and '-' has that shape.
  for (const [shape, what, copied] of SHAPES) {
    if (!copied) { if (shape.test(s)) return `reply-refused: looks like ${what}`; continue; }
    for (const [run] of s.matchAll(new RegExp(shape.source, 'g'))) if (!given.includes(run)) return `reply-refused: looks like ${what}`;
  }
  return null;
}
