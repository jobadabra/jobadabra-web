// Guard: release — the day's digest hangs on one broker call: one lost connection gets one more try; a timeout or a refusal does not.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {askOnceMore} from '../../jobs/daily-digest.mjs';

const lost = {ok: false, status: 'unreachable', detail: 'no answer from the broker: fetch failed (ECONNRESET: read ECONNRESET) after 63 s'};
const plays = answers => { let calls = 0; return {calls: () => calls, ask: async () => answers[calls++]}; };

test('one lost connection is one more try and is said; a timeout, a refusal or a second loss is final', async () => {
  const lines = [], print = console.log;
  console.log = line => lines.push(String(line));
  try {
    const healed = plays([lost, {ok: true}]);
    assert.equal((await askOnceMore({}, {ask: healed.ask})).ok, true);
    assert.equal(healed.calls(), 2);
    assert.deepEqual(lines, [`Digest: ${lost.detail}; one more try`]);
    const twice = plays([lost, lost]);
    assert.equal((await askOnceMore({}, {ask: twice.ask})).status, 'unreachable');
    assert.equal(twice.calls(), 2);
    for (const answer of [{ok: false, status: 'unreachable', detail: 'no answer from the broker: The operation was aborted due to timeout after 180 s'}, {ok: false, status: 'capped', detail: 'broker: budget:week 100% of 100% (scheduled)'}, {ok: true}]) {
      const once = plays([answer]);
      assert.equal(await askOnceMore({}, {ask: once.ask}), answer);
      assert.equal(once.calls(), 1);
    }
  } finally { console.log = print; }
});
