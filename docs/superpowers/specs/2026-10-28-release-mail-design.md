# Release mail: "What's new" to our users at each stable release

> **Verdict:** at each stable promotion the site builds a held draft from that version's What's new entry; the owner reviews it on /admin/email and clicks "Send to everyone". Sender: **Igor from Jobadabra**.

## Decisions (owner, 28 Oct 2026)
| Question | Answer |
|---|---|
| Audience | Everyone New releases reaches (owner, 5 Nov 2026: "this should be on by default"; "After confirming"): a confirmed account (or Pro) that has not stopped it, plus website waitlist signups. A waitlist signup from the app has seen "Nothing else", so it gets only the Pro launch mail. Rule: `newsRefusal` in `shared/mail-lists.js`; Admin → E-mail shows each address with what each type does for it. |
| Consent | Three types (owner, 5 Nov 2026: "we should not treat all the emails as one box"): **service** (on), **New releases** (on by default for a confirmed address; a stop turns it off), **Tips and tricks** (off until a real tick; carries the Pro launch offer, which every waitlist signup also gets). A stored yes is `mail_on`, a stop is `mail_off`; no row = no answer yet, so a default is told from a choice (`newsAnswered`). The old single box `marketing_opt_in` is no longer read; migration `0134` carried it over. |
| Switch | `MARKETING_MAIL=on` is turned on by the owner (his 28 Oct yes); the first real send is still his click only. |
| Unsubscribe | The footer of **every** promotional mail carries the one-click "stop" link + the `List-Unsubscribe` headers (already added by `shared/mail.js` for any non-essential template). Each link stops its own type only (a link from a mail sent before the split stops both news types). A test loops over every news template and fails if one lacks it. |
| Content | The complete `changelog_entries` row for the version: New / Improved / Fixed rows. Short subject `Jobadabra <version> · What's new`, prominent version heading; owner may add an introduction (5 Nov 2026). |
| Trigger | `release-stable.sh` / `canary-promote.yml` call the site once with the version; idempotent per version (`release_mail` row, primary key version). |
| Sender | `Igor from Jobadabra <news@jobadabra.top>`. |

## Pieces
1. `shared/mail-templates.js`: template `release` (list releases), our mail frame, categorized changelog rows, pills, update button.
2. `db/migrations/0105_release_mail.sql`: `release_mail(version PK, status draft|sent, headline, created_at, sent_at, sent_count)`; `pro_accounts.marketing_off_at`.
3. `admin/release-mail.js`: draft from changelog, list on /admin/email, "Send test", "Send to everyone" (batches under the 3000/day cap and 6/day/address).
4. `api/release-mail-ingest.js`: the promotion call (Bearer key), idempotent.
5. Tests: renders; unsubscribed/bounced get nothing; one version never twice; fake promotion; every marketing template has the stop link; MAIL off in tests.

## Open risk
Unconfirmed wizard addresses may be mistyped; bounces and complaints suppress automatically (`mail_off`). Audience may be tightened to confirmed addresses if the owner prefers.

## Review and test clarity (owner, 5 Nov 2026)

The release review page uses the shared admin main container, with responsive cards for preview, test and broadcast. Both text and email inputs use the admin theme. A test sends the saved draft to one entered address, adds `[TEST]` to its short versioned subject and identifies itself in HTML and text. The confirmation names the version, recipient and subject. It leaves the broadcast pending; sending to everyone remains the owner's explicit action. `sending` is shown as in progress, never completed.

Legacy drafts without category metadata read the complete changelog through the same adapter for preview, test and broadcast, including previously omitted fixes. No production data rewrite or AI generation is needed.

All email footers include “Don't have the app? Download Jobadabra”. The release CTA says “Open Jobadabra App” and uses the HTTPS `/open?view=jobs` handoff, which opens the installed app on Jobs. The email directs the user to choose Update; it does not promise to open an update dialog automatically (owner, 5 Nov 2026).

## Stable interval (owner, 5 Nov 2026)

Release emails are available only for versions recorded as stable. Both drafting and sending verify that channel; a beta cannot send even if a draft row was created earlier. Content is every visible changelog entry after the previous stable version through the target stable version, including intermediate betas and excluding the previous stable and later versions. Exact repeated changes are included once. Numeric version ordering determines the boundary, and a stable with no visible changes of its own still bounds the interval and triggers a draft when its beta interval has changes.

The same calculation serves new drafts, existing drafts, previews, tests and broadcasts. The email shows “Changes since version …”. A broadcast stores its complete content when claiming the draft; sending/sent previews and subsequent test copies retain that snapshot even if the public changelog is redrafted. No AI redraft or automatic send is needed.

## Finding drafts and testing templates (owner, 5 Nov 2026)

The Email overview starts with stable release draft links. Template titles open dedicated full-page sample previews with back navigation. Both sample-send buttons return to an anchored result inside the selected template, preserve detail mode, identify whether the destination was the test inbox or the entered address, and show readable failure reasons. Email inputs and buttons share the responsive admin styling. An accepted send is distinct from a received copy in Test inbox.

## Release template layout (owner, 5 Nov 2026)

Category labels sit above distinct change headings and regular-weight descriptions, giving the text the full content width on phones. Change groups are separated by spacing and light dividers. App labels use restrained inline emphasis rather than filled chips, and multi-step instructions use an ordered list. The version stays prominent; the primary button opens the app, and download remains a footer fallback. HTML and plain text carry the same instructions and destination.

## Live release preview (owner, 5 Nov 2026)

`/admin/growth/email?template=release` resolves to the newest stable version's real review page, not the sample template. The overview's release card and its test buttons use the same real stable-to-stable content. Gallery forms pin the version displayed, and the review URL pins the version being approved; a Latest stable email link resolves afresh when wanted. A test is marked TEST and never changes broadcast status. Missing real drafts show the latest stable changelog read-only with an explicit pending/no-changes state, never sample content or an older stable draft. Other email templates keep sample data. Viewing is read-only, and sending to everyone remains the owner's explicit confirmation.
