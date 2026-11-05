// One shared ranking per role kind × country of every source installs read: employer feeds (contributions) and job boards (sitefacts kind
// 'board'; a board the web search found is a board too), by the jobs LOCATED in the installs' places each gave and how long its read took
// (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md item B; owner, 26 Oct 2026: "Parallel + learned", each field + place
// remembers what worked for every user). Served in the employer index (api/employers.js slice), the one delivery path; an install's run
// starts from it (src/source_rank.py ranked_sources). Owner's rules (26 Oct 2026): a source is proven after 1 install (the next install's own
// read checks it), dead after 3 installs read it fine and found no local job (nothing here depends on who asked); best = local jobs per
// minute, fit 70+ as the tie-break. The kind is a value from the fixed list (shared/pool-labels.js ROLES), never a branch here, so a new kind
// works unchanged; 'other' (any field) never makes a source dead. Counts and fixed ids only. Tests: test/unit/api/source-ranking.test.js.
import {COUNTRIES} from '../shared/pool-tags.js';

export const PROVEN_K = 1, DEAD_K = 3, MAX_PROVEN = 200, MAX_DEAD = 3000;
const list = text => String(text || '').split(',').filter(Boolean);

// {"<kind>|<country>": {proven: [{kind, source, installs, local, fit70, seconds, per_run, per_min}], dead: ['employer:<ats>:<slug>' | 'board:<host>']}}
export async function sourceRanking(env) {
  if (!env.STATS) return {};
  let feeds, boards;
  try {
    feeds = (await env.STATS.prepare(`SELECT ats, slug, roles, countries, local, fit70, seconds FROM contributions
      WHERE local IS NOT NULL AND COALESCE(failed, 0) = 0`).all()).results || [];
    boards = (await env.STATS.prepare(`SELECT host, body, roles, countries, in_places AS local, fit70, seconds FROM sitefacts
      WHERE kind = 'board' AND in_places IS NOT NULL AND roles IS NOT NULL`).all()).results || [];
  } catch { return {}; }   // before migration 0109
  const cells = {};
  const add = (kind, source, row, countries) => {
    for (const role of list(row.roles)) {
      for (const country of countries) {
        const cell = (cells[`${role}|${country}`] ||= {});
        const item = (cell[`${kind}:${source}`] ||= {kind, source, installs: 0, local: 0, fit70: 0, seconds: 0, timed: 0, timedLocal: 0});
        item.installs += 1;
        item.local += row.local || 0;
        item.fit70 += row.fit70 || 0;
        if (Number.isFinite(row.seconds) && row.seconds > 0) { item.seconds += row.seconds; item.timed += 1; item.timedLocal += row.local || 0; }
      }
    }
  };
  for (const row of feeds) add('employer', `${row.ats}:${row.slug}`, row, list(row.countries).filter(c => COUNTRIES.includes(c)));
  for (const row of boards) {
    let serves;
    try { serves = JSON.parse(row.body || '{}').countries || []; } catch { serves = []; }
    add('board', row.host, row, list(row.countries).filter(c => serves.includes(c)));   // an install's countries count only where the board serves
  }
  const out = {};
  for (const [key, items] of Object.entries(cells)) {
    const role = key.slice(0, key.indexOf('|'));
    const proven = [], dead = [];
    for (const item of Object.values(items)) {
      if (item.local > 0 && item.installs >= PROVEN_K) {
        // Per minute only from the reads that were timed: their local jobs over their time, so an older untimed read does not dilute it.
        const per_min = item.timed ? Math.round(item.timedLocal / Math.max(item.seconds / 60, 1 / 60) * 10) / 10 : null;
        proven.push({kind: item.kind, source: item.source, installs: item.installs, local: item.local, fit70: item.fit70,
          seconds: item.timed ? Math.round(item.seconds / item.timed * 10) / 10 : null, per_run: Math.round(item.local / item.installs * 10) / 10, per_min});
      } else if (item.local === 0 && item.installs >= DEAD_K && role !== 'other') dead.push(`${item.kind}:${item.source}`);
    }
    proven.sort((a, b) => (b.per_min ?? -1) - (a.per_min ?? -1) || b.fit70 - a.fit70 || b.per_run - a.per_run || a.source.localeCompare(b.source));
    if (proven.length || dead.length) out[key] = {proven: proven.slice(0, MAX_PROVEN), dead: dead.sort().slice(0, MAX_DEAD)};
  }
  return out;
}
