# E-mails: an "Open in Jobadabra" button that works, and the owner's footer (5 Nov 2026)

> **Verdict:** two PRs. 1/2 stops the e-mail button from sending an app that cannot open it to a dead end; 2/2 adds the owner's personal footer and Reply-To to every e-mail.

## PRs

| PR | What | State |
|---|---|---|
| 1/2 | "Open in Jobadabra" only for an app that can open it, else "Update Jobadabra"; /open says "Didn't open?" after 2 s | this PR |
| 2/2 | Footer "Questions? Just reply to this email" with the owner's photo and name; Reply-To support@ | next |

## Design (1/2)

- **One place** for "minimum app version for X": `shared/app-needs.js` (`NEEDS`). Mail asks `appButton()`; /open's text is tied to `NEEDS.open` by `test/unit/website/open-app.test.js`.
- **Version signal:** the newest `telemetry.version` (kind `health`) of any install linked to the account (`pro_devices`). Unknown = no claim: the Open button stays, /open's fallback covers it.
- **/open:** the page tries `jobadabra://`; if the window neither lost focus nor was hidden within 2 s, it shows the note.
- **Class:** any later feature that needs a newer app adds one line to `NEEDS` and wraps its link with `appButton()`.
