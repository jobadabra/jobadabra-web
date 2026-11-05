// A take is reused while nothing it records changed, and two takes record at once (round 9, owner 24 Oct 2026: "let's do all the optimizations
// possible ... we're too slow right now"): the key moves with every input of a recording, and only with those.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {KEY_FILE, keptTake, RECORDER_FILES, RECORDER_FUNCTIONS, reuseTake, takeKey} from '../../media/takes.mjs';

const media = new URL('../../media/', import.meta.url).pathname;
const base = {label: 'hero-phone', piece: {steps: [{hold: 2, look: '#a'}], window: {width: 880, height: 660}}, persona: {}, appSha: 'abc', day: '2026-10-25'};

test('the key moves with the steps, the window, the app commit, the day and the persona; the same inputs give the same key', () => {
  const key = takeKey(base);
  assert.equal(takeKey({...base}), key);
  for (const change of [{piece: {...base.piece, steps: [{hold: 3, look: '#a'}]}}, {piece: {...base.piece, zoom: 1.25}}, {appSha: 'def'}, {day: '2026-10-26'}, {label: 'hero'}]) {
    assert.notEqual(takeKey({...base, ...change}), key, JSON.stringify(change));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
  try {
    fs.writeFileSync(path.join(dir, 'profile.json'), '{}');
    const withPersona = takeKey({...base, persona: {folder: dir}});
    fs.writeFileSync(path.join(dir, 'profile.json'), '{"name": "x"}');
    assert.notEqual(takeKey({...base, persona: {folder: dir}}), withPersona, 'an edited persona file');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the key covers every module the recorders import (a new import must join RECORDER_FILES or RECORDER_FUNCTIONS)', () => {
  const seen = new Set(), todo = ['record-app.mjs', 'record-extension.mjs'];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (RECORDER_FUNCTIONS[file]) continue;   // only the named functions are recorder code
    for (const [, dep] of fs.readFileSync(path.join(media, file), 'utf8').matchAll(/from '\.\/([a-z-]+\.mjs)'/g)) todo.push(dep);
  }
  for (const file of seen) assert.ok(RECORDER_FILES.includes(file) || RECORDER_FUNCTIONS[file], `${file} is imported by a recorder but not in the take key`);
  assert.ok(fs.readFileSync(path.join(media, 'stand-in.mjs'), 'utf8').includes('form.html') ? RECORDER_FILES.includes('form.html') : true);
});

test('the newest earlier set with the same key gives its take; this set, another key or a missing log does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sets-'));
  const take = (set, key, log = true) => {
    const dir = path.join(root, set, '.work', 'hero-phone');
    fs.mkdirSync(path.join(dir, 'frames'), {recursive: true});
    fs.writeFileSync(path.join(dir, KEY_FILE), key);
    fs.writeFileSync(path.join(dir, 'frames', 'f00001.jpg'), set);
    if (log) fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({set}));
    return dir;
  };
  try {
    take('hero-1', 'k1');
    const newer = take('hero-2', 'k1');
    fs.utimesSync(path.join(root, 'hero-2'), new Date(), new Date(Date.now() + 1000));
    take('hero-3', 'k2'); take('hero-4', 'k1', false);
    const now = path.join(root, 'hero-5');
    take('hero-5', 'k1');
    assert.equal(keptTake(now, 'hero-phone', 'k1'), newer);
    assert.equal(keptTake(now, 'hero-phone', 'k9'), null);
    const into = path.join(root, 'hero-6', '.work', 'hero-phone');
    assert.deepEqual(reuseTake(newer, into), {set: 'hero-2'});
    assert.equal(fs.readFileSync(path.join(into, 'frames', 'f00001.jpg'), 'utf8'), 'hero-2');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('takeOf reuses a kept take unless HERO_FRESH, records through the take queue and keeps the key; a clip records both takes at once', () => {
  const source = fs.readFileSync(path.join(media, 'media.mjs'), 'utf8');
  assert.match(source, /kept = process\.env\.HERO_FRESH \? null : keptTake\(/);
  assert.match(source, /recorded = await recordQueue\(\(\) => record\(\{persona, piece, dir\}\)\)/);
  assert.match(source, /fs\.writeFileSync\(path\.join\(dir, KEY_FILE\), key\)/);
  assert.match(source, /const \[main, narrow\] = await Promise\.all\(\[takeOf\(/);
  assert.match(source, /const finishes = await settled\(options\.pieces[^\n]*makeVideo\(/, 'every piece records at once (the queue bounds it), renders after');
  assert.match(fs.readFileSync(path.join(media, 'record-app.mjs'), 'utf8'), /JOBADABRA_PORT: String\(await freePort\(\)\)/, 'each app on its own port, never the live 47111');
});

test('apps start one at a time, a failed start is tried again, and a stray library error still ends as media: FAILED', () => {
  const app = fs.readFileSync(path.join(media, 'record-app.mjs'), 'utf8');
  assert.match(app, /const app = await startApp\(\{/);
  assert.match(app, /const mine = starting\.then\(start\);\n\s+starting = mine\.catch\(\(\) => \{\}\);/);
  assert.match(fs.readFileSync(path.join(media, 'media.mjs'), 'utf8'), /for \(const event of \['uncaughtException', 'unhandledRejection'\]\) process\.on\(event,/);
});

test('a take that fails is recorded once more before the run stops', () => {
  const source = fs.readFileSync(path.join(media, 'media.mjs'), 'utf8');
  assert.match(source, /try \{ recorded = await recordQueue\(\(\) => record\(\{persona, piece, dir\}\)\); \} catch \(error\) \{\n\s+if \(\+\+failed > 1\) throw error;/);
});
