// The two routes the Send to AI run calls (admin/feedback-ai.js, PR 7/7): GET /api/feedback/brief and POST /api/feedback/ai-status. The run proves itself with GitHub's own token; every way of forging one is played
// here and must change nothing and serve nothing. Tokens are signed with a test key; no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {brief, status} from '../../../admin/feedback-ai.js';
import {actRoute, view} from '../../../admin/feedback.js';
import {NOW, REPO, add, env, log, prUrl, row, signer} from '../shared/feedback/feedback-kit.js';

const kit = await signer(), deps = {jwks: kit.jwks};
const get = (ref, token) => brief(new Request(`https://x/api/feedback/brief?ref=${ref}`, {headers: token ? {Authorization: `Bearer ${token}`} : {}}), env_, NOW, deps);
const post = (body, token, e = env_) => status(new Request('https://x/api/feedback/ai-status', {method: 'POST', headers: token ? {Authorization: `Bearer ${token}`} : {}, body: JSON.stringify(body)}), e, NOW, deps);
let env_;
const closeFile = branch => `${REPO}/.github/workflows/feedback-ai-closed.yml@refs/heads/${branch}`;
const running = (fields = {}) => { env_ = env(); return add(env_, {state: 'ai_running', ...fields}); };

test('the brief is served to the run GitHub started, binds it to the card, and logs who took it', async () => {
  const ref = running({ai_include: 'logs', logs: 1});
  await env_.FEEDBACK_FILES.put(`feedback/${ref}/logs.txt`, 'LOG LINE');
  const answer = await get(ref, await kit.token());
  assert.equal(answer.status, 200);
  const {brief: body} = await answer.json();
  assert.deepEqual([body.ref, body.files.logs, 'contact' in body, 'install' in body], [ref, 'LOG LINE', false, false]);
  const bound = row(env_, ref);
  assert.deepEqual([bound.ai_run, bound.ai_run_url], ['9001', `https://github.com/${REPO}/actions/runs/9001`]);
  assert.deepEqual(log(env_, ref), [{who: 'ai (run 9001)', action: 'ai_brief', detail: 'run bound'}]);
  assert.equal((await get(ref, await kit.token())).status, 200, 'the same run may read it again');
});

test('every forged or wrong token gets 401 on both routes and nothing changes', async () => {
  const ref = running({ai_run: '9001'});
  const cases = {
    'no token': undefined, 'garbage': 'abc.def.ghi',
    'signed with a key GitHub never published': await kit.forged(),
    'another audience': await kit.token({aud: 'jobadabra-ai-broker'}),
    'another repository': await kit.token({repository: 'someone/else'}),
    'another workflow file': await kit.token({workflow_ref: `${REPO}/.github/workflows/ui-fix.yml@refs/heads/main`}),
    'the right file from a branch': await kit.token({workflow_ref: `${REPO}/.github/workflows/feedback-ai.yml@refs/heads/evil`}),
    'another event': await kit.token({event_name: 'schedule'}),
    'expired': await kit.token({exp: 1}),
  };
  for (const [what, token] of Object.entries(cases)) {
    assert.equal((await get(ref, token)).status, 401, `brief: ${what}`);
    assert.equal((await post({ref, status: 'none', verdict: 'none', why: 'x'}, token)).status, 401, `status: ${what}`);
  }
  assert.deepEqual([row(env_, ref).state, log(env_, ref).length], ['ai_running', 0]);
  const noRepo = env({TIMERS_REPO: ''});
  assert.equal((await status(new Request('https://x/s', {method: 'POST', headers: {Authorization: `Bearer ${await kit.token()}`}, body: JSON.stringify({ref, status: 'none'})}), noRepo, NOW, deps)).status, 401, 'no repository set = closed');
});

test('the brief is refused for a card that is not waiting for a run, one whose hour is over, and a second run that is not the first', async () => {
  const idle = running({state: 'new'});
  assert.equal((await get(idle, await kit.token())).status, 409);
  const old = running({state_at: '2026-11-03T10:00:00.000Z'});
  assert.equal((await get(old, await kit.token())).status, 409, 'an hour has passed');
  const ref = running();
  assert.equal((await get(ref, await kit.token({run_id: '1'}))).status, 200);
  assert.equal((await get(ref, await kit.token({run_id: '2'}))).status, 409, 'the first run to ask owns the card');
  assert.equal(row(env_, ref).ai_run, '1');
  assert.equal((await get('not-a-ref', await kit.token())).status, 400);
  assert.equal((await get('0000000000000fff', await kit.token())).status, 409);
});

