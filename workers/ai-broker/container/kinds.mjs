// The container names WHY a call failed, in one word, so the Worker never reads error text (design "the life of one AI call", owner 8 Nov 2026: "Yes, codes (Recommended)").
// Kinds: out-of-quota (the plan's allowance is used up), at-capacity (the model server turned the run away), login-lost (the Codex login or Claude token is no good), stalled (the guard killed it), failed (anything else).
// Why (8 Nov 2026, bd): these were regexes in the Worker (lib/fallback.mjs `exhausted`, `overloaded`, #406) and string compares ('login-lost', 'claude-auth', 'claude-limit'); a model that words an error differently silently became "failed". Now the words live in this one file, next to the CLI that says them, with their tests.

/** The server's own words in a failed Codex run's text: the last "message" of its JSON event stream, else the text without its `codex-failed:<code>` prefix; one line. */
export function codexMessage(why) {
  const said = [...String(why ?? '').matchAll(/"message":"((?:[^"\\]|\\.)*)"/g)].map(found => { try { return JSON.parse(`"${found[1]}"`); } catch { return found[1]; } });   // a cut-off escape keeps the raw text
  return (said.length ? said.at(-1) : String(why ?? '').replace(/^codex-failed:\d+\s*/, '')).replace(/\s+/g, ' ').trim();
}

/** One word for an error text: 'out-of-quota' | 'at-capacity' | 'login-lost' | 'stalled' | 'failed'. Takes the text a Codex or Claude run failed with (Claude's own coded words included). */
export function kindOf(error) {
  const text = String(error ?? '');
  if (text === 'login-lost' || text === 'claude-auth') return 'login-lost';
  if (text === 'claude-limit' || /usage[ _-]limit|usage_limit_reached/i.test(text)) return 'out-of-quota';
  if (/\[killed after \d|claude-failed:timeout/.test(text)) return 'stalled';
  if (/\bat capacity\b|overloaded|high demand|capacity[ _]unavailable/i.test(codexMessage(text))) return 'at-capacity';
  return 'failed';
}
