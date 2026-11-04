// Testing → Overview: the catalogue of every way we look for bugs (owner, 1 Nov 2026: "all different methods of testing and finding bugs we use to keep the app
// qualitative, bug-free and reliable"; unit tests are left off: they are for agent development, not proof the app is stable). Pure data: what each method proves, how its
// last run and its bug count are found in stored data (admin/testing-overview-data.js), the page that has the detail. Cadence comes from the workflow's own cron when the
// schedules snapshot has one; `when` is the trigger in words for the ones that are not crons (checked against the public workflows by test/unit/admin/testing-overview.test.js).
//
// A line = one way the method runs:  {label, wf?: workflow file, when?: trigger words, last?: where the last run is read, byHand?: true}
//   byHand: the workflow has no trigger but workflow_dispatch (debugging only): shown as "by hand", its last run is information and never paints the card red (owner, 1 Nov 2026)
//   last (omitted = the workflow's newest finished run): {e2e: [run kinds]} | {suite: name} (its newest night in the e2e snapshot) | {integration: true} | {synthetic: true} (the Worker's probe rounds, shared/synthetic.js) | {none: why}
// bugs = how "bugs caught" is read: {checks: [workflow files]} (PR-check scorecard, 30 days) | {detector: name} (self-healing, 7 days) | {caught: true} (e2e reds that caught a bug)
//   | {mutation: true} | {recall: true} | {sentry: true} | {none: why}

export const RINGS = [
  {id: 'prove', icon: '🛡️', title: 'Prove the journeys work', note: 'what must never break, run on the real app'},
  {id: 'find', icon: '🔎', title: 'Find bugs nobody wrote a test for', note: 'the UI Finder and code review'},
  {id: 'testers', icon: '🧬', title: 'Test the testers', note: 'plant a bug, see if the checks notice'},
  {id: 'real', icon: '🌍', title: 'Real use and AI quality', note: 'what installs and recorded sites tell us'},
];

