// The states of a feedback and the actions on them (shared/feedback-actions.js, admin/feedback.js): the table is the design, so every state x action pair is played; a delete leaves nothing in R2;
// the log keeps who and when but no text; only the owner reaches the route. Nothing here calls Telegram or the real bucket.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {ACTIONS, STATES, act, actionsFor, historyOf} from '../../shared/feedback-actions.js';
import {actRoute, view} from '../../admin/feedback.js';
import {recentFeedback, undelivered} from '../../shared/feedback.js';
import {PUBLIC_REPO, githubUrl} from '../../shared/repos.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql', '0128_feedback_replies.sql', '0129_feedback_ai.sql']) db.exec(readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql), batch: async list => { const out = []; for (const item of list) out.push({meta: {changes: (await item.run()).changes}}); return out; }};   // D1's batch: in order, each result has meta.changes
}
const bucket = () => {
  const kept = new Map();
  return {kept, put: async (key, value) => { kept.set(key, value); }, get: async key => (kept.has(key) ? {body: kept.get(key)} : null),
    delete: async keys => { for (const key of [].concat(keys)) kept.delete(key); },
    list: async ({prefix}) => ({objects: [...kept.keys()].filter(key => key.startsWith(prefix)).map(key => ({key})), truncated: false})};
};
const env = (extra = {}) => ({STATS: d1(), FEEDBACK_FILES: bucket(), STATS_KEY: 'owner-key', STATS_API_KEY: 'owner-key', ...extra});
let counter = 0;
function add(e, state = 'new', text = 'Setup stops at step 2 (invented)') {
  const ref = (++counter).toString(16).padStart(16, '0');
  e.STATS.db.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, state) VALUES ('2026-11-03T09:00:00.000Z', '2026-11-03', 'install-aaaa-bbbb', '0.9.1', 'darwin', ?, 'ana@example.com', ?, ?)").run(text, ref, state);
  return ref;
}
const stateOf = (e, ref) => e.STATS.db.prepare('SELECT state, state_note, impact FROM feedback WHERE ref = ?').get(ref);
const BODY = {fixed: {when: 'never'}, released: {version: '0.9.12'}, defer: {tell: false}, ai: {}, ai_pr: {pr: `${githubUrl(PUBLIC_REPO)}/pull/3100`}, ai_none: {verdict: 'none'}, ai_failed: {why: 'x'}, ai_merged: {}, ai_closed: {}, dismiss: {}, false_positive: {note: 'works as designed'}, reopen: {}, delete: {}, impact: {impact: 'high'}};

test('every state x action pair does what the table says: allowed ones end in the table\'s state, the others are refused with 409 and change nothing', async () => {
  for (const state of STATES) for (const action of Object.keys(ACTIONS)) {
    const e = env(), ref = add(e, state), result = await act(e, {ref, action, ...BODY[action]}, 'owner (key)', new Date(), {trusted: true, start: async () => {}});   // the run's own steps need the proof the AI routes give; Send to AI needs a start
    if (ACTIONS[action].from.includes(state)) {
      assert.equal(result.ok, true, `${action} from ${state}: ${result.error}`);
      if (action === 'delete') assert.equal(stateOf(e, ref), undefined);
      else assert.equal(stateOf(e, ref).state, ACTIONS[action].to || state, `${action} from ${state}`);
    } else {
      assert.equal(result.status, 409, `${action} from ${state} must be refused`);
      assert.equal(stateOf(e, ref).state, state);
      assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM feedback_log').get().n, 0, 'a refused action writes no log line');
    }
  }
});

test('the menu offers exactly the actions the table allows for the state', () => {
  assert.deepEqual(actionsFor('new'), ['fixed', 'defer', 'ai', 'dismiss', 'false_positive', 'delete']);
  assert.deepEqual(actionsFor('deferred'), ['fixed', 'ai', 'reopen', 'delete']);
  assert.deepEqual(actionsFor('fixed'), ['released', 'reopen', 'delete']);
  assert.deepEqual(actionsFor('released'), ['reopen', 'delete']);
  assert.deepEqual(actionsFor('dismissed'), ['reopen', 'delete']);
  assert.deepEqual(actionsFor('ai_running'), []);
});

