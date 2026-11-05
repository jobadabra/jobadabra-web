// The kinds of role are one list on the site (shared/pool-labels.js KINDS); every other copy must say the same, and the site must accept every
// kind the engine (public src/role_kinds.py) sends: the site lands first, so it may know more, never less (owner, 26 Oct 2026: 'Other' split).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {KINDS, KIND_NAMES, ROLES} from '../../../shared/pool-labels.js';
import {KINDS as EMPLOYER_KINDS} from '../../../api/employers.js';
import {FAMILIES} from '../../../shared/search-report.js';
import {KINDS as HEATMAP_ROWS, kindName} from '../../../shared/scoutingvisual.js';

test('every site copy of the kinds is the one list', () => {
  const copies = {'api/employers.js KINDS': EMPLOYER_KINDS, 'shared/search-report.js FAMILIES': FAMILIES, 'shared/scoutingvisual.js KINDS (heatmap rows)': HEATMAP_ROWS,
    'shared/pool-labels.js ROLES (after the IT families)': ['software', ...ROLES.slice(ROLES.indexOf('sales_b2b'))]};
  for (const [where, list] of Object.entries(copies)) assert.deepEqual(list, KINDS, where);
  assert.equal(KINDS.at(-1), 'other');
});

test('every kind has a name a person reads, and no copy names it by its id', () => {
  for (const kind of KINDS) {
    assert.ok(KIND_NAMES[kind], kind);
    assert.notEqual(kindName(kind), kind, kind);
  }
});

test('the site accepts every kind the engine sends', () => {
  const engine = readFileSync(new URL('../../../src/role_kinds.py', import.meta.url), 'utf8').match(/^KINDS = \(([^)]*)\)/m)[1];
  const missing = [...engine.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]).filter(kind => !KINDS.includes(kind));
  assert.deepEqual(missing, [], 'public src/role_kinds.py sends kinds the site drops: land the site half first');
});

test('the fields split out of Other are kinds', () => {
  for (const kind of ['engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security']) assert.ok(KINDS.includes(kind), kind);
});
