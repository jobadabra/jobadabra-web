// The daily draw's alarm (.github/workflows/random-draw.yml, after the upload): the draw's verdict against every earlier draw (the upload's answer: admin/search-lab-draws.js judge),
// or, when the upload did not run (a branch), against its own numbers only. A reason in `alarm` (0 relevant jobs, a crash, a floor from the draws' numbers) files or updates the
// issue for its field × place × path (search-alarm.mjs); a draw with none closes an open one.
//   GH_TOKEN=... node jobs/persona-search/draw-alarm.mjs <out> [--verdict <upload answer.json>] [--run <url>] [--repo owner/name] [--dry]
// Guard: test/unit/jobs/search-alarm.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {judge, rowFromDraw} from '../../admin/search-lab-draws.js';
import {act, body, fingerprint, title, REPO} from './search-alarm.mjs';
import {pathToFileURL} from 'node:url';

// The draw's case for search-alarm.mjs. `verdict`: the upload's answer ({alarm, why, severity}) or null.
export function caseOf(info, presses, verdict, run = '') {
  const row = rowFromDraw(info, presses, {build: null});
  const judged = verdict?.ok ? verdict : judge([row])[0];
  return {source: 'random-draw', field: row.family, role: row.role, place_kind: row.place_kind, place: row.place_kind ? row.place : `${row.city}, ${row.country}`,
    path: row.path || 'first', engine: row.engine, date: row.draw_date, severity: judged.severity, why: judged.alarm || [], run,
    counts: {'Jobs in the places': row.in_places, 'Scored': row.scored, 'Relevant (fit 70+)': row.fit70}, funnel: row.funnel};
}

async function main() {
  const option = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
  const out = process.argv[2];
  if (!out || out.startsWith('--')) { console.error('usage: node jobs/persona-search/draw-alarm.mjs <out> [--verdict <file>] [--run <url>] [--repo owner/name] [--dry]'); process.exit(2); }
  const folder = path.join(out, 'draw'), file = option('--verdict', '');
  const presses = fs.readFileSync(path.join(folder, 'presses.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const verdict = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8') || 'null') : null;
  const c = caseOf(JSON.parse(fs.readFileSync(path.join(folder, 'draw.json'), 'utf8')), presses, verdict, option('--run', ''));
  if (process.argv.includes('--dry')) { console.log(c.why.length ? `WOULD FILE ${fingerprint(c)}\n${title(c)}\n\n${body(c)}` : `WOULD PASS ${fingerprint(c)} (closes its issue if one is open)`); return; }   // a pass has no issue to print
  console.log(`alarm: ${act(c, {pass: !c.why.length, repo: option('--repo', REPO)})} (${fingerprint(c)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