test('dismiss, undo and a false positive with its reason are logged with who and when; a false positive without a reason is refused', async () => {
  const e = env(), ref = add(e), t = new Date('2026-11-03T10:00:00Z');
  assert.equal((await act(e, {ref, action: 'dismiss'}, 'owner (session)', t)).state, 'dismissed');
  assert.equal((await act(e, {ref, action: 'reopen'}, 'owner (session)', t)).state, 'new');
  assert.equal((await act(e, {ref, action: 'false_positive', note: '  '}, 'owner (session)', t)).status, 400);
  assert.equal((await act(e, {ref, action: 'false_positive', note: 'duplicate of the Notion one'}, 'owner (key)', t)).state, 'false_positive');
  assert.deepEqual({...stateOf(e, ref)}, {state: 'false_positive', state_note: 'duplicate of the Notion one', impact: ''});
  const lines = await historyOf(e.STATS, ref);
  assert.deepEqual(lines.map(l => [l.who, l.action, l.detail]), [['owner (key)', 'false_positive', 'new -> false_positive: duplicate of the Notion one'], ['owner (session)', 'reopen', 'dismissed -> new'], ['owner (session)', 'dismiss', 'new -> dismissed']]);
  assert.equal(lines[0].at, '2026-11-03T10:00:00.000Z');
});

test('impact is high, medium, low or cleared; anything else is refused; it works in every state', async () => {
  const e = env(), ref = add(e, 'fixed');
  for (const impact of ['high', 'low', '']) assert.equal((await act(e, {ref, action: 'impact', impact}, 'owner (key)')).impact, impact);
  assert.equal((await act(e, {ref, action: 'impact', impact: 'urgent'}, 'owner (key)')).status, 400);
  assert.equal(stateOf(e, ref).impact, '');
});

test('delete removes the row and every file under its ref, leaves other feedback\'s files, and its log line holds no text', async () => {
  const e = env(), ref = add(e, 'dismissed', 'My email is ana@example.com and the token is SECRET123'), other = add(e);
  for (const key of ['screen.png', 'logs.txt', 'page.json', 'profile.json']) { e.FEEDBACK_FILES.kept.set(`feedback/${ref}/${key}`, 'x'); }
  e.FEEDBACK_FILES.kept.set(`feedback/${other}/logs.txt`, 'keep me');
  assert.equal((await act(e, {ref, action: 'delete'}, 'owner (session)')).ok, true);
  assert.deepEqual([...e.FEEDBACK_FILES.kept.keys()], [`feedback/${other}/logs.txt`]);
  assert.equal(stateOf(e, ref), undefined);
  const log = JSON.stringify(e.STATS.db.prepare('SELECT * FROM feedback_log').all());
  assert.match(log, new RegExp(ref)); assert.doesNotMatch(log, /ana@example|SECRET123/);
});

test('a bucket failure leaves the row in place and says so; nothing is half deleted', async () => {
  const e = env(), ref = add(e, 'dismissed');
  e.FEEDBACK_FILES.kept.set(`feedback/${ref}/logs.txt`, 'x');
  e.FEEDBACK_FILES.delete = async () => { throw new Error('r2 down'); };
  const result = await act(e, {ref, action: 'delete'}, 'owner (key)');
  assert.equal(result.status, 502);
  assert.equal(stateOf(e, ref).state, 'dismissed');
});

test('the dismissed and false-positive messages leave the product brain\'s signals', async () => {
  const e = env(), keep = add(e, 'new', 'keep'); add(e, 'dismissed', 'noise'); add(e, 'false_positive', 'noise too');
  assert.deepEqual((await recentFeedback(e.STATS, 30, new Date('2026-11-04T00:00:00Z'))).map(r => r.text), ['keep']);
  assert.ok(keep);
});

