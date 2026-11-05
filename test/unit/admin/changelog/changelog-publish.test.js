// jobs/changelog-publish.mjs: which releases get an entry (stable, or a beta the gate approved), the draft with a fake model: kinds, floor, hidden versions, and a failed AI answer publishes nothing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {problems} from '../../../../admin/changelog.js';
import {PATHSPEC, chunksOf, draftEntry, draftOrPlain, estimate, newerThanStored, plan, startEntry, versionLine} from '../../../../jobs/changelog-publish.mjs';

const release = (version, extra = {}) => ({tagName: `desktop-v${version}`, isPrerelease: true, isDraft: false, publishedAt: '2026-10-18T01:00:00Z', body: '', ...extra});
const approved = {body: 'Beta-approved: abc123'};
const work = {tag: 'desktop-v0.7.20', prev: 'desktop-v0.7.16', version: '0.7.20', date: '2026-10-18', channel: 'beta'};
// A fake Codex broker (askBroker's answer shape): the texts in order; every request body (Messages shape) is kept in `calls`.
const model = (...texts) => { const calls = []; return {calls, broker: async body => { calls.push(body); const text = texts.shift(); return {ok: true, tier: 'small', message: {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 1500, output_tokens: 400}}}; }}; };

test('stable releases and approved betas get an entry; a build that failed its gate does not; its commits roll into the next one', () => {
  const releases = [release('0.7.15', {isPrerelease: false}), release('0.7.16', {isPrerelease: false}), release('0.7.17', approved), release('0.7.18'), release('0.7.19', approved), release('0.7.20', {isDraft: true, ...approved}), {...release('pr-assets-1'), tagName: 'pr-assets-1'}];
  const {draft} = plan(releases, {}, 'abc1234');
  assert.deepEqual(draft.map(item => [item.version, item.prev, item.channel]), [['0.7.15', 'abc1234', 'stable'], ['0.7.16', 'desktop-v0.7.15', 'stable'], ['0.7.17', 'desktop-v0.7.16', 'beta'], ['0.7.19', 'desktop-v0.7.17', 'beta']]);
});

test('a version is drafted once and re-running skips it; a stored beta that became stable is promoted; the oldest release is the changes since the first commit', () => {
  const releases = [release('0.7.14', {isPrerelease: false}), release('0.7.16', {isPrerelease: false}), release('0.7.17', {isPrerelease: false}), release('0.7.18', approved)];
  const done = plan(releases, {'0.7.16': 'stable', '0.7.17': 'beta'}, 'abc1234');
  assert.deepEqual(done.draft.map(item => item.version), ['0.7.14', '0.7.18']);
  assert.deepEqual(done.promote, [{version: '0.7.17', channel: 'stable'}]);
  assert.deepEqual(plan(releases, {}, 'abc1234').draft.map(item => [item.version, item.prev]), [['0.7.14', 'abc1234'], ['0.7.16', 'desktop-v0.7.14'], ['0.7.17', 'desktop-v0.7.16'], ['0.7.18', 'desktop-v0.7.17']]);
  assert.deepEqual(plan(releases, {'0.7.14': 'stable', '0.7.16': 'stable', '0.7.17': 'stable', '0.7.18': 'beta'}, 'abc1234'), {draft: [], promote: []});
});

test('an alpha tag is the oldest version, shown as x.y.z, and sorts before the next release', () => {
  const releases = [release('0.5.0', {isPrerelease: false}), release('0.4.0-alpha.254', {isPrerelease: false})];
  assert.deepEqual(plan(releases, {}, 'abc1234').draft.map(item => [item.version, item.tag, item.prev]), [['0.4.0', 'desktop-v0.4.0-alpha.254', 'abc1234'], ['0.5.0', 'desktop-v0.5.0', 'desktop-v0.4.0-alpha.254']]);
});

test('the 0.0.1 entry is the project start, dated at the first commit, and passes the same checks', () => {
  const entry = startEntry('2026-09-24');
  assert.deepEqual([entry.version, entry.date, entry.channel], ['0.0.1', '2026-09-24', 'start']);
  assert.deepEqual(problems(entry), []);
  assert.equal(entry.groups.length, 1);
});

test('the draft is grouped by kind, rule-breakers are dropped, and the cost is measured', async () => {
  const ai = model(JSON.stringify({groups: [{kind: 'fixes', items: [{emoji: '🐛', lead: 'Dropdowns fixed', text: 'Required dropdowns fill again.'}, {lead: 'Pro', text: 'Pro costs $29.'}]}, {kind: 'features', items: [{emoji: '🔎', lead: 'Better search', text: 'Search shows more jobs.'}]}]}));
  const done = await draftEntry(work, {subjects: ['Fix dropdowns', 'Add search'], broker: ai.broker});
  assert.deepEqual(done.entry.groups.map(group => group.kind), ['features', 'fixes']);
  assert.equal(done.dropped.length, 1);
  assert.equal(done.calls, 1, 'one broker call');
  assert.match(ai.calls[0].messages[0].content, /0\.7\.20 \(changes since 0\.7\.16\)/);
  const first = model('{"groups":[]}');
  await draftEntry({...work, prev: 'abc1234', first: true}, {subjects: ['x'], broker: first.broker});
  assert.match(first.calls[0].messages[0].content, /changes since the start of the project/);
});

