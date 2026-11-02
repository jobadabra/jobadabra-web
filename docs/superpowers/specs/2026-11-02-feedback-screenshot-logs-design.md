# Send feedback carries a screenshot and the logs (design)

> **Verdict:** "Send feedback" gets the app window's screenshot and the relevant logs (secrets removed on the person's machine), and the owner gets a Telegram message with the photo and a link to the logs. Today a failed Telegram send leaves no trace; that is fixed first.

Owner, 2 Nov 2026: "extend the "Send feedback" feature/dialog. SO that it sends a screenshot with the app screen. and all the relevant logs." · "And me, as a admin/founder I should get a telegram message when a new feedback is received".
Trigger: a Windows tester hit a setup bug the owner only saw through a screen share.

## What was found (Step 1, 2 Nov 2026)

| Check | Result |
|---|---|
| Secrets `BRAIN_BOT_TOKEN`, `BRAIN_CHAT_ID` on the production Worker `www` (Cloudflare API, names only) | both exist |
| Feedback rows in D1 `www-stats` | 3 rows, the last 2 Oct 2026; no way to tell whether Telegram got them |
| `api/feedback.js` send | `fetcher(...).catch(console.log)`: only a network error is caught; Telegram's own refusal (`ok:false`, 400/403) is a resolved response and was ignored. **A failed notification was invisible.** |

Root cause of "invisible": the result of the send was never stored. Fix: every send's result is written on the row (`notified`), and /admin shows a counter of messages that did not arrive.

## Design

### States of one feedback (one owner: `api/feedback.js`)
| State | Set by | Meaning |
|---|---|---|
| stored | the INSERT | words, version, platform, screen, contact are in D1 |
| files | the PUT to R2 | `shot`/`logs` flags = 1 when the object is kept |
| notified | the Telegram verdicts | `''` (not tried, old rows) · `sent` · `failed: <status> <why>` · `off` (no bot secrets) |

### Site (this repo, PR 1/2)
- `POST /api/feedback` accepts, besides today's fields: `screen` (≤ 60 chars, the page the person was on), `screenshot` (a PNG/JPEG data URL, decoded ≤ **2 MB**), `logs` (text ≤ **200 KB**). Over a cap: the feedback is kept without that part and the answer says `{ok:true, skipped:['screenshot']}`; never a refusal of the words. The 10-a-day-per-install 429 stays.
- Files go to a private R2 bucket `feedback-files` (binding `FEEDBACK_FILES`), keys `feedback/<ref>/screen.<png|jpg>` and `feedback/<ref>/logs.txt`; `<ref>` is a random 16-hex id on the D1 row. Deleted after **90 days** by the daily cron (`purge`), like the lab videos.
- Telegram: message 1 (`sendMessage`) = the words, version, OS, screen, contact, **link to the logs on /admin**; message 2 (`sendPhoto`, a reply to message 1) = the screenshot. Each response is read (`ok`); the verdict is written to `notified`.
- `/admin/growth/feedback`: a counter "⚠ N not delivered to Telegram", per row the screenshot thumbnail (click: full size), a "Logs" viewer, the `notified` flag. Files are served only through `GET /admin/growth/feedback/file?ref=…&kind=screen|logs` behind the admin login (`viewer`), `no-store`.

### App (PR 2/2, public repo)
`capturePage()` of the Jobadabra window when the dialog opens (before it draws), thumbnail with "Include screenshot" (ON, ×); "Include logs" (ON) with "See what's sent"; every log line through a redactor (keys, tokens, LinkedIn session, e-mails, home-folder names); a test feeds a log full of fake secrets.

### Screen data and profile snapshot (3/3, owner, 2 Nov 2026)
Owner: "it should offer by default (being on) the option to send the data from that page or which is relevant to debug … And yes, let's add an option to send a snapshot of the entire profile, but with a small warning note about the privacy." · "send enough data and evidences that we can debug: app version, OS platform, installation id (the email if the user has set it) … Screenshot, data, profile".
- `POST /api/feedback` also accepts `page` (the screen's data, JSON text ≤ **200 KB**, ON by default in the app) and `profile` (a snapshot of the whole Profile, JSON text ≤ **200 KB**, OFF by default). Over a cap, not text, no bucket or past the day's file cap: skipped and said, like the logs.
- Same bucket, keys `feedback/<ref>/page.json` and `profile.json`; row flags `page`, `profile` (0/1, migration 0125); the 90-day purge clears them. One table `TEXT_FILES` (shared/feedback.js) names the kinds for the endpoint, the file route and the purge.
- /admin: the card shows "Logs", "Screen data" and "Profile snapshot (the person turned it on)" viewers. The Telegram message lists what came ("Screenshot · Logs · Screen data · Profile on /admin"); the profile and the page data are never put in Telegram itself.
- App (3/3): one registry page → function returning that page's data; the app's identity block (version, OS + version + arch, install id, e-mail if set) is always sent and shown in "See what's sent".

## Privacy
Redaction happens on the person's machine before anything leaves it (PR 2/2). The Worker stores what it receives and never reads the logs; no job or CV text is put in logs by the app (`desktop/lib/log.js` rule).

## Progress
- [x] Step 1: Telegram secrets and D1 checked
- [x] Spec
- [x] 1/2 site: migration, endpoint, R2, Telegram verdicts, /admin, purge (tests first) (#334)
- [x] 2/2 app: screenshot, logs bundle + redactor, dialog, "See what's sent" (jobadabra#3012)
- [ ] 3/3 site: `page` + `profile` files (migration 0125)
- [ ] 3/3 app: screen-data registry, profile snapshot, identity block, dialog switches + privacy note
- [ ] Owner's end-to-end proof after deploy: one real feedback → Telegram photo + logs link
