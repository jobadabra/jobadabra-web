# Service mail: the person owns the mail about their search

Status: agreed by the owner, 5 Nov 2026 (v4, with the footers and screens the owner set the same evening). Nothing is built. No mail goes out from this work without the owner's OK.
Sketches: https://claude.ai/artifact/Tns6cz671kVymGhSpt1Z12 (who owns each e-mail) · https://claude.ai/artifact/XtMLKx9N24j2Jbbg6fyjvT (automations by mode; its Mac only mail rule is replaced here)
Owner, in their words: "each users sets his own emails. We can jsut suggest a sepcific/default configuration" · "They enabled because they wanted to automate something, not because they wanted to give up on privacy" · "we put privacy first, and we let them know, let them feel that they are in control of their data" · "Let's drop this rule of 1 digest + 1 urgent" · "Why do we need to know [if the app is open]? We just try to open the app. If it's closed we open it. If it's open we focus it" · Trial: "Let's keep them off for now. I don't want to stress my users" · Gmail check "Mac now, phone later".

## Verdict

- 🟢 **Three owners replace today's mail types.** The person owns the mail about their search. Jobadabra owns only its own news.
- 🟢 **Modes change what can run, not the rules.** Each mode only suggests different defaults; every row can be changed.
- 🟢 **Every mail says why it came**, and states only what is true for that mail. Account mail has no unsubscribe. A person's own mail points to the app, with a small web link for someone who cannot open it.
- 🟢 **A switch beside each automation, and the same switch in Notifications.** The screen says plainly what comes from the Mac and what comes from Always on.
- 🟢 **Privacy line, once the Notifications screen ships:** "You choose every e-mail. Your data stays yours: your search and profile work for you, never for our marketing."
- 🟢 **Tips by mail are general, the same for everyone.** Personal suggestions stay in the app, where they already are. No personal data reaches the site for a tip.
- 🟢 **Insights are a product feature**, not the person's automation.
- 🟢 **No new daily limit.** The 10 a person a day (3,000 for the product) stays as a safety net only.
- 🟢 **No "app is open" rule.** A mail's button opens the app, or focuses it; the OS handles an uninstalled app.
- 🟢 **Trial reminders stay off** (`TRIAL_REMINDERS`, untouched).
- ⚪ **Not designed on purpose:** replies while the Mac is off, and the interview reminder (the coordinator brings it to the owner first). The registry keeps a place for both.

## The three owners

| Owner | Mails | Who decides | In Admin |
|---|---|---|---|
| **Account** | sign-in code 🔒, confirm 🔒, about your feedback, Always on test | nobody: they go when the person asks | on the list, no switch on the locked ones |
| **Yours** | a row per automation (new matches, applied for you, an application needs you, interview reminder), Always on stopped working, nothing found for days, Job digest, Weekly summary | the person; we suggest | counts and the suggested default, read only: no stop (owner, 6 Nov 2026: "Only the person") |
| **Jobadabra's** | What's new, Tips and tricks (general), Pro is out and offers, come back (planned), trial reminders (off) | the owner on content and rhythm, the person on the tick | on/off and rhythm |

Job digest and Weekly summary were never promotional: they are the person's own reports.

**Come back** (owner: "a user just downloaded the app then stopped using. Then in 3 months we can get back to them say that look, we grew our job pool size by 3x"): it replaces the planned check-in and carries "What got in the way?". Goes once, 3 months after the app last reached us. It uses only that date and product facts, never the person's search or profile, and its footer names the date. It is promotional, so it needs the tick; the legal read below covers whether someone who gave their address for the product can get it with a stop link instead.

**No consent pop-up for what a person sets themselves** (owner: "we don't need to get any consent"). Three things stay: confirming the address (it protects strangers from mail they never asked for), the tick on Jobadabra's mail, and no upsell inside a person's own mail (a Pro banner would make it promotional). The stored choice of the CV switch (date and wording, `2026-11-05-email-consent-design.md`, public repo) stays. One legal read of the wording before it goes in ads.

## What each mode can run

