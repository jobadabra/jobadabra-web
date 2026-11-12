// Pure parts of /admin/operations/scheduled: read a workflow file (name, first comment, crons, hand-only, runner), say a cron in words, find its next and previous start,
// group a job into an area, judge its health. No network, no D1; the collector (jobs/schedules-snapshot.mjs) and the page (src/schedules.js) both use it. Guard: test/schedules.test.js.

export const AREAS = [
  {id: 'testing', label: 'Testing', hint: 'Suites, canaries, the Finder and fixers, labs and reviews', link: ''},
  {id: 'search', label: 'Job search & scouting', hint: 'Scouting, random draws, daily digest', link: '/admin/job-search/lab'},
  {id: 'other', label: 'Everything else', hint: 'Builds, watchdogs, cost and site jobs', link: ''}];
// File names (without .yml) per area; a new job lands in "Everything else" until it is listed here (test/schedules.test.js lists the unlisted ones in its failure text).
// Why (1 Nov 2026, owner: "I want a Schedules tab in Testing that will list all scheduled related to testing"): one Testing area (it took over Self-healing, which is a Testing page) so the Testing tab and the aggregate filter by the same ids.
const TESTING = ['e2e', 'desktop', 'mutation', 'windows-smoke', 'stable-canary', 'canary-promote', 'ai-answer-drift', 'code-review', 'pr-check-scorecard', 'tests', 'lab-ci', 'scout-canary', 'prompt-cases-night', 'coverage-report', 'ui-findings', 'ui-fix', 'ui-verdict', 'ui-ranking', 'finder-review', 'sentry-fix', 'fix-verdicts', 'issue-fixed', 'page-cases', 'record-sites', 'watch-live', 'harness', 'harness-daily', 'judge-exam', 'self-heal-stats', 'search-lab-heal', 'form-learning', 'e2e-intel', 'integration-intel', 'e2e-weekly', 'hosted-e2e'];
const SEARCH = ['scout', 'central-scout', 'board-discovery','random-draw', 'daily-digest', 'product-brain', 'proposer', 'aliases', 'playbooks'];
export const areaOf = file => { const id = String(file).replace(/\.ya?ml$/, ''); return TESTING.includes(id) ? 'testing' : SEARCH.includes(id) ? 'search' : 'other'; };

