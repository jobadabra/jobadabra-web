// The one model the broker's Free AI step runs on, how it is asked, and what it costs. Not the app's Free AI (shared/free-ai.js keeps its own table until its own PR).
// Why (8 Nov 2026, fr; owner: "Gemma 4 for every ask"): Qwen3-30B (the old model here) stops answering on 20 Nov 2026 (Cloudflare's planned deprecations, HTTP 410) and thinks past any output ceiling.
// Measured on the repo's fixed Free AI cases (tools/free-ai-*cases, fictional data, 139 calls, 0 errors): extraction 100% right (Qwen3 94%), form answers 88% on the small set (Qwen3 50%) and 83% on the 63 real-sized ones (Qwen3 67%),
// scoring rank 0.94 (Qwen3 0.92), kit 71% (same), the 150-PR digest 6/6; about $0.0005 a call, the same as Qwen3. Limit: 300 requests a minute, like Qwen3 (glm-5.3 has 20 a minute, so it cannot carry a Search check).
// Two things make it work, both measured: thinking off (`enable_thinking: false`), and the JSON schema written into the prompt instead of sent as `response_format`: with the forced schema it looped on blank lines to the token limit (extraction 0% valid).

export const FREE_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const FREE_WINDOW = 256000;   // tokens of context (Cloudflare's model page)
const PRICE = {input: 0.1, output: 0.3};   // USD per million tokens (Cloudflare's list price, 8 Nov 2026)

/** Extra request fields the model needs. */
export const FREE_EXTRAS = {chat_template_kwargs: {enable_thinking: false}};

/** USD for a usage {input_tokens, output_tokens}. */
export const costOf = (usage = {}) => ((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output) / 1e6;

const SCHEMA_ASK = 'Reply with ONE JSON object only, no other text, matching this JSON schema exactly: ';

/** The prompt with the answer's JSON schema written into it. */
export const promptWithSchema = (prompt, schema) => `${prompt}\n\n${SCHEMA_ASK}${JSON.stringify(schema)}`;

/**
 * A reply without the markdown fence the model wraps JSON in (```json … ```). Linear in the reply's length.
 * Why (8 Nov 2026, fr, code review): a trailing-fence regex (`\s*```\s*$`) is quadratic on a long whitespace run, and a model that loops on blank lines produces exactly that (60,000 newlines took 6.5 s of CPU in the worker).
 */
export function stripFence(text) {
  let reply = String(text ?? '').trim();
  const open = /^```(?:json)?\s*/i.exec(reply);
  if (open) reply = reply.slice(open[0].length);
  if (reply.endsWith('```')) reply = reply.slice(0, -3);
  return reply.trim();
}
