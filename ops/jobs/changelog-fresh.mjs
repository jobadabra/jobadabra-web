#!/usr/bin/env node
// Watchdog for the What's new page (owner, 24 Oct 2026: "outdated, why is it not updated on a new release?"): fails and tells the owner when the newest STABLE desktop release is missing from the page more than 2 hours
// after it was published. Runs as a step of daily-digest.yml (its own hourly schedule, so it still fires when changelog-publish.yml's runs are dropped by GitHub). No AI, no cost. Guard: test/jobs/changelog-fresh.test.js.
import {execFileSync} from 'node:child_process';
import {zurichHour} from '../admin/build-digest.js';
import {shouldTell, previousConclusion, tellOwner} from '../admin/ai-refusal.js';
import {pathToFileURL} from 'node:url';
import {PUBLIC_REPO} from '../shared/repos.js';

const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || PUBLIC_REPO;
const base = process.env.CHANGELOG_URL || 'https://www.jobpilotto.top/changelog/data';
const STABLE = /^desktop-v(\d+\.\d+\.\d+)$/;
const order = version => version.split('.').map(Number);

// releases [{tagName, isPrerelease, isDraft, publishedAt}] + the versions the site holds -> the newest stable release that is missing and older than `hours` ({version, hours} ) or null.
export function staleStable(releases, have, now = new Date(), hours = 2) {
  const stable = releases.filter(item => STABLE.test(item.tagName) && !item.isPrerelease && !item.isDraft)
    .map(item => ({version: item.tagName.match(STABLE)[1], at: new Date(item.publishedAt)}))
    .sort((a, b) => { const x = order(b.version), y = order(a.version); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); });
  const newest = stable[0];
  if (!newest || newest.version in have) return null;
  const age = (now - newest.at) / 36e5;
  return age > hours ? {version: newest.version, hours: Math.floor(age)} : null;
}

async function main() {
  const out = (cmd, ...args) => execFileSync(cmd, args, {encoding: 'utf8', maxBuffer: 1 << 26}).trim();
  const key = process.env.SELFHEAL_PUBLISH_KEY;
  if (!key) { console.log('::error::SELFHEAL_PUBLISH_KEY is not set: the page was not checked.'); process.exit(1); }
  const releases = JSON.parse(out('gh', 'release', 'list', '-R', repo, '-L', '30', '--json', 'tagName,isPrerelease,isDraft,publishedAt'));
  const response = await fetch(base, {headers: {Authorization: `Bearer ${key}`}});
  if (!response.ok) { console.log(`::error::the site answered ${response.status} to GET /changelog/data: the page was not checked.`); process.exit(1); }
  const stale = staleStable(releases, (await response.json()).have || {});
  if (!stale) return console.log('the newest stable release is on the What\'s new page');
  const text = `${stale.version} (stable) has been out for ${stale.hours} hours and is not on the What's new page. Run changelog-publish.yml by hand; its log says why.`;
  console.log(`::error::${text}`);
  if (shouldTell({previous: previousConclusion('daily-digest.yml', {run: out}), zurichHour: zurichHour(new Date())})) console.log(`Telegram: ${JSON.stringify(await tellOwner(`⚠️ What's new is out of date: ${text}`))}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