test('the route answers only the owner, only POST with JSON; a guest or a stranger gets a 404 and nothing changes', async () => {
  const e = env(), ref = add(e);
  const post = (headers, body = {ref, action: 'dismiss'}, method = 'POST') => actRoute(new Request('https://x/admin/growth/feedback/act', {method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined}), e);
  assert.equal((await post({'Content-Type': 'application/json'})).status, 404);
  assert.equal((await post({'Content-Type': 'application/json', Authorization: 'Bearer wrong'})).status, 404);
  assert.equal((await post({Authorization: 'Bearer owner-key'}, undefined, 'GET')).status, 404);
  assert.equal((await post({Authorization: 'Bearer owner-key', 'Content-Type': 'text/plain'})).status, 415);
  assert.equal(stateOf(e, ref).state, 'new');
  const ok = await post({Authorization: 'Bearer owner-key', 'Content-Type': 'application/json'});
  assert.equal(ok.status, 200); assert.equal((await ok.json()).state, 'dismissed');
  assert.equal((await post({Authorization: 'Bearer owner-key', 'Content-Type': 'application/json'})).status, 409);
  assert.equal(e.STATS.db.prepare('SELECT who FROM feedback_log').get().who, 'owner (key)');
});

test('the page data carries the actions only for the owner', async () => {
  const e = env(); add(e);
  const owner = await (await view(new Request('https://x/admin/feedback/inbox?json=1', {headers: {Authorization: 'Bearer owner-key'}}), e, new Date('2026-11-03T12:00:00Z'))).json();
  assert.equal(owner.canAct, true); assert.deepEqual(owner.rows[0].actions, ['fixed', 'defer', 'ai', 'dismiss', 'false_positive', 'delete']);
  assert.equal((await view(new Request('https://x/admin/feedback/inbox?history=0000000000000001'), e)).status, 404);
});

test('every POST route of the feedback page checks the owner first (a new one without isOwner fails here)', () => {
  const source = readFileSync(new URL('../../admin/feedback.js', import.meta.url), 'utf8');
  const handlers = source.split(/\nexport async function /).slice(1).filter(body => /method !== 'POST'|method === 'POST'/.test(body));
  assert.ok(handlers.length >= 1, 'the scan found no POST route: it is blind');
  for (const body of handlers) assert.match(body.slice(0, 400), /isOwner\(/, `${body.slice(0, 30)}: a POST route without the owner check`);
});

test('a change that lost a race writes no log line: Undo names the state it undoes, and a row that moved during a delete is kept', async () => {
  const e = env(), ref = add(e, 'fixed');
  assert.equal((await act(e, {ref, action: 'reopen', from: 'dismissed'}, 'owner (key)')).status, 409);
  assert.equal(stateOf(e, ref).state, 'fixed');
  const gone = add(e, 'dismissed');
  e.FEEDBACK_FILES.list = async () => { e.STATS.db.prepare("UPDATE feedback SET state = 'fixed' WHERE ref = ?").run(gone); return {objects: [], truncated: false}; };   // someone else moves it while its files are being deleted
  assert.equal((await act(e, {ref: gone, action: 'delete'}, 'owner (key)')).status, 409);
  assert.equal(stateOf(e, gone).state, 'fixed');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM feedback_log').get().n, 0, 'no change, no log line');
});

test('the Telegram alert counts only messages still open: a dismissed one whose send failed no longer raises it', async () => {
  const e = env(), ref = add(e);
  e.STATS.db.prepare("UPDATE feedback SET notified = 'failed: 400 chat not found'").run();
  assert.equal(await undelivered(e.STATS, 30, new Date('2026-11-04T00:00:00Z')), 1);
  await act(e, {ref, action: 'dismiss'}, 'owner (key)');
  assert.equal(await undelivered(e.STATS, 30, new Date('2026-11-04T00:00:00Z')), 0);
});
