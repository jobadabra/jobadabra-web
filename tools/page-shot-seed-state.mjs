// Demo data for the state cards of /admin/testing/bug-loop and the Red main tab (state-issues plan, 5 Nov 2026): made-up findings, detectors, ticks and suites, never a real issue or user.
export const stateFields = back => ({
  ranking: {open: 4, counts: {P0: 0, P1: 1, P2: 1, P3: 2}, rows: [
    {number: 301, title: 'settings: the button opens the wrong page', priority: 'P1', platform: 'Mac', score: 8, needsPerson: true, clean: false, build: 'aaaaaaa', days: 0, url: 'https://github.com/demo/demo/issues/301'},
    {number: 302, title: 'jobs: a disabled choice hides the server controls', priority: 'P2', platform: 'Mac', score: 4, needsPerson: false, clean: false, build: 'bbbbbbb', days: 2, url: 'https://github.com/demo/demo/issues/302'},
    {number: 303, title: 'src: a page loses its town without a structured location', priority: 'P3', platform: 'Windows', score: 2, needsPerson: false, clean: true, build: 'ccccccc', days: 9, url: 'https://github.com/demo/demo/issues/303'},
    {number: 304, title: 'desktop/lib: a CLI is excluded by the chat app path', priority: 'P3', platform: 'Mac', score: 2, needsPerson: true, clean: false, build: 'ddddddd', days: 1, url: 'https://github.com/demo/demo/issues/304'}]},
  scorecard: {at: '2026-11-05', yield: {thisWeek: {real: 6, falsePositive: 3}, lastWeek: {real: 4, falsePositive: 7}}, totals: {filed: 40, real: 22, falsePositive: 12, open: 4, precision: 65},
    detectors: [['ai-review', 'AI screenshot review', 20, 14, 6, 70 - back], ['code-review', 'AI code review', 12, 10, 2, 83], ['layout-check', 'Layout and DOM checks', 8, 2, 6, 25]].map(([source, detector, filed, real, falsePositive, precision]) =>
      ({source, detector, filed, real, falsePositive, open: 0, precision, causes: falsePositive > 3 ? {'fp:stale-build': 3, 'by-design': 2} : {}, severityChanged: {judged: filed > 10 ? 3 : 0}}))},
});

export async function stateRows(env, now = Date.now()) {
  const put = (key, value) => env.STATS.prepare('INSERT INTO ci_state (key, body, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, at = excluded.at').bind(key, JSON.stringify(value), new Date(now).toISOString()).run();
  await put('noise-register', {entries: [['profile', 'text on profile: a numeric box shows its label', 'false-positive', 'the label is the field name, not a leak'], ['focus', 'consistency on focus: suggestions show no evidence', 'false-positive', 'evidence is empty on purpose'],
    ['agent', 'step failed: the AI user agent works its goals', 'harness', 'the broker call timed out'], ['wizard', 'step failed: AI asks have stored answers', 'harness', 'a fixture-coverage check, not a product check']]
    .map(([view, title, word, why], i) => ({id: `n${i}`, view, kind: 'text', source: 'ai-review', title, detail: '', word, why, date: `2026-11-0${4 - (i > 1)}`}))});
  const items = [['i1', 'false-positive', 'actions: Gmail check status contradicts itself', '#2678', 'right'], ['i2', 'needs-human', 'src: Calendar title returned as account email', '#2589', 'wrong'], ['i3', 'false-positive', 'actions: toast and Recent runs differ', 'not filed (noise register)', null]]
    .map(([key, word, what, where, tick]) => ({key, word, what, where, tick, why: 'The code at the cited line does what the screen shows; the finding misreads it.'}));
  await put('verdict-audit', {audits: [{week: '2026-11-07', opened: '2026-11-07T06:00:00Z', closed: null, score: null, items}, {week: '2026-10-31', opened: '2026-10-31T06:00:00Z', closed: '2026-11-07T06:00:00Z', score: {right: 4, wrong: 1, size: 5}, items: []}]});
}

export async function redMainRows(env, now = Date.now()) {
  const ago = hours => new Date(now - hours * 3600000).toISOString();
  await env.STATS.prepare('INSERT INTO ci_state (key, body, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, at = excluded.at').bind('red-main', JSON.stringify({at: ago(1), reds: [
    {suite: 'focusdismiss', status: 'found', since: '8fc460d1111', sinceAt: ago(96), run: 'https://github.com/demo/demo/actions/runs/1', pr: {number: 2795, branch: 'xx-wizard-standin', title: 'AI replay key ignores per-run store ids'}, found: '4f2035e', good: 'd1495ce', tested: [['59b9a0c', 'failure'], ['7b0ca3c', 'failure'], ['4f2035e', 'failure']]},
    {suite: 'settings', status: 'bisecting', since: 'abc1234', sinceAt: ago(6), run: 'https://github.com/demo/demo/actions/runs/2', pr: null, good: null, tested: []}]}), ago(1)).run();
}
