// The engine's "Job boards…" lines of each press, printed in the random draw's job log (.github/workflows/random-draw.yml), so a press's boards_read
// (tools/persona-search/funnel.py: the boards with a "Job boards found: <name> N job(s), M relevant" line) can be explained: which boards were proposed,
// skipped, read and what each gave (26 Oct 2026: a before/after pair went from 12 boards to 0 and no log said why).
// Board names and counts only: the roles' search words are cut to a count, links are cut, no other line of the log is shown. Guard: test/unit/jobs/board-lines.test.js.
// Usage: node jobs/persona-search/board-lines.mjs <draw folder with run-<press>.log>
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const STEP = /^\[(\d+)s\] /;
const COUNT = /^Job boards found: (.+?) ([\d,]+) job\(s\), ([\d,]+) relevant/;
const QUERIES = /^(Job boards: searches for all your roles worked out with AI: )(.*)$/;
const number = text => Number(String(text).replace(/,/g, ''));

function clean(part) {
  const queries = part.match(QUERIES);
  const kept = queries ? `${queries[1]}${queries[2].split(', ').filter(Boolean).length} searches` : part;
  return kept.replace(/https?:\/\/\S+/g, '<link>').replace(/\S+@\S+\.\S+/g, '<mail>');
}

// The "Job boards…" lines of one press log, each with its time, a repeat shown once.
export function boardLines(text) {
  const seen = new Set(), out = [];
  for (const raw of String(text).split('\n')) {
    const at = raw.match(STEP), line = raw.replace(STEP, '');
    for (const part of line.split('⏳').map(piece => piece.trim())) {   // a progress line can carry another after it
      if (!part.startsWith('Job boards')) continue;
      const kept = clean(part);
      if (seen.has(kept)) continue;
      seen.add(kept);
      out.push(at ? `[${at[1]}s] ${kept}` : kept);
    }
  }
  return out;
}

// One press's block: its lines and the boards_read sum as funnel.py counts it (a board read twice keeps its best read).
export function pressReport(press, text) {
  const lines = boardLines(text);
  if (!lines.length) return `Press ${press}: no "Job boards" line in the log: the board step printed nothing`;
  const boards = new Map();
  for (const line of lines) {
    const m = line.replace(STEP, '').match(COUNT);
    if (!m) continue;
    const [jobs, relevant] = boards.get(m[1]) || [0, 0];
    boards.set(m[1], [Math.max(jobs, number(m[2])), Math.max(relevant, number(m[3]))]);
  }
  const sum = index => [...boards.values()].reduce((total, pair) => total + pair[index], 0);
  return [`Press ${press}, job boards:`, ...lines, `Press ${press}: ${boards.size} boards read (boards_read), ${sum(0)} jobs, ${sum(1)} relevant`].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) { console.error('usage: node jobs/persona-search/board-lines.mjs <draw folder>'); process.exit(2); }
  const logs = fs.existsSync(folder) ? fs.readdirSync(folder).map(name => name.match(/^run-(\d+)\.log$/)).filter(Boolean).sort((a, b) => a[1] - b[1]) : [];
  if (!logs.length) console.log('No press log: the search did not start');
  for (const m of logs) console.log(`${pressReport(Number(m[1]), fs.readFileSync(path.join(folder, m[0]), 'utf8'))}\n`);
}
