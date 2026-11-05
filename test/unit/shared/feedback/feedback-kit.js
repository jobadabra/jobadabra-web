// Shared fakes for the Send to AI tests: an in-memory D1 with the feedback migrations, an R2 bucket, and a signer for GitHub-style run tokens. Not a test file (the runner picks up *.test.js only).
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_REPO, githubUrl} from '../../../../shared/repos.js';

const MIGRATIONS = ['0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql', '0128_feedback_replies.sql', '0129_feedback_ai.sql', '0134_feedback_receipt.sql'];
export const REPO = PUBLIC_REPO;   // the owner's name is never typed in a test (shared/repos.js)
export const prUrl = number => `${githubUrl(REPO)}/pull/${number}`;
export const NOW = new Date('2026-11-03T12:00:00.000Z');

export function d1() {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) db.exec(readFileSync(new URL(`../../../../db/migrations/${name}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql), batch: async list => { const out = []; for (const item of list) out.push({meta: {changes: (await item.run()).changes}}); return out; }};
}
export const bucket = () => {
  const kept = new Map();
  return {kept, put: async (key, value) => { kept.set(key, value); }, get: async key => (kept.has(key) ? {body: kept.get(key)} : null),
    delete: async keys => { for (const key of [].concat(keys)) kept.delete(key); },
    list: async ({prefix}) => ({objects: [...kept.keys()].filter(key => key.startsWith(prefix)).map(key => ({key})), truncated: false})};
};
export const env = (extra = {}) => ({STATS: d1(), FEEDBACK_FILES: bucket(), STATS_KEY: 'owner-key', STATS_API_KEY: 'owner-key', TIMERS_REPO: REPO, TIMERS_GITHUB_TOKEN: 'timers-token', ...extra});

let counter = 0x100;
/** One feedback row; `fields` overrides columns (state, state_at, ai_run, pr_url, ai_include, ...). Returns its ref. */
export function add(e, fields = {}) {
  const ref = (++counter).toString(16).padStart(16, '0');
  const row = {at: '2026-11-03T09:00:00.000Z', day: '2026-11-03', install: 'install-aaaa-bbbb', version: '0.9.1', platform: 'darwin', text: 'Setup stops at step 2 (invented)', contact: 'ana@example.com', ref, state: 'new', state_at: NOW.toISOString(), ...fields};
  const keys = Object.keys(row);
  e.STATS.db.prepare(`INSERT INTO feedback (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(key => row[key]));
  return ref;
}
export const row = (e, ref) => e.STATS.db.prepare('SELECT * FROM feedback WHERE ref = ?').get(ref);
export const log = (e, ref) => e.STATS.db.prepare('SELECT who, action, detail FROM feedback_log WHERE ref = ? ORDER BY rowid').all(ref).map(line => ({...line}));

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A GitHub run-token signer: sign(claims overrides, header?) -> JWT; jwks reader for the verifier; `other` signs with a key GitHub never published. */
export async function signer() {
  const make = async () => {
    const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
    const jwk = {...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1'};
    return {jwk, sign: async (claims, header = {alg: 'RS256', kid: 'k1'}) => {
      const body = `${enc(header)}.${enc(claims)}`;
      return `${body}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body))).toString('base64url')}`;
    }};
  };
  const real = await make(), other = await make();
  const claims = (extra = {}) => ({iss: 'https://token.actions.githubusercontent.com', aud: 'jobadabra-feedback', repository: REPO, event_name: 'workflow_dispatch', run_id: '9001',
    workflow_ref: `${REPO}/.github/workflows/feedback-ai.yml@refs/heads/main`, exp: Math.floor(NOW.getTime() / 1000) + 600, ...extra});
  return {jwks: async () => ({keys: [real.jwk]}), token: async extra => real.sign(claims(extra)), forged: async extra => other.sign(claims(extra)), claims};
}