test('nothing a user would notice is hidden, not retried; no commits cost nothing', async () => {
  assert.equal((await draftEntry(work, {subjects: [], broker: model().broker})).hidden, true);
  const done = await draftEntry(work, {subjects: ['Refactor tests'], broker: model('{"groups":[]}').broker});
  assert.equal(done.hidden, true);
  assert.equal(done.calls, 1);
});

test('an unusable AI answer is retried once, then the version is not published and the error says why', async () => {
  const good = JSON.stringify({groups: [{kind: 'features', items: [{lead: 'New', text: 'A thing.'}]}]});
  assert.ok((await draftEntry(work, {subjects: ['x'], broker: model('sorry', good).broker})).entry);
  await assert.rejects(draftEntry(work, {subjects: ['x'], broker: model('sorry', 'still no').broker}), /0\.7\.20: the model's answer was unusable twice \(not JSON\)/);
  await assert.rejects(draftEntry(work, {subjects: ['x'], broker: async () => ({ok: false, status: 'capped', detail: 'broker: budget:week 100% of 100% (scheduled)'})}), /budget:week 100% of 100%/);
});

const group = (lead, kind = 'features') => JSON.stringify({groups: [{kind, items: [{lead, text: `${lead} works now.`}]}]});
const many = n => Array.from({length: n}, (_, i) => `Change ${i}`);

test('only what a user can see is read: tests, e2e, fixtures, recordings, CI, docs and tools never reach the AI', () => {
  const spec = PATHSPEC.join(' ');
  for (const kept of ['desktop', 'src', 'extension', 'app-core/src', 'worker/src', 'config']) assert.ok(PATHSPEC.includes(kept), kept);
  for (const dropped of ['desktop/e2e', 'desktop/test', 'desktop/scripts', 'desktop/docs']) assert.match(spec, new RegExp(`:\\(exclude\\)${dropped}`), dropped);
  assert.match(spec, /exclude,glob\)\*\*\/fixtures\/\*\*/);
  assert.doesNotMatch(spec, /(^| )tools( |$)|\.github|(^| )docs( |$)/);
});

test('big versions are cut in chunks of at most 300 subjects', () => {
  assert.deepEqual(chunksOf(many(650)).map(chunk => chunk.length), [300, 300, 50]);
  assert.deepEqual(chunksOf(many(10)).map(chunk => chunk.length), [10]);
  assert.deepEqual(chunksOf([]), []);
});

test('a big version is drafted per chunk and merged by one short call; each prompt stays small', async () => {
  const ai = model(group('One'), group('Two', 'fixes'), group('Merged'));
  const done = await draftEntry(work, {subjects: many(450), broker: ai.broker});
  assert.equal(ai.calls.length, 3);
  assert.match(ai.calls[0].messages[0].content, /part 1 of 2/);
  assert.match(ai.calls[2].messages[0].content, /One/);
  assert.deepEqual(done.entry.groups.map(item => item.items[0].lead), ['Merged']);
  for (const call of ai.calls) assert.ok(call.messages[0].content.length < 12000);
});

test('a version of one chunk costs one call; a failed merge falls back to the chunk results, never publishing a rule-breaker', async () => {
  const one = model(group('Only'));
  await draftEntry(work, {subjects: many(300), broker: one.broker});
  assert.equal(one.calls.length, 1);
  const bad = model(group('One'), group('Two', 'fixes'), 'no json', 'no json');
  const done = await draftEntry(work, {subjects: many(450), broker: bad.broker});
  assert.deepEqual(done.entry.groups.map(item => item.kind), ['features', 'fixes']);
});

test('the run stops at its call cap: no broker call is made past it and the version is not published', async () => {
  const ai = model(group('One'), group('Two'), group('Three'));
  const spend = {total: 12, cap: 12};
  await assert.rejects(draftEntry(work, {subjects: many(10), broker: ai.broker, spend}), /call cap of 12 broker calls/);
  assert.equal(ai.calls.length, 0);
});

test('the estimate says per version the chunks, tokens in and out, and the broker calls (no dollars: the Codex plan)', () => {
  const {chunks, tokensIn, tokensOut, calls} = estimate(many(650));
  assert.equal(chunks, 3);
  assert.ok(tokensIn > 650 * 3 && tokensIn < 25000, `in ${tokensIn}`);
  assert.ok(tokensOut > 0);
  assert.equal(calls, 4, '3 chunk calls + 1 merge call');
  assert.equal(estimate(many(5)).calls, 1);
  assert.deepEqual(estimate([]), {chunks: 0, tokensIn: 0, tokensOut: 0, calls: 0});
});

