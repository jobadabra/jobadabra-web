#!/usr/bin/env node
// Writes the daily build digest ("what we built today", spec docs/superpowers/specs/2026-10-16-daily-digest.md) from the PRs merged on one Zurich day, with a Haiku-tier call on the Codex broker (since 31 Oct 2026; admin/build-digest.js does the cutting, validating and rendering).
//   node jobs/daily-digest.mjs [--day YYYY-MM-DD] [--force [--final] [--rewrite]] [--out results.json] [--cost cost.json] [--prs prs.json --open open.json]
// Hourly (daily-digest.yml): asks the site what it holds (GET /digest/data), plans (build-digest.js plan: unchanged set, once an hour, 8 drafts, final from 23:00 Zurich) and stores the draft (PUT, SELFHEAL_PUBLISH_KEY).
// Needs gh with GH_TOKEN (unless --prs) and `permissions: id-token: write` (the broker's run token; a refusal fails loudly: "AI skipped", no fallback). --out: a list of {day, final, markdown, groups, open, numbers, usd}; --cost: {usd, calls} for desktop/e2e/ai-cost-report.mjs --job daily-digest --file.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {countOf, daysToRun, makeDigest, plan, zurichDay, zurichHour} from '../admin/build-digest.js';
import {post} from '../admin/build-digest-telegram.js';
import {aiLine, isRefusal, reportRefusal} from '../admin/ai-refusal.js';
import {askBroker} from '../desktop/e2e/lib/broker-client.mjs';   // the public tree's client of workers/ai-broker
import {pathToFileURL} from 'node:url';
import {PUBLIC_REPO} from '../shared/repos.js';

const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || PUBLIC_REPO;
const base = process.env.DIGEST_URL || 'https://www.jobpilotto.top/digest/data';
const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28}) || 'null');
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : ''; };

// The PRs merged on `day` (Zurich) and the open ones. gh's search is by UTC date: ask for the day before too, then keep the exact Zurich day.
export function collect(day) {
  const before = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const merged = gh('pr', 'list', '--repo', repo, '--state', 'merged', '--search', `merged:>=${before}`, '--limit', '400', '--json', 'number,title,mergedAt,body')
    .filter(pr => zurichDay(new Date(pr.mergedAt)) === day);
  const open = gh('pr', 'list', '--repo', repo, '--state', 'open', '--limit', '40', '--json', 'number,title');
  return {prs: merged.sort((a, b) => a.number - b.number), open};
}

// One day: look at what the site holds, decide (plan), write the digest, store it. Returns what happened, for the log and for the Telegram step (--out).
async function runDay({day, late, publishKey, now}) {
  const {prs, open} = arg('prs') ? {prs: JSON.parse(readFileSync(arg('prs'), 'utf8')), open: arg('open') ? JSON.parse(readFileSync(arg('open'), 'utf8')) : []} : collect(day);
  const numbers = prs.map(pr => pr.number);
  let stored = null;
  if (publishKey && !process.argv.includes('--force')) stored = await (await fetch(`${base}?day=${day}`, {headers: {Authorization: `Bearer ${publishKey}`}})).json();
  const decision = process.argv.includes('--force') ? {final: process.argv.includes('--final')} : plan({now, numbers, stored, late, zurichHour: zurichHour(now)});
  if (decision.skip) { console.log(`${day}: skipped (${decision.skip})`); return null; }
  const digest = await makeDigest({day, prs, open, broker: askBroker});
  const usd = 0, {calls} = digest, {count, min, max} = countOf(digest.numbers);   // the Codex plan has no dollars; `calls` is what the job costs
  console.log(`${day}: ${decision.final ? 'FINAL' : 'draft'}, ${count} PRs${count ? ` (#${min}-#${max})` : ''}, ${digest.groups.length} groups, ${calls} broker ${calls === 1 ? 'call' : 'calls'}`);
  if (aiLine(digest.answered)) console.log(aiLine(digest.answered));   // Why (owner, 1 Nov 2026): CI should know which model answers; the 23:33 timeout was only visible in the broker's health
  const rewrite = process.argv.includes('--rewrite');   // a closed day written again in the new form: stored over the old one, no Telegram post
  const result = {day, final: decision.final, ...(rewrite ? {rewrite: true} : {}), markdown: digest.markdown, groups: digest.groups, open: digest.open, numbers: digest.numbers, usd, calls};
  if (publishKey) {
    const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${publishKey}`, 'Content-Type': 'application/json'}, body: JSON.stringify(result)});
    if (!response.ok) throw new Error(`the site refused the digest (${response.status})`);
    const stored = await response.json().catch(() => ({}));
    // The post goes out once: only when the site stored THIS final digest (a closed day answers "ignored", so a repeat run posts nothing).
    if (decision.final && stored.final && !stored.ignored && !stored.rewritten) console.log(`Telegram: ${JSON.stringify(await post(result, {token: process.env.BUILDLOG_TELEGRAM_TOKEN, chat: process.env.BUILDLOG_TELEGRAM_CHAT}))}`);
  } else console.log('(SELFHEAL_PUBLISH_KEY is not set: nothing stored)');
  return result;
}

async function main() {
  const now = new Date(), results = [];
  const publishKey = process.env.SELFHEAL_PUBLISH_KEY;
  // Yesterday too, until a run has closed it (daysToRun): a missed night no longer leaves a day open.
  const days = daysToRun(now, arg('day'));
  // A refusal by the AI (limit, bad key, overload) is named, told on Telegram once per outage, and fails the run: the digest of that day is retried at the next run (owner, 24 Oct 2026: 7 of 8 runs failed unseen).
  try { for (const item of days) { const result = await runDay({...item, publishKey, now}); if (result) results.push(result); } }
  catch (error) {
    if (!isRefusal(error)) throw error;
    await reportRefusal(error, {job: 'Daily build digest', effect: 'Nothing was written for today; the next run tries again.', workflow: 'daily-digest.yml', zurichHour: zurichHour(now), run: (cmd, ...args) => execFileSync(cmd, args, {encoding: 'utf8'})});
    process.exit(1);
  }
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(results));
  if (arg('cost')) writeFileSync(arg('cost'), JSON.stringify({usd: results.reduce((sum, item) => sum + item.usd, 0), calls: results.reduce((sum, item) => sum + item.calls, 0)}));
  if (!arg('out') && !publishKey) for (const item of results) console.log(item.markdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