| Automation | Mac only | Own accounts | Our servers |
|---|---|---|---|
| Find jobs | while open | Mac can be off | Mac can be off (daily on trial, down to every 4 h on Pro) |
| More employers (no row: the product decides, #3312) | while open | Mac can be off | on the Mac, while open |
| Insights | while open | Mac can be off | on the Mac, while open |
| Check Gmail & Calendar | while open | moves to the Mac | on the Mac, while open |
| Applying, Full automation included | on the Mac | on the Mac | on the Mac |

A mail about work done on the Mac can only go while the app is open, and its row says so.

## Suggested defaults

| Row | Mac only | Always on |
|---|---|---|
| Find jobs: new matches | in the digest | in the digest |
| Applying: applied for you | e-mail (8 Nov) | e-mail |
| Applying: an application needs you | e-mail (8 Nov) | e-mail |
| Gmail: interview reminder | e-mail (8 Nov) | e-mail |
| Ready to send: forms ready to check | e-mail (8 Nov) | e-mail |
| Always on stopped working | not shown | e-mail |
| Nothing found for days | not shown | after 3 days |
| Job digest | daily | daily |
| Weekly summary | Mondays | Mondays |
| What's new, Tips and tricks | off | off |

Owner, 6 Nov 2026: "on Mac only, the defualt notifications should be off for any automations, because they get the notification in the app... Only Weekly Summary and Jobs digest can be on". And: "When the user activates Always on, then all the automation notifications shuold turn to on, by default": turning Always on on turns every row on, except a row the person pressed off themselves (only the person decides).

Owner, 6 Nov 2026 (replacing the 5 Nov "consent" wording): the address found in the CV is presented as saved for the person's own notifications ("We shuold rather say that we detected it and we'll save it for future app notifications"), and the CV switch is "for enabling the email notifications", "On by default". Continue with it on sends the address to our site and turns on the suggested rows for the person's mode, each changeable in Settings → Notifications; turned off, nothing leaves the Mac and the step counts as asked. Notifications inside the app start on (nothing leaves the Mac); e-mail starts with that press, or later with one press in Notifications ("App on; e-mail off until one press"). Left off, it is suggested once at the moments it helps: an application needs the person, Always on, the first sent application. Asking for our news comes after the first sent application (owner: "we want lateron to ask for their consent on that, after first sent applciation"). A row the person has set is never reset by a mode change.

## Jobadabra's mails: five mails, two switches

Owner, 6 Nov 2026: "We should think/define a number of approximate 5 promotional emails to bring user back, to keep them engaged, to remind about us", "I'd keep What's new separate", then on five switches: "I think we went too granular. What user will agree on deliberately ticking \"Come back\"?", and on two: "I like the 2 switches".

| Mail | What | Switch | State |
|---|---|---|---|
| What's new | a release, nothing else | What's new | built |
| News and offers | "Pro is out", "we doubled our jobs list", offers | News and tips | built as Pro is out |
| Tips and tricks | general tips from our own library | News and tips | row 7 |
| Come back | quiet for 3 months | News and tips | row 7 |
| Trial reminder | the trial nears its end, or ended. Facts about their own trial | none: goes without a tick, stops from the mail | built, off until the owner turns it on |

In the app: a "News from Jobadabra" card under Notifications with the two switches, replacing today's single tick. Both off until the person says yes (owner, 6 Nov 2026: replaces 5 Nov's "on by default"), asked once after the first sent application. At most one What's new or News and tips mail per person per week.

A switch is for a choice a person would make, so the site keeps its two lists (`releases`, `tips`). Come back therefore reaches only people who said yes; reaching everyone would need the legal read and breaks "news needs its own tick". Not built.

## Every mail says why it came

Owner, 6 Nov 2026, on the first version: "these footers looks horriable. Loks like essays/novels", and "we shouldn't show \"Downlaod\" on user app email notifications". So every footer is at most two short lines: why, in a few words, then the links joined by " · ". A fact that needs a sentence sits behind a link.

| Mail | Line 1 | Line 2 |
|---|---|---|
| The person's own (app, their GitHub, our digest) | "You chose these in the app: Settings → Notifications." | Stop these emails · jobadabra.top (hosted Always on adds "How we keep your data" → /trust) |
| Jobadabra's news | "Same news for everyone. You asked for it." | Stop these emails · Email settings · jobadabra.top, then "Don't have the app? Download Jobadabra" (news also reaches people without the app) |
| Account | a few words: "This address was entered in Jobadabra.", "A security e-mail, sent even if you stopped others." | jobadabra.top; no stop link, no List-Unsubscribe header |

Owner, 6 Nov 2026, asked whether people care where a mail was written: "Keep promise, cut extras". The server still keeps nothing after sending; the footer no longer says where each mail was written. The web stop link stays on the person's own mails because someone who lost the app cannot reach Settings while their own GitHub keeps mailing them.