test('a run reports its PR, then the PR merges: the card goes ai_running -> ai_pr -> fixed, waiting for the release', async () => {
  const ref = running({ai_run: '9001'});
  const opened = await post({ref, status: 'pr', pr: prUrl(3100)}, await kit.token());
  assert.deepEqual([opened.status, (await opened.json()).state], [200, 'ai_pr']);
  assert.equal(row(env_, ref).pr_url, prUrl(3100));
  const merged = await post({ref, status: 'merged', pr: prUrl(3100)}, await kit.token({event_name: 'pull_request_target', workflow_ref: closeFile('main'), run_id: '9100'}));
  assert.deepEqual([merged.status, (await merged.json()).state], [200, 'fixed']);
  assert.deepEqual([row(env_, ref).told, row(env_, ref).tell_mode], ['pending', 'release']);
  assert.deepEqual(log(env_, ref).map(l => [l.who, l.action]), [['ai (run 9001)', 'ai_pr'], ['ai (PR 3100)', 'ai_merged']]);
});

test('merged and closed only for the PR the card holds, and only from a pull_request_target run; a workflow_dispatch run cannot claim a merge', async () => {
  const e = env(), ref = add(e, {state: 'ai_pr', pr_url: prUrl(3100)}), merge = await kit.token({event_name: 'pull_request_target', workflow_ref: closeFile('main')});
  env_ = e;
  assert.equal((await post({ref, status: 'merged', pr: prUrl(3101)}, merge)).status, 409, 'another PR');
  assert.equal((await post({ref, status: 'merged'}, merge)).status, 409, 'no PR named');
  assert.equal((await post({ref, status: 'merged', pr: prUrl(3100)}, await kit.token())).status, 401, 'a dispatch run is not a merge event');
  assert.equal(row(e, ref).state, 'ai_pr');
  assert.equal((await post({ref, status: 'closed', pr: prUrl(3100)}, merge)).status, 200);
  assert.deepEqual([row(e, ref).state, row(e, ref).pr_url], ['new', '']);
  assert.equal((await post({ref, status: 'merged', pr: prUrl(3100)}, merge)).status, 409, 'a second report finds the card moved on (and the PR link gone)');
});

test('only the run that owns the card, inside its hour, can end it; a PR report of a wrong state or a bad link changes nothing', async () => {
  const other = running({ai_run: '77'});
  assert.equal((await post({ref: other, status: 'none', verdict: 'none', why: 'x'}, await kit.token({run_id: '9001'}))).status, 409, 'another run id');
  const old = running({ai_run: '9001', state_at: '2026-11-03T10:30:00.000Z'});
  assert.equal((await post({ref: old, status: 'failed', why: 'x'}, await kit.token())).status, 409, 'an hour is over');
  const unbound = running();
  assert.equal((await post({ref: unbound, status: 'none'}, await kit.token())).status, 409, 'a run that never took the brief');
  const idle = running({state: 'new', ai_run: '9001'});
  assert.equal((await post({ref: idle, status: 'pr', pr: prUrl(1)}, await kit.token())).status, 409, 'the card is not running');
  const bad = running({ai_run: '9001'});
  assert.equal((await post({ref: bad, status: 'pr', pr: 'https://example.com/pull/1'}, await kit.token())).status, 400);
  assert.deepEqual([row(env_, bad).state, row(env_, bad).pr_url], ['ai_running', '']);
  assert.equal((await post({ref: bad, status: 'bogus'}, await kit.token())).status, 400);
  assert.equal((await post({ref: 'zz', status: 'none'}, await kit.token())).status, 400);
  assert.equal((await post({ref: '0000000000000fff', status: 'none'}, await kit.token())).status, 404);
});

