// Send to AI, the site's side (shared/feedback-ai.js + the `ai*` rows of shared/feedback-actions.js, PR 7/7): the caps, the dead-run expiry, the start that fails, the brief's content and the internal steps.
// Nothing here calls GitHub or the AI: `start` is a fake; the run's answers are the internal actions played directly.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ACTIONS, act, actionsFor} from '../../shared/feedback-actions.js';
import {DAILY_RUNS, STALE_MS, aiColumns, briefOf, expireStale, startRun} from '../../shared/feedback-ai.js';
import {NOW, REPO, add, env, log, prUrl, row} from './feedback-kit.js';

const started = [], start = async ref => { started.push(ref); };
const click = (e, ref, extra = {}, opts = {start}, now = NOW) => act(e, {ref, action: 'ai', ...extra}, 'owner (session)', now, opts);
const PR = prUrl(3100);

test('Send to AI moves a new or deferred card to ai_running, writes the ticks and one log line, and starts the run for that ref', async () => {
  for (const state of ['new', 'deferred']) {
    const e = env(), ref = add(e, {state, state_note: '🤖 failed: an old try'});
    started.length = 0;
    const done = await click(e, ref);
    assert.equal(done.ok, true, done.error);
    assert.deepEqual(started, [ref]);
    const after = row(e, ref);
    assert.deepEqual([after.state, after.ai_include, after.ai_run, after.state_note], ['ai_running', 'logs,page', '', ''], 'default ticks; the old verdict is cleared');
    assert.deepEqual(log(e, ref), [{who: 'owner (session)', action: 'ai', detail: `${state} -> ai_running: with logs, page`}]);
  }
});

test('the ticks: logs and screen data default on, the profile snapshot only when ticked; unticking is respected', () => {
  assert.equal(aiColumns({}).columns.ai_include, 'logs,page');
  assert.equal(aiColumns({include: {profile: true}}).columns.ai_include, 'logs,page,profile');
  assert.equal(aiColumns({include: {profile: 'yes'}}).columns.ai_include, 'logs,page', 'only a real true ticks the profile');
  assert.equal(aiColumns({include: {logs: false, page: false}}).columns.ai_include, '');
  assert.equal(aiColumns({include: {logs: false, page: false}}).detail, 'words only');
});

test('the owner\'s menu never offers the run\'s own steps; the owner route cannot play them either', async () => {
  assert.deepEqual(actionsFor('new').filter(name => name.startsWith('ai')), ['ai']);
  assert.deepEqual(actionsFor('ai_running'), []);
  assert.deepEqual(actionsFor('ai_pr'), ['fixed', 'reopen', 'delete']);
  for (const action of Object.keys(ACTIONS).filter(name => ACTIONS[name].internal)) {
    const e = env(), ref = add(e, {state: ACTIONS[action].from[0]});
    const done = await act(e, {ref, action, pr: PR, why: 'x'}, 'owner (session)', NOW, {start});
    assert.equal(done.status, 400, `${action} without proof of the run`);
    assert.equal(row(e, ref).state, ACTIONS[action].from[0]);
  }
});

test('without a dispatch token the click is refused (503) and nothing changes', async () => {
  const e = env(), ref = add(e);
  const done = await click(e, ref, {}, {});
  assert.equal(done.status, 503);
  assert.equal(row(e, ref).state, 'new');
  assert.equal(log(e, ref).length, 0);
});

test('one at a time: a second click while a run is going is refused (409); the cap is 3 clicks a day (429) and counts again tomorrow', async () => {
  const e = env(), [a, b, c, d] = [add(e), add(e), add(e), add(e)];
  assert.equal((await click(e, a)).ok, true);
  const second = await click(e, b);
  assert.equal(second.status, 409);
  assert.equal(row(e, b).state, 'new');
  for (const [ref, runs] of [[a, 1], [b, 2], [c, 3]]) {   // each run ends, the next click is allowed, until the third has been used
    if (ref !== a) assert.equal((await click(e, ref)).ok, true, `click ${runs}`);
    await act(e, {ref, action: 'ai_none', verdict: 'needs-human', why: 'a person must look'}, 'ai (run 1)', NOW, {trusted: true});
  }
  assert.equal(DAILY_RUNS, 3);
  const fourth = await click(e, d);
  assert.equal(fourth.status, 429);
  assert.equal(row(e, d).state, 'new');
  const tomorrow = new Date('2026-11-04T00:00:01.000Z');
  assert.equal((await click(e, d, {}, {start}, tomorrow)).ok, true, 'the day count restarts at 00:00 UTC');
});

