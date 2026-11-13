// Demo data for the "Publish to website" card (admin/benchmark-publish.js) and the public /benchmark it feeds: one fair form round in which OUR tool never ran one form (a bot check), the rivals did,
// and one search round of six tools on three made-up searches. The totals on the five shared forms are made up to look like a real round; no run, answer or listing is real.
// 'benchmark-publish' fills Admin only (nothing public yet); 'benchmark-publish-live' also publishes both rounds the way the owner's confirmed press does, so /benchmark shows them.
import {buildSnapshot as formSnapshot} from '../admin/benchmark.js';
import {buildSnapshot as searchSnapshot} from '../admin/benchmark-search.js';
import {formsSection, searchSection} from '../admin/benchmark-publish.js';

const AT = '2026-11-12T19:00:00Z';
// [form, right, wrong, empty, unreached]
const FORMS = {
  extension: [['101', 10, 0, 0, 0], ['102', 12, 1, 0, 0], ['103', 9, 0, 1, 0], ['105', 11, 1, 0, 0], ['107', 9, 0, 1, 0]],   // no form 104: the run stopped at a bot check
  'browser-use': [['101', 9, 0, 1, 0], ['102', 8, 0, 2, 0], ['103', 7, 1, 1, 0], ['104', 6, 0, 2, 0], ['105', 8, 0, 1, 0], ['107', 6, 0, 2, 0]],
  stagehand: [['101', 7, 1, 2, 0], ['102', 6, 0, 4, 0], ['103', 6, 1, 2, 0], ['104', 5, 0, 3, 0], ['105', 7, 1, 1, 0], ['107', 6, 0, 2, 0]],
  nanobrowser: [['101', 4, 1, 6, 0], ['102', 3, 0, 7, 1], ['103', 3, 1, 6, 0], ['104', 2, 0, 6, 0], ['105', 4, 1, 5, 0], ['107', 3, 0, 3, 0]],
};
const PERSONAS = [['Truck Driver · Sofia', 'Bulgaria', 'non-tech'], ['HR Generalist · Cluj-Napoca', 'Romania', 'non-tech'], ['Data Analyst · Nuremberg', 'Germany', 'tech']];
// [tool, ours, found per search, relevant per search, beyond]
const SEARCH = [['Jobadabra', 1, [30, 22, 28], [9, 7, 11]], ['Jobadabra with every source', 0, [48, 40, 52], [15, 12, 19], '{"JobSpy": 6, "EURES": 9, "Adzuna": 11, "Jooble": 8}'], ['JobSpy', 0, [60, 55, 70], [10, 8, 14]],
  ['EURES', 0, [40, 35, 45], [9, 6, 12]], ['Adzuna', 0, [3, 0, 8], [1, 0, 3]], ['Jooble', 0, [25, 12, 30], [6, 3, 9]]];

async function fill(env, ai = '') {
  for (const [tool, rows] of Object.entries(FORMS)) for (const [form, right, wrong, empty, unreached] of rows) {
    await env.STATS.prepare('INSERT OR IGNORE INTO benchmark_runs (id, at, applicant, mode, tool, ours, build, form, heldout, fixes, required, right, wrong, empty, unans, holds, dups, round, rep, unreached) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?)')
      .bind(`pub/fixed/${form}/${tool}`, AT, 'thin', tool === 'extension' ? 'user' : 'any', tool, tool === 'extension' ? 1 : 0, tool === 'extension' ? 'a1b2c3d' : '', form, '', right + wrong + empty, right, wrong, empty, 'fixed', unreached).run();
  }
  const form = await formSnapshot(env.STATS);
  await env.STATS.prepare('INSERT OR REPLACE INTO benchmark_snapshot (id, at, body) VALUES (1, ?, ?)').bind(form.at, JSON.stringify(form)).run();
  for (const [tool, ours, found, relevant, beyond = '{}'] of SEARCH) for (const [i, [persona, country, kind]] of PERSONAS.entries()) {
    await env.STATS.prepare('INSERT OR IGNORE INTO benchmark_search_runs (id, at, round, persona, kind, country, tool, ours, build, ai, found, place, role, relevant, employers, seconds, cents, missed, beyond) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)')
      .bind(`pub/${tool}/${i}`, AT, '2026-11-12', persona, kind, country, tool, ours, ours ? 'a1b2c3d' : '', ours ? ai : '', found[i], Math.max(found[i] - 1, 0), Math.max(found[i] - 3, relevant[i]), relevant[i], relevant[i] + 2, '{}', beyond).run();
  }
  const search = await searchSnapshot(env.STATS);
  await env.STATS.prepare('INSERT OR REPLACE INTO benchmark_search_snapshot (id, at, body) VALUES (1, ?, ?)').bind(search.at, JSON.stringify(search)).run();
  return {form, search};
}

export const publishSeeds = {
  'benchmark-publish': async ({env}) => { await fill(env); },
  // 13 Nov 2026: the same live card with ours on the app's tiers (the round after the AI switch).
  'benchmark-publish-live-app': async ({env}) => { await publishSeeds['benchmark-publish-live']({env}, 'app'); },
  'benchmark-publish-live': async ({env}, ai = '') => {
    const {form, search} = await fill(env, ai), at = new Date('2026-11-12T20:30:00Z').toISOString();
    await env.STATS.prepare('INSERT INTO benchmark_published (kind, round, published_at, body) VALUES (?, ?, ?, ?)').bind('form', 'fixed', at, JSON.stringify(formsSection('fixed', form.fair.rounds.fixed, 'Ashby bot check'))).run();
    await env.STATS.prepare('INSERT INTO benchmark_published (kind, round, published_at, body) VALUES (?, ?, ?, ?)').bind('search', '2026-11-12', at, JSON.stringify(searchSection('2026-11-12', search.rounds['2026-11-12'], search.at))).run();
  },
};
