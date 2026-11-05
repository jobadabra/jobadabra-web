// The product media's personas (media/persona-copy.mjs, personas/): a persona lays its files over desktop/demo, its dates move to the
// recording's week, and no persona folder holds the default person's words it forbids.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {leftWords} from '../../media/check.mjs';
import {loadPersona} from '../../media/options.mjs';
import {applyEdits, personaCopy, shiftDates, weekShift} from '../../media/persona-copy.mjs';
import {VIDEOS} from '../../media/scenes.mjs';
import {formHost} from '../../media/stand-in.mjs';

const media = path.join(import.meta.dirname, '..', '..', 'media');
const demo = path.join(import.meta.dirname, '..', 'demo');

test('dates move by whole weeks, so weekday names stay right; no anchor, no move', () => {
  assert.equal(weekShift('2026-10-12', new Date(2026, 9, 12)), 0);
  assert.equal(weekShift('2026-10-12', new Date(2026, 10, 3)), 21, '22 days away: the nearest whole week');
  assert.equal(weekShift('', new Date(2027, 0, 1)), 0);
  const text = 'Interview Wed 14 Oct, 10:00 · 2026-10-14T10:00:00+02:00 · since 2026-09-29 · on 28 Dec';
  assert.equal(shiftDates(text, 21, 2026), 'Interview Wed 04 Nov, 10:00 · 2026-11-04T10:00:00+02:00 · since 2026-10-20 · on 18 Jan');
  assert.equal(shiftDates(text, 0, 2026), text);
});

test('a persona lays its own files over the demo; media.json stays out; dates are shifted', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-persona-'));
  fs.writeFileSync(path.join(folder, 'jobs.json'), JSON.stringify({jobs: [{title: 'Nurse', next_interview: '2026-10-14T10:00:00'}]}));
  fs.writeFileSync(path.join(folder, 'media.json'), '{}');
  fs.mkdirSync(path.join(folder, 'config'));
  fs.writeFileSync(path.join(folder, 'config', 'search.json'), '{"role_keywords": ["nurse"]}');
  const data = personaCopy({folder, today: '2026-10-12'}, {demo, now: new Date(2026, 9, 26)});
  try {
    assert.match(fs.readFileSync(path.join(data, 'jobs.json'), 'utf8'), /Nurse.*2026-10-28T10:00/);
    assert.ok(fs.existsSync(path.join(data, 'focus.json')), 'a file the persona does not change comes from the demo');
    assert.ok(!fs.existsSync(path.join(data, 'media.json')));
    assert.match(fs.readFileSync(path.join(data, 'config', 'search.json'), 'utf8'), /nurse/, 'the engine\'s settings folder comes along');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); fs.rmSync(data, {recursive: true, force: true}); }
});

test('every persona folder loads, is anchored on a Monday, and holds none of the words it forbids', () => {
  const root = path.join(media, 'personas');
  const names = fs.readdirSync(root);
  assert.ok(names.includes('nurse-lyon'));
  for (const name of names) {
    const persona = loadPersona(path.join(root, name));
    assert.ok(persona.forbid.length, `${name}: media.json lists the default person's words (forbid)`);
    assert.equal(new Date(`${persona.today}T12:00:00Z`).getUTCDay(), 1, `${name}: "today" is a Monday`);
    const files = fs.readdirSync(path.join(root, name), {recursive: true}).filter(file => file !== 'media.json' && fs.statSync(path.join(root, name, file)).isFile());
    for (const file of files) {
      assert.deepEqual(leftWords(fs.readFileSync(path.join(root, name, file), 'utf8'), persona.forbid), [], `${name}/${file}`);
    }
  }
});

test('the default person\'s words are found as whole words only; the form lives on the employer\'s .example host', () => {
  assert.deepEqual(leftWords('Senior SRE in Zurich', ['SRE', 'Zurich', 'Kubernetes']), ['SRE', 'Zurich']);
  assert.deepEqual(leftWords('SREs are a different word', ['SRE']), []);
  assert.equal(formHost({company: 'Institut Cardio Rhône'}), 'careers.institut-cardio-rhone.example');
  assert.equal(formHost({}), 'careers.employer.example');
});

test('the nurse persona has enough data for every screen the videos zoom into: a long job list, interviews, calendar events', () => {
  const folder = path.join(media, 'personas', 'nurse-lyon');
  const {jobs} = JSON.parse(fs.readFileSync(path.join(folder, 'jobs.json'), 'utf8'));
  const interviews = JSON.parse(fs.readFileSync(path.join(folder, 'interviews.json'), 'utf8'));
  assert.ok(jobs.filter(job => job.status !== 'dismissed').length >= 15, 'a list worth zooming into');
  assert.ok(jobs.filter(job => job.next_interview).length >= 5, 'a calendar with events');
  assert.ok(interviews.saved.length >= 5, 'an interview library with several rows');
  assert.ok(Object.keys(interviews.records).length >= 1, 'a review to open');
  const text = JSON.stringify([jobs, interviews]);
  assert.deepEqual(leftWords(text, loadPersona(folder).forbid), [], 'no default-demo words in the new data');
});