test('a run that never answered is sent back to new after an hour (with the reason and a system log line) and no longer blocks the next click', async () => {
  const e = env(), stuck = add(e, {state: 'ai_running', state_at: new Date(NOW.getTime() - STALE_MS - 1000).toISOString()}), fresh = add(e, {state: 'ai_running', state_at: new Date(NOW.getTime() - 1000).toISOString()});
  assert.equal(await expireStale(e.STATS, NOW), 1);
  assert.deepEqual([row(e, stuck).state, row(e, stuck).state_note, row(e, fresh).state], ['new', '🤖 failed: the run did not answer in an hour', 'ai_running']);
  assert.deepEqual(log(e, stuck), [{who: 'system', action: 'ai_failed', detail: 'no answer in an hour'}]);
  const e2 = env(), dead = add(e2, {state: 'ai_running', state_at: '2026-11-03T08:00:00.000Z'}), next = add(e2);
  assert.equal((await click(e2, next)).ok, true, 'the dead run does not block');
  assert.equal(row(e2, dead).state, 'new');
});

test('when the run cannot be started the card goes straight back to new with the reason, the click is a 502 and the log says both', async () => {
  const e = env(), ref = add(e);
  const done = await click(e, ref, {}, {start: async () => { throw new Error('GitHub 404: workflow not found'); }});
  assert.equal(done.status, 502);
  assert.match(done.error, /no AI was used/);
  assert.deepEqual([row(e, ref).state, row(e, ref).state_note], ['new', '🤖 failed: could not start the run: GitHub 404: workflow not found']);
  assert.deepEqual(log(e, ref).map(l => l.action), ['ai', 'ai_failed']);
});

test('startRun dispatches feedback-ai.yml with the timers\' token on the public repo, never the site\'s token; missing settings throw', async () => {
  const calls = [];
  await startRun({TIMERS_GITHUB_TOKEN: 't', TIMERS_REPO: REPO, GITHUB_TOKEN: 'site-token'}, 'abc', async (...args) => { calls.push(args); });
  assert.deepEqual(calls.map(([e, inputs, workflow]) => [e.GITHUB_REPO, e.GITHUB_TOKEN, inputs, workflow]), [[REPO, 't', {ref: 'abc'}, 'feedback-ai.yml']]);
  await assert.rejects(() => startRun({TIMERS_REPO: 'x'}, 'abc', async () => {}), /TIMERS_GITHUB_TOKEN/);
  await assert.rejects(() => startRun({TIMERS_GITHUB_TOKEN: 'x'}, 'abc', async () => {}), /TIMERS_REPO/);
});

test('the run\'s steps: PR open -> ai_pr; none/failed -> new with the verdict; merged -> fixed and waiting for the release; closed -> new without the PR', async () => {
  const trusted = {trusted: true}, run = (e, ref, input, who = 'ai (run 9001)') => act(e, {ref, ...input}, who, NOW, trusted);
  const e = env(), ref = add(e, {state: 'ai_running', ai_run: '9001', ai_run_url: `${prUrl(0).replace('/pull/0', '')}/actions/runs/9001`});
  assert.equal((await run(e, ref, {action: 'ai_pr', pr: 'https://example.com/x'})).status, 400, 'a PR link of another site is refused');
  assert.equal((await run(e, ref, {action: 'ai_pr', pr: PR})).state, 'ai_pr');
  assert.equal(row(e, ref).pr_url, PR);
  assert.equal((await run(e, ref, {action: 'ai_merged'}, 'ai (PR 3100)')).state, 'fixed');
  const merged = row(e, ref);
  assert.deepEqual([merged.told, merged.tell_mode, merged.tell_mail, merged.ai_run], ['pending', 'release', 0, '']);
  const e2 = env(), ref2 = add(e2, {state: 'ai_pr', pr_url: PR});
  assert.equal((await run(e2, ref2, {action: 'ai_closed'}, 'ai (PR 3100)')).state, 'new');
  assert.deepEqual([row(e2, ref2).pr_url, row(e2, ref2).state_note], ['', '🤖 its PR was closed without merging']);
  const e3 = env(), ref3 = add(e3, {state: 'ai_running'});
  assert.equal((await run(e3, ref3, {action: 'ai_none', verdict: 'not-reproducible', why: 'the setup page works on 0.9.1'})).state, 'new');
  assert.equal(row(e3, ref3).state_note, '🤖 not-reproducible: the setup page works on 0.9.1');
  const e4 = env(), ref4 = add(e4, {state: 'ai_running'});
  assert.equal((await run(e4, ref4, {action: 'ai_none', verdict: 'made-up', why: ''})).state, 'new');
  assert.equal(row(e4, ref4).state_note, '🤖 none', 'an unknown verdict word becomes none');
  const e5 = env(), ref5 = add(e5, {state: 'ai_running'});
  assert.equal((await run(e5, ref5, {action: 'ai_failed'})).status, 400, 'a failure says why');
  assert.equal(row(e5, ref5).state, 'ai_running');
});