export const METHODS = [
  {id: 'e2e', ring: 'prove', icon: '🧪', title: 'E2E · Tier 1 journeys', proves: 'Must-not-break journeys, on the real app.', href: '/admin/testing/e2e',
    lines: [{label: 'After each merge', when: 'every merge to main', last: {e2e: ['after-merge']}}, {label: 'Night', wf: 'e2e.yml', last: {e2e: ['nightly', 'scheduled']}},
      {label: 'Beta build', wf: 'desktop.yml', last: {e2e: ['beta']}}],
    bugs: {caught: true}},
  {id: 'integration', ring: 'prove', icon: '🧩', title: 'Integration tests', proves: 'Extension, app and store, off the real internet.', href: '/admin/testing/integrations',
    lines: [{label: 'Every pull request that touches its area', wf: 'integration.yml', when: 'every pull request', last: {integration: true}}, {label: 'Page cases, full window', wf: 'page-cases.yml'}],
    bugs: {checks: ['integration.yml', 'page-cases.yml']}},
  {id: 'smoke', ring: 'prove', icon: '💨', title: 'Smoke', proves: 'The app starts and draws every Settings section.', href: '/admin/testing/pr-checks',
    lines: [{label: 'Pull request and merge', wf: 'smoke.yml', when: 'every pull request'}, {label: 'Windows', wf: 'windows-smoke.yml'}],
    bugs: {checks: ['smoke.yml']}},
  {id: 'upgrade', ring: 'prove', icon: '⬆️', title: 'Upgrade and data test', proves: 'Update an older install; nothing may be lost.', href: '/admin/testing/scheduled',
    lines: [{label: 'Weekly and monthly, report only', wf: 'upgrade-data.yml'}], bugs: {none: 'a red run is a finding, not yet a bug'}},
  {id: 'fresh-install', ring: 'prove', icon: '📦', title: 'Daily fresh-install smoke', proves: 'The published download installs and opens.', href: '/admin/testing/synthetic-monitoring',
    lines: [{label: 'Daily, report only', wf: 'fresh-install-smoke.yml'}], bugs: {none: 'a red run is a finding, not yet a bug'}},
  {id: 'gtm', ring: 'prove', icon: '🗺️', title: 'GTM readiness', proves: 'How stable each journey is.', href: '/admin/testing/gtm-readiness', linkOnly: true,
    lines: [{label: 'Own page', last: {none: 'this page only links to it'}}], bugs: {none: 'the page measures readiness, not bugs'}},

  {id: 'review', ring: 'find', icon: '🖼️', title: 'AI screenshot review', proves: 'An AI reads each screen like a job seeker.', href: '/admin/testing/self-healing',
    lines: [{label: 'Files what the review found', wf: 'ui-findings.yml', when: 'after each merge + night pass 1'}], bugs: {detector: 'AI screenshot review'}},
  {id: 'layout', ring: 'find', icon: '📐', title: 'Layout checks', proves: 'Clipped or off-screen text, no AI.', href: '/admin/testing/self-healing',
    lines: [{label: 'With every run that takes shots', wf: 'ui-findings.yml', when: 'after every e2e run'}], bugs: {detector: 'Layout and DOM checks'}},
  {id: 'interactions', ring: 'find', icon: '🖱️', title: 'Interactions', proves: 'Clicks every safe control; flags what breaks.', href: '/admin/testing/self-healing',
    lines: [{label: 'Night, report only', when: 'nights', last: {suite: 'interactions'}}], bugs: {detector: 'Interaction probe'}},
  {id: 'wander', ring: 'find', icon: '🧭', title: 'Wander', proves: 'A random walk through the app.', href: '/admin/testing/e2e',
    lines: [{label: 'Night, report only', when: 'nights', last: {suite: 'wander'}}], bugs: {none: 'not counted under its own name'}},
  {id: 'code-review', ring: 'find', icon: '🔍', title: 'AI code review', proves: 'Reads merged code; Gitar reads every PR.', href: '/admin/testing/pr-checks',
    lines: [{label: 'Merged code', wf: 'code-review.yml'}, {label: 'Gitar on every pull request', when: 'every pull request', last: {none: 'Gitar posts on GitHub only'}}],
    bugs: {detector: 'AI code review'}},

  {id: 'mutation', ring: 'testers', icon: '🧬', title: 'Planted code bugs', proves: 'Plants bugs in code; the suites must go red.', href: '/admin/testing/self-healing',
    lines: [{label: 'Planted-bug run', wf: 'mutation.yml'}], bugs: {mutation: true}},
  {id: 'recall', ring: 'testers', icon: '🪲', title: 'Planted UI bugs', proves: 'Plants visible bugs; counts what the Finder sees.', href: '/admin/testing/self-healing',
    lines: [{label: 'With the Interactions night', when: 'nights', last: {suite: 'interactions'}}], bugs: {recall: true}},

  {id: 'sentry', ring: 'real', icon: '🐞', title: 'Sentry', proves: 'Crashes and errors from real installs.', href: '/admin/testing/sentry',
    lines: [{label: 'Sentry fixer', wf: 'sentry-fix.yml'}], bugs: {sentry: true}},
  {id: 'canary', ring: 'real', icon: '🐤', title: 'Canary → stable', proves: 'A release reaches a few installs first.', href: '/admin/testing/scheduled',
    lines: [{label: 'Promote to stable', wf: 'canary-promote.yml'}, {label: 'Stable canary', wf: 'stable-canary.yml'}], bugs: {none: 'not counted as a bug yet'}},
  {id: 'synthetic', ring: 'real', icon: '📡', title: 'Synthetic monitoring', proves: 'Probes the live site and services every 15 min.', href: '/admin/testing/synthetic-monitoring',
    lines: [{label: 'Probe round', when: 'every 15 min', last: {synthetic: true}}], bugs: {none: 'a probe finds outages, not bugs'}},
  // Why (4 Nov 2026, AI user agents 9/12 part 3): the planned card became live when the agent's nightly run and its Admin tab shipped; its bug count is the Finder's detector for the agent's filed notes.
  {id: 'agents', ring: 'find', icon: '🤖', title: 'AI user agents', proves: 'An AI persona clicks through the app nightly.', href: '/admin/testing/ai-persona',
    lines: [{label: 'Night', wf: 'ai-user-agents.yml'}], bugs: {detector: 'ai-user-agent'}},
  {id: 'pool', ring: 'real', icon: '🏭', title: 'Real-site pool', proves: 'Recorded apply sites, replayed offline.', href: '/admin/form-filling/lab',
    lines: [{label: 'Offline replays', wf: 'site-replays.yml', byHand: true}, {label: 'Recording', wf: 'record-sites.yml'}], bugs: {none: 'the Lab page counts them per site'}},
  {id: 'quality-ai', ring: 'real', icon: '🎯', title: 'Quality AI and prompt cases', proves: 'Are the answers of the AI right and steady?', href: '/admin/testing/e2e',
    lines: [{label: 'Quality night', when: 'nights', last: {suite: 'quality'}}, {label: 'Prompt cases', wf: 'prompt-cases-night.yml', when: 'with the nightly run'}], bugs: {none: 'it measures answer quality, not bugs'}},
];

// Owner-approved methods that are not built yet (1 Nov 2026): grey cards, so the page grows when one lands. A landed one moves up into METHODS with a workflow.
export const PLANNED = [
  {id: 'faults', ring: 'find', icon: '⚡', title: 'Fault injection', proves: 'Notion errors, timeouts, offline, full disk.'},
];
