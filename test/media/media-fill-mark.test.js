// The recorder marks the form's tab the way the app's Apply does, so the REAL extension fills it (owner, 12 Nov 2026: the /how-it-works split still
// showed the old name; redoing it found that every extension recording since 2 Nov stopped at "Timeout 20000ms": this repo's rename turned the mark
// into one the extension never listens for). Checked against the extension's own rule, so a rename on either side turns this red, not a media run.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tabArmed} from '../../extension/tab-pages.js';
import {FILL_MARK} from '../../media/fill-mark.mjs';

test('the tab the recorder marks is one the extension fills (extension/tab-pages.js tabArmed)', () => {
  assert.equal(tabArmed({url: `https://jobs.example/apply#${FILL_MARK}`}), true, `#${FILL_MARK} arms the tab`);
  assert.equal(tabArmed({url: 'https://jobs.example/apply#jobadabra-fill'}), false, 'positive control: a mark the extension does not know leaves the tab alone');
});
