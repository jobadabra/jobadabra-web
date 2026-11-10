// The one list of alerts the owner can get (owner, 5 Nov 2026: "control easily on what I want to get alerted or not"). An event that is not here cannot send:
// api/ops-notify.js refuses it. Admin → Operations → Notifications and the Notify column of Scheduled draw from this list and the owner's settings (notify_settings).
// Why (5 Nov 2026, sketch Xo6tGKuwH7P86VcWq9eBv9): 3 channels, not today's 5 bots: Engineering = the CI alerts, build log and Sentry bots; Users = the Brain bot; Marketing = new.
// Fields: id (what a sender posts), label, group, on (default), mode + modes (When), channel (default), jobs (workflow files whose row on Scheduled carries the switch: a bare name is in the public repo, 'jobadabra-web/<file>' in this one),
//   status 'live' | 'new' (its sender is built in PR 4) | 'later', wired (true once its sender posts through /ops/notify: until then the switch is stored but changes nothing),
//   parked (a reason string: a decided wait; the page shows it as parked and leaves it out of the "senders moved over" count),
//   maxPerHour (a ceiling on top of the mode). Owner-facing alerts only: the 12 notifications each user gets about their own search are not here.
export const CHANNELS = [
  {id: 'engineering', icon: '🛠', name: 'Engineering', about: 'CI, releases, tests, Sentry, AI credit', env: null},
  {id: 'users', icon: '💬', name: 'Users & product', about: 'Feedback, form reports, Free AI spend', env: ['BRAIN_BOT_TOKEN', 'BRAIN_CHAT_ID']},
  {id: 'marketing', icon: '📈', name: 'Marketing & Sales', about: 'Sign-ups, installs, Pro', env: null},
];
export const MODES = {every: 'Every time', changes: 'Changes only', problems: 'Only problems', daily: 'Once a day'};
export const GROUPS = [['releases', '🚀 Releases'], ['main', '🔴 Main & tests'], ['ai', '🤖 AI'], ['users', '👥 Users'], ['site', '🩺 Site health'], ['marketing', '📈 Marketing & Sales']];