## What we can say (read 5 Nov 2026)

| Claim | Verdict | Why |
|---|---|---|
| Your search and profile are never used for our marketing | say it | nothing built uses them, and tips stay general. Not "your data": Come back uses the date the app last reached us |
| We never sell it, or use it to train AI | say it | on the privacy page |
| Stored encrypted, kept apart per account, deleted when you turn this off | say it | the owner's line, in the app; it covers the profile, found jobs are not encrypted with the person's key |
| You choose every e-mail | after the Notifications screen | |
| You'll get it 100% of the time | never | a run can fail; say "on schedule, even with your Mac off" |
| Written on your Mac, we kept no copy | after PR 5 | held mail sits in `mail_held` with its full text for up to 14 days |
| Jobadabra doesn't have your data | never | on our servers we hold the profile and decrypt it to run the search; Free AI passes through us, with no copy kept |
| Only you can read it | never | not end-to-end encrypted; the "How we protect your data" popup says so |
| Your data never leaves your Mac | never | the AI reads it in every mode; Technical reports are on by default (anonymous) |

## What exists today

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

Sent in the last 30 days (coordinator's sketch): confirm 9, app messages 8, what's new 5, sign-in code 1. Twenty-three mails.

Every mail from the engine is `message`, so a row per mail has nothing to key on. The engine knows the kind (`src/notify.py` `queue(kind=…)`); the site receives only `activity` or nothing (`api/account-email.js:130`). `digest` (hosted) and `message` (GitHub) are two paths to one thing, one run's new matches.

## Design

### 1. One registry (`shared/mail-registry.js`, new)

The one owner of what a mail is: id, owner (`account`, `yours`, `jobadabra`), locked or not, its suggested default per mode. `TEMPLATES` keeps subject/html/text. App mail gets virtual ids so `message` can be told apart: `app-matches`, `app-weekly`, `app-stopped`, `app-nothing`, `app-applied`, `app-needs-you`; `app-reminder` (Interview reminder) and `app-ready` (Forms ready to check) joined on 8 Nov 2026.

Stored: one D1 table `mail_rule (id TEXT PRIMARY KEY, enabled INTEGER, rhythm TEXT, at TEXT)`, one row per mail the owner changed. For a Jobadabra mail it holds on/off and rhythm; a Yours or locked mail is never written, and a stored row for one is ignored (owner, 6 Nov 2026: "\"Yours\" is not something that Jobadabra can control. It's in the users' hand", then "Only the person"). Suggested defaults per mode live in `mail-registry.js`, changed by a PR, not in this table. Locked mails cannot be written.
`send()` asks `ruleOf(id)` before the claim: off → `{ok:false, reason:'rule_off'}`, logged like any refusal and shown in "Why mail was not sent".

**A failed read never sends more than the owner chose** (the lesson of #442): a missing table leaves the defaults; any other read error keeps this Worker copy's last good answer, and with none holds every unlocked mail. Locked mails never wait for a rule.

### 2. The person's choices

One stored value per person and row, reused from `mail_on` / `mail_off`, with `pro_accounts.digest_cadence` as the digest's rhythm (kept, not retired). The site needs them for the mails it writes itself, and they hold ticks only, never search data. Automation, Notifications and the web link all write the same value.

### 3. Admin → E-mail → Settings

One list in three groups, by owner: name and "goes out when", last sent, sent in 7 days, preview. Jobadabra's rows have a real toggle (same press route and confirm as the switches) and a rhythm. Yours rows show 👤 Theirs, the suggested default and how many people turned each off, with no switch: only the person decides. Trial rows read "Off (TRIAL_REMINDERS switch)" and link to the Switches card. People's choices show only as counts.

### 4. Two screens, one stored value

- **Settings → Automation, the Schedules card:** a simple e-mail switch in line with each automation. Applying has no Schedules row, so its two switches sit on Settings → Apply.
- **Settings → Notifications:** the same switches again, then Summaries (Job digest, Weekly summary), then From Jobadabra. Both screens write the one value in section 2, so they can never disagree.
- **Each row says where it comes from:** "From your Mac: only while your Mac is awake and the app is open. If it isn't, no e-mail is sent." or "From Always on: on schedule, even with your Mac off." We do not promise 100%: a run can fail, and Always on stopped working covers that.
- **Without Always on,** the screen sells it in one line with the Turn on button: "Turn on Always on and these arrive on schedule, even with your Mac off." In the app only, never inside a person's own mail.
- **From Jobadabra** sits apart and says it has nothing to do with Mac only or Always on.
- Rows that cannot exist in a mode are not shown. Telegram is not touched by this spec. Turning a mail off is a plain choice: one line says what they will no longer hear about, with no confirm step (v3's "We strongly advise against this" goes: "it's they deciding for them").

### 5. Mac mail is not stored

One sender: the site (`shared/mail.js` `send()`). The Mac never sends a mail itself; it posts the text to `POST /api/notify/email` with its install key, to the person's own address only, and the site sends it (owner, 6 Nov 2026: "desktop app can just send an API request to our API and we send the mail, to avoid duplicate the email sending logic in 2 places"). Sending from the Mac alone would need Gmail's `gmail.send` scope (a new Google verification) or a mail key inside the app (anyone could copy it): not done.

Mail written on the Mac goes at once, or the Mac holds it for its digest and sends one mail. `mail_held` stops taking it, so the footer is true. Own accounts keep `mail_held` while the repo has nowhere to hold; their footer makes no such claim.

### 6. Job digest and Weekly summary

Both Always on by default, and the person's rhythm. Own accounts get the Monday report the engine already sends (`src/telegram.py:57`), with its own kind `weekly`; **no second report**. On our servers the report cannot exist, because it needs the applications, so the site writes plain counts with no AI: searches run and new matches from `hosted_runs.new_count`, the best few from `hosted_inbox`.

### 7. Insights and tips

- Made on the device from the person's applications (`src/ai/insights.py`), once a day when the app is open, with no row in Schedules. Own accounts keep running them on GitHub. People paying with their own AI key get a plain on/off in Settings.
- Seen in Reports and the Focus and Jobs suggestions card, in every mode. That is where personal tips live (owner: "Don't we already provide suggestions/tips in the app?").
- Tips and tricks by mail come from our own library. Nothing personal reaches the site, so no privacy change.
- Learning from people's data stays with Technical reports, the switch on the Welcome screen, on by default, anonymous. No new tick. A tick for tips must never double as permission for our analysis: that would make the privacy line false.

### 8. Check Gmail stays on the Mac

Owner: "Mac now, phone later". The GitHub Gmail job stops and the Google sign-in leaves the repo (the coordinator owns that move). It never ran on our servers. Findings land in the app. No mail here needs Gmail read while the Mac is off.

### 9. The Schedules card (decided; sc builds it in the public repo)

Owner, via the coordinator: "Yes, say where (Recommended)", "Yes, one place searches (Recommended)". Two rows, Find jobs and Check Gmail & Calendar (#3312: the person should not see the employer search), the status says where each runs, and with our servers on the Mac stops its own scheduled search; the Find jobs button still works. Insights get their own once-a-day trigger.

### 10. The new mails (off until the owner turns each on)

| Mail | Goes out when | Source | Notes |
|---|---|---|---|
| Always on stopped working | a hosted run is refused or paused, or the GitHub run fails (`src/notify.py` `failure_words`) | hosted run result, `admin/mail-lifecycle.js:50`, the engine | once per cause per 24 h; one fix link |
| Nothing found for days | N days of runs with no new match (default 3, the person's row) | `hosted_runs.new_count` / the engine's run log | links to "Were you expecting more jobs?" |
| Weekly summary | the person's day | section 6 | |
| Applied for you | Full automation sent an application | the Mac | lists, never a bare count |
| An application needs you | an application is waiting for the person | the Mac | one per waiting job |

### 11. Room left, not designed

The owner is still deciding replies while the Mac is off. The interview reminder is a Yours row (built 8 Nov 2026: the engine's existing prep message, the evening before or the morning of, now under its row; nothing about the interview is left on the site). Inbound mail is a second entry type (`direction: 'in'`); the Worker already has an `email` handler (`admin/test-mail.js`).

## Pull requests (the site lands first; the public repo then uses it)

| # | Repo | What | Who gets what |
|---|---|---|---|
| 1 | site | registry with three owners, `mail_rule`, `ruleOf` in `send()`, fail-closed read | the owner: one stop for each Account and Jobadabra mail (Yours: the person's, see Decisions) |
| 2 | site | Admin → Settings: the list by owner | the owner: sees who decides what |
| 3 | site | stored choices per row, `notify/email` accepts `kind`, the mail settings page rows | a person: the footer link changes the same rows |
| 4 | public | the switches in Automation and Notifications with suggested defaults, the Mac or Always on line, the Always on pitch; the engine sends kinds and honours rows | a person chooses each mail and knows when it can arrive |
| 5 | site | footers by owner in two short lines; no unsubscribe on Account mail; the digest obeys a row the person turned off (the row is stored with a held mail). Owner, 6 Nov 2026, "Keep promise, cut extras": the Mac does not keep its own digest | a person sees why a mail came, and it is true |
| 6 | site + public | the new mails, one PR each, each off until the owner turns it on | Always on and Full automation people |
| 7 | site | Tips and tricks from a general library; the Come back mail | people who ticked them |
| 8 | site | the privacy line on the website, after 4 and 5, with one legal read | people deciding whether to trust us |

PRs 1 to 3 ship with every new row **off**; existing mails keep today's behaviour. PR 3 can merge before PR 4 (an old engine sends no kind: it keeps today's path). **PR 5's "Mac mail is not stored" reaches people before PR 4's switches** (review of hr-31): a mail held on our server for the digest carries no row, so one held before a person turns its row off would still go in the digest; once the Mac holds its own mail, nothing is held here to re-check.

## Decisions (the owner's, 5 Nov 2026)

| Decision | Answer |
|---|---|
| Mail types | "Three owners"; 6 Nov 2026, the owner replaced the emergency stop on Yours: "If enable or disable from here, and they do the same from their desktop app, what happens? Who has higher precedence?" → "Only the person" |
| Mac only mail | "Their choice" |
| Where to manage it | "from both Automations and Notifications": a switch beside each automation, the same switches in Notifications |
| Footer of Yours mail | "App line + small web link" |
| Footer of Account mail | no unsubscribe |
| Win-back | Come back, after 3 months |
| Privacy line | "combine 1 and 2" |
| Personal tips | in the app, where they are; Tips mail general |
| Learning from data | the Technical reports switch, already on the Welcome screen, on by default |
| Insights | "I agree to be product feature" |
| Monday mail on our servers | "Plain counts" |
| Schedules card | "Yes, say where", "Yes, one place searches" |

**Replaced by this version:** Admin sets the rhythm (now the person); no job mail on Mac only (now the person's choice, mostly off); Full automation as an exception (now two ordinary rows); "Yes, one sentence, 30 days" for Tips (no sentence reaches the site, no privacy sentence); the strong service-off warning.

## Measure before building

- How many people have Always on (hosted or GitHub): the audience for the Always on defaults. Read from `hosted_schedules` and the engine's notify calls once PR 3 logs the kind.
- How many people change a suggested default, by row, once PR 4 ships: a default nobody keeps is the wrong default.

## 8 Nov 2026: a mail for every automation (replaces the Mac only defaults above)

Owner: "We're missing the email notifications switch for each automation" · "Let's wire all the unwired and siwthem them on on every row". The four automation rows (needs you, applied, interview reminder, forms ready) start ON in both modes once e-mail is on; a choice a person made is never reset. Interview reminder = the Mac's Gmail & Calendar check; Forms ready = our site at the end of a Ready to send night, counts only; Applied for you = the Mac. Parked: Replies found, Nothing found for days. Plan: jobadabra `docs/superpowers/plans/2026-11-08-mw-automation-mails.md`.

## Progress (6 Nov 2026)

| Row | State | PRs |
|---|---|---|
| Spec | ✅ merged | web#447 |
| 1–2 | ✅ merged | web#452 |
| 3 | ✅ merged, live | web#456 |
| 4 | ✅ merged, switches shown | public #3335 |
| 5 | ✅ merged | web#460 footers in two short lines (owner: "Loks like essays/novels", "Redo it"); Mac-only defaults: only New matches (digest) and Weekly summary on |
| 5b | ✅ merged, migration 0139 applied | web#463 |
| 8a | ✅ merged | web#459 the data promise as three levels with chips; `privacy.html` and `terms.html` stay for row 8 |
| 7a | ▶️ site first, then the app card | two switches on `/api/mail/choices`, What's new off until a yes, the weekly cap |
| 6, 7, 8 | ⏳ | new mails; Tips and Come back (+ news consent after the first sent application, Backlog); privacy page and terms with a legal read |

