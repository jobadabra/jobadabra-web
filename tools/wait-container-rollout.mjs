// Waits until a Cloudflare container application runs the image that was just deployed, then exits 0; exits 1 on timeout.
// Usage: node tools/wait-container-rollout.mjs <path to the deployed wrangler config> [--timeout-min=10]   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID in the environment)
// Why (5 Nov 2026, hr 6/6): `wrangler deploy` printed "Modified application" and the job went green, but the application moved to the new version 54 s later and the instance kept the old
// image until then. The staging proof's third press ran in that gap and tested the old code. Done = the application is on the newest version, its image is that version's, and no instance
// runs another image or is still starting.
import {readFileSync} from 'node:fs';
import {readConfig} from './runner-config.mjs';

/** The container application's name: the Worker name and the lower-cased class (what wrangler creates). */
export const appNameOf = config => `${config.name}-${config.containers[0].class_name.toLowerCase()}`;

const digestOf = image => String(image || '').split('@')[1] || '';

/** Pure: {done, why} from the application, its versions and its instances as the API returns them. */
export function rolledOut(app, versions, instances) {
  const newest = [...versions].sort((a, b) => b.version - a.version)[0];
  if (!newest) return {done: false, why: 'no version listed yet'};
  if (app.version !== newest.version) return {done: false, why: `the application is on version ${app.version} of ${newest.version}`};
  if (digestOf(app.configuration?.image) !== digestOf(newest.configuration?.image)) return {done: false, why: 'the application\'s image is not the newest version\'s'};
  const old = instances.filter(item => digestOf(item.image) !== digestOf(app.configuration?.image));
  if (old.length) return {done: false, why: `${old.length} instance(s) still on the old image`};
  const {scheduling = 0, starting = 0} = app.health?.instances || {};
  if (scheduling + starting) return {done: false, why: `${scheduling + starting} instance(s) still starting`};
  return {done: true, why: `version ${app.version} is running`};
}

async function api(path) {
  const reply = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`, {headers: {Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`}});
  const body = await reply.json();
  if (!body.success) throw new Error(`${path}: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.result;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const file = process.argv[2], minutes = Number((process.argv.find(arg => arg.startsWith('--timeout-min=')) || '--timeout-min=10').split('=')[1]);
  if (!file) { console.error('usage: node tools/wait-container-rollout.mjs <wrangler config> [--timeout-min=10]'); process.exit(2); }
  const name = appNameOf(readConfig(readFileSync(file, 'utf8'))), until = Date.now() + minutes * 60 * 1000;
  let last = '';
  while (true) {
    const apps = await api('/containers/applications'), app = apps.find(item => item.name === name);
    const answer = app ? rolledOut(app, await api(`/containers/applications/${app.id}/versions`), await api(`/containers/applications/${app.id}/instances-v2`)) : {done: false, why: `no application ${name} yet`};
    if (answer.why !== last) console.log(`rollout ${name}: ${answer.done ? 'DONE' : 'waiting'}: ${answer.why}`);
    last = answer.why;
    if (answer.done) break;
    if (Date.now() > until) { console.error(`rollout ${name}: still not done after ${minutes} min: ${answer.why}`); process.exit(1); }
    await new Promise(done => setTimeout(done, 10000));
  }
}
