// What installs' browsers met on sites that refused the engine, by ladder step (owner, 21 Oct 2026: "do we save and display any information about the bot checks?"). Reads the browser_read
// site facts (api/pool.js readOf: outcome + step, one row per install and host). Counts only: no host name leaves this file. The card is admin/bot-checks.js. Guarded by test/unit/admin/bot-checks.test.js.
const STEPS = ['engine', 'download', 'tab'];

// [{outcome, step, sites, installs}] -> the numbers the card shows; a share without a step (before 21 Oct 2026) is counted as 'unknown'.
export function summarize(rows = []) {
  const out = {total: 0, opened: 0, bot: 0, refused: 0, login: 0, openedAt: {engine: 0, download: 0, tab: 0, unknown: 0}};
  for (const row of rows) {
    const sites = Number(row.sites) || 0;
    out.total += sites;
    if (row.outcome in out && row.outcome !== 'total') out[row.outcome] += sites;
    if (row.outcome === 'opened') out.openedAt[STEPS.includes(row.step) ? row.step : 'unknown'] += sites;
  }
  return out;
}

export async function gather(db) {
  const rows = ((await db.prepare(`SELECT json_extract(body, '$.outcome') AS outcome, json_extract(body, '$.step') AS step, COUNT(DISTINCT host) AS sites, COUNT(DISTINCT install) AS installs
    FROM sitefacts WHERE kind = 'browser_read' GROUP BY outcome, step`).all().catch(() => ({results: []}))).results) || [];
  return summarize(rows);
}
