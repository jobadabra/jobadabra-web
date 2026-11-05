// The hosted e2e's stand-in AI answers a numbered-list question with one entry per item, and places Zurich (jobs/hosted-e2e/fake-ai.mjs).
// 26 Oct 2026: it answered every list with [], so after places became the AI's to decide first (jobadabra #2023) no job was placed and
// "new matches reached the inbox" failed on main for hours.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeAi} from '../../../jobs/hosted-e2e/fake-ai.mjs';

const GEO = {type: 'object', required: ['places'], properties: {places: {type: 'array', items: {type: 'object', properties: {
  n: {type: 'integer'}, kind: {type: 'string', enum: ['city', 'area', 'country', 'remote', 'unknown']}, cc: {type: 'string'},
  lat: {type: 'number'}, lon: {type: 'number'}, r_km: {type: 'integer'}}}}}};
const TRIAGE = {type: 'object', required: ['locations'], properties: {locations: {type: 'array', items: {type: 'object', properties: {
  n: {type: 'integer'}, where: {type: 'string'}, country: {type: 'string'}, nearest: {type: 'string'}, km: {type: 'integer'},
  answer: {type: 'string', enum: ['best', 'inside', 'out']}}}}}};
const DECIDE = {type: 'object', required: ['results'], properties: {results: {type: 'array', items: {type: 'object', properties: {
  index: {type: 'integer'}, answer: {type: 'string', enum: ['software', 'other']}}}}}};
const ask = async (schema, text) => JSON.parse((await fakeAi().run('@cf/x', {messages: [{role: 'system', content: 'You place strings.'},
  {role: 'user', content: text}], response_format: {type: 'json_schema', json_schema: {schema}}})).response);

test('a list question gets one answer per numbered item', async () => {
  const {places} = await ask(GEO, 'Strings:\n1. zurich\n2. 8005 Zürich, CH\n3. Switzerland\n4. Remote - EMEA\n5. Lyon');
  assert.deepEqual(places.map(p => [p.n, p.kind, p.cc]), [[1, 'city', 'CH'], [2, 'city', 'CH'], [3, 'country', 'CH'], [4, 'remote', ''], [5, 'unknown', '']]);
  assert.ok(Math.abs(places[0].lat - 47.37) < 0.1 && places[0].r_km > 0, 'Zurich sits where Zurich is');
});

test('the job-location question answers best for Zurich, inside for Switzerland, out for the rest', async () => {
  const {locations} = await ask(TRIAGE, 'Their places (JSON): {"top_tier": ["zurich"]}\nThe job locations:\n1. Zürich, Switzerland\n2. Bern, CH\n3. Lyon, France');
  assert.deepEqual(locations.map(l => [l.n, l.answer]), [[1, 'best'], [2, 'inside'], [3, 'out']]);
});

test("other list questions stay unanswered: a first allowed answer per item would be a wrong one (zurich as the Geneva metro)", async () => {
  assert.deepEqual(await ask(DECIDE, 'Task: kind\n\n### Item 0\nzurich\n\n### Item 1\nPlatform Engineer'), {results: []});
});

test("the title question picks the titles with the search's own role words, never its ruled-out ones", async () => {
  const FIT = {type: 'object', required: ['fit'], properties: {fit: {type: 'array', items: {type: 'integer'}}}};
  const search = JSON.stringify({role_words: ['site reliability', '\\bsre\\b', 'platform engineer'], words_ruled_out: ['\\bintern(ship)?\\b']});
  const {fit} = await ask(FIT, `The search (JSON): ${search}\nThe titles:\n1. Site Reliability Engineer\n2. Accountant\n3. Platform Engineer Intern\n4. SRE Lead`);
  assert.deepEqual(fit, [1, 4]);
});

test('a list with no numbered items stays empty', async () => {
  assert.deepEqual(await ask({type: 'object', properties: {tags: {type: 'array', items: {type: 'string'}}}}, 'no list here'), {tags: []});
});
