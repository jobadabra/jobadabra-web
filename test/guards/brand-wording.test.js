// The product is called Jobadabra in every tracked file of the site repo; the old name (Job Pilotto, job-pilotto, JOB_PILOTTO, jobpilotto) survives only as a kept name (24 Oct 2026 rename; owner, 2 Nov 2026: "Everything that is job pilotto is renamed/dropped/replaced", no two versions).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {test} from 'node:test';

// CI runs this inside the joined tree (public files laid under this repo's): only this repo's own folders are scanned, the public repo has its own guard.
const OWN = /^(web|admin|api|shared|workers|jobs|media|preview|test|db)\//;
const NOT_SCANNED = /(^|\/)(node_modules|dist)\/|^AGENTS\.md$|^CLAUDE\.md$|^db\/migrations\/|^test\/fixtures\/|^test\/brand-wording\.test\.js$|\.(png|jpg|jpeg|gif|ico|svg|webp|mp4|woff2?|lock)$|package-lock/;
// Kept names, each with its reason: a line is allowed when one matches.
const KEPT = [
  /Job Pilotto\\?\.app|quit app "Job Pilotto"/,                              // the bundle's file name, which the install script and updater still use (productName in the public repo)
  /Job Pilotto (QA|Brain|Tests|Sentry|Sign-in)|connection "Job Pilotto"|integrations → Job Pilotto/,  // the QA data folder and external accounts' own names
  /jobpilotto(\\*\.top|\\*\.workers\\*\.dev)/,                              // the old domain we still own, and the account's workers.dev subdomain (installed apps call it)
  /sre[-_]job[-_]pilotto[-_]bot/,                                         // the Telegram bot's username and its Worker
  /job-pilotto(-app)?\b.*sentry|sentry.*job-pilotto|job-pilotto\.sentry/i, // the Sentry org and project slugs
  /secrets\.JOB_PILOTTO_/,                                                // a GitHub secret not yet copied to its new name
  /(ws\.)?job-pilotto-(ui-fix|ui-verdict|self-heal|e2e-testing)/,         // Anthropic console API key names
];

test('the site repo says Jobadabra, except the kept names', () => {
  const files = execFileSync('git', ['ls-files'], {encoding: 'utf8', maxBuffer: 1 << 26}).split('\n').filter(f => f && OWN.test(f) && !NOT_SCANNED.test(f));
  const bad = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      if (/job[-_ ]?pilotto/i.test(line) && !KEPT.some(rule => rule.test(line))) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(bad, [], 'say "Jobadabra" (or add the kept name to KEPT with its reason):\n' + bad.slice(0, 40).join('\n'));
});