// ---- the workflow file ----
const unquote = text => text.trim().replace(/^['"]|['"]$/g, '');
// {name, about, crons, manual, runner}: `about` is the first comment line(s) under `name:` (the file's own words), at most 160 characters.
export function parseWorkflow(text) {
  const lines = String(text).split('\n');
  const name = unquote((lines.find(line => /^name:/.test(line)) || '').replace(/^name:/, '').split(' #')[0]) || '';
  const about = [];
  for (const line of lines.slice(lines.findIndex(l => /^name:/.test(l)) + 1)) { if (!/^#/.test(line)) break; about.push(line.replace(/^#\s?/, '')); }
  const crons = [...String(text).matchAll(/^\s*-\s*cron:\s*(['"])(.+?)\1/gm)].map(match => match[2].trim());
  const onBlock = String(text).split(/^jobs:/m)[0];
  const manual = /^\s*workflow_dispatch\s*:/m.test(onBlock);
  const runner = (String(text).match(/^\s*runs-on:\s*(.+)$/m) || [])[1]?.trim().replace(/['"]/g, '') || '';
  return {name, about: about.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160), crons, manual, runner, ai: /ai-cost-report|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|DIGEST_ANTHROPIC_KEY/.test(text)};
}
// The Worker's cron starts some workflows through the API (app-core/src/scheduler.js jobsFor): {file: [cron, ...]} from `cron === '<cron>'` lines that name a `workflow: '<file>'`.
export function parseWorkerCrons(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const cron = [...line.matchAll(/cron === '([^']+)'/g)].map(match => match[1]), file = (line.match(/workflow: '([^']+\.ya?ml)'/) || [])[1];
    if (cron.length && file) out[file] = [...new Set([...(out[file] || []), cron[0]])];
  }
  return out;
}
// A runner label's weight against GitHub's private-repo minutes: macOS counts 10, Windows 2, Linux 1; a public repo is free.
export const billedWeight = (runner, isPrivate) => (!isPrivate ? 0 : /mac/i.test(runner) ? 10 : /windows/i.test(runner) ? 2 : 1);

// ---- cron ----
function field(spec, lo, hi) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [range, step] = part.split('/'), stepN = Number(step) || 1;
    const [a, b] = range === '*' ? [lo, hi] : range.includes('-') ? range.split('-').map(Number) : [Number(range), step ? hi : Number(range)];
    for (let v = a; v <= b; v += stepN) out.add(v);
  }
  return out;
}
export function parseCron(cron) {
  const parts = String(cron).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    const [minute, hour, dom, month, dow] = [field(parts[0], 0, 59), field(parts[1], 0, 23), field(parts[2], 1, 31), field(parts[3], 1, 12), new Set([...field(parts[4].replace(/7$/, '0'), 0, 6)])];
    return {minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*'};
  } catch { return null; }
}
export const matches = (c, date) => c.minute.has(date.getUTCMinutes()) && c.hour.has(date.getUTCHours()) && c.month.has(date.getUTCMonth() + 1)
  && (c.domAny && c.dowAny ? true : c.domAny ? c.dow.has(date.getUTCDay()) : c.dowAny ? c.dom.has(date.getUTCDate()) : c.dom.has(date.getUTCDate()) || c.dow.has(date.getUTCDay()));
// The next (direction 1) or previous (-1) start of a cron after/before `from`, looking up to 32 days (a monthly cron); null for a cron it cannot read.
export function step(cron, from, direction = 1) {
  const c = parseCron(cron); if (!c) return null;
  const date = new Date(Math.floor(from.getTime() / 60000) * 60000 + direction * 60000);
  for (let i = 0; i < 32 * 1440; i++, date.setTime(date.getTime() + direction * 60000)) if (matches(c, date)) return new Date(date);
  return null;
}
export const nextOf = (crons, now) => crons.map(cron => step(cron, now, 1)).filter(Boolean).sort((a, b) => a - b)[0] || null;
export const prevOf = (crons, now) => crons.map(cron => step(cron, now, -1)).filter(Boolean).sort((a, b) => b - a)[0] || null;

const ZURICH = {timeZone: 'Europe/Zurich'};
export const clock = date => date.toLocaleTimeString('en-GB', {...ZURICH, hour: '2-digit', minute: '2-digit'});
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// One cron in plain words, in Europe/Zurich: "Daily 04:30", "Hourly at :17", "Every 3 h at :40", "Every 30 min", "Weekly Mon 04:00", "Monthly on day 1 07:41"; anything else keeps the cron text.
export function words(cron, now = new Date()) {
  const c = parseCron(cron); if (!c) return cron;
  const [m, h, dom, month, dow] = cron.trim().split(/\s+/);
  const at = hours => hours.map(hour => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, c.minute.size === 1 ? [...c.minute][0] : 0)); return clock(d); });
  if (m.startsWith('*/') && h === '*') return `Every ${m.slice(2)} min`;
  if (c.minute.size === 1 && h === '*' && dom === '*' && dow === '*') return `Hourly at :${String([...c.minute][0]).padStart(2, '0')}`;
  if (c.minute.size === 1 && h.startsWith('*/') && dom === '*' && dow === '*') return `Every ${h.slice(2)} h at :${String([...c.minute][0]).padStart(2, '0')}`;
  if (c.minute.size === 1 && dom === '*' && /^\d+(,\d+)*$/.test(h) && dow === '*') return `Daily ${at([...c.hour].sort((a, b) => a - b)).join(' · ')}`;
  if (c.minute.size === 1 && dom === '*' && /^\d+$/.test(h) && c.dow.size === 1) return `Weekly ${DAYS[[...c.dow][0]]} ${at([...c.hour])[0]}`;
  if (c.minute.size === 1 && /^\d+$/.test(h) && /^\d+$/.test(dom) && month === '*' && dow === '*') return `Monthly on day ${dom} ${at([...c.hour])[0]}`;   // Why (1 Nov 2026, nm): the upgrade test's 1st-of-the-month start showed as a raw cron on its Overview card
  return cron;
}
export const whenWords = (date, now = new Date()) => {
  if (!date) return '–';
  const day = d => d.toLocaleDateString('en-CA', ZURICH), diff = (Date.parse(day(date)) - Date.parse(day(now))) / 86400000;
  return `${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : date.toLocaleDateString('en-GB', {...ZURICH, day: 'numeric', month: 'short'})} ${clock(date)}`;
};

// ---- health ----
// Runs are newest first: [{at, conclusion: success|failure|cancelled|skipped|null, mins, url}]. State: off (disabled), none (never ran), red (last finished run failed), green.
export function stateOf(job) {
  if (job.disabled) return 'off';
  const done = (job.recent || []).find(run => run.conclusion);
  return !done ? 'none' : done.conclusion === 'failure' || done.conclusion === 'timed_out' ? 'red' : 'green';
}
// Missed: a start was due (the last scheduled time) more than the allowed lateness ago and no run began since. Lateness: half the interval, at most 2 hours (GitHub's scheduler is often late).
export function missed(job, now) {
  if (job.disabled || !job.crons?.length || !job.recent?.length) return false;   // a job that never ran shows "no run yet", not a miss
  const prev = prevOf(job.crons, now), next = nextOf(job.crons, now);
  if (!prev || !next) return false;
  const late = Math.min((next - prev) / 2, 2 * 3600000), last = Date.parse(job.recent[0].at) || 0;
  return now - prev > late && last < prev;
}
export const RUN_DOTS = 14;
