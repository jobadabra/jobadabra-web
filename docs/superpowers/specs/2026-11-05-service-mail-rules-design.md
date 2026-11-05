# Service mail: mail is for what happens while the app is closed

Status: agreed by the owner, 5 Nov 2026 (v3). Nothing is built. No mail goes out from this work without the owner's OK.
Sketch: https://claude.ai/artifact/XtMLKx9N24j2Jbbg6fyjvT
Owner, in their words: "when the user uses mac only mode, then there is no point sending many emails or none at all because he is seeing all the updates in the app. Emails would be just duplicate. Secondly, when is Mac Only, we don't have user's data/profile to be able to send him email notificatiosn" · "I can enable/disable every email. Or modify their cadence" · "every email except the urgent/mandatory/functional ones like sign in codes, or confirm" · "Let's drop this rule of 1 digest + 1 urgent. The service/functional mails should be sent as many as it needs" · "Why do we need to know [if the app is open]? We just try to open the app. If it's closed we open it. If it's open we focus it" · Trial: "Let's keep them off for now. I don't want to stress my users" · Gmail check "Mac now, phone later".

## Verdict

- 🟢 **The rule: mail is for what happens while the app is closed.** Mac only sends no job mail: the app already shows it. Job mail belongs to Always on.
- 🟢 **Only Find jobs really changes between modes.** Gmail and applying stay on the Mac for everyone. Insights follow the applications.
- 🟢 **Insights are a product feature**, not the person's automation. The Schedules row goes. Mail is one sentence in Tips (ticked) and Weekly summary (Always on).
- 🟢 **Every e-mail gets a row in Admin → E-mail → Settings**: on/off, rhythm, last sent, sent in 7 days, preview. Sign-in code and confirm are locked.
- 🟢 **No new daily limit.** The 10 a person a day (3,000 for the product) stays as a safety net only.
- 🟢 **No "app is open" rule.** A mail's button opens the app, or focuses it; the OS handles an uninstalled app.
- 🟢 **Rhythm is the owner's**, set in Admin: matches daily, summary on Mondays. The person only ticks.
- 🟢 **Trial reminders stay off** (`TRIAL_REMINDERS`, untouched).
- ⚪ **Not designed on purpose:** replies while the Mac is off, and the interview reminder (briefed separately). The registry keeps a place for both.

## The three modes

| Mode | Runs when | The site holds |
|---|---|---|
| Mac only | the app is open | the address |
| Always on, your own accounts | GitHub runs it, Mac can be off | the address, and what the repo posts to it |
| Always on, our servers | our container runs it, Mac can be off | address, profile, search settings, matches. No applications, no Gmail |

The site cannot write a personal mail for a Mac only person. The Mac can, and does today, but only while the app is open, which is when nobody needs it.

### Automations

| Automation | Mac only | Own accounts | Our servers |
|---|---|---|---|
| Find jobs | while open | Mac can be off | Mac can be off (daily on trial, down to every 4 h on Pro) |
| More employers (own schedule) | while open | Mac can be off | on the Mac, while open |
| Insights | while open | Mac can be off | on the Mac, while open |
| Check Gmail & Calendar | while open | moves to the Mac | on the Mac, while open |
| Applying, Full automation included | on the Mac | on the Mac | on the Mac |

### E-mails

| Mail | Mac only | Own accounts | Our servers |
|---|---|---|---|
| Sign-in code 🔒, confirm 🔒, about your feedback, check-in (planned) | goes | goes | goes |
| What's new, Tips and tricks, Pro is out | if ticked | if ticked | if ticked |
| Trial reminders | off | off | off |
| New matches (Job digest), daily | no | goes | goes |
| Weekly summary, Mondays | no | the Monday report | plain counts |
| Always on stopped working | no | goes | goes |
| Nothing found for days | no | goes | goes |
| Always on test | no | on press | on press |
| Interview reminder (reserved) | with Google connected | with Google connected | with Google connected |
| Applied for you, An application needs you | Full automation only | Full automation only | Full automation only |
| Run news, daily insight, Gmail findings, budget and health alerts | app only | app only | app only |

