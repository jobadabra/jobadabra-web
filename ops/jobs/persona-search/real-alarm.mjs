// The real installs' search alarm (owner 26 Oct 2026; run by .github/workflows/random-draw.yml after the draw's alarm, main only): per role family × country with
// 3+ installs (GET /search-lab/real-gaps, admin/search-lab-real-gaps.js), MIN_INSTALLS+ installs whose latest search found 0 relevant jobs files or updates its
// issue (search-alarm.mjs, one per field × place); a group where none did closes an open one; 1-2 such installs say nothing (k >= 3). Counts only.
//   REPLAYS_PUBLISH_KEY=... GH_TOKEN=... node jobs/persona-search/real-alarm.mjs [--run <url>] [--repo owner/name] [--dry]
// Guard: test/unit/jobs/real-alarm.test.js.
import {act, body, fingerprint, title, REPO} from './search-alarm.mjs';
import {pathToFileURL} from 'node:url';

export const MIN_INSTALLS = 3;

// One group of the route's answer -> {case, verdict: 'file'|'pass'|'quiet'}.
export function caseOf(group, day, run = '') {
  const verdict = group.zero >= MIN_INSTALLS ? 'file' : group.zero === 0 ? 'pass' : 'quiet';
  return {verdict, case: {source: 'real-installs', field: group.family, role: group.name, place_kind: 'country', place: group.country, path: 'real', date: day, run,
    severity: group.zero === group.installs ? 'high' : 'medium',
    why: verdict === 'file' ? [`0 relevant jobs (fit 70+) on the latest search of ${group.zero} of ${group.installs} installs`] : [],
    counts: {'Installs (k ≥ 3)': group.installs, 'With 0 relevant jobs': group.zero, 'Jobs in the places (median)': group.in_places}}};
}

async function main() {
  const option = flag => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : ''; };
  const answer = await fetch('https://www.jobpilotto.top/search-lab/real-gaps', {headers: {Authorization: `Bearer ${process.env.REPLAYS_PUBLISH_KEY}`}});
  if (!answer.ok) { console.log(`real installs: no answer (${answer.status}): nothing judged`); return; }
  const {day, groups} = await answer.json();
  if (!groups.length) console.log('real installs: no field × country with 3+ installs yet');
  for (const group of groups) {
    const {verdict, case: c} = caseOf(group, day, option('--run'));
    if (verdict === 'quiet') { console.log(`real installs: ${fingerprint(c)}: ${group.zero} of ${group.installs} with 0 relevant (under ${MIN_INSTALLS}: not told)`); continue; }
    if (process.argv.includes('--dry')) { console.log(`${verdict === 'file' ? 'WOULD FILE' : 'WOULD PASS'} ${fingerprint(c)}${verdict === 'file' ? `\n${title(c)}\n\n${body(c)}\n` : ''}`); continue; }
    console.log(`real installs: ${act(c, {pass: verdict === 'pass', repo: option('--repo') || REPO})} (${fingerprint(c)})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