const a = (id, label, group, mode, channel, extra = {}) => ({id, label, group, on: true, mode, modes: [mode], channel, jobs: [], status: 'live', wired: false, ...extra});
export const ALERTS = [
  a('beta-published', '🧪 Beta published', 'releases', 'every', 'engineering', {wired: true, jobs: ['beta-approve.yml']}),
  // Why (5 Nov 2026, owner: "I didn't get any notification. I should have"; beta 0.9.12 failed in silence): a release that ends without reaching testers or stable (a build or the E2E gate failed or did not run, a promotion failed) tells the owner;
  // desktop/e2e/release-failed-alert.mjs in the public repo posts it. The release-alert for a lane that WAS offered stays `beta-published`.
  a('release-failed', '🔴 A release did not ship (build, E2E gate, promotion or store publish failed)', 'releases', 'every', 'engineering', {jobs: ['desktop.yml', 'canary-promote.yml'], wired: true}),   // the sender (public #3293, desktop/e2e/release-failed-alert.mjs) merged first; until this is live the site answers 400 and the old bot sends it
  a('stable-promoted', '✅ Stable promoted', 'releases', 'every', 'engineering', {wired: true, jobs: ['canary-promote.yml']}),
  a('msstore-status', '🏪 Microsoft Store accepted / refused / recovered', 'releases', 'every', 'engineering', {wired: true, jobs: ['msix-store-watch.yml', 'msix-store.yml']}),
  a('chrome-store-failed', '🧩 Chrome Web Store publish failed', 'releases', 'problems', 'engineering', {wired: true, jobs: ['extension-store-publish.yml']}),
  a('release-guard', '🛡 Release guard stopped a release', 'releases', 'every', 'engineering', {wired: true, jobs: ['release-guard.yml']}),
  a('release-mail-draft', '📰 "What\'s new" mail draft ready', 'releases', 'every', 'marketing', {jobs: ['jobadabra-web/changelog-publish.yml'], wired: true}),
  a('main-red', '🔴 Main went red · back to green', 'main', 'changes', 'engineering', {wired: true, modes: ['every', 'changes'], jobs: ['e2e.yml', 'desktop.yml']}),
  a('nightly-skipped', '⏭ Nightly skipped (main e2e red)', 'main', 'every', 'engineering', {wired: true, jobs: ['e2e.yml']}),
  a('journey-failing', '🧭 A journey no longer passes', 'main', 'changes', 'engineering', {wired: true, modes: ['every', 'changes'], jobs: ['journeys.yml']}),
  a('harness-daily', '🧰 Harness daily: a check failed', 'main', 'problems', 'engineering', {wired: true, jobs: ['harness-daily.yml']}),
  a('replay-refill', '🔁 Replay refill needs a look', 'main', 'every', 'engineering', {wired: true, jobs: ['replay-refill.yml']}),
  a('replay-drift', '🎞 Site replays: pinned rows differ from live', 'main', 'every', 'engineering', {wired: true, modes: ['every', 'problems'], jobs: ['site-replays.yml']}),   // Why (5 Nov 2026, 3/4e): site-replays.yml was the one main-checks alert still on its own bot, so no switch could stop it; its sender is public node ci-alert.mjs (workflow -> event table)
  // Why (10 Nov 2026, owner: "If a source is getting lost · We should have red CI · We should have alerts · on the Engineering channel"; bot: "The CI-alerts Telegram bot (Recommended)"): the night
  // Search check (public search-personas.yml, desktop/e2e/search-alert.mjs) tells a lost source, a number under its floor, a night no AI answered, and green again once. On Engineering it is the bot
  // connected there (Admin → Operations → Notifications); when the switchboard refuses, the sender falls back to the CI-alerts bot.
  a('search-night', '🔎 Find jobs night check: a source lost, a floor broken or the night not run', 'main', 'changes', 'engineering', {wired: true, modes: ['every', 'changes'], jobs: ['search-personas.yml']}),
  a('pr-check-scorecard', '📊 PR check scorecard (monthly)', 'main', 'every', 'engineering', {wired: true, jobs: ['pr-check-scorecard.yml']}),
  a('daily-build-digest', '🗓 Daily build digest', 'main', 'daily', 'engineering', {on: false, jobs: ['jobadabra-web/daily-digest.yml']}),
  a('record-sites', '📼 Record sites / watch list: new failures', 'main', 'daily', 'engineering', {wired: true, on: false, modes: ['every', 'daily'], jobs: ['record-sites.yml', 'watch-live.yml']}),
  // Why (10 Nov 2026, owner: "Abuse-only ceiling"): a person's own AI key has no daily cap on cloud readiness, only a ceiling (about 500 reads) that catches a broken loop; the owner is told once a day (api/ready-read-access.js).
  a('ready-read-ceiling', '☁️ A cloud readiness install hit its abuse ceiling', 'ai', 'daily', 'engineering', {wired: true}),
  // Why (10 Nov 2026, owner: "~500/day + alert (Recommended)"): cloud Full automation has no daily limit, only a ceiling of about 500 submits per install that catches a broken loop; the owner is told once a day (api/ready-auto.js).
  a('ready-submit-ceiling', '☁️ A cloud Full automation install hit its abuse ceiling', 'ai', 'daily', 'engineering', {wired: true}),
  a('ai-fixer-round', '🔧 AI fixer: PR ready / red / conflict', 'ai', 'every', 'engineering', {wired: true, jobs: ['ai-fixer.yml', 'ai-fixer-follow.yml']}),
  a('ai-persona-night', '🧑‍💻 AI persona night report', 'ai', 'problems', 'engineering', {status: 'new', modes: ['every', 'problems'], jobs: ['ai-user-agents.yml']}),
  a('ai-credit', '🪫 AI credit ran out / AI refused a job / AI step skipped', 'ai', 'daily', 'engineering', {wired: true, modes: ['every', 'daily']}),
  a('free-ai-spend', '💸 Free AI spend over its day, month or neurons limit', 'ai', 'every', 'users', {wired: true}),
  a('broker-fallback', '↩️ Broker fell back to Free AI', 'ai', 'daily', 'users', {modes: ['every', 'daily'], parked: 'a once-a-day note from the broker Worker; it moves with the old bots (4/4)'}),   // Why (5 Nov 2026, coordinator): parked, not built: the note still arrives once a day at most and a new production secret on the broker is not worth it now; trigger: when the old bots retire (4/4). Listed so the page does not count it as waiting
  a('feedback-received', '💬 Feedback received', 'users', 'every', 'users', {wired: true}),
  a('form-reported', '📝 A form was reported', 'users', 'every', 'users', {wired: true}),
  a('email-added', '✉️ An account added or changed its e-mail', 'users', 'every', 'users', {wired: true}),
  a('form-report-waiting', '⏳ A reported form waits 2 days, not fetched', 'users', 'every', 'users', {wired: true}),
  a('feedback-overdue', '⏰ A feedback is 24 h old with no reply', 'users', 'every', 'users', {wired: true}),
  a('feedback-not-told', '📣 Feedback reporters not told after a release', 'users', 'problems', 'users', {wired: true, jobs: ['feedback-released.yml']}),
  a('index-copy-failed', '🗂 Employer list: the day\'s copy could not be saved', 'site', 'daily', 'engineering', {wired: true}),   // Why (5 Nov 2026, review): a failed copy must not stay unseen until the day a list is lost; the scout reads only the publish's status. `daily` = at most one message a UTC day, by the switchboard
  a('feedback-impact-down', '📉 Feedback impact job is down', 'users', 'problems', 'users', {wired: true}),
  a('always-on-failed', '☁️ Always on: a user\'s run failed', 'users', 'every', 'engineering', {status: 'new'}),
  a('sentry-issue', '🐞 Sentry: new / regressed / spike', 'site', 'every', 'engineering', {wired: true, maxPerHour: 30}),
  a('site-probe', '🌐 Site probe down · back up', 'site', 'changes', 'engineering', {wired: true, modes: ['every', 'changes']}),
  a('index-publish-refused', '🗂 Employer list: a publish was refused', 'site', 'daily', 'engineering', {wired: true}),   // Why (5 Nov 2026, owner's brief): a refused publish means a broken scout run and a list going stale. `daily` = at most one message a UTC day: the scout retries every 6 h
  a('index-kinds-dropped', '🗂 Employer list: most employer kinds lost in one publish', 'site', 'daily', 'engineering', {wired: true}),   // Why (6 Nov 2026, owner: "Alert on fields, block on employers (Recommended)"): told, never refused. `daily` = at most one message a UTC day
  a('search-check-dropped', '🔎 Night search dropped or missing (under two thirds of the personas measured, relevant local jobs down, employer sites out of time, or no result at all by 06:30 UTC)', 'site', 'daily', 'engineering', {wired: true}),   // Why (6 Nov 2026, owner: "I see nowhere in Admin... Where should I see it the search dropped? Am I getting alerted? I'm not alerted"): the nightly search check was green with 0 of 6 (5 Nov) and 2 of 6 (6 Nov) measured and nobody heard. The Worker judges the uploaded night (admin/search-night-judge.js) and tells once a day by the switchboard
  a('signup-new', '🎉 New sign-up (CV step done, e-mail given with consent)', 'marketing', 'every', 'marketing', {status: 'new'}),
  a('install-new', '📥 New install / download', 'marketing', 'daily', 'marketing', {status: 'new', modes: ['every', 'daily']}),
  a('pro-waitlist', '⭐ Pro early-access sign-up (waitlist)', 'marketing', 'every', 'marketing', {wired: true}),
  a('pro-purchase', '💳 Pro purchase', 'marketing', 'every', 'marketing', {status: 'later'}),
];
const BY_ID = new Map(ALERTS.map(alert => [alert.id, alert]));
export const alertOf = id => BY_ID.get(String(id)) || null;
export const channelOf = id => CHANNELS.find(channel => channel.id === id) || null;

/** An alert with the owner's saved row laid over its defaults; a saved value the registry no longer allows (a mode or channel that went away) falls back to the default. */
export function effective(alert, saved = null) {
  const mode = saved?.mode && alert.modes.includes(saved.mode) ? saved.mode : alert.mode;
  const channel = saved?.channel && channelOf(saved.channel) ? saved.channel : alert.channel;
  const on = saved && saved.enabled !== null && saved.enabled !== undefined ? Boolean(saved.enabled) : alert.on;
  return {...alert, on, mode, channel};
}
/** The alerts whose switch sits on a scheduled workflow's row (its file name and repo name, e.g. 'e2e.yml' in 'jobadabra'); the same file name in another repo is another job. */
export const alertsForJob = (file, repo = 'jobadabra') => ALERTS.filter(alert => alert.jobs.includes(repo === 'jobadabra' ? file : `${repo}/${file}`));
