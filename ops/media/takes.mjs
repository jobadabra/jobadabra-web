// A take recorded once is reused while nothing it records changed (round 9, owner 24 Oct 2026: "let's do all the optimizations possible ... we're
// too slow right now"): a camera, check or words change then records nothing. The key is the take's piece (steps, window, text size), the
// recorders' sources, the app's commit, the persona's files and today's date (the demo's dates follow it); the take is looked up in the newest
// earlier set next to this one (tools/hero.sh keeps each set's .work). HERO_FRESH=1 records everything. Guard: desktop/test/media-takes.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {clipTo} from './camera.mjs';
import {edgesScript} from './edges.mjs';
import {nav} from './scenes.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
// What the recorders run (record-app.mjs, record-extension.mjs and what they import); the three functions they take from render-side modules are
// hashed by their source (RECORDER_FUNCTIONS), so a change elsewhere in camera.mjs, edges.mjs or scenes.mjs keeps the takes.
export const RECORDER_FILES = ['record-app.mjs', 'record-extension.mjs', 'fill-mark.mjs', 'screencast.mjs', 'persona-copy.mjs', 'hold.mjs', 'live-review.mjs', 'stand-in.mjs', 'form.html'];
export const RECORDER_FUNCTIONS = {'camera.mjs': [clipTo], 'edges.mjs': [edgesScript], 'scenes.mjs': [nav]};
export const KEY_FILE = 'take-key';

// Every file under a folder as "path size mtime", sorted. -> lines.
const listing = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, {recursive: true}).map(String).sort().flatMap(rel => {
  const stat = fs.statSync(path.join(dir, rel));
  return stat.isFile() ? [`${rel} ${stat.size} ${Math.round(stat.mtimeMs)}`] : [];
}) : []);

// The take's key. piece: what takeOf records (after phoneTake / pacing); appSha: the app's commit; day: the local date (YYYY-MM-DD). -> hex.
export function takeKey({label, piece, persona = {}, appSha = '', day = '', files = RECORDER_FILES, dir = here}) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({label, piece, appSha, day, persona: persona.folder || null}));
  for (const file of files) hash.update(fs.readFileSync(path.join(dir, file)));
  for (const fns of Object.values(RECORDER_FUNCTIONS)) for (const fn of fns) hash.update(String(fn));
  if (persona.folder) hash.update(listing(persona.folder).join('\n'));
  return hash.digest('hex').slice(0, 24);
}

// The newest set next to `out` (not out itself) whose kept take `label` has this key. -> that take's folder, or null.
export function keptTake(out, label, key) {
  const root = path.dirname(out);
  if (!fs.existsSync(root)) return null;
  const sets = fs.readdirSync(root).map(name => path.join(root, name)).filter(dir => dir !== path.resolve(out) && fs.statSync(dir).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const set of sets) {
    const dir = path.join(set, '.work', label);
    try {
      if (fs.readFileSync(path.join(dir, KEY_FILE), 'utf8').trim() === key && fs.existsSync(path.join(dir, 'log.json'))) return dir;
    } catch { /* no kept take there */ }
  }
  return null;
}

// Copies a kept take (its frames and log) into dir, as a copy-on-write clone where the disk can. -> the recorded log.
export function reuseTake(kept, dir) {
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  fs.cpSync(path.join(kept, 'frames'), path.join(dir, 'frames'), {recursive: true, mode: fs.constants.COPYFILE_FICLONE});
  fs.copyFileSync(path.join(kept, 'log.json'), path.join(dir, 'log.json'), fs.constants.COPYFILE_FICLONE);
  return JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
}