A person can get 8 mails on Mac only, 13 on Always on, 2 more with Full automation. On own accounts a real failure (budget, health, a failed run) goes out as Always on stopped working.

**Why Full automation is the one exception** (owner: "Keep both"): applying only happens on the Mac, so the rule alone would remove these two. It is the one case where the app acts in the person's name while they have walked away on purpose. The Mac writes the mail, so the site needs no new data, and only people who confirmed Full automation get it.

## What exists today (read 5 Nov 2026)

One door: `shared/mail.js:107` is the only `EMAIL.send` in the site. Every mail goes through `send()`: stop lists, the per-address cap (10 a day, claim-based), the global cap (3,000), footer.

| Mail (template) | List | Triggered by | Gate today |
|---|---|---|---|
| Sign-in code (`account-code`) | service, essential | `api/pro-signin.js:34`, the person asks | the cap |
| Confirm (`welcome`, `confirm-resend`) | service (resend: essential) | `api/account-email.js:90` and `:111` | none |
| About your feedback (`feedback-update`) | service | `shared/feedback-reply.js:86` | none |
| Digest (`digest`) | service | `shared/hosted-notify.js:19`, a hosted run found matches | ≥ 4 h apart; email channel on |
| App mail (`message`) | service | `POST /api/notify/email` (`api/account-email.js:118`); `activity` is held (`api/mail-held.js`) for the daily/weekly digest | unconfirmed address: 1 a day |
| Always on paused | service | daily cron, `admin/mail-lifecycle.js:50` | once per 30 days |
| Always on test | service | the person presses Test | once a day, outside the cap |
| Trial left / trial ends | service | `admin/mail-lifecycle.js:43,46` | **off**: `TRIAL_REMINDERS` |
| What's new (`release`) | releases | the owner presses send | MARKETING_MAIL, the card |
| Pro is out (`pro-launch`) | tips + waitlist | the owner presses send | MARKETING_MAIL, MAIL_LAUNCH |

