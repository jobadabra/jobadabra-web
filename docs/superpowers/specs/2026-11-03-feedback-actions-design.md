# Actions on each feedback (design)

> **Verdict:** every message on `/admin/growth/feedback` gets an **impact** (high / medium / low; the AI suggests it, the owner can change it) and a **⋯ menu** with six actions: **Dismiss**, **Delete**, **False positive**, **Fixed + tell the reporter**, **Acknowledge + defer**, **Send to AI** (a CI run that ends in a draft PR for the owner to review). One state per feedback, one owner of its changes, every change logged. The reporter hears about "fixed" or "deferred" in the app, and by e-mail only when they gave an address; a fix is told **automatically when a beta or stable release includes it**.

Owner, 3 Nov 2026: "offer some actions buttons for each feedback received, such as: Delete/Dismiss feedback; Mark as fixed + inform the reporter; send it to a claude session (on the CI using the ai-broker, that the outcome should be a PR with the fix)." · "And also: Mark as false positive" · "an option to inform and thank the reporter, that we acknowledged it, but we'll defer it (let's categorize feedbacks from the impact perspective: high/medium/low, where low is edge cases or low value…)". On the new session: "make an exception. I approve this".
Owner's answers on the design (3 Nov 2026): "AI suggests, I can modify. Make all the action buttons under a 3 dot dropdown menu" · "either I type the version, either leave blank which means next update/version. But, we should develop also an automatic way so that, when we release a new beta/stable version which includes a feedback fix, we should automatically inform all the reporters." · after an AI PR merges: the card turns Fixed and he presses "Tell the reporter".
Outcome: the owner clears the list in one pass (today it only grows), reporters see their words led to something, and a clear bug can reach a reviewed PR without a hand-written brief.

## What was found (3 Nov 2026)

