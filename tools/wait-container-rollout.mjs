// Waits until a Cloudflare container application runs the image that was just deployed, then exits 0; exits 1 on timeout or when Cloudflare ends the rollout without it.
// Usage: node tools/wait-container-rollout.mjs <path to the deployed wrangler config> [--timeout-min=10] [--deploy-output=<wrangler deploy's output>]   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID in the environment)
// Design (5 Nov 2026, hr 6/6; the 3rd fix on this path in a day, so one owner per state and no extra cases):
//   1. target   = the digest `wrangler deploy` pushed (owner: the deploy output); none pushed -> the latest rollout's version (owner: Cloudflare).
//   2. version  = the version whose image is that digest (owner: the versions list); not listed yet -> waiting.
//   3. rollout  = Cloudflare's rollout to that version (owner: the rollouts list): pending/progressing -> waiting at its step; reverted/replaced -> failed at once; completed -> 4.
//   4. verdict "rolled out" = that rollout completed AND every instance runs the target digest (owner: instances-v2).
// Why: #380 judged "newest listed version = the application's" and said DONE while the new version was not listed yet (01:27, try 5); try 3 had pressed into the old image after a green deploy.
import {readFileSync} from 'node:fs';
import {readConfig} from './runner-config.mjs';

/** The container application's name: the Worker name and the lower-cased class (what wrangler creates). */
export const appNameOf = config => `${config.name}-${config.containers[0].class_name.toLowerCase()}`;

// Why (5 Nov 2026, Gitar on #380): a reference without @sha256 (a tag) reduced to '' on both sides and passed as "equal"; compare the whole reference then.
const digestOf = image => { const ref = String(image || ''); return ref.split('@')[1] || ref; };
const short = digest => digest.replace(/^sha256:/, '').slice(0, 12);

/** The image digest `wrangler deploy` pushed ("<tag>: digest: sha256:… size: n"), the last one (cf-retry may deploy twice); '' when it pushed none. */
export const pushedDigest = output => (String(output).match(/digest: (sha256:[0-9a-f]+)/g) || []).map(line => line.split(' ')[1]).pop() || '';

/** Pure: {done, failed?, why} from the versions, rollouts (newest first) and instances as the API returns them; `expected` = the pushed digest ('' = none). */
export function rolledOut(versions, rollouts, instances, expected = '') {
  const version = expected ? versions.find(item => digestOf(item.configuration?.image) === expected) : versions.find(item => item.version === rollouts[0]?.target_version);
  if (!version) return {done: false, why: expected ? `version with the pushed image ${short(expected)} not listed yet` : 'no rollout listed yet'};
  const target = digestOf(version.configuration?.image), rollout = rollouts.find(item => item.target_version === version.version);
  if (!rollout) return {done: false, why: `no rollout to version ${version.version} yet`};
  if (rollout.status === 'reverted' || rollout.status === 'replaced') return {done: false, failed: true, why: `Cloudflare ${rollout.status} the rollout to version ${version.version}`};
  if (rollout.status !== 'completed') {
    const {current_step: step = '?', total_steps: steps = '?', version_distribution: split = {}} = rollout.progress || {};
    const {starting = 0, scheduling = 0, failed = 0} = rollout.health?.instances || {};
    return {done: false, why: `rollout to version ${version.version} ${rollout.status || 'pending'}, step ${step} of ${steps} (${split.target_version_percentage ?? 0}% on it; starting ${starting + scheduling}, failed ${failed})`};
  }
  const old = instances.filter(item => digestOf(item.image) !== target);
  if (old.length) return {done: false, why: `rollout to version ${version.version} completed, ${old.length} instance(s) still on another image`};
  return {done: true, why: `version ${version.version} (${short(target)}) rolled out`};
}

async function api(path) {
  const reply = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`, {headers: {Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`}});
  const body = await reply.json().catch(() => ({success: false, errors: `HTTP ${reply.status}, not JSON`}));
  if (!body.success) throw new Error(`${path}: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.result;
}

/** One look: {done, failed?, why}. An API error is "waiting" with its reason, never a throw (one 502 must not turn a good deploy red; Gitar on #380). `get(path)` -> the API's result. */
export async function checkOnce(name, get, expected = '') {
  try {
    const app = (await get('/containers/applications')).find(item => item.name === name);
    if (!app) return {done: false, why: `no application ${name} yet`};
    const base = `/containers/applications/${app.id}`;
    return rolledOut(await get(`${base}/versions`), await get(`${base}/rollouts`), await get(`${base}/instances-v2`), expected);
  } catch (error) {
    return {done: false, why: `API error: ${error.message}`};
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const file = process.argv[2], minutes = Number((process.argv.find(arg => arg.startsWith('--timeout-min=')) || '--timeout-min=10').split('=')[1]);
  if (!file) { console.error('usage: node tools/wait-container-rollout.mjs <wrangler config> [--timeout-min=10] [--deploy-output=<file>]'); process.exit(2); }
  const name = appNameOf(readConfig(readFileSync(file, 'utf8'))), until = Date.now() + minutes * 60 * 1000;
  const output = (process.argv.find(arg => arg.startsWith('--deploy-output=')) || '').split('=')[1];
  const expected = output ? pushedDigest(readFileSync(output, 'utf8')) : '';
  console.log(`rollout ${name}: target ${expected ? `the pushed image ${short(expected)}` : 'the latest rollout (no image pushed)'}`);
  let last = '';
  while (true) {
    const answer = await checkOnce(name, api, expected);
    if (answer.why !== last) console.log(`rollout ${name}: ${answer.done ? 'DONE' : answer.failed ? 'FAILED' : 'waiting'}: ${answer.why}`);
    last = answer.why;
    if (answer.done) break;
    if (answer.failed) process.exit(1);
    if (Date.now() > until) { console.error(`rollout ${name}: still not done after ${minutes} min: ${answer.why}`); process.exit(1); }
    await new Promise(done => setTimeout(done, 10000));
  }
}
