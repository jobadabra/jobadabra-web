// What the Benchmark Job Search page counts (owner, 20 Oct 2026): one summary row per tool on a persona (a role in a European city), from the bake-off's search-bench rounds -> the scores per tool,
// the grid per persona, the split by kind (tech / non-tech) and the job systems whose jobs we miss. Pure functions: tool, persona and job-system names arrive as data, none is written here.
// found = jobs the tool showed; place = those the blind judge put in the persona's city, nearby or remote for their country; role = judged the persona's kind of job; relevant = both.
// Guard: test/unit/admin/benchmark/benchmark-search.test.js.
export const KINDS = ['tech', 'non-tech'];
export const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

// The latest row per persona out of a tool's rows: a re-run replaces the older one, so a total never counts a persona twice.
const latestPerPersona = rows => [...new Map([...rows].sort((a, b) => a.at.localeCompare(b.at)).map(row => [row.persona, row])).values()];

export function totals(rows) {
  const t = {personas: rows.length, found: sum(rows, 'found'), place: sum(rows, 'place'), role: sum(rows, 'role'), relevant: sum(rows, 'relevant'), employers: sum(rows, 'employers'), seconds: sum(rows, 'seconds'), cents: sum(rows, 'cents')};
  const empty = rows.filter(row => row.relevant === 0).length;
  // Why (27 Oct 2026): a rival's run time is often not recorded (sent as 0); averaging those 0s showed "0 s". Only timed searches count; none -> null ("–").
  const timed = rows.filter(row => Number(row.seconds) > 0);
  return {...t, placeShare: share(t.place, t.found), roleShare: share(t.role, t.found), relevantShare: share(t.relevant, t.found), empty, avgSeconds: timed.length ? Math.round(sum(timed, 'seconds') / timed.length) : null};
}

const parse = text => { try { const value = typeof text === 'object' ? text : JSON.parse(text || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };

// rows -> {rounds: {'2026-10-20': {tools, personas, grid, kinds, missed}}}: tools = ours first, then the others by relevant jobs.
export function summarize(rows) {
  const rounds = {};
  for (const round of [...new Set(rows.map(row => row.round))].sort()) {
    const mine = rows.filter(row => row.round === round);
    const tools = [...new Set(mine.map(row => row.tool))].map(tool => {
      const list = latestPerPersona(mine.filter(row => row.tool === tool));
      return {tool, ours: list.some(row => row.ours), withAll: list.some(row => Object.keys(parse(row.beyond)).length > 0), build: list.find(row => row.ours)?.build || '', ...totals(list), rows: list};
    }).sort((a, b) => b.ours - a.ours || b.relevant - a.relevant || a.tool.localeCompare(b.tool));
    const personas = [...new Map(mine.map(row => [row.persona, {persona: row.persona, kind: row.kind, country: row.country}])).values()].sort((a, b) => a.persona.localeCompare(b.persona, 'en', {numeric: true}));
    const grid = Object.fromEntries(tools.map(tool => [tool.tool, Object.fromEntries(tool.rows.map(row => [row.persona, {found: row.found, place: row.place, role: row.role, relevant: row.relevant}]))]));
    const kinds = Object.fromEntries(KINDS.map(kind => [kind, Object.fromEntries(tools.map(tool => [tool.tool, totals(tool.rows.filter(row => row.kind === kind))]))]));
    // The job systems of the jobs another tool shows as relevant and ours does not (each other tool's own `missed` map, summed over its personas).
    const missed = {};
    for (const tool of tools.filter(item => !item.ours && !item.withAll)) for (const row of tool.rows) for (const [system, count] of Object.entries(parse(row.missed))) missed[system] = (missed[system] || 0) + (Number(count) || 0);
    // What "ours with every source" adds on top of each rival (owner, 27 Oct 2026): its own `beyond` map, summed over its personas.
    // Why (27 Oct 2026, owner via 6e): a rival whose job failed for a persona is not sent for it; that persona is counted as "not counted", never as a smaller total
    // that looks complete. `searches` = the personas of the line; a rival's `missing` = those it has no number for.
    const beyond = {}, seen = {}, withAllRows = tools.filter(item => item.withAll).flatMap(item => item.rows);
    for (const row of withAllRows) for (const [rival, count] of Object.entries(parse(row.beyond))) { beyond[rival] = (beyond[rival] || 0) + (Number(count) || 0); if (count !== null) seen[rival] = (seen[rival] || 0) + 1; }   // null = the rival's job failed for that search
    rounds[round] = {tools: tools.map(({rows: _rows, ...tool}) => tool), personas, grid, kinds, missed: Object.entries(missed).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30),
      beyond: Object.entries(beyond).map(([rival, jobs]) => [rival, jobs, withAllRows.length - (seen[rival] || 0)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), beyondSearches: withAllRows.length};
  }
  return {schema: 1, rounds};
}
