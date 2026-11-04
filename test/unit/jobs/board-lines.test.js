// The draw's job log shows the engine's "Job boards…" lines (jobs/persona-search/board-lines.mjs): board names and counts only, so a press's boards_read
// can be explained (26 Oct 2026: a before/after pair went from 12 boards to 0 and no log said why). The roles' search words are cut to a count.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {boardLines, pressReport} from '../../../jobs/persona-search/board-lines.mjs';

const LOG = [
  '[3s] Strategy: First Officer, Second Officer in Europe',
  '[12s] Job boards proposed for France, Germany: AeroCrew Jobs, PilotsGlobal',
  '[14s] Job boards: searches for all your roles worked out with AI: first officer A320, copilot jobs Toulouse, pilote de ligne',
  '[15s] Job boards: 2 read in the last 6 h skipped; reading 3 new ones',
  '[40s] Reading employer job sites: 120 of 997 ⏳ Job boards found: AeroCrew Jobs 41 job(s), 6 relevant',
  '[41s] Job boards found: AeroCrew Jobs 41 job(s), 6 relevant',
  '[44s] Job boards found: PilotsGlobal read by the AI page reader see https://pilotsglobal.example/jobs?q=first+officer',
  '[45s] Job boards found: PilotsGlobal 0 job(s), 0 relevant',
  '[50s] Job boards: a web search found no trade or local board',
  '[60s] Senior First Officer A320 at Example Air: 82',
].join('\n');

test('every Job boards line is shown with its time; other lines and job titles stay out', () => {
  const lines = boardLines(LOG);
  assert.deepEqual(lines.filter(line => line.includes('AeroCrew Jobs 41')), ['[40s] Job boards found: AeroCrew Jobs 41 job(s), 6 relevant']);   // a repeat is shown once
  assert.ok(lines.includes('[12s] Job boards proposed for France, Germany: AeroCrew Jobs, PilotsGlobal'));
  assert.ok(lines.includes('[15s] Job boards: 2 read in the last 6 h skipped; reading 3 new ones'));
  assert.ok(lines.includes('[50s] Job boards: a web search found no trade or local board'));
  assert.ok(!lines.some(line => /Example Air|Strategy|employer job sites/.test(line)));
});

test("the roles' search words and any link are cut", () => {
  const text = boardLines(LOG).join('\n');
  assert.match(text, /searches for all your roles worked out with AI: 3 searches/);
  assert.doesNotMatch(text, /first officer A320|Toulouse|pilote|https?:/);
  assert.match(text, /PilotsGlobal read by the AI page reader see <link>/);
});

test('the report names boards_read: the boards with a count line', () => {
  assert.match(pressReport(1, LOG), /^Press 1, job boards:\n/);
  assert.match(pressReport(1, LOG), /\nPress 1: 2 boards read \(boards_read\), 41 jobs, 6 relevant$/);
  assert.equal(pressReport(2, '[1s] Run counts: looked=0'), 'Press 2: no "Job boards" line in the log: the board step printed nothing');
});

test('the command reads every press log of the draw folder', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'board-lines-'));
  fs.writeFileSync(path.join(folder, 'run-1.log'), LOG);
  fs.writeFileSync(path.join(folder, 'run-2.log'), '[2s] Job boards: already read by this search; read again in a few hours\n');
  const out = execFileSync(process.execPath, [path.resolve('jobs/persona-search/board-lines.mjs'), folder]).toString();
  assert.match(out, /Press 1, job boards:[\s\S]*Press 2, job boards:\n\[2s\] Job boards: already read by this search/);
  fs.rmSync(folder, {recursive: true, force: true});
});
