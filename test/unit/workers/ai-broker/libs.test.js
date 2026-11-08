// Guards the broker's pure rules (workers/ai-broker/lib): who may call, which lane, the allowance brakes, and the reply refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRunToken} from '../../../../workers/ai-broker/lib/oidc.mjs';
import {laneOf, LANES, queueOf} from '../../../../workers/ai-broker/lib/lanes.mjs';
import {allow, claudeAllow, claudeWeekPercent, linesOf, CLAUDE_LIMIT_PCT, DAILY, newMeter, record, recordCall, callsToday, ownSharePct, TOKENS_PER_PERCENT} from '../../../../workers/ai-broker/lib/budget.mjs';
import {weeklyWindow} from '../../../../workers/ai-broker/container/weekly.mjs';
import {refuseReply} from '../../../../workers/ai-broker/lib/guard.mjs';
import {modelOf, tierOfClaude} from '../../../../workers/ai-broker/lib/tiers.mjs';
import {slots} from '../../../../workers/ai-broker/lib/queue.mjs';
import {readFileSync} from 'node:fs';

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
async function signer() {
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const jwk = {...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1'};
  const sign = async (claims, header = {alg: 'RS256', kid: 'k1'}) => {
    const body = `${enc(header)}.${enc(claims)}`;
    return `${body}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body))).toString('base64url')}`;
  };
  return {sign, jwks: async () => ({keys: [jwk]})};
}
const good = {iss: 'https://token.actions.githubusercontent.com', aud: 'jobadabra-ai-broker', repository: 'GarryOne/jobadabra', event_name: 'pull_request', exp: Math.floor(Date.now() / 1000) + 600};
const opts = jwks => ({jwks, audience: 'jobadabra-ai-broker', repository: 'GarryOne/jobadabra'});

test('a live run of the owner\'s repo is accepted', async () => {
  const {sign, jwks} = await signer();
  assert.equal((await verifyRunToken(await sign(good), opts(jwks))).event_name, 'pull_request');
});

test('the broker takes run tokens of the public repo and the private site repo, and no third (31 Oct 2026: the site\'s changelog and digest jobs run on Codex)', async () => {
  const {sign, jwks} = await signer(), both = {...opts(jwks), repository: ['GarryOne/jobadabra', 'GarryOne/jobadabra-web']};
  for (const repository of ['GarryOne/jobadabra', 'GarryOne/jobadabra-web']) assert.equal((await verifyRunToken(await sign({...good, repository}), both)).repository, repository);
  const third = await sign({...good, repository: 'GarryOne/jobadabra-other'});
  await assert.rejects(() => verifyRunToken(third, both), /wrong repository/);
});

test('every other caller is refused with its reason', async () => {
  const {sign, jwks} = await signer(), other = await signer();
  const cases = [
    ['another repository', await sign({...good, repository: 'someone/else'}), /wrong repository/],
    ['another audience', await sign({...good, aud: 'x'}), /wrong audience/],
    ['an expired token', await sign({...good, exp: 1}), /expired/],
    ['another issuer', await sign({...good, iss: 'https://evil.example'}), /wrong issuer/],
    ['a token signed by another key', await other.sign(good), /bad signature/],
    ['alg none', await sign(good, {alg: 'none', kid: 'k1'}), /RS256/],
    ['no token', '', /not a JWT/],
  ];
  for (const [what, token, why] of cases) await assert.rejects(() => verifyRunToken(token, opts(jwks)), why, what);
});

test('the lane comes from the verified claims', () => {
  assert.equal(laneOf({event_name: 'pull_request'}), 'pr');
  assert.equal(laneOf({event_name: 'schedule', job_workflow_ref: 'GarryOne/jobadabra/.github/workflows/central-scout.yml@refs/heads/main'}), 'scheduled');
  assert.equal(laneOf({event_name: 'workflow_dispatch', job_workflow_ref: 'GarryOne/jobadabra/.github/workflows/job-search-benchmark.yml@refs/heads/main'}), 'bench');
});

test('a by-hand Search check (its by-hand environment) gets the by-hand lane; the nightly and every other workflow keep theirs', () => {
  const search = 'GarryOne/jobadabra/.github/workflows/search-personas.yml@refs/heads/main';
  assert.equal(laneOf({event_name: 'workflow_dispatch', workflow_ref: search, environment: 'search-check-by-hand'}), 'byhand');
  assert.equal(laneOf({event_name: 'workflow_dispatch', job_workflow_ref: search, environment: 'search-check-by-hand'}), 'byhand');
  assert.equal(laneOf({event_name: 'workflow_dispatch', workflow_ref: search}), 'scheduled', 'the nightly (no environment) stays scheduled');
  const tapes = 'GarryOne/jobadabra/.github/workflows/press-tapes.yml@refs/heads/main';   // owner, 8 Nov 2026: "Yes, tapes use it too (Recommended)"
  assert.equal(laneOf({event_name: 'workflow_dispatch', workflow_ref: tapes, environment: 'search-check-by-hand'}), 'byhand');
  assert.equal(laneOf({event_name: 'workflow_dispatch', workflow_ref: tapes}), 'scheduled');
  assert.equal(laneOf({event_name: 'workflow_dispatch', workflow_ref: search, environment: 'other'}), 'scheduled');
  for (const other of ['central-scout.yml', 'search-personas-extra.yml', 'press-tapes-old.yml', 'job-search-benchmark.yml']) {
    assert.notEqual(laneOf({event_name: 'workflow_dispatch', workflow_ref: `GarryOne/jobadabra/.github/workflows/${other}@refs/heads/main`, environment: 'search-check-by-hand'}), 'byhand', other);
  }
  assert.ok(LANES.includes('byhand'));
});

// Owner, 8 Nov 2026 ("by-hand Search checks may use the 30% PR reserve (about 1 run a day)", then "codex up to 100%, Claude up to 90%"): a by-hand check waits behind PR checks and stops at its day cap; the reserve and the Claude exception are gone.
test('a by-hand Search check runs to 100% of the Codex week, waits behind PR checks, and stops at its day cap', () => {
  assert.equal(allow('byhand', newMeter(2000000000), 99).ok, true);
  assert.deepEqual(allow('byhand', newMeter(2000000000), 100), {ok: false, why: 'budget:week 100% of 100% (byhand)'});
  assert.equal(queueOf('byhand'), 'scheduled');
  assert.equal(queueOf('drift'), 'scheduled');
  assert.equal(queueOf('pr'), 'pr');
  const day = 1999990000;
  let m = newMeter(2000000000);
  for (let i = 0; i < DAILY.byhand; i++) m = recordCall(m, 'byhand', day);
  assert.deepEqual(allow('byhand', m, null, TOKENS_PER_PERCENT, day), {ok: false, why: `budget:daily ${DAILY.byhand} of ${DAILY.byhand} calls (byhand)`});
  assert.equal(allow('byhand', m, null, TOKENS_PER_PERCENT, day + 86400).ok, true, 'a new UTC day starts at zero');
});

// Owner, 8 Nov 2026 ("Actually, codex up to 100%, Claude up to 90%"): Claude's seven-day window is read as the CLI gives it (a fraction 0..1, measured), 90% and over is closed for every lane.
test('Claude is open under 90% of its week and closed from 90%; an unknown reading is open', () => {
  const week = (utilization, resetsAt = 2000000100) => ({sevenDay: {utilization, resetsAt}});
  assert.equal(claudeWeekPercent(week(0.04), 2000000000), 4);
  assert.equal(claudeWeekPercent(week(0.899), 2000000000), 89.9);
  assert.deepEqual([0.5, 0.899].map(u => claudeAllow(claudeWeekPercent(week(u), 2000000000))), [{ok: true}, {ok: true}]);
  assert.deepEqual(claudeAllow(claudeWeekPercent(week(0.9), 2000000000)), {ok: false, why: 'budget:claude-week 90% of 90%'});
  assert.deepEqual(claudeAllow(claudeWeekPercent(week(1), 2000000000)), {ok: false, why: 'budget:claude-week 100% of 90%'});
  for (const unknown of [null, {}, {sevenDay: null}, week(0.99, 1999999999), week(99), week(-0.1), week(NaN), {sevenDay: {resetsAt: 2000000100}}, {sevenDay: {utilization: 0.95}}]) {
    assert.equal(claudeWeekPercent(unknown, 2000000000), null, JSON.stringify(unknown));
    assert.deepEqual(claudeAllow(claudeWeekPercent(unknown, 2000000000)), {ok: true});
  }
  assert.equal(CLAUDE_LIMIT_PCT, 90);
});

test('the lines /health shows are the ones allow() uses', () => {
  const lines = linesOf(LANES);
  for (const lane of LANES) {
    assert.equal(lines.week[lane], 100);
    assert.equal(allow(lane, newMeter(2000000000), lines.week[lane] - 0.1).ok, true); assert.equal(allow(lane, newMeter(2000000000), lines.week[lane]).ok, false);
  }
  assert.equal(lines.daily, DAILY); assert.equal(lines.claude, 90);
});

test('only the exact nightly workflow gets drift; PR priority and verified workflow precedence remain', () => {
  const workflow = 'GarryOne/jobadabra/.github/workflows/ai-answer-drift.yml@refs/heads/bench';
  assert.equal(laneOf({event_name: 'schedule', job_workflow_ref: workflow}), 'drift');
  assert.equal(laneOf({event_name: 'workflow_dispatch', workflow_ref: workflow}), 'drift');
  assert.equal(laneOf({event_name: 'pull_request', job_workflow_ref: workflow}), 'pr');
  for (const name of ['ai-answer-drift-extra.yml', 'other-ai-answer-drift.yml', 'ai-answer-drift.yml.bak']) {
    assert.equal(laneOf({workflow_ref: `GarryOne/jobadabra/.github/workflows/${name}@refs/heads/main`}), 'scheduled');
  }
  assert.equal(laneOf({workflow_ref: workflow, job_workflow_ref: 'GarryOne/jobadabra/.github/workflows/central-scout.yml@refs/heads/main'}), 'scheduled');
  assert.equal(laneOf({workflow_ref: 'GarryOne/jobadabra/.github/workflows/central-scout.yml@refs/heads/.github/workflows/ai-answer-drift.yml'}), 'scheduled');
  assert.ok(LANES.includes('drift'));
});

const driftDay = Date.parse('2026-10-30T23:59:59Z') / 1000;

test('drift accepts call 24, refuses call 25 and opens again at UTC midnight', () => {
  let m = newMeter(driftDay + 604800);
  for (let i = 0; i < 24; i++) {
    assert.equal(allow('drift', m, null, TOKENS_PER_PERCENT, driftDay).ok, true);
    m = recordCall(m, 'drift', driftDay);
  }
  assert.equal(callsToday(m, 'drift', driftDay), 24);
  assert.deepEqual(allow('drift', m, null, TOKENS_PER_PERCENT, driftDay), {ok: false, why: 'budget:daily 24 of 24 calls (drift)'});
  assert.equal(allow('scheduled', m, null, TOKENS_PER_PERCENT, driftDay).ok, true);
  assert.equal(allow('drift', m, null, TOKENS_PER_PERCENT, driftDay + 1).ok, true);
  assert.equal(callsToday(m, 'drift', driftDay + 1), 0);
  m = recordCall(m, 'drift', driftDay + 1);
  assert.equal(callsToday(m, 'drift', driftDay + 1), 1);
});

test('old stored meters accept drift tokens and daily counts without NaN or losing previous tokens', () => {
  let m = JSON.parse('{"resetsAt":2000000000,"tokens":{"pr":10,"scheduled":20,"bench":30}}');
  assert.equal(allow('drift', m, null, TOKENS_PER_PERCENT, driftDay).ok, true);
  assert.equal(callsToday(m, 'drift', driftDay), 0);
  m = recordCall(m, 'drift', driftDay);
  m = record(m, 'drift', 40, driftDay);
  assert.equal(ownSharePct(m, 1), 100);
  assert.equal(callsToday(JSON.parse(JSON.stringify(m)), 'drift', driftDay), 1);
});

test('weekly resets preserve daily reservations; token completions never count calls twice', () => {
  let m = recordCall(newMeter(driftDay), 'drift', driftDay);
  m = record(m, 'drift', 123, driftDay, driftDay + 604800);
  assert.equal(ownSharePct(m, 1), 123);
  assert.equal(callsToday(m, 'drift', driftDay), 1);
});

// Owner, 8 Nov 2026 ("codex up to 100%"; the 3 Nov "PR reserve" that held scheduled, bench and drift at 70% is gone): every lane stops at 100% of the Codex week.
const CAP = {pr: 100, byhand: 100, scheduled: 100, bench: 100, drift: 100};

test('every lane may use the week up to 100%: refused at the cap, allowed just below', () => {
  for (const lane of LANES) {
    const cap = CAP[lane], fresh = newMeter(2000000000);
    const below = record(newMeter(2000000000), lane, (cap - 0.1) * TOKENS_PER_PERCENT, 1);
    const full = record(newMeter(2000000000), lane, cap * TOKENS_PER_PERCENT, 1);
    assert.deepEqual(allow(lane, below, null), {ok: true}, `${lane}: own share below cap`);
    assert.deepEqual(allow(lane, full, null), {ok: false, why: `budget:own-share ${cap.toFixed(1)}% of ${cap}% (${lane})`});
    assert.deepEqual(allow(lane, fresh, cap - 0.1), {ok: true}, `${lane}: week below cap`);
    assert.deepEqual(allow(lane, fresh, cap), {ok: false, why: `budget:week ${cap}% of ${cap}% (${lane})`});
    assert.deepEqual(allow(lane, below, cap - 0.1), {ok: true}, `${lane}: both below cap`);
    assert.deepEqual(allow(lane, fresh, null), {ok: true}, `${lane}: no week reading yet`);
  }
  for (const lane of LANES) assert.equal(allow(lane, newMeter(2000000000), 71).ok, true, `${lane} at 71% of the week still runs (no reserve since 8 Nov 2026)`);
});

// Owner's goal, 30 Oct 2026 (a hand beta, green): /health read whole week 32%, broker tokens 43,241,035; the seed ratio called that 60.06% and refused every scheduled call.
test('own share never exceeds the whole-week reading: a seed estimate over the cap is allowed while the whole week is below the cap, and refused once the week reaches it', () => {
  for (const lane of LANES) {
    const cap = CAP[lane], m = record(newMeter(2000000000), lane, (cap + 0.1) * TOKENS_PER_PERCENT, 1);
    assert.equal(ownSharePct(m), cap + 0.1, 'by the seed alone the broker reads over the cap');
    assert.deepEqual(allow(lane, m, cap - 0.1), {ok: true}, lane);
    assert.deepEqual(allow(lane, m, cap), {ok: false, why: `budget:own-share ${cap.toFixed(1)}% of ${cap}% (${lane})`});
    assert.deepEqual(allow(lane, m, null), {ok: false, why: `budget:own-share ${(cap + 0.1).toFixed(1)}% of ${cap}% (${lane})`}, 'no whole-week reading yet: the seed estimate stands');
  }
});

test('a meter with no reset date yet keeps counting across calls (Gitar #221: it was reset to 1970 on every call)', () => {
  let m = newMeter(0);
  for (let i = 0; i < 3; i++) m = record(m, 'scheduled', 10 * TOKENS_PER_PERCENT, 1793000000, undefined);
  assert.equal(ownSharePct(m), 30);
  assert.equal(allow('scheduled', m, null).ok, true);
  m = record(m, 'scheduled', 70 * TOKENS_PER_PERCENT, 1793000000, undefined);
  assert.equal(allow('scheduled', m, null).ok, false);
});

test('a new week starts a fresh meter', () => {
  const m = record(newMeter(100), 'scheduled', 5 * TOKENS_PER_PERCENT, 500, 1000);
  assert.equal(m.resetsAt, 1000);
  assert.equal(ownSharePct(m), 5);
});

test('4 calls run at once and a waiting PR check goes before scheduled and benchmark work', async () => {
  const q = slots(2), order = [];
  const [a, b] = [await q.acquire('scheduled'), await q.acquire('scheduled')];
  const waiters = ['bench', 'scheduled', 'pr'].map(lane => q.acquire(lane).then(release => { order.push(lane); release(); }));
  assert.deepEqual(q.stats(), {active: 2, waiting: {pr: 1, scheduled: 1, bench: 1}});
  a(); a();   // a second release of the same slot frees nothing
  b();
  await Promise.all(waiters);
  assert.deepEqual(order, ['pr', 'scheduled', 'bench']);
  assert.equal(q.stats().active, 0);
});

test('a Claude tier keeps its Codex counterpart, and an unknown tier is refused', () => {
  assert.deepEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001', 'gpt-4'].map(tierOfClaude), ['small', 'mid', 'large', 'small', null]);
  assert.deepEqual(['small', 'mid', 'large', undefined, 'huge', 'constructor', '__proto__', 'toString'].map(modelOf), ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', null, null, null, null]);
});

test('the Worker keeps its egress list and exports what the list needs (it cannot be loaded here, so its source is read)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../../../workers/ai-broker/worker.js', import.meta.url), 'utf8');
  assert.match(src, /export \{ContainerProxy\} from '@cloudflare\/containers'/);   // missing: every container start fails (28 Oct 2026)
  assert.match(src, /enableInternet = false/);
  assert.match(src, /interceptHttps = true/);   // without it HTTPS fails with the internet off: codex timed out on chatgpt.com (28 Oct 2026)
  assert.match(src, /allowedHosts = HOSTS/);
  assert.match(src, /HOSTS = \['chatgpt\.com', 'auth\.openai\.com', 'api\.openai\.com', 'api\.anthropic\.com'\]/);   // the Claude engine adds api.anthropic.com (1 Nov 2026) and nothing else
  assert.match(src, /refuseReply\(answer\.reply\)/);   // the last layer against a credential in a reply
});