| Check | Result |
|---|---|
| The page (`admin/feedback.js`) | read-only list, polls every 60 s; no state, no actions; guests (`viewer`) can read it |
| D1 `feedback` (migrations 0003, 0124, 0125) | words, install id, version, platform, contact (free text), screen, file flags, `notified`; no state column |
| Files | R2 `feedback-files`, keys `feedback/<ref>/{screen.*,logs.txt,page.json,profile.json}`, purged after 90 days |
| E-mail sender | exists: `send(env,'<template>',to,data)` in `shared/mail.js` (Cloudflare Email Sending from `no-reply@jobadabra.top`, kill switch `MAIL`, 6 mails a day per address, honours unsubscribe, logs a hash). **No new provider.** |
| Starting a GitHub workflow from the Worker | exists: `dispatch(env, inputs, workflow)` (`workers/www/index.js`) with `TIMERS_GITHUB_TOKEN` + `TIMERS_REPO` (the public repo). **No new secret.** |
| An agent that edits files on the broker | exists: `jobadabra:desktop/e2e/edit-codex.mjs` (two broker calls, **no tools**, edits come back as data; the workflow's later steps validate paths, run the tests, push, open the PR) and `ui-fix.yml` is the template. The broker is one prompt in, one answer out, container with no internet. |
| App ↔ site by install id | the app already sends `install` (`app-feedback.js`); nothing reads anything back for feedback |

## Design

### States of one feedback (one owner: `shared/feedback-actions.js`)
No other file writes `state`. The table below is the code: an action not listed for a state is refused (409).

| State | Chip | Enter from | Leaves by |
|---|---|---|---|
| `new` | 🆕 New | the INSERT; any "Reopen" | every action |
| `dismissed` | 🙈 Dismissed | new | Reopen (undo), Delete |
| `false_positive` | 🚫 False positive + the one-line reason | new | Reopen, Delete |
| `deferred` | ⏳ Acknowledged · deferred (+ JOB link) | new | Reopen, Fixed, Send to AI, Delete |
| `ai_running` | 🤖 AI running (+ run link) | new, deferred | `ai_pr` (PR opened), `new` (AI found nothing or the run failed; the reason is kept) |
| `ai_pr` | 🔀 PR open (+ PR link) | `ai_running` | `fixed` when the PR merges (callback), `new` if the PR is closed unmerged |
| `fixed` | ✅ Fixed (+ version / PR); "⏳ Fixed · waiting for release" while the reporter is to be told at a release | new, deferred, `ai_pr` | Mark as released, Reopen, Delete |
| `released` | 📦 Released in <version> (<channel>) | `fixed`: a release call finds a waiting card, or the owner's "Mark as released" (asks the version) | Reopen, Delete |

- **Open** (the header count) = `new` + `ai_running` + `ai_pr`. The header reads `7 open · 3 deferred · 41 total`, plus one noise line `False positive: 4 of 41 (10%)`. Filters on the page: All · Open · Deferred · Fixed · Dismissed · False positive; and impact: High · Medium · Low · Unrated. Sort: newest (default) or impact (high first, then newest).
- Columns (migration `0126`; `impact_ai`, `impact_why`, `tell_mode`, `tell_message` and `tell_mail` arrive with the PR that needs them, as 0127+, all additive, old rows = `new`/unrated): `state`, `state_at`, `state_note` (≤ 200: reason / message), `impact` (`''|high|medium|low`), `fixed_in` (version text or `''`), `pr_url`, `run_url`, `linear_url`, `told` (`''|app|app+mail|app, mail refused: <why>`), `seen_at` (the app showed the reply). Table `feedback_log(at, ref, who, action, detail)` — **who** is `owner (session)` or `owner (key)` — written in the same batch as the state change; shown per card under "History".
- **Impact** (owner's scale): **High** = blocks a main journey, loses data or money, or many people hit it · **Medium** = real, has a workaround · **Low** = an edge case or low value (what we would park in Linear by ROI). **The AI suggests it** when the feedback arrives (columns `impact_ai` + `impact_why`, one line); the owner's three chips on the card set `impact` and win; the card shows the suggestion as "AI: Medium — workaround exists" until he decides. Unrated is allowed (the AI refused or is off).
- **How the suggestion runs:** in the Worker after the INSERT (`waitUntil`, never in the app's request), on Workers AI (`env.AI`, no key, no paid spend; the same free engine as Free AI). It reads the words, version and screen name only (no contact, no logs). A refusal or a bad answer leaves it blank and says why on the card ("AI unavailable: …", never a silent miss); the daily job retries the rows still blank (7 days, 3 tries in all). When the daily retry finds the AI refused every row, the run names the cause (limit / rate / other), tells the owner on Telegram once a day per cause and throws (the cron is logged as failed): the site rule that an AI job never fails silently (Gitar on #339). The fallback that needs no AI is the owner's own rating. A daily cap of 100 calls (counted by when the call was made) protects the shared free neurons; a row held back by it says so on its card. The cost shows on /admin/growth/ai-cost under "other". Until the owner rates it, the AI's suggestion counts for the impact filters and the sort; his rating always wins and his log line records what the AI had said. The prompt has a case set `test/fixtures/feedback-impact-cases.json` (invented messages with the expected class) replayed by a test on recorded answers; a prompt change adds its case and replays the whole set.

### Actions (all in one **⋯ menu** on the card; owner-only: `isOwner`, never `viewer`; `SameSite=Strict` cookie, JSON body, `POST /admin/growth/feedback/act`)
- **Dismiss** — hides it from Open; one click, an "Undo" toast. **Delete** — two-step ("Delete forever?" Yes / No, inline, not a browser dialog): removes the row **and** every R2 object under `feedback/<ref>/` (screenshot, logs, screen data, profile snapshot); the `feedback_log` line stays with no content. Delete is the only way the profile snapshot leaves before 90 days.
- **False positive** — asks one line ("why: not a bug / works as designed / duplicate of …"), stored in `state_note`; feeds the noise line.
- **Fixed + tell the reporter** — form: *Fixed in* (a version the owner types, or blank = "the next release"), *PR/commit link* (needed for the automatic match below), *Message to the reporter* (prefilled "Thank you — this is fixed in <version>."; the owner may edit; ≤ 300), tick **Also e-mail** (on only when `contact` is a valid address; off otherwise, with the reason shown), and **When to tell**: ◉ *automatically at the first release that includes it* (default when blank version) · ○ *now* (default when a version is typed) · ○ *don't tell*.
- The menu shows only the actions the state table allows (a Fixed card offers Reopen and Delete); the card itself shows the impact chips, the state chip and the chips for files, run and PR. The menu is a button with `aria-haspopup="menu"`, keyboard operable, closes on Escape.
- **Acknowledge + defer** — form: *Message* (prefilled "Thank you — we saw this and parked it for later. If we pick it up we will tell you."), optional *Linear link* (`https://linear.app/…`, stored as given, shown as a chip; no Linear API call), **Also e-mail** as above. Impact is asked in the same form when unrated (default Low).
- **Send to AI** — see below.

### How the reporter is told (one sentence, two doors)
- **In the app** (public repo PR): on start and every 6 hours the app asks `GET /api/feedback/replies` with its own Free AI key (`x-api-key: JPF1.<install>.<token>`, the proof the trial count uses; the install id alone is not a credential) and gets the replies not yet seen: `{ref, sentOn, excerpt (the first 80 characters of their own words), kind: fixed|deferred, fixedIn, message}`. Shown as a notice card on Home: "You wrote on 28 Oct: "the kit is great; setup took 20 min…" · **Fixed in 0.9.12** — thank you." If `fixedIn` is newer than the installed version: "arrives in 0.9.12 — update when ready". Closing it calls `POST /api/feedback/replies/seen`. The install id is the key (a random UUID only that device and our D1 hold); the answer holds nothing but their own words, a date and our one-line message; 60 requests an hour per install.
- **By e-mail**, only when `contact` is a valid address and the owner left the tick on: new template `feedback-update` on the `service` list (no new provider, no marketing); `send()` already refuses an unsubscribed or bounced address and caps 6 a day; the verdict is written to `told` and shown on the card ("✉ sent" / "✉ refused: unsubscribed"). The mail repeats the same message and quotes the same 80 characters.
- Telling happens only inside Fixed / Defer, with the owner's message, **now** or **at the next release** (below). Nothing is sent that the owner did not write or accept.

### Automatic: a release that includes a fix tells its reporters
- A feedback in `fixed` with *When to tell = at release* waits (`told = 'pending'`). Every beta and stable build calls `POST /api/feedback/released` {`version`, `channel`, `prs` (the PR numbers in the release's commit list), `cutAt`} with the publish key the release already uses for `/release-mail/draft` (`SELFHEAL_PUBLISH_KEY`).
- Match, in order: (1) the feedback's PR number is in `prs` · (2) no PR link and no version typed, and it was marked fixed before `cutAt` · (3) the version the owner typed equals `version`. A match sets `fixed_in = <version> (<channel>)`, then tells exactly like "now": the in-app reply and, if ticked, the mail; the verdict goes to `told` and the log.
- **Told once, at the first release** that carries the fix, saying which channel ("fixed in beta 0.9.12"). The later stable build does not tell again (the reply already exists; the card shows "also in stable 0.9.14" quietly).
- A release call with a bad key is refused; the same call twice tells nobody twice (`told` is the guard). The owner sees the result in the release's run log and on the cards (no new page).
- The call itself is one step added to the public release workflows (PR 6/7 below).

### Send to AI (CI, one click, ends in a draft PR)
Why this is not the UI Fixer (which stays OFF, owner 25 Oct 2026): that one ran on a schedule over many findings. This runs only when the owner clicks it on one feedback, at most **3 a day and 1 at a time** (counted from `feedback_log`), and ends in a **draft PR** he reviews. It never merges and never pushes to main. Owner approved the work on 3 Nov 2026.

```
admin button ─► POST act {ai, include} ─► site: state ai_running, one-time run row
   └► dispatch ai-fixer.yml (jobadabra/jobadabra, inputs: source=feedback and ref; feedback-ai.yml until 5 Nov 2026) via TIMERS_GITHUB_TOKEN
        ├ 1 brief   OIDC token (audience jobadabra-feedback) ─► GET /api/feedback/brief?ref (site verifies GitHub's signature, repo, workflow file, state=ai_running)
        ├ 2 agent   broker call 1 picks files, call 2 returns edits as data (≤ 3 calls: one retry after a red test), 25 min cap
        ├ 3 gates   paths allowed (src/, desktop/, extension/ and their tests; never .github/, tools/, package files, secrets), a test file changed,
        │            the new test FAILS before the fix and PASSES after, the whole unit suite and the lint pass
        ├ 4 PR      branch fd-ai/<ref>, DRAFT PR "[fd-ai] <ref> <title>", label fd-ai: root cause, the failing test, the fix
        └ 5 report  POST /api/feedback/ai-status {pr|none|failed} (same OIDC proof; the run id must be the one that took the brief) ─► the card shows the run and the PR
   merged / closed ─► a job in the same file (event `pull_request_target`, so it runs main's file) reports {merged|closed, pr} ─► state fixed, PR number kept, *When to tell* = at release (default); the owner can press "Tell the reporter now"
```
- **What the agent gets:** the words, version, platform, screen name, the logs and the screen data (both ticked by default), **never the profile snapshot unless the owner ticks it for this run**, never the contact or the install id. The files were redacted by the app when they were sent; **the second pass runs in the CI run, on the brief it fetched, before the AI sees a character** (`desktop/lib/feedback-bundle.js redact`). *Changed on 3 Nov 2026 (7/7): the Worker has no `node:` modules, so it cannot import that redactor; the run is where the code already is.* The site serves only what the owner ticked, as stored, and never the contact, the install id or the screenshot.
- **The repo is public, so the PR is public.** The branch, commit, PR title and body, run log and artifacts are written by a script that (a) never quotes the feedback or the logs, only the AI's own root cause and fixture data it invents, (b) is scanned for e-mails, tokens, home-folder names and the install id before it is posted (a hit stops the run, nothing is pushed). The brief is a file that is never printed or uploaded.
- **The AI may also say no:** verdict `fixed-already | not-reproducible | needs-human | false-positive` with a reason → no PR, the card returns to `new` with "🤖 <verdict>: <why>" (a false-positive verdict is a suggestion; only the owner sets that state).
- **A refused broker call** (limit, login, down) is named, reported to the card as `failed: <cause>` and the run goes red (`AiRefused` handling already used by the site's jobs); nothing else breaks.
- **Authenticity:** the Worker trusts the run only when GitHub's OIDC token verifies (`audience`, `repository`, `workflow_ref` = `.github/workflows/ai-fixer.yml@refs/heads/main` (or feedback-ai.yml, still trusted), `event_name` = `workflow_dispatch`, or `pull_request_target` for merged/closed) **and** the feedback is in `ai_running` started within the last hour; the first run id to fetch the brief owns the card and every later report must carry that id (merged/closed must name the PR the card holds). A run that never answers is sent back to `new` after an hour. The run's own steps (`ai_pr`, `ai_none`, `ai_failed`, `ai_merged`, `ai_closed`) are internal actions: not in the menu and refused on the owner's route. Nothing secret is in the dispatch inputs (the repo and its run pages are public).
- Recorded fixtures in every test (a recorded broker answer); the live broker is never called in CI tests.

### Auth and the log
All six actions, impact and the AI callbacks go through `shared/feedback-actions.js`; the route checks `isOwner` first (guests get 404 and the buttons are not drawn). Every change is a `feedback_log` row in the same batch. A test lists every `POST` route of the feedback page and fails on one without the owner check.

## PRs (titles `[fd] n/7 …`; the site lands first, then the app, then CI)
| # | Repo | What the owner gets |
|---|---|---|
| 1/7 | site | the ⋯ menu; states; impact chips; filters/sort; Dismiss, Undo, Delete (R2 too), False positive; history log; light/dark shots |
| 2/7 | site | AI-suggested impact on arrival (Workers AI, case set, retry job) |
| 3/7 | site | Fixed + Acknowledge/defer forms, the replies API, the `feedback-update` mail, `told` on the card |
| 4/7 | public (app) | the notice card on Home |
| 5/7 | site | `POST /api/feedback/released`: tells waiting reporters when a release includes the fix |
| 6/7 | public (release) | the release workflows call it with their PR list |
| 7/7 | site + public (CI) | Send to AI: dispatch, signed brief, callbacks, run/PR chips, `feedback-ai.yml`, gates, leak scan |

(7/7 may split into site and CI halves when it is built; that is decided then.)

## Non-goals
Replies back and forth with the reporter · editing a reporter's words · Linear API sync (the link is typed) · telling reporters again when stable follows beta · bulk actions · running the AI on every new feedback · auto-merge · a public feedback page · the Telegram message getting buttons.

## Acceptance
- One state per feedback; an action from a state the table does not list is refused and tested for every pair (a loop over the table).
- Delete leaves no R2 object under the ref (a fake bucket proves it) and no row; the log line has no text.
- No feedback action is reachable as a guest or without the owner check (the route-listing test).
- "Fixed" with an e-mail address sends exactly one `feedback-update` mail; with a non-address contact sends none and says why; an unsubscribed address shows the refusal; the in-app reply exists in all three cases.
- The app's reply for a version the install does not have yet says "arrives in …", for one it has says "fixed in …".
- Send to AI: a forged callback (wrong repo, wrong workflow file, wrong audience, expired, state not `ai_running`) is refused; the 4th click in a day and a 2nd while one runs are refused with the reason.
- The AI PR text and branch of a fixture run with a planted e-mail, token and home path in the feedback contain none of them; the leak scan stops a planted one.
- A release call whose PR list contains a waiting feedback's PR tells that reporter once (app reply + the ticked mail); the same call again, a release without the PR, and a feedback marked "don't tell" tell nobody; a feedback marked fixed after the release's `cutAt` is not matched by rule 2.
- The impact suggestion for the invented case set matches the expected class on the recorded answers; a refused or malformed AI answer leaves the impact blank and the row still saves and notifies.
- Light + dark before/after screenshots of the page in each UI PR.

## Progress
- [x] Facts: mail sender, dispatch token, edit-codex pattern, broker limits (above)
- [x] Spec (this file)
- [x] Sketch + owner's yes on the design (3 Nov 2026, with: AI-suggested impact, ⋯ menu, automatic tell at release)
- [x] 1/7 site: menu, states, impact chips, Dismiss/Delete/False positive (#338)
- [x] 2/7 site: AI-suggested impact (#339)
- [x] 3/7 site: Fixed, Defer, replies API (needs the app's own JPF1 key), mail (#341)
- [x] 4/7 app: notice card (jobadabra #3044)
- [x] Owner's add-on: version, platform, install id mandatory on every feedback (#342; e-mail stays optional)
- [x] 5/7 site: released endpoint (`POST /api/feedback/released`, this PR)
- [x] `released` state: a release (or "Mark as released") moves a waiting Fixed card to Released; Deferred relabelled "Acknowledged · deferred" (owner, 3 Nov 2026)
- [x] 6/7 release workflows call it (jobadabra #3072)
- [ ] 7/7 site half: Send to AI button, caps, brief and status routes, run/PR chips (this PR)
- [ ] 7/7 public half: `feedback-ai.yml` (the run, gates, leak scan, callbacks)
