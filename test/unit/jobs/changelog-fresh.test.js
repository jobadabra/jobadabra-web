// jobs/changelog-fresh.mjs: the page must have the newest stable desktop release within 2 hours.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {staleStable} from '../../../jobs/changelog-fresh.mjs';

const rel = (version, hoursAgo, extra = {}) => ({tagName: `desktop-v${version}`, isPrerelease: false, isDraft: false, publishedAt: new Date(Date.parse('2026-10-24T12:00:00Z') - hoursAgo * 36e5).toISOString(), ...extra});
const now = new Date('2026-10-24T12:00:00Z');

test('a stable release missing from the page for over 2 hours is stale; sooner, present, beta or draft is not', () => {
  assert.deepEqual(staleStable([rel('0.8.27', 5), rel('0.8.20', 30)], {'0.8.20': 'stable'}, now), {version: '0.8.27', hours: 5});
  assert.equal(staleStable([rel('0.8.27', 1.5)], {}, now), null);
  assert.equal(staleStable([rel('0.8.27', 5)], {'0.8.27': 'stable'}, now), null);
  assert.equal(staleStable([rel('0.8.28', 9, {isPrerelease: true}), rel('0.8.29', 9, {isDraft: true}), {...rel('1.0.0', 9), tagName: 'pr-assets-1'}], {}, now), null);
  assert.equal(staleStable([], {}, now), null);
});