test('a planted injection\'s reply is refused: tokens, login fields, long encodings, long text', () => {
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.c2lnbmF0dXJl';
  for (const text of [`Here: ${jwt}`, '{"refresh_token": "abc"}', 'x'.repeat(120), 'sk-' + 'a'.repeat(30), 'y '.repeat(10001)])
    assert.match(refuseReply(text), /^reply-refused/, text.slice(0, 20));
  assert.equal(refuseReply('{"verdict":"pass","reason":"the image is mostly red"}'), null);
});

test('the week reading is the window that lasts a week, whichever slot it sits in', () => {
  const day = {usedPercent: 3, resetsAt: 1, windowDurationMins: 300}, week = {usedPercent: 32, resetsAt: 2, windowDurationMins: 10080};
  assert.deepEqual(weeklyWindow({primary: week, secondary: null}), {usedPercent: 32, resetsAt: 2});
  assert.deepEqual(weeklyWindow({primary: day, secondary: week}), {usedPercent: 32, resetsAt: 2});   // the 5h window in primary must not be taken for the week
  assert.equal(weeklyWindow({primary: day, secondary: null}), null);
  assert.equal(weeklyWindow({primary: {usedPercent: 32, resetsAt: 2}}), null);   // no length given: not trusted
  assert.equal(weeklyWindow(undefined), null);
});

