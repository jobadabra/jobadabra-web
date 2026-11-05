// Demo data for /admin/testing/report-only's product-quality board on tools/page-shot.mjs (5 Nov 2026, [ri]): 30 made-up days of real-user fills, searches and crash reports, probe rounds,
// quality nights and answer counts, over the nightly-trends seed. Everything is invented (install ids, times, counts); no real user data. A deliberate shape: form filling climbs, first-job time slips.

const DAY = 86400000;
const wave = (n, k) => Math.sin(n * 1.7 + k);

/** @param {{env: object}} context the seed context of tools/worker-server.mjs; `seeds` the seed table (for the seeds this one lays itself over) */
export async function qualityBoard({env}, seeds) {
  await seeds['nightly-trends']({env});
  await seeds['synthetic-card']({env});
  const now = new Date(), day = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10), db = env.STATS, statements = [];
  const read = async table => JSON.parse((await db.prepare(`SELECT body FROM ${table} WHERE id = 1`).first()).body);
  for (let back = 29; back >= 0; back--) for (let card = 0; card < 3; card++) {   // three real fills a day from five installs; the share climbs from ~80% to ~90%
    const filled = Math.round(10 * (0.8 + 0.1 * (1 - back / 29) + 0.03 * wave(back, card)));
    statements.push(db.prepare("INSERT INTO fill_cards (id, day, board, required, filled, source, install) VALUES (?, ?, 'ashby', 10, ?, 'user', ?)").bind(`demo-${back}-${card}`, day(back), Math.min(10, filled), `inst-${(back + card) % 5}`));
  }
  const event = (kind, back, install, fingerprint, data = {}) => db.prepare("INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data) VALUES (?, ?, ?, ?, '0.9.9', 'mac', ?, 'demo', ?)")
    .bind(day(back), `${day(back)}T08:00:00Z`, kind, install, fingerprint, JSON.stringify(data));
  for (let back = 29; back >= 0; back--) for (let s = 0; s < 3; s++) statements.push(event('search', back, `inst-${(back + s) % 5}`, 'search|demo', {first_s: Math.round(7 + 4 * (1 - back / 29) + 1.5 * wave(back, s))}));   // first job: ~7 s then ~11 s
  [[1, 'inst-1', 'crash|a'], [4, 'inst-2', 'crash|a'], [9, 'inst-3', 'crash|b'], [2, 'inst-4', 'run|c'], [11, 'inst-0', 'run|d'], [20, 'inst-1', 'crash|e']].forEach(([back, install, fingerprint]) => statements.push(event(fingerprint.startsWith('run') ? 'run_failed' : 'crash', back, install, fingerprint)));
  for (let back = 13; back >= 0; back--) for (const [family, kept, ms] of [['claude', 0.93, 'ms_10'], ['openai', 0.88, 'ms_20']])
    statements.push(db.prepare(`INSERT INTO form_answers (day, ai_family, calls, fields, returned, kept, ${ms}) VALUES (?, ?, 10, 100, 100, ?, 10)`).bind(day(back), family, Math.round(100 * kept)));
  await db.batch(statements);
  const snapshot = await read('e2e_snapshot');   // 30 live quality nights (agree ~96%), and the bugs the tests caught
  const quality = Array.from({length: 30}, (_, back) => ({runId: 9700 - back, day: day(back), pairs: 20, within8: 19 + (back % 7 === 3 ? 0 : 1) - (back === 12 ? 2 : 0), over20: 0, factsExact: 63, factsTotal: 63, judged: 18, invented: 0, promptCases: null}));
  const caught = [[0, 11], [1, 12], [1, 12], [3, 13], [6, 14], [9, 15], [16, 16], [22, 17]].map(([back, runId]) => ({day: day(back), kind: 'after-merge', runId: 9000 + runId, suite: 'apply', line: `demo break ${runId}`}));
  await db.prepare('UPDATE e2e_snapshot SET body = ? WHERE id = 1').bind(JSON.stringify({...snapshot, quality: [...quality, ...(snapshot.quality || []).filter(night => night.promptCases)], caught})).run();
}
