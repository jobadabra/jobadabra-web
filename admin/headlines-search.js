// Headline numbers of the Job search pages (admin/headlines.js), drawn on Job search → Overview (owner, 12 Nov 2026: "also, let's have an overview page" · "For both Job search and Lab";
// sketch https://claude.ai/artifact/FhduZ2SAEWiYfe7UAvcmLL, asked via AskUserQuestion: "Yes, both as sketched", "4: Night, Finish, Real, Draws"). Scouting's employer count moved here from
// Intelligence (owner, 18 Oct 2026). The Lab's four tiles are the Lab Overview's own numbers (admin/lab-overview.js), so the two pages never disagree. Guard: test/unit/admin/section-overview.test.js.
import {fromCards} from './headlines-growth.js';
import {labTabs} from './lab-overview.js';
import {labData} from './lab-overview-data.js';
import {changeText, changes} from './benchmark-ai.js';
import {snapshotOf} from './benchmark-search-snapshot.js';

const num = value => (Number(value) || 0).toLocaleString('en-US');
const day = (now, back) => new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10);
const LAB_TILES = ['night', 'finish', 'real', 'draws'];   // Why (12 Nov 2026, owner: "4: Night, Finish, Real, Draws"): every page gives at most 4 tiles; Session checks stays on the Lab's own Overview

async function labTiles(env, now) {
  const tabs = labTabs(await labData(env, now), now);
  return LAB_TILES.map(key => tabs.find(entry => entry.tab === key)).map(entry => ({label: entry.title, value: entry.value, sub: entry.sub, status: entry.status,
    ...(entry.series?.filter(value => value != null).length >= 2 ? {series: entry.series, higherIsBetter: entry.higherIsBetter !== false} : {}), href: `/admin/job-search/lab?tab=${entry.tab}`}));
}

async function installsTiles(env, now) {
  if (!env.STATS) return [{label: 'Employers found by installs', value: '–', sub: 'no database', status: 'none'}];
  const daily = ((await env.STATS.prepare('SELECT day, from_pool FROM index_daily ORDER BY day DESC LIMIT 30').all()).results || []).reverse();
  const sharing = (await env.STATS.prepare('SELECT COUNT(DISTINCT install) AS n FROM contributions WHERE day >= ?').bind(day(now, 30)).first())?.n || 0;
  if (!daily.length) return [{label: 'Employers found by installs', value: '–', sub: `no daily count yet · ${num(sharing)} installs shared in 30 days`, status: 'none'}];
  return [{label: 'Employers found by installs', value: num(daily.at(-1).from_pool), sub: `on the list · ${num(sharing)} installs shared in 30 days`, status: 'none', series: daily.map(row => row.from_pool)}];
}

/** The newest benchmark round: our right jobs against the best other tool's. Green when we find at least as many, else red (the page's own question: how do we compare). */
async function benchmarkTiles(env) {
  let rounds = {};
  try { rounds = (await snapshotOf(env.STATS))?.rounds || {}; } catch { rounds = {}; }
  const dates = Object.keys(rounds).sort(), last = dates.at(-1), tools = rounds[last]?.tools || [];
  const ours = tools.find(tool => tool.ours), others = tools.filter(tool => !tool.ours).sort((a, b) => (b.relevant || 0) - (a.relevant || 0));
  if (!ours) return [{label: 'Benchmark · right jobs', value: '–', sub: 'no round yet', status: 'none'}];
  const moves = changes(rounds), best = others[0], series = dates.map(date => (rounds[date].tools || []).find(tool => tool.ours)?.relevant ?? null);
  return [{label: 'Benchmark · right jobs, last round', value: num(ours.relevant), sub: `${last}${others.slice(0, 2).map(tool => ` · ${tool.tool} ${num(tool.relevant)}`).join('')}`,
    status: !best || (ours.relevant || 0) >= (best.relevant || 0) ? 'good' : 'bad', ...(series.filter(value => value != null).length >= 2 ? {series} : {}),
    breaks: moves.map(move => move.index), ...(moves.length ? {mark: changeText(moves.at(-1))} : {})}];
}

export const JOB_SEARCH = {'/admin/job-search/lab': labTiles, '/admin/job-search/scouting': fromCards('/admin/job-search/scouting'), '/admin/job-search/installs': installsTiles, '/admin/job-search/benchmark': benchmarkTiles};
