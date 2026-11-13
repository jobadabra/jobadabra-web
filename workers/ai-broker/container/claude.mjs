// The Claude Code CLI as an engine of the AI broker (docs/superpowers/specs/2026-11-01-ai-broker-design.md, section 3): argument, input and output handling, kept pure so a test can run it offline.
// Measured 1 Nov 2026 with the real CLI 2.1.316 on the owner's subscription token (hello@jobadabra.top, Max):
// - `--bare` is refused with an OAuth token ("Not logged in"): never use it.
// - the default setup sends ~28-39k cached tokens per call; `--setting-sources "" --disable-slash-commands --strict-mcp-config` and an own system prompt cut a "pong" call to ~390 input tokens.
// - images work as base64 content blocks over `--input-format stream-json`, so the CLI needs no file-reading tool (`--tools ""`).
// - with `--json-schema` the final `result` is the JSON text (and `structured_output` the parsed object).
// - the stream carries a `rate_limit_event` with the subscription windows: {status, unifiedWindows: {five_hour|seven_day: {utilization, resetsAt, status}}}.

export const SYSTEM_PROMPT = "You are a helpful assistant. Follow the user's instructions exactly.";   // Why: an own, short prompt replaces Claude Code's default coding prompt; it must not shape answer length (the lean test used "Answer briefly." only to keep the reply short)
const MEDIA = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif'};

// Why (2 Nov 2026, the first digest call that the Claude engine took after Codex ran out): the real daily-digest prompt (145 PRs, 70k characters, 27k input tokens) takes Claude 85-117 s on this account, 72-105 s of it thinking, 20-29k output tokens. The same call measured with `--effort low` (85 s) and `MAX_THINKING_TOKENS=0` (no change: still 105 s of thinking) did not get shorter, so a call that long cannot be cut short from outside (a small call does think less at --effort low: claudeArgs, 13 Nov 2026). The Codex kill at 100 s killed it at 103 s ("claude-failed:null ... thinking_duration_ms 95200"). Callers wait 180 s (desktop/e2e/lib/broker-client.mjs), so a Claude call gets 150 s.
export const CLAUDE_TIMEOUT_MS = 150000;

/**
 * The CLI arguments of one call: no tools, no settings, no slash commands, no MCP, no saved session; the model is a full id (claude-haiku-5-5, ...).
 * Why (2 Nov 2026, owner: "Web search on Claude"): a call with `search` gets exactly one tool, WebSearch, allowed up front (nothing to ask in -p mode); no shell, no page fetching, no file access.
 * Measured live with the real CLI on the subscription token: 22.5 s, a cited answer, WebSearch the only tool used.
 * `effort` (low|medium|high|xhigh, optional) becomes `--effort`; without it the CLI picks its own default.
 */
export function claudeArgs({model, schema, search = false, effort}) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', ...(search ? ['WebSearch', '--allowedTools', 'WebSearch'] : ['']), '--no-session-persistence',
    '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', SYSTEM_PROMPT, '--model', String(model)];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  // Why (13 Nov 2026, cx; sa: "build that PR"): the app runs Haiku at --effort low and Sonnet at medium (src/ai/engine.py effort_for); the broker dropped the caller's effort, so CI's calls thought more than the app's.
  // Measured on the owner's plan, same prompts, effort sent vs not: title triage (Haiku) p50 5.7 vs 7.0 s and 877 vs 1282 thinking tokens; right answers equal on every question (title 48/48, place 22/22 vs 20/20, score 34/35 vs 35/35, visit 1 vs 1 "no" kept in 10).
  if (effort) args.push('--effort', String(effort));   // the Worker already refused any value outside lib/tiers.mjs EFFORTS
  return args;
}

/** The one stream-json line that is the whole prompt: text first, then each image as a base64 block. Throws 'unsupported image' for a name or data it cannot send. */
export function claudeInput({prompt, images = []}) {
  const content = [{type: 'text', text: String(prompt)}];
  for (const image of images) {
    const media = MEDIA[String(image.name || '').split('.').pop().toLowerCase()];
    if (!media || typeof image.base64 !== 'string') throw new Error('unsupported image');
    content.push({type: 'image', source: {type: 'base64', media_type: media, data: image.base64}});
  }
  return `${JSON.stringify({type: 'user', message: {role: 'user', content}})}\n`;
}

const AUTH = /not logged in|please run \/login|invalid (x-api-key|api key|token|bearer|authentication)|oauth token.*(expired|revoked|invalid)|authentication[_ ]error|\b401\b|unauthori[sz]ed/i;
const LIMIT = /usage limit|limit reached|hit your .{0,30}limit|out of (extra )?usage|rate[ _-]?limit|too many requests|\b429\b/i;

/**
 * Reads the CLI's stream-json output. Returns {reply, tokens: {input, cached, cacheWritten, output}, limits} on success (`input` includes both cache parts), or {error: 'claude-auth' | 'claude-limit' | 'claude-failed:<code> <tail>', resetsAt?}.
 * "Ran out" is read from the stream's own rate_limit_event when it says the window is not allowed, else (only when no status was seen) from the error text; anything unknown is a plain failure (never guessed as "ran out").
 */
export function readClaude(stdout, stderr = '', code = 0, timedOut = false) {
  let result = null, info = null;
  for (const line of String(stdout).split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'result') result = event;
    else if (event.type === 'rate_limit_event' && event.rate_limit_info) info = event.rate_limit_info;
  }
  const windows = info?.unifiedWindows || {};
  const limits = info ? {status: info.status, fiveHour: windows.five_hour ?? null, sevenDay: windows.seven_day ?? null} : null;
  if (result && !result.is_error && typeof result.result === 'string' && result.result.trim()) {
    const usage = result.usage || {};
    // Why (5 Nov 2026, a8, owner: "yes. Let's do" on measuring Claude's caching): `input` keeps folding both cache parts in (the week meter and the tally read it, unchanged); `cached` (read from the cache, Codex's meaning) and `cacheWritten` (stored in it) are only exposed, so a run's real cached share can be read.
    const read = usage.cache_read_input_tokens || 0, written = usage.cache_creation_input_tokens || 0;
    return {reply: result.result, tokens: {input: (usage.input_tokens || 0) + written + read, cached: read, cacheWritten: written, output: usage.output_tokens || 0}, limits};
  }
  if (timedOut) return {error: `claude-failed:timeout after ${CLAUDE_TIMEOUT_MS / 1000} s`, limits};   // killed by our timer: say so, not the tail of its stream
  const text = String(result?.result || stderr || stdout).replace(/\s+/g, ' ');
  if (info && info.status && !['allowed', 'allowed_warning'].includes(info.status)) return {error: 'claude-limit', resetsAt: info.resetsAt ?? null, limits};
  if (AUTH.test(text)) return {error: 'claude-auth', limits};
  // Why (Gitar on #291): when the stream said the window is allowed, a "429 / too many requests" text is a passing throttle, not an empty allowance: a plain failure, tried again next call. The message is trusted only when no status was seen, and then no reset time is borrowed.
  if (!info && LIMIT.test(text)) return {error: 'claude-limit', resetsAt: null, limits};
  return {error: `claude-failed:${code} ${text.slice(-200)}`, limits};
}