test('an automatic run drafts only versions newer than the newest stored one; older gaps wait for --backfill', () => {
  const list = ['0.5.0', '0.7.2', '0.7.17', '0.7.18'].map(version => ({version}));
  assert.deepEqual(newerThanStored(list, {'0.7.16': 'stable'}).map(item => item.version), ['0.7.17', '0.7.18']);
  assert.deepEqual(newerThanStored(list, {'0.7.18': 'beta'}), []);
  assert.equal(newerThanStored(list, {}).length, 4);
});

// The AI is skipped (owner, 24 Oct 2026; on the Codex broker since 31 Oct 2026): the version still goes out, as a plain entry; the broker's 'capped' and a 429 both stop further calls; an ok answer stays the AI's.
const refusing = (status, detail) => { const calls = []; return {calls, broker: async () => { calls.push(1); return {ok: false, status, detail}; }}; };
const LIMIT = 'broker: budget:week 100% of 100% (scheduled)';   // the broker's own words when the Codex allowance is used up (429/503 = 'capped')
const subjects = ['Fix required dropdowns that stayed empty', 'Add a Compare view for two jobs'];

test('a Codex budget refusal (\'capped\') publishes a plain entry marked plain, names the refusal, and the next version makes no call', async () => {
  const {draftOrPlain} = await import('../../../../jobs/changelog-publish.mjs');
  const ai = {down: null}, fake = refusing('capped', LIMIT);
  const first = await draftOrPlain(work, {subjects, ai, broker: fake.broker});
  assert.equal(first.plain, true);
  assert.equal(first.entry.plain, true);
  assert.deepEqual(problems(first.entry), []);
  assert.match(first.error.message, /^broker answered capped: .*budget:week/);
  assert.equal(first.error.kind, 'limit');
  const second = await draftOrPlain({...work, version: '0.7.21'}, {subjects, ai, broker: fake.broker});
  assert.equal(second.plain, true);
  assert.equal(fake.calls.length, 1, 'no call once the AI is down');
});

test('a 429 from the broker is also plain and red; an ok answer is the AI entry with no error', async () => {
  const {draftOrPlain} = await import('../../../../jobs/changelog-publish.mjs');
  const limited = await draftOrPlain(work, {subjects, ai: {down: null}, broker: refusing(429, 'broker: slow down').broker});
  assert.equal(limited.plain, true);
  assert.equal(limited.error.kind, 'rate');
  const fine = await draftOrPlain(work, {subjects, ai: {down: null}, ...model(JSON.stringify({groups: [{kind: 'fixes', items: [{emoji: '🐛', lead: 'Dropdowns fixed', text: 'Required dropdowns fill again.'}]}]}))});
  assert.equal(fine.plain, undefined);
  assert.equal(fine.error, undefined);
  assert.equal(fine.entry.plain, undefined);
});

test('when nothing fit to show can be built without the AI, the refusal is still an error and nothing is hidden', async () => {
  const {draftOrPlain} = await import('../../../../jobs/changelog-publish.mjs');
  const done = await draftOrPlain(work, {subjects: ['wip'], ai: {down: null}, broker: refusing('capped', LIMIT).broker});
  assert.ok(done.error);
  assert.equal(done.entry, undefined);
});

test('the run\'s per-version log line reads what every result shape carries: an AI entry, a plain one, a hidden version (Gitar #241: it read the removed `cost` and would have crashed the run)', async () => {
  const ai = await draftEntry(work, {subjects: ['Fix dropdowns'], broker: model(group('Dropdowns', 'fixes')).broker});
  assert.equal(versionLine(work, ai), 'desktop-v0.7.20: fixes 1, 0 dropped by the word floor, 1 broker call');
  const plainRun = await draftOrPlain(work, {subjects, ai: {down: null}, broker: refusing('capped', LIMIT).broker});
  assert.match(versionLine(work, plainRun), /\[plain, no AI\], 0 dropped by the word floor, 1 broker call$/, 'the refused call is counted: it used the allowance');
  const unusable = await draftOrPlain(work, {subjects, ai: {down: null}, broker: model('sorry', 'still no').broker});
  assert.match(versionLine(work, unusable), /\[plain, no AI\], 0 dropped by the word floor, 2 broker calls$/, 'an answer unusable twice used two calls');
  const hidden = await draftEntry(work, {subjects: ['Refactor tests'], broker: model('{"groups":[]}').broker});
  assert.equal(versionLine(work, hidden), 'desktop-v0.7.20: nothing a user would notice (hidden), 0 dropped by the word floor, 1 broker call');
  assert.doesNotMatch([ai, plainRun, hidden].map(done => versionLine(work, done)).join('\n'), /NaN|undefined|\$/);
});

test('the run\'s spend counts every broker call, including the refused and unusable ones, across versions (Gitar #241)', async () => {
  const spend = {total: 0, cap: 12}, ai = {down: null}, one = await draftOrPlain(work, {subjects, ai, spend, broker: model('sorry', 'still no').broker});
  assert.equal(one.calls, 2);
  const two = await draftOrPlain({...work, version: '0.7.21'}, {subjects, ai, spend, broker: model(group('Fine')).broker});
  assert.equal(two.calls, 1);
  assert.equal(spend.total, one.calls + two.calls, 'the sum of what each version reports is what counted against the cap');
});