test('the AI broker audience is accepted, the old jobadabra-codex-broker one and any other are refused (7/7, 2 Nov 2026)', async () => {
  const {sign, jwks} = await signer();
  assert.equal((await verifyRunToken(await sign({...good, aud: 'jobadabra-ai-broker'}), opts(jwks))).aud, 'jobadabra-ai-broker');
  for (const aud of ['jobadabra-codex-broker', 'jobadabra-other']) await assert.rejects(async () => verifyRunToken(await sign({...good, aud}), opts(jwks)), /wrong audience/);
});

// Why (1 Nov 2026, owner's pick via mac-07): central-scout.yml and product-brain.yml move to jobadabra-lab. Each must verify under both owners and keep the lane (so tiers and caps) it has today in jobadabra; a missing repo name makes every scout AI call skip silently with "oidc: wrong repository".
const allowed = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars.REPOSITORY.split(',');
for (const name of ['central-scout', 'product-brain']) {
  test(`${name}.yml run in jobadabra-lab is accepted under both owners and keeps the scheduled lane`, async () => {
    const {sign, jwks} = await signer();
    for (const repository of ['GarryOne/jobadabra-lab', 'jobadabra/jobadabra-lab']) {
      const claims = {...good, repository, event_name: 'schedule', job_workflow_ref: `${repository}/.github/workflows/${name}.yml@refs/heads/main`};
      const verified = await verifyRunToken(await sign(claims), {...opts(jwks), repository: allowed});
      assert.equal(laneOf(verified), 'scheduled');
      assert.equal(laneOf({...verified, job_workflow_ref: verified.job_workflow_ref.replace('-lab/', '/')}), laneOf(verified));   // the same workflow in jobadabra: same lane
    }
  });
}
