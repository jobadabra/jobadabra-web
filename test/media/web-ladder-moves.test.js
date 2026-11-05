// The site stores the moves the app counts (shared/ladder-moves.js <- desktop/lib/ladder/learning.js counts()): the site cannot import the app's rungs (they read the disk and the shared
// folder), so it keeps its own copy of the fixed lists. A kind, an outcome or a shape the app counts is never dropped by the site; the site may know more (one way, owner 21 Oct 2026: it lands before the app starts counting it).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SHAPE} from '../lib/ladder/learning.js';
import {KINDS} from '../lib/ladder/rung2-sketch.js';
import {OUTCOMES} from '../lib/ladder/rung3-digest.js';
import * as site from '../../shared/ladder-moves.js';

const missing = (app, here) => app.filter(item => !here.includes(item));

test('the site\'s fixed lists for ladder moves hold every one of the app\'s', () => {
  assert.deepEqual(missing(KINDS, site.KINDS), []);
  assert.deepEqual(missing(OUTCOMES, site.OUTCOMES), []);
  assert.equal(site.SHAPE.source, SHAPE.source);
});
