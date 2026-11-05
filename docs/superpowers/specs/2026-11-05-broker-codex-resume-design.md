# The broker keeps one Codex conversation per persona goal

> **Verdict:** every AI broker call starts a new Codex thread and pays Codex's own context again: about **11–12k of the ~16.4k tokens** of a persona call. A 250k persona run gets ~15 steps. The broker will keep one Codex conversation per persona goal (`codex exec resume`) and count what each turn *adds* (uncached input + output). Measured on 5 Nov 2026: a resumed turn adds **194–3,716** tokens, not ~16.5k, and hit the cache 4 of 4 times (fresh threads: 2 of 5). Only the AI user agent gets it; every other caller and the Claude path are untouched.

Owner (5 Nov 2026, via mac-32): "We can switch to Claude, but even for Codex, that context should be only once, at the start of the session. So we run a session for 30 mins long, let's say. So we lose that initial context just once." Pick: "Build it for the persona". Plan: `docs/superpowers/plans/2026-11-05-broker-codex-resume.md` (PR 1/2 here, PR 2/2 the caller in the public repo).

## What was measured (5 Nov 2026, Codex 0.162.1, gpt-6-astra, "pong" prompts on this Mac's login)

| call | mode | input | cached | uncached | output |
|---|---|---|---|---|---|
| 1–5 | fresh thread each | 17,383 · 16,543 · 16,543 · 17,383 · 16,543 | 0 · 0 · 11,520 · 17,152 · 0 | 17,383 · 16,543 · 5,023 · 231 · 16,543 | 18 each |
| 1 | resumed, opens the thread | 16,543 | 0 | 16,543 | 18 |
| 2 | resumed | 16,578 | 16,384 | 194 | 18 |
| 3 | resumed | 16,613 | 16,384 | 229 | 18 |
| 4 | resumed | 20,100 | 16,384 | 3,716 | 18 |
| 5 | resumed | 22,747 | 19,968 | 2,779 | 18 |

| steps per 250k run (measured) | tokens per call | steps |
|---|---|---|
| fresh, count everything (today) | 16,897 | 14 |
| fresh, count uncached + output | 11,163 | 22 |
| resumed, count everything | 18,534 | 13 (worse than today) |
| resumed, count uncached + output | 4,710 over 5 calls; 1,748 from call 2 | 53 over 5 calls; ~134 after the opening |

These are "pong" turns with no page view. A real persona step adds its own text (~2.5k) on top. **Two traps found:** (1) `codex exec --json` prints the thread's *running total* as `usage` on a resumed turn (16,543 / 33,121 / 49,734 / 69,834 / 92,581), not the turn's; the broker must subtract. (2) Counting everything makes resuming no better than fresh: the meter must count uncached input.

## Design

