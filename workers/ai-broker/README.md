# AI broker

> **One URL that answers every CI, scheduled and benchmark AI call on the owner's subscriptions, never on a paid API key.**
> A GitHub Actions job sends a prompt with its own OIDC token. The broker picks an engine, answers, and counts the call. The engines are Codex (ChatGPT login) first, then Claude (subscription token), then Free AI (Workers AI, $2 a day).

| | |
|---|---|
| URL | `https://jobadabra-ai-broker.jobpilotto.workers.dev` |
| Who may call | GitHub Actions jobs of the repositories in the `REPOSITORY` var (`jobadabra/jobadabra`, `jobadabra-web`, `jobadabra-lab`, and the same three repositories under the org's previous owner), OIDC run token |
| Engines | `codex` → `claude` → `free-ai` (first one set by `ENGINE`, default `codex`) |
| Where it runs | Cloudflare Worker + one Durable Object (`AiBroker`) + one container (4 vCPU, 6 GiB, durable_object policy; `lib/do-container.mjs`) |
| Status | `GET /health` (public, counts and states only, no secret) |
| Deploy | automatic on merge to `main` (`.github/workflows/release-ai-broker.yml`) |
| Design | [`docs/superpowers/specs/2026-11-01-ai-broker-design.md`](../../docs/superpowers/specs/2026-11-01-ai-broker-design.md) |

## What it supports

- ✅ **Plain prompts** and **JSON answers** (`schema`: the reply follows a JSON Schema)
- ✅ **Images** (`images`: base64, Codex and Claude only)
- ✅ **Web search** (`search: true`, Codex and Claude only)
- ✅ **Three tiers**, mapped to the same level on each engine: `small` / `mid` (default) / `large`
- ✅ **Reasoning effort** for Codex: `low`, `medium`, `high`, `xhigh`
- ✅ **Engine choice per call**: ask for one engine first, only one engine, or only the two subscriptions
- ✅ **Fallback**: when an engine runs out, is busy or fails, the next one answers. The reply says which engine answered and why the others did not (`fellBack`)
- ✅ **Lanes and priority**: PR checks always go before scheduled work and benchmarks
- ✅ **Kept conversations** (Codex) for the persona runs: only the new turn is sent, not the whole prompt again
- ✅ **Counts** per workflow, job, engine and day, shown on `/health` and the admin AI cost page
- ❌ No paid API keys, no `claude-api` engine (owner, 3 Nov 2026)
- ❌ Not for the desktop app or end users: callers are CI jobs only

## Call it from a GitHub Actions job

The job needs `permissions: id-token: write`. It asks GitHub for a run token with the audience `jobadabra-ai-broker` and posts the call:

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - run: |
      TOKEN=$(curl -sS -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
        "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=jobadabra-ai-broker" | jq -r .value)
      curl -sS -X POST https://jobadabra-ai-broker.jobpilotto.workers.dev/call \
        -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
        -H "x-jobadabra-job: $GITHUB_JOB" \
        -d '{"prompt": "Say hello in French.", "tier": "small"}'
```

In Node, use the public repo's client `desktop/e2e/lib/broker-client.mjs`. It gets the token, sends the job header and waits up to 180 s.

## API

### `POST /call`

**Headers**

| Header | Required | Meaning |
|---|---|---|
| `Authorization: Bearer <OIDC run token>` | yes | GitHub's per-run token, audience `jobadabra-ai-broker`, from an allowed repository |
| `content-type: application/json` | yes | |
| `x-jobadabra-job` | no | the job name to count the call under (`$GITHUB_JOB`) |

The **lane** comes from the verified token, never from the caller: `pr` (a `pull_request` event), `byhand` (a by-hand Search check or press tape), `drift` (`ai-answer-drift.yml`), `bench` (a workflow named like "bench"), else `scheduled`.

**Body**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `prompt` | string | required | the question |
| `schema` | object | none | a JSON Schema; the reply is JSON that follows it |
| `images` | `[{name, base64}]` | `[]` | images sent with the prompt (Codex and Claude) |
| `search` | boolean | `false` | allow web search (Codex and Claude; Free AI never answers a search) |
| `tier` | `small` \| `mid` \| `large` | `mid` | model level (table below) |
| `effort` | `low` \| `medium` \| `high` \| `xhigh` | the CLI's default | Codex reasoning effort; `high` counts 2×, `xhigh` 4× in the meter |
| `engine` | `codex` \| `claude` \| `free-ai` | `ENGINE` var | the engine to ask first for this call |
| `only` | boolean | `false` | with `engine`: that engine alone; refused (503) instead of another engine answering |
| `subs` | boolean | `false` | with `engine` = `codex` or `claude`: the two subscriptions only, that one first, never Free AI |
| `session` | string | none | conversation id, for the persona workflow only (below) |
| `delta` | string | none | with `session`: only the new turn |
| `endSession` | boolean | none | with `session`: close the conversation |

**Tiers**

| Tier | Codex | Claude |
|---|---|---|
| `small` | gpt-6-luna | Haiku |
| `mid` (default) | gpt-6.1-sol | Sonnet |
| `large` | gpt-6-astra | Opus |

Callers name a tier, never a model. The Claude ids live in `shared/pro-claude.js`.

**Reply 200**

```json
{
  "reply": "Bonjour !",
  "tokens": {"input": 812, "output": 4},
  "ms": 3520,
  "lane": "pr",
  "tier": "small",
  "model": "claude-haiku-5-5",
  "engine": "claude",
  "weekUsedPercent": 100,
  "fellBack": [{"engine": "codex", "why": "ran-out"}]
}
```

`fellBack` is there only when an engine before the one that answered did not answer. With `schema`, `reply` is the JSON text.

**Errors** (always `{"why": "..."}`)

| Status | When |
|---|---|
| 400 | a bad field: unknown `tier`, `effort` or `engine`, `only` without `engine`, `subs` with a wrong engine, `search` not a boolean |
| 401 | no run token, a wrong audience, or a repository that is not allowed |
| 422 | the answer was refused by the guard (it held the broker's login, a JWT or a key) |
| 429 | a cap: the day cap of a counted lane, the Claude week line, or every engine's week used up |
| 502 | the engine failed (`why` is its own error, with any key or token withheld) |
| 503 | `no-login` / `login-lost` (Codex needs the owner), or `only-<engine>: …` / `subs: …` when the engines a call allows cannot answer |

### `GET /health`

Public; counts and states only. Read it before a big run to see the room left.

| Field | Meaning |
|---|---|
| `state` | `ready` (login stored and answered since the last start), `starting`, `no-login`, `login-lost` |
| `limits` | the Codex week: `{usedPercent, resetsAt}` |
| `lines` | the room per lane on the Codex week, the day caps, `claude` (the Claude line, %), `claudeWeek` |
| `own` | tokens used this week per lane |
| `daily` | today's calls of the counted lanes (`drift`, `byhand`) |
| `chain` | per engine: configured, answered / ran out / busy / failed today, average time, Claude's limits and last error |
| `engine` | the engine that answers first now |
| `queue` | calls running now and waiting per queue |
| `fallback` | Free AI's spend today and its cap |
| `tally`, `jobs` | calls per workflow and per job, per day |

```sh
curl -s https://jobadabra-ai-broker.jobpilotto.workers.dev/health | jq '{state, engine, limits, queue}'
```

### `POST /admin/login`, `/admin/call`, `/admin/stop` (owner only)

`Authorization: Bearer <BROKER_ADMIN_TOKEN>` (Keychain `jobadabra.codex-broker.admin_token`).

- `/admin/login`: the one-time upload of the Codex `auth.json`. It is refused (409) while a working login is stored, and accepted again after `login-lost`.
- `/admin/call`: a smoke call from the owner's Mac, same body as `/call` (lane from `x-lane`, default `scheduled`).
- `/admin/stop`: stops the container, to prove the login survives a restart.

## How an engine is chosen

1. **The door** checks the body, the lane's caps and the week lines, then reserves the call before any engine runs.
2. **The chain** starts with `engine` (or `ENGINE`) and follows `codex → claude → free-ai`. An engine that was doing worse lately (half of its last calls failed) moves behind the other subscription for 30 minutes, unless the call names its own engine.
3. **Each engine's turn:**
   - **Codex** answers until its week is 100% used.
   - **Claude** answers while its seven-day window reads under 90%.
   - **Free AI** has a $2 UTC-day cap and takes neither a search nor an image.
4. **The reply** names the engine and model. A refusal names the first engine's own reason.

At most 24 calls run in the container at once (`PARALLEL` in `worker.js`, every engine together: Claude has no cap of its own since 13 Nov 2026); PR calls wait ahead of the rest.

<details>
<summary>Kept conversations (sessions)</summary>

Only `jobadabra/ai-user-agents.yml` may keep a Codex conversation. The key is built from the signed run token (repository, run id, attempt) and the caller's `session` id, so no other run can reach it.

- The first call sends the full prompt and opens the conversation.
- The next calls send only `delta` (the new turn) and resume it.
- A conversation restarts from the full prompt after 5 minutes idle, after 120 turns, on a different tier, or when a turn was answered by another engine.
- `endSession: true` closes it.

Spec: `docs/superpowers/specs/2026-11-05-broker-codex-resume-design.md`.
</details>

<details>
<summary>Install and configure (owner, once)</summary>

The broker is already deployed; this is for a fresh account or a rebuild.

**Secrets** (`wrangler secret put <NAME>` in this folder; values from the Keychain, never in code)

| Secret | What for |
|---|---|
| `BROKER_ADMIN_TOKEN` | the `/admin/*` routes (Keychain `jobadabra.codex-broker.admin_token`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | the Claude engine; made with `claude setup-token`. Without it Claude is skipped |
| `SELFHEAL_PUBLISH_KEY` | the notes to the owner (Claude token gone bad, an engine moved back, Free AI's cap): posted to the site's `/ops/notify` through the `SITE` service binding, so Admin → Notifications routes and mutes them (Engineering). Same key as every CI upload. No Telegram secret here |

**Vars** (`wrangler.jsonc`)

| Var | Meaning |
|---|---|
| `ENGINE` | the engine that answers first: `codex` (default), `claude` or `free-ai` |
| `AUDIENCE` | accepted OIDC audiences, comma list (`jobadabra-ai-broker`) |
| `REPOSITORY` | repositories whose run tokens are accepted, comma list |
| `FALLBACK_FREE_AI_DAY_USD` | Free AI's UTC-day cap (`2`) |

The `AI` binding (Workers AI) is Free AI's engine.

**Codex login** (once, and again only after `login-lost`):

```sh
curl -X POST https://jobadabra-ai-broker.jobpilotto.workers.dev/admin/login \
  -H "Authorization: Bearer $(security find-generic-password -s jobadabra.codex-broker.admin_token -w)" \
  --data-binary @"$HOME/.codex/auth.json"
```

The login lives only in the Durable Object's storage, and is written back after every call (Codex refreshes it). The container may reach only `chatgpt.com`, `auth.openai.com`, `api.openai.com` and `api.anthropic.com`.
</details>

<details>
<summary>Deploy and test</summary>

- **Deploy:** merging a change under `workers/ai-broker/` (or the shared files it imports) runs `Release · AI broker`. It refuses unless `/health` says `ready` or `starting`, runs the broker's tests, then `wrangler deploy`.
  - A deploy replaces the container: for about 9 minutes nothing runs in it, and calls go to the next engine (seen 11 Nov 2026).
  - Never deploy under another Worker name: a new name starts an empty Durable Object and the Codex login is gone.
- **Tests:** `node --test test/unit/workers/ai-broker/*.test.js` (from the repo root; no network, no AI).
- **By hand:** `gh workflow run release-ai-broker.yml`.
</details>

<details>
<summary>Files</summary>

| File | What it does |
|---|---|
| `worker.js` | routes, the Durable Object, the door, the engine walk |
| `lib/oidc.mjs` | verifies GitHub's run token |
| `lib/lanes.mjs` | lane of a call, queue order |
| `lib/budget.mjs` | week lines (Codex 100%, Claude 90%), day caps, the meter |
| `lib/engines.mjs` | the engine chain and per-engine counts |
| `lib/adapt.mjs` | moves an engine back when it does worse |
| `lib/tiers.mjs` | tier → model, effort |
| `lib/fallback.mjs` | Free AI and its day cap |
| `lib/guard.mjs` | refuses an answer that holds a login, JWT or key |
| `lib/queue.mjs`, `lib/busy.mjs` | slots and how long a call waits for one |
| `lib/sessions.mjs` | kept Codex conversations |
| `lib/tally.mjs` | counts per workflow and job |
| `lib/walk.mjs` | one verdict per engine turn |
| `container/` | the image: `server.mjs` runs `codex exec` and the Claude CLI |
</details>
