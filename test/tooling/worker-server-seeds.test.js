// tools/worker-server.mjs runOnce: the seeds whose second run breaks run once per database; every other seed stays re-runnable.
// Why (12 Nov 2026, coordinator): web main was red 14 h after #566's job-search-overview ran random-draws a second time under "all". Run: tools/site-run.sh node --test test/tooling/worker-server-seeds.test.js
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ONCE, runOnce, workerServer} from '../../tools/worker-server.mjs';

const table = () => {
  const ran = [];
  const seeds = {'random-draws': async ({env}) => { ran.push(['random-draws', env.id]); }, schedules: async ({env}) => { ran.push(['schedules', env.id]); },
    'job-search-overview': async context => { await seeds['random-draws'](context); await seeds.schedules(context); }};
  return {seeds, ran};
};

test('a once-seed runs once per database, a re-runnable seed every time, and a second database gets its own run', async () => {
  const {seeds, ran} = table(), one = {id: 1}, two = {id: 2};
  runOnce(seeds);
  for (const name of ['random-draws', 'schedules', 'job-search-overview']) await seeds[name]({env: one});
  await seeds['job-search-overview']({env: two});
  assert.deepEqual(ran, [['random-draws', 1], ['schedules', 1], ['schedules', 1], ['random-draws', 2], ['schedules', 2]]);
});

test('wrapping twice keeps one wrapper, and a seed that threw runs again on the next ask', async () => {
  let tries = 0;
  const seeds = {'random-draws': async () => { tries++; if (tries === 1) throw new Error('half-way'); }};
  const once = runOnce(seeds)['random-draws'];
  assert.equal(runOnce(seeds)['random-draws'], once);
  const env = {};
  await assert.rejects(seeds['random-draws']({env}), /half-way/);
  await seeds['random-draws']({env});
  await seeds['random-draws']({env});
  assert.equal(tries, 2);
});

test('every seed on one database: "all" loads without a broken unique key (the 12 Nov red)', async () => {
  assert.ok(ONCE.includes('random-draws'));
  const site = await workerServer(process.cwd(), 'all');
  try {
    const draws = (await site.env.STATS.prepare('SELECT COUNT(*) AS n FROM search_lab_draws').all()).results[0].n;
    assert.ok(draws > 0, 'random-draws seeded its rows once');
  } finally { site.close(); }
});
