// The staging copy of the site's config (tools/staging-config.mjs): Always on is on there with its own Hosted data, and nothing of production's data, routes or cron survives (hr 3/6, 5 Nov 2026).
// Why: a fictional test install on staging wrote into production's D1, KV, bucket and queue, because the copy kept every data binding.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {STAGING_DATA, stagingToml} from '../../tools/staging-config.mjs';

const toml = readFileSync(new URL('../../workers/www/wrangler.toml', import.meta.url), 'utf8');
const staging = stagingToml(toml);

test('staging has its own name, no routes and no cron', () => {
  assert.match(staging, /^name = "www-staging"/m);
  assert.ok(!/custom_domain/.test(staging) && /^crons = \[\]/m.test(staging));
});

test('the Hosted data is staging\'s own: D1, KV, bucket and queue', () => {
  assert.match(staging, new RegExp(`database_name = "${STAGING_DATA.d1.name}"\\ndatabase_id = "${STAGING_DATA.d1.id}"`));
  assert.ok(staging.includes(`id = "${STAGING_DATA.kv.id}"`));
  assert.ok(staging.includes(`bucket_name = "${STAGING_DATA.hostedBucket}"`) && staging.includes(`queue = "${STAGING_DATA.hostedQueue}"`));
  for (const production of ['61f8d0f7-82c2-4afe-a6e5-508aaaf2cfa0', 'a871d4644b614266b5bfa7f1b5e811c1', 'bucket_name = "hosted-state"', 'queue = "find-jobs-runs"']) assert.ok(!staging.includes(production), `production's ${production} is gone`);
});

test('Always on is on in staging and production, and only staging\'s runs call staging back', () => {
  assert.match(staging, /^HOSTED_ALWAYS_ON = "on"/m);
  assert.match(staging, /^HOSTED_SITE = "https:\/\/www-staging\.jobpilotto\.workers\.dev"/m);
  // Why (5 Nov 2026, owner: "let's make it production ready", "go ahead with everything"): the owner's flip; "off" again is the rollback (every hosted route answers 404).
  assert.match(toml, /^HOSTED_ALWAYS_ON = "on"/m, 'production is on since the owner\'s flip (5 Nov 2026)');
  assert.ok(!/^HOSTED_SITE/m.test(toml));
});

test('a config that lost a data binding the copy rewrites fails loudly', () => {
  assert.throws(() => stagingToml(toml.replace('queue = "find-jobs-runs"', 'queue = "renamed"')), /the queue was not switched/);
});