test('merged and closed are trusted only from feedback-ai-closed.yml as merged on main, and only those two steps; feedback-ai.yml, a branch copy or a dispatch step from it is refused', async () => {
  // Owner, 5 Nov 2026: "Yes, rename + fold": the close notice moves to its own file so a normal PR's close draws one row, not seven.
  const fromMain = await kit.token({event_name: 'pull_request_target', workflow_ref: closeFile('main')});
  const e = env(), ref = add(e, {state: 'ai_pr', pr_url: prUrl(3100)});
  env_ = e;
  assert.equal((await post({ref, status: 'merged', pr: prUrl(3100)}, await kit.token({event_name: 'pull_request_target', workflow_ref: closeFile('evil')}))).status, 401, 'a branch copy of the close file');
  assert.equal((await post({ref, status: 'merged', pr: prUrl(3100)}, await kit.token({event_name: 'pull_request_target'}))).status, 401, 'feedback-ai.yml on main no longer closes a card');
  assert.equal(row(e, ref).state, 'ai_pr');
  assert.equal((await post({ref, status: 'merged', pr: prUrl(3100)}, fromMain)).status, 200, 'positive control: the close file on main');
  const run = running({ai_run: '9001'});
  assert.equal((await post({ref: run, status: 'pr', pr: prUrl(3101)}, await kit.token({workflow_ref: closeFile('main')}))).status, 401, 'a PR report must come from feedback-ai.yml');
  assert.equal((await get(run, await kit.token({workflow_ref: closeFile('main')}))).status, 401, 'the brief only for feedback-ai.yml');
  assert.equal((await post({ref: run, status: 'none'}, await kit.token({event_name: 'pull_request_target'}))).status, 401, 'a pull_request_target run of feedback-ai.yml cannot end a run');
  const open = add(env_, {state: 'ai_pr', pr_url: prUrl(3102)});
  assert.equal((await post({ref: open, status: 'closed', pr: prUrl(3102)}, await kit.token({workflow_ref: closeFile('main')}))).status, 401, 'a dispatch token from the close file is not a close');
  assert.equal((await post({ref: open, status: 'closed', pr: prUrl(3102)}, fromMain)).status, 200, 'closed from the close file on main');
});

test('the run ends without a PR: the card is new again and shows the verdict and the reason, with the run id in the log', async () => {
  const ref = running({ai_run: '9001', ai_run_url: 'u'});
  const done = await post({ref, status: 'none', verdict: 'false-positive', why: 'the button exists; the report was about another app'}, await kit.token());
  assert.equal(done.status, 200);
  const after = row(env_, ref);
  assert.deepEqual([after.state, after.state_note, after.ai_run, after.ai_run_url], ['new', '🤖 false-positive: the button exists; the report was about another app', '', '']);
  assert.deepEqual(log(env_, ref), [{who: 'ai (run 9001)', action: 'ai_none', detail: 'ai_running -> new: false-positive'}]);
});

test('only GET reads the brief and only POST reports', async () => {
  env_ = env();
  assert.equal((await brief(new Request('https://x/b', {method: 'POST'}), env_, NOW, deps)).status, 405);
  assert.equal((await status(new Request('https://x/s'), env_, NOW, deps)).status, 405);
});

test('the owner\'s click starts feedback-ai.yml for that ref with the timers\' token; without the token it is a 503; a stranger gets 404; the owner route never accepts a run\'s own step', async () => {
  const calls = [], dispatch = async (e, inputs, workflow) => { calls.push([e.GITHUB_REPO, e.GITHUB_TOKEN, inputs, workflow]); };
  const post = (e, body, key = 'owner-key') => actRoute(new Request('https://x/admin/growth/feedback/act', {method: 'POST', headers: {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {})}, body: JSON.stringify(body)}), e, NOW, {dispatch});
  const e = env(), ref = add(e);
  const sent = await post(e, {ref, action: 'ai', include: {profile: true}});
  assert.deepEqual([sent.status, (await sent.json()).state], [200, 'ai_running']);
  assert.deepEqual(calls, [[REPO, 'timers-token', {ref}, 'feedback-ai.yml']]);
  assert.equal(row(e, ref).ai_include, 'logs,page,profile');
  assert.deepEqual(log(e, ref).map(l => l.who), ['owner (key)']);
  assert.equal((await post(e, {ref, action: 'ai_merged'})).status, 400, 'a run\'s step through the owner\'s route');
  assert.equal((await post(e, {ref, action: 'ai_pr', pr: prUrl(1)})).status, 400);
  assert.equal((await post(env(), {ref, action: 'ai'}, 'wrong-key')).status, 404);
  const noToken = env({TIMERS_GITHUB_TOKEN: ''}), second = add(noToken);
  assert.equal((await post(noToken, {ref: second, action: 'ai'})).status, 503);
  assert.equal(row(noToken, second).state, 'new');
});