test('the brief carries the words, version, platform, screen and only the ticked files; never the contact, the install id or the screenshot', async () => {
  const e = env(), ref = add(e, {state: 'ai_running', ai_include: 'logs,profile', logs: 1, page: 1, profile: 1, screen: 'Setup', shot: 'png'});
  await e.FEEDBACK_FILES.put(`feedback/${ref}/logs.txt`, 'LOG LINE');
  await e.FEEDBACK_FILES.put(`feedback/${ref}/page.json`, '{"page":"data"}');
  await e.FEEDBACK_FILES.put(`feedback/${ref}/profile.json`, '{"profile":"snapshot"}');
  await e.FEEDBACK_FILES.put(`feedback/${ref}/screen.png`, 'PNG');
  const body = await briefOf(e, ref);
  assert.deepEqual(Object.keys(body.files).sort(), ['logs', 'profile'], 'page was not ticked');
  assert.equal(body.files.logs, 'LOG LINE');
  const text = JSON.stringify(body);
  for (const secret of ['ana@example.com', 'install-aaaa-bbbb', 'PNG']) assert.ok(!text.includes(secret), `the brief must not carry ${secret}`);
  assert.deepEqual([body.text, body.version, body.platform, body.screen], ['Setup stops at step 2 (invented)', '0.9.1', 'darwin', 'Setup']);
  assert.equal(await briefOf(e, '0000000000000fff'), null);
});

test('two clicks that both read an empty gate cannot both start: the caps are part of the write (one at a time, 3 a day)', async () => {
  const stale = e => ({...e.STATS, prepare: sql => (/COUNT\(\*\) AS n FROM feedback/.test(sql) ? {bind: () => ({first: async () => ({n: 0})}), first: async () => ({n: 0})} : e.STATS.prepare(sql))});
  const e = env(), a = add(e), b = add(e), e2 = {...e, STATS: stale(e)};
  assert.equal((await click(e2, a)).ok, true);
  assert.equal((await click(e2, b)).status, 409, 'a second run while one goes, though the gate read said none');
  assert.equal(row(e, b).state, 'new');
  const f = env(), refs = [add(f), add(f), add(f), add(f)], f2 = {...f, STATS: stale(f)};
  for (const ref of refs.slice(0, 3)) { assert.equal((await click(f2, ref)).ok, true); await act(f, {ref, action: 'ai_none', verdict: 'none', why: 'x'}, 'ai (run 1)', NOW, {trusted: true}); }
  assert.equal((await click(f2, refs[3])).status, 409, 'the 4th of the day, though the gate read said 0 so far');
  assert.equal(row(f, refs[3]).state, 'new');
});

test('a merged AI fix of a card that was deferred first does not reuse the deferral text as its Fixed reply', async () => {
  const e = env(), ref = add(e, {state: 'ai_pr', pr_url: prUrl(3100), tell_message: 'parked for later', told: 'app', seen_at: '2026-11-03T10:00:00.000Z'});
  assert.equal((await act(e, {ref, action: 'ai_merged'}, 'ai (PR 3100)', NOW, {trusted: true})).state, 'fixed');
  const after = row(e, ref);
  assert.deepEqual([after.tell_message, after.told, after.seen_at], ['', 'pending', '']);
});
