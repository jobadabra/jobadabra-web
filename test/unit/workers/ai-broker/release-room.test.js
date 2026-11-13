// A broker deploy waits for the room and holds it until the Durable Object runs the new code, so no search loses its calls in flight to the reset.
// Why (13 Nov 2026, cx; sa: "go on (a)"): "Durable Object reset because its code was updated" ×19 at 04:17:50-04:18:00Z, ~5 min after a merge's deploy (04:12:56Z), cut every call of
// tr's 30-profile round in flight: 20 calls waited 40-46 s (the relay asks a cut call again after 30 s). Resets today: 04:00 ×30, 04:17 ×19, 04:26 ×49, each 4.5-5 min after a deploy.
// Guard: a search's calls — every call in flight at a reset is cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAPACITY} from '../../../../workers/ai-broker/lib/claims.mjs';

const workflow = readFileSync(new URL('../../../../.github/workflows/release-ai-broker.yml', import.meta.url), 'utf8');
/** The `run:` text of the step named `name` (its block up to the next step), or '' when there is none. */
const step = name => { const at = workflow.indexOf(`- name: ${name}`); if (at < 0) return ''; const next = workflow.indexOf('\n      - ', at + 1); return workflow.slice(at, next < 0 ? undefined : next); };
const order = names => names.map(name => workflow.indexOf(`- name: ${name}`));

test('the release takes the whole room before it deploys, waits at most 45 min for it, and deploys anyway after that, saying so', () => {
  assert.match(workflow, /id-token: write/, 'the claim needs the job\'s GitHub run token');
  const take = step('Take the whole broker room');
  assert.ok(take, 'the step exists');
  assert.match(take, new RegExp(`claim\\.py wait ${CAPACITY}\\b`), `it asks for all ${CAPACITY} searches, so no search runs during the deploy and none starts`);
  assert.match(take, /timeout 45m /, 'at most 45 min in line');
  assert.match(take, new RegExp(`claim\\.py hold ${CAPACITY}\\b`), 'once granted it keeps renewing the room in the background');
  assert.match(take, /::warning::/, 'a deploy without the room says so in the run');
  const [taken, deployed] = order(['Take the whole broker room', 'Deploy the broker and its image']);
  assert.ok(taken > 0 && taken < deployed, 'the room is taken before the deploy');
});

test('the room is held until the new code has reached the Durable Object, then always given back', () => {
  const keep = step('Keep the room until the broker runs the new code');
  const seconds = Number(/sleep (\d+)/.exec(keep)?.[1]);
  assert.ok(seconds >= 7 * 60, `held ${seconds} s after the deploy: resets came 4.5-5 min after a deploy`);
  const back = step('Give the room back');
  assert.match(back, /if: always\(\)/, 'given back even when the deploy fails');
  assert.match(back, /claim\.py release/);
  const [deployed, kept, given] = order(['Deploy the broker and its image', 'Keep the room until the broker runs the new code', 'Give the room back']);
  assert.ok(deployed < kept && kept < given, 'deploy, keep, give back');
  assert.ok(Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1]) >= 45 + 7 + 15, 'the job outlives the wait, the hold and the deploy');
});
