# Admin → Operations: Scheduled + Notifications, one switchboard

> **Verdict:** every alert that reaches the owner on Telegram is one row in one registry, with an on/off switch, a "when" and a channel; one Worker endpoint (`/ops/notify`) decides and sends. Owner, 5 Nov 2026: "control easily on what I want to get alerted or not". Sketch (approved, "Yes, as drawn"): https://claude.ai/artifact/Xo6tGKuwH7P86VcWq9eBv9

## Design:
- **Menu.** The `Schedules` group becomes **⚙️ Operations**: tabs **Scheduled** (`/admin/operations/scheduled`, gains a *Notify* column) and **Notifications** (`/admin/operations/notifications`). The Testing → Scheduled tab was the same page filtered to Testing; it is gone (the Area filter does it, and shows the Testing start-time graph). Old addresses redirect.
- **Registry** (`shared/notify-registry.js`): per alert `id, label, group, on, mode, modes, channel, jobs, status, wired`. An event not in it cannot send. Defaults as the owner chose: daily build digest and record-sites/watch list **off**, the rest on; new sign-up every time, installs a daily summary.
- **Settings** (`notify_settings`): a row only for what the owner changed; one setting per alert, so the Notify cell on Scheduled and the row on Notifications are the same switch.
- **Channels** (3): 🛠 Engineering, 💬 Users & product (starts on the Brain bot's secrets), 📈 Marketing & Sales (the owner creates the bot). Each shows the bot and chat **read live** (getMe/getChat), has *Send test* and *Change bot*. A token is stored sealed (AES-GCM under the Worker secret `NOTIFY_SECRET`) and never shown back; the chat is typed or found from the bot's last message.
- **`POST /ops/notify`** (Bearer `SELFHEAL_PUBLISH_KEY`) `{event, text, link?, state?, level?, fallback?}` → 200 sent / 200 held (`off`, `same-state`, `not-a-problem`, `already-today`, `rate`) / 400 unknown event / 503 could not deliver. Worker senders call `notify()` in process.
- **When:** *Every time*, *Changes only* (sender passes `state`), *Only problems* (sender may pass `level: 'ok'` for an all-clear), *Once a day*; Sentry also max 20 an hour.
- **Senders must pass the fields their mode needs** (PRs 2–4): `state` for *Changes only* (without it the alert sends every time), `level: 'ok'` on an all-clear for *Only problems*. Known limits (parked, low impact for one owner): dedupe and the hourly ceiling are check-then-send, so two simultaneous posts can both go; a failed send is not counted against the ceiling.
- **Fail-open:** on a non-2xx or no answer the sender posts with its old bot, then (best effort) posts `fallback: true`; Admin shows "N sent without switchboard (7 d)". A red main is never lost.
- **Privacy:** the text is never stored (log keeps event, time, channel, ok, reason, state); an e-mail address in a text is replaced; alerts link to the Admin page.
- **`wired`:** a registry flag per alert, false until its sender posts through the switchboard (PRs 2–4). The page says "N of 30 senders moved over" and "sender not moved yet", so a stored switch is never mistaken for a working one.
- Out of scope: the 12 notifications each user gets about their own search.

## Registry (30)
Releases 7 · Main & tests 9 · AI 5 · Users 6 · Site health 2 · Marketing & Sales 4 (NEW: AI persona night report, Always on run failed, new sign-up, new install; LATER: Pro purchase).

## Progress
| PR | What | State |
|---|---|---|
| 1 `[nt] 1/4` | Store, registry, `/ops/notify`, Operations menu, Notifications tab, Notify column, channels | ✅ merged #427 |
| 2 `[nt] 2/4` | Site/Worker senders call `notify()`; hand-written Telegram fetches go | ✅ merged #429 (9 senders) |
| 3 `[nt] 3/4a+b` | (owner, 5 Nov: failed-release alerts first: event `release-failed`, registry here, sender in jobadabra) | ✅ merged #434 + public #3293 |
| 3 `[nt] 3/4c` | jobadabra: `ci-alert.mjs`, `telegram-post.mjs` and 13 workflow senders post to `/ops/notify` (fail-open) | ✅ merged public #3298 |
| 3 `[nt] 3/4d` | The 12 events those senders use are marked `wired` here | ✅ merged #441 |
| 3 `[nt] 3/4e-a` | Two new events for senders that had none: `replay-drift` (site-replays.yml), `pr-check-scorecard` (monthly scorecard) | ✅ merged #443 |
| 3 `[nt] 3/4e-b` | jobadabra: `release_guard.py`, the AI-fixer follow-up, the `ai-skipped-alert` action (ui-*, judge-exam, ai-fixer), the scorecard and site-replays post to `/ops/notify` (fail-open) | ✅ merged public #3308 |
| 3 `[nt] 3/4e-c` | Public route list names `/ops/notify` | ▶️ public #3313 |
| 3 `[nt] 3/4f` | The four newest events marked wired; the broker fallback shown as parked | ▶️ this PR |
| — | **Parked (coordinator, 5 Nov):** `workers/ai-broker/lib/fallback.mjs`'s once-a-day "Free AI cap reached" note stays on the brain bot; a new production secret on the broker is not worth it now; trigger: when the old bots retire (4/4). The page shows it as `parked` and leaves it out of the count; `finder-review.yml`'s AI-skipped alert also keeps the CI-alerts bot (its job runs Codex-edited code beside the alert) | |
| — | **Out of scope (owner/coordinator, 5 Nov):** `daily.yml`, `mail.yml`, `scout.yml` send on each person's own bot (`TELEGRAM_BOT_TOKEN`), already switched by their Settings → Notifications (`JOBADABRA_NOTIFY`); they are not among the registry's alerts, so the page's "N of M senders moved over" never counts them as waiting | |
| 4 `[nt] 4/4` | New alerts; old bot secrets retired after a week of switchboard sends | |

## Owner to do (secrets are never mine)
- Set the Worker secret `NOTIFY_SECRET` (any long random string) so *Change bot* can keep tokens.
- Create the Marketing bot with @BotFather and paste its token in Notifications → Marketing → Connect bot.
- Engineering has no bot in the Worker yet: paste the CI-alerts bot's token under Change bot.