Sent in the last 30 days (coordinator's sketch): confirm 9, app messages 8, what's new 5, sign-in code 1. Twenty-three mails. The 8 app messages are the part this rule changes; the log does not split them by mode yet.

Every mail from the engine is `message` (new matches, run news, the Test alert), so a switch per mail has nothing to key on. The engine knows the kind (`src/notify.py` `queue(kind=…)`); the site receives only `activity` or nothing (`api/account-email.js:130`). `digest` (hosted) and `message` (GitHub) are two paths to one thing, one run's new matches.

## Design

### 1. One registry, one stored rule per mail (`shared/mail-registry.js`, new)

The one owner of what a mail is: id, group, locked or not, which rhythms it allows, its default. `TEMPLATES` keeps subject/html/text. App mail gets virtual ids so `message` can be told apart: `app-matches`, `app-weekly`, `app-stopped`, `app-nothing`, `app-applied`, `app-needs-you`; `app-reminder` is reserved.

| Group | Mails | Rhythm in Admin |
|---|---|---|
| Account | sign-in code 🔒, confirm 🔒, feedback update, Always on test, check-in | none: each goes when it happens |
| Always on | new matches, stopped working (includes today's Always on paused), nothing found | matches: `daily` or `weekly`; nothing found: N days (default 3) |
| Summary | weekly summary | the day it goes (Monday) |
| Full automation | applied for you, an application needs you | none: each goes when it happens |
| News | what's new, Tips and tricks, Pro launch | tips: at least N days apart |

Stored: one D1 table `mail_rule (id TEXT PRIMARY KEY, enabled INTEGER, rhythm TEXT, at TEXT)`, one row per mail the owner changed. No row = the registry's default. Locked mails cannot be written.
`send()` asks `ruleOf(id)` before the claim: off → `{ok:false, reason:'rule_off'}`, logged like any refusal and shown in "Why mail was not sent".

**A failed read never sends more than the owner chose** (the lesson of #442): a missing table leaves the defaults; any other read error keeps this Worker copy's last good answer, and with none holds every unlocked mail. Locked mails never wait for a rule.

The person's own digest choice (`pro_accounts.digest_cadence`, `api/account-email.js:81`) stops being read once the Admin rhythm exists; the app's Settings drops the choice.

### 2. Admin → E-mail → Settings: the Mails list

A table above "Mail types and rules", one row per mail, by group: name and "goes out when", a real toggle (same press route and confirm as the switches; locked rows show 🔒), the rhythm select where one applies, last sent, sent in 7 days, preview and test send. Trial rows read "Off (TRIAL_REMINDERS switch)" and link to the Switches card.

### 3. Mac only stops sending job mail

One owner: `notifyEnv` (`desktop/lib/notify-channel.js:31`). On this Mac the engine gets the e-mail channel only for the Full automation kinds; on GitHub it keeps it. Settings → Notifications: on Mac only, e-mail for job news is replaced by one line: "E-mail about new matches comes with Always on." Telegram is not touched by this spec.

### 4. Job digest: turning on Always on is the tick

The server card promises "New matches by e-mail every morning" (`desktop/renderer/always-on-choice-words.js:21`). Turning on Always on already asks for the address, and that counts as the tick (owner: "Turning on is the tick"). The person can untick it in Notifications; matches then wait in the app. People without Always on do not see the tick.

### 5. Insights are a product feature

- **Made on the device** from the person's own applications (`src/ai/insights.py`). The Schedules row goes. Today they run inside the first scheduled search after 04:00 UTC (`desktop/lib/pipeline-args.js:36`), so no search means no insight. They get their own trigger: once a day when the app is open. Own accounts keep running them on GitHub.
- **Cost:** people paying with their own AI key lose the row that stopped this, so they get a plain on/off in Settings.
- **Seen in** Reports and the Focus and Jobs suggestions card, in every mode.

| Mail | Who | What reaches the site | New data? |
|---|---|---|---|
| Weekly summary, own accounts | Always on | the Monday report the engine already sends (`src/telegram.py:57` queues it as mail), with its own kind `weekly`. **Reuses the report; no second one.** | none |
| Weekly summary, our servers | Always on | nothing new. The site writes plain counts with no AI: searches run and new matches from `hosted_runs.new_count`, the best few from `hosted_inbox`. The report needs the applications, which never reach our servers, so it stays in the app. | none |
| Tips with an insight | ticked Tips, any mode | **one `finding` sentence (≤160 characters) of the latest report, with its date**, replacing the previous one, kept 30 days at most, deleted when the person unticks Tips, stops it or deletes the account. Never the summary, job titles, employers or CV text. | one sentence per ticked person |
| Tips without an insight | ticked Tips | a tip from our own library, used when no sentence is under 30 days old | none |

Privacy sentence on `website/public/privacy.html`, beside "Email address", in the same PR as the Tips insight: *"If you tick Tips and tricks, we keep one sentence from your latest weekly analysis (with its numbers, never a job or an employer) to put in a tips email. We delete it after 30 days, or when you untick it."*

### 6. Check Gmail stays on the Mac

Owner: "Mac now, phone later". The GitHub Gmail job stops and the Google sign-in leaves the repo (the coordinator owns that move). It never ran on our servers. Replies, interviews and rejections land in the app and are not mailed. No mail in this spec needs Gmail read while the Mac is off.

### 7. The Schedules card

Three rows in every mode, and the status says where each runs:

| Row | Mac only | Own accounts | Our servers |
|---|---|---|---|
| More employers | this Mac, while open | GitHub, Mac can be off | this Mac, while open |
| Find jobs | this Mac, while open | GitHub, Mac can be off | Our servers, Mac can be off |
| Check Gmail & Calendar | this Mac, while open | this Mac, while open | this Mac, while open |

Fixes two wrong statuses: on our servers rows read "this Mac, while open" (`desktop/renderer/pages/connections.js:39` only knows GitHub), and Insights never said it needs the app open. With our servers on, the Mac stops its own scheduled search (`desktop/lib/schedule.js:11` stops only for GitHub, so both can search today); the Find jobs button still works.

### 8. Service mail can be turned off, with a warning

The stop link and the mail settings page already stop `service` (`shared/mail.js`, `api/mail-unsub.js`). Added: a person who turns it off with Always on reads **"We strongly advise against this: you won't know about new matches, or when Always on stops."** and confirms. (Changed from "when an application needs you": applying happens on the Mac.) Sign-in and confirm still reach them. People → "service off" count in Admin.

### 9. The new mails (off until the owner turns each on)

| Mail | Goes out when | Source | Notes |
|---|---|---|---|
| Always on stopped working | a hosted run is refused or paused, or the GitHub run fails (`src/notify.py` `failure_words`) | hosted run result, `admin/mail-lifecycle.js:50`, the engine | once per cause per 24 h; one fix link |
| Nothing found for days | N days of runs with no new match (default 3) | `hosted_runs.new_count` / the engine's run log | links to "Were you expecting more jobs?" |
| Weekly summary | Mondays | section 5 | |
| Applied for you | Full automation sent an application | the Mac | lists, never a bare count |
| An application needs you | Full automation is waiting for the person | the Mac | one per waiting job |

### 10. Room left, not designed

The owner is still deciding replies while the Mac is off. The interview reminder comes from a small fact the Mac leaves behind (briefed separately): the registry reserves `app-reminder`. Inbound mail is a second entry type (`direction: 'in'`); the Worker already has an `email` handler (`admin/test-mail.js`).

## Pull requests (the site lands first; the public repo then uses it)

| # | Repo | What | Who gets what |
|---|---|---|---|
| 1 | site | `mail-registry.js`, `mail_rule`, `ruleOf` in `send()`, fail-closed read | the owner: one place to turn a mail off |
| 2 | site | Admin → Settings: the Mails list | the owner: "I can enable/disable every email. Or modify their cadence" |
| 3 | site | `POST /api/notify/email` accepts `kind`; rhythm from Admin | Always on people: matches and the Monday mail on the owner's rhythm |
| 4 | public | `src/notify.py` sends the kinds; the Mac keeps e-mail only for Full automation; Notifications line | a Mac only person stops getting duplicates of the app |
| 5 | public | the Schedules card: three rows, true statuses, the Mac stops searching beside our servers; insights get their own trigger and the own-key on/off | a person sees where each job really runs |
| 6 | site + public | Job digest: turning on Always on is the tick, untick in Notifications | Always on people get what the card promises |
| 7 | site | service-off warning; "service off" count in People | a person who would switch it off is told what it costs |
| 8 | site + public | the new mails, one PR each, each off until the owner turns it on | Always on and Full automation people |
| 9 | site + public | Tips with an insight, with the privacy sentence | people who ticked Tips get one real sentence about their search |

PRs 1 to 3 ship with every new row **off**; existing mails keep today's behaviour. PR 3 can merge before PR 4 (an old engine sends no kind: it keeps today's path).

## Decisions (all the owner's, 5 Nov 2026)

| Decision | Answer |
|---|---|
| Mac only and job mail | none: "Emails would be just duplicate" |
| Insights | "I agree to be product feature" |
| Full automation mails | "Keep both" |
| Job digest | "Turning on is the tick" |
| Monday mail on our servers | "Plain counts" |
| Digest rhythm | "Matches daily, summary on Mondays" |
| Tips with an insight | "Yes, one sentence, 30 days" |

Open default, changeable in Admin: Nothing found for days, N = 3. The Schedules card (section 7) and the Mac stopping its own search on our servers are recommendations the owner has seen in the sketch and not yet answered.

## Measure before building

- How many people have Always on (hosted or GitHub): the whole audience for job mail. Read from `hosted_schedules` and the engine's notify calls once PR 3 logs the kind.
- Mails per person per day after PR 1 ("Why mail was not sent": `rule_off`, `rate`).