test('the page\'s own poll sends a run that never answered back to new, so a dead run cannot leave a card stuck', async () => {
  const e = env(), ref = add(e, {state: 'ai_running', state_at: '2026-11-03T09:00:00.000Z'});
  const answer = await view(new Request('https://x/admin/feedback/inbox?json=1', {headers: {Authorization: 'Bearer owner-key'}}), e, NOW);
  const {rows} = await answer.json();
  assert.equal(rows.find(r => r.ref === ref).state, 'new', 'the list already shows it as new');
  assert.equal(row(e, ref).state_note, '🤖 failed: the run did not answer in an hour');
  assert.deepEqual(log(e, ref).map(l => l.who), ['system']);
});

const fixerRef = branch => `${REPO}/.github/workflows/ai-fixer.yml@refs/heads/${branch}`;

test('ai-fixer.yml is trusted for the brief and the pr/none/failed reports exactly like feedback-ai.yml, as merged on main and only for a dispatch; nothing else changes', async () => {
  const ref = running();
  const fixer = run => kit.token({workflow_ref: fixerRef('main'), run_id: run});
  assert.equal((await get(ref, await fixer('7001'))).status, 200, 'positive control: the brief goes to the agent run');
  assert.equal(row(env_, ref).ai_run, '7001');
  assert.equal((await get(ref, await fixer('7002'))).status, 409, 'a second run (a round) is not the first');
  const refused = {
    'a branch copy': {workflow_ref: fixerRef('evil')}, 'a pull_request event': {workflow_ref: fixerRef('main'), event_name: 'pull_request'},
    'a pull_request_target event': {workflow_ref: fixerRef('main'), event_name: 'pull_request_target'}, 'another repository': {workflow_ref: fixerRef('main'), repository: 'someone/else'},
    'another audience': {workflow_ref: fixerRef('main'), aud: 'jobadabra-ai-broker'}, 'a longer file name': {workflow_ref: `${REPO}/.github/workflows/ai-fixer.yml.evil@refs/heads/main`},
  };
  const fresh = running();
  for (const [what, claims] of Object.entries(refused)) assert.equal((await get(fresh, await kit.token({...claims, run_id: '7003'}))).status, 401, what);
  assert.deepEqual([row(env_, fresh).ai_run, row(env_, fresh).state], ['', 'ai_running'], 'none of them bound the card');
  const idle = running({state: 'new'}), old = running({state_at: '2026-11-03T10:00:00.000Z'});
  assert.equal((await get(idle, await fixer('7004'))).status, 409, 'a card that was not clicked');
  assert.equal((await get(old, await fixer('7005'))).status, 409, 'a stale hour');
});

test('the agent run reports its own card: pr, none and failed from the bound run only; merged and closed never come from ai-fixer.yml', async () => {
  const ref = running({ai_run: '7001'}), own = await kit.token({workflow_ref: fixerRef('main'), run_id: '7001'}), other = await kit.token({workflow_ref: fixerRef('main'), run_id: '7002'});
  assert.equal((await post({ref, status: 'pr', pr: prUrl(3300)}, other)).status, 409, 'a run that does not own the card');
  assert.equal(row(env_, ref).state, 'ai_running');
  assert.equal((await post({ref, status: 'pr', pr: prUrl(3300)}, own)).status, 200);
  assert.equal(row(env_, ref).state, 'ai_pr');
  for (const closing of ['merged', 'closed']) {
    assert.equal((await post({ref, status: closing, pr: prUrl(3300)}, await kit.token({workflow_ref: fixerRef('main'), event_name: 'pull_request_target', run_id: '7001'}))).status, 401, `${closing} from ai-fixer.yml`);
    assert.equal((await post({ref, status: closing, pr: prUrl(3300)}, own)).status, 401, `${closing} from a dispatch`);
  }
  const none = running({ai_run: '7001'});
  assert.equal((await post({ref: none, status: 'none', verdict: 'needs-human', why: 'tests-failed'}, own)).status, 200);
  assert.equal(row(env_, none).state, 'new', 'the card is new again with the verdict');
});