**States of one conversation** (key = repository + run id + run attempt + the caller's session id, built from the verified run token):

| state | meaning | Owner |
|---|---|---|
| none | no record | the broker's Durable Object (`sessions` storage value) |
| open | first turn answered, thread on the container's disk | same |
| warm | 2+ turns; the next call resumes it with only the new turn | same |
| ended | the caller said it was the last turn; record and files deleted | same |
| lost | the container no longer has it (sleep, redeploy); the call restarts from the full prompt and says so | the container reports, the Durable Object records |

**Events**

| event | what happens |
|---|---|
| first call of a session | `none` → `open`: a new thread that stays on disk, full prompt |
| next call with a `delta` | `warm`: `codex exec resume`, only the `delta` is sent |
| idle more than 5 minutes | restart from the full prompt (reason `idle`) |
| 120 turns | restart (`turn-cap`) |
| another tier than the record | restart (`tier`); a call with no `delta`: restart (`no-delta`) |
| `endSession: true` | answered, then deleted (`ended`) |
| container sleep or redeploy | its table is empty: restart from the full prompt (`lost`), no error to the caller |
| the turn fails | the record is untouched; a busy model (capacity, limit) keeps the thread, any other failure deletes it |
| another engine answers (Codex at capacity or out) | answered from the full `prompt`; the conversation is left alone |
| the run ends without `endSession` | idle drop (5 min in the container, 1 h in the record) |

**One owner:** the Durable Object decides when a conversation lives (`lib/sessions.mjs`); the container only holds files and a table of "thread ids and running totals" in memory (`container/threads.mjs`). The caller never names a thread id.

**Never shared:** only the workflow `jobadabra/ai-user-agents.yml` (from the verified token) may keep a conversation; the key is built from the signed `repository`, `run_id`, `run_attempt` and the caller's session id. A caller-sent `x-session` header is never forwarded.

**One turn at a time per conversation** (a per-key lock before the slot); other keys and plain calls never wait. At most 8 conversations on the container's disk; opening a 9th drops the longest idle.

## Contract (agreed with ag-ai-user-agents-f1, 5 Nov 2026)

Request fields (optional, persona only; `prompt` stays the full prompt): `session` (`[a-z0-9-]{1,40}`, one per goal), `delta` (text of only the newest user turn; none on the first call), `endSession` (only on a call known to be last).
Reply: `tokens: {input, output, cached, counted}` (`input` is the turn's own, never the running total; `counted` is what the broker meters: input − cached + output for a conversation call, input + output for every other Codex call; Claude and Free AI answers carry no `counted`), and `session: {mode: opened|resumed|restarted|ended, reason?: lost|idle|turn-cap|tier|no-delta}` on a conversation call.

## What counts

- A conversation call counts `input − cached + output` against the lane's week meter, the workflow row and the job row (`tokensOf` reads `counted`). Every other Codex call counts `input + output` as before; the `effort` weight still multiplies.
- Not changed: app users' metering, Free AI caps, the Claude engine, the admission rules (daily cap, week brakes).

<details><summary>Files</summary>

- `workers/ai-broker/lib/sessions.mjs`: who may keep one, plan of the next call, records, `countedOf`, the per-key lock.
- `workers/ai-broker/container/threads.mjs` + `server.mjs`: the in-memory table, `readTurn`, `turnUsage`, resume and cleanup.
- `workers/ai-broker/lib/args.mjs`: `keep` (no `--ephemeral`) and `resume` (`exec resume <id> … -c sandbox_mode="read-only" -`; `exec resume` has no `-s`).
- `workers/ai-broker/worker.js`: the `x-session` header from the verified token, the plan, the lock, the counted meter; `lib/tally.mjs` `tokensOf` prefers `counted`.
- Tests: `test/unit/workers/ai-broker/sessions.test.js` (the trap, persona-only, restarts, lock, header); `container.test.js` loads the new file.

</details>

## Risks and open questions

- **Open question (unexplained, measure after merge):** on the 5-turn run the turn's input grew +3.5k at turn 4 and +2.6k at turn 5 although each turn added a 30-token "pong". Not chased now. The first real persona run after this merges records per-turn `input`, `cached` and `counted` in the trace (ag's row `mode`, the broker's reply); read them for the same jump and decide then.
- A warm thread keeps every earlier page view (the caller's full prompt drops old ones), so the context grows ~2.5k a step, mostly cached. The 120-turn cap stays below the model's 475k window.
- The first call of every goal still costs the opening (~16.5k uncached; 6 goals ≈ 100k of a 250k run). That is the price of independent goals.
- `exec resume` was proven on 0.162.1 for the arguments the broker uses; the sandbox is passed as `-c sandbox_mode` (the thread's stored one also applies). A resumed turn fails like any other when the model is at capacity (#406 passes the call to Claude).
- The Codex week meter counts whole percents; whether the plan really weighs cached input lower is unmeasured. The meter now follows the owner's rule (count what a turn adds); if the week figure drifts, adjust `TOKENS_PER_PERCENT`, not this design.