// Moments (owner, 24 Oct 2026: one person and one job throughout, "2 weeks later" before Track): a clip may play the persona later in time, as a few
// record edits in <persona>/moments/<name>.json laid over the copy.
test('a moment edits records by id: fields set, null removes one, _first moves it to the front, _drop removes it; an unknown id fails loudly', () => {
  const data = {jobs: [{id: 1, stage: 'Interview scheduled', next_interview: 'x'}, {id: 4, stage: ''}], items: [{page_id: 'a'}, {page_id: 'b'}, {page_id: 'c'}]};
  const out = applyEdits(data, {jobs: {1: {stage: 'Applied', next_interview: null}, 4: {stage: 'Interview scheduled'}}, items: {c: {_first: true, v: 1}, a: {_drop: true}}});
  assert.deepEqual(out.jobs, [{id: 1, stage: 'Applied'}, {id: 4, stage: 'Interview scheduled'}]);
  assert.deepEqual(out.items, [{page_id: 'c', v: 1}, {page_id: 'b'}]);
  assert.throws(() => applyEdits(data, {jobs: {9: {stage: 'x'}}}), /no record 9/);
});

// Round 2 (owner, 24 Oct 2026: Track starts on "a gmail check that shows an interview scheduled mail received", then that job's interview): a moment
// adds a record (the e-mail check run), edits a bare-list file (runs.json, key "."), a map of records by id (interviews.json records) and one record (draft).
test('a moment adds a record with _add, edits a bare list under ".", a map by id and a single record by its id', () => {
  const runs = [{id: 1, kind: 'search'}];
  assert.deepEqual(applyEdits(runs, {'.': {9: {_add: true, _first: true, kind: 'mail'}}}), [{id: 9, kind: 'mail'}, {id: 1, kind: 'search'}]);
  assert.deepEqual(applyEdits({items: []}, {items: {n: {_add: true, page_id: 'n'}}}).items, [{page_id: 'n'}], 'an _add keeps the id field it names');
  const iv = {records: {'iv-3': {id: 'iv-3', title: 'Clinique · Phone screen'}}, draft: {id: 'd', title: 'Clinique, phone screen', file: 'a.webm'}};
  const out = applyEdits(iv, {records: {'iv-3': {title: 'Institut · Phone screen'}}, draft: {d: {title: 'Institut, phone screen'}}});
  assert.equal(out.records['iv-3'].title, 'Institut · Phone screen');
  assert.deepEqual(out.draft, {id: 'd', title: 'Institut, phone screen', file: 'a.webm'});
  assert.throws(() => applyEdits(iv, {draft: {other: {title: 'x'}}}), /no record other/);
  assert.throws(() => applyEdits(runs, {runs: {1: {kind: 'x'}}}), /runs is not a list/);
});

test('a recording with a moment gets the moment\'s edits, dates shifted like the rest; the moments folder itself is not copied', () => {
  const folder = path.join(media, 'personas', 'nurse-lyon');
  const persona = loadPersona(folder);
  const now = new Date('2026-10-26T09:00:00Z');   // two weeks after the anchor
  const data = personaCopy(persona, {demo, now, moment: 'later'});
  try {
    assert.ok(!fs.existsSync(path.join(data, 'moments')));
    const {jobs} = JSON.parse(fs.readFileSync(path.join(data, 'jobs.json'), 'utf8'));
    const job = jobs.find(one => one.company === persona.job.company && one.title === persona.job.title);
    assert.match(job.next_interview, /^2026-10-28T/, 'the interview moved with the recording week');
  } finally { fs.rmSync(data, {recursive: true, force: true}); }
  assert.throws(() => personaCopy(persona, {demo, now, moment: 'nope'}), /no moment nope/);
});

test('the hero follows ONE job: the form\'s job is in the list the Find clip opens, the draft names roles, and later it has the interview Focus and the calendar show', () => {
  const folder = path.join(media, 'personas', 'nurse-lyon');
  const persona = loadPersona(folder);
  const read = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
  const {job} = persona;
  assert.ok(read('jobs.json').jobs.some(one => one.company === job.company && one.title === job.title), 'the job is in the list');
  const find = VIDEOS.hero.steps.find(step => step.click?.includes('job-row'));
  assert.ok(find && find.click.includes(job.title.split(', ').at(-1)), `the Find clip opens that job (${find?.click})`);
  const draft = read('draft.json').draft;
  assert.ok(draft.search.target_roles?.length >= 3, 'step 3 shows roles, not "Not set"');
  assert.ok(typeof draft.usd === 'number', 'a draft always has its cost (the setup screen reads it)');
  const track = VIDEOS['hero-track'];
  assert.equal(track.moment, 'later');
  const data = personaCopy(persona, {demo, now: new Date('2026-10-12T09:00:00Z'), moment: 'later'});
  try {
    const later = file => JSON.parse(fs.readFileSync(path.join(data, file), 'utf8'));
    const jobs = later('jobs.json').jobs.filter(one => one.next_interview && one.next_interview >= persona.today).sort((a, b) => a.next_interview.localeCompare(b.next_interview));
    assert.equal(`${jobs[0].company} ${jobs[0].title}`, `${job.company} ${job.title}`, 'the next interview on the calendar is that job');
    const first = later('focus.json').items[0];
    assert.equal(first.kind, 'prepare');
    assert.equal(first.company, job.company, 'Focus leads with preparing for it');
  } finally { fs.rmSync(data, {recursive: true, force: true}); }
});
