// /admin/testing/bug-bundles (any signed-in admin): the bugs the AI testers reported, newest first: title, severity, source, journey, when, and a link to the bug's GitHub issue and to its evidence page.
// Why (7 Nov 2026, owner: "let's add a dedicated page", Admin → Testing → Bug bundles; GitHub stays the tracker, "to avoid making it a bug/issue tracker"): this page only lists the evidence the store holds (shared/bug-bundles.js
// listBundles). It has NO status, owner, close button or count of open bugs: the state of a bug is its GitHub issue, which each row links to (a search for the bundle id, which the issue's "Evidence bundle" line carries).
// Guard: test/unit/admin/bug-bundles.test.js.
import {viewer} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {PUBLIC_REPO} from '../shared/repos.js';
import {KEEP_DAYS, listBundles} from '../shared/bug-bundles.js';
import {CHIP_STYLE, chip} from './chip.js';
import {STYLE} from './ai-persona-page.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';

const LIST_MAX = 100;   // listBundles' default: the headline says "newest" at the cap instead of a count that is too low
const HEADERS = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
const SEVERITY = {high: ['🔴 high', 'bad'], medium: ['🟠 medium', 'warn'], low: ['🟡 low', 'muted']};
const SOURCE = {persona: 'AI persona', 'desktop-tester': 'Claude Desktop'};
const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null);   // a stored word like "constructor" must not find Object.prototype's keys
const when = (report, uploaded) => String(report.at || (uploaded ? new Date(uploaded).toISOString() : '')).slice(0, 16).replace('T', ' ');

/** The list page body. `entries`: [{id, uploaded, report}] from listBundles, newest first. */
export function listHtml(entries) {
  const band = verdictBand({icon: '🐞', headline: !entries.length ? 'No bug bundle is kept yet' : entries.length >= LIST_MAX ? `The newest ${LIST_MAX} bug bundles` : `${entries.length} bug bundle${entries.length === 1 ? '' : 's'} kept`,
    note: `What the AI testers reported through Send feedback, with its pictures and logs, kept ${KEEP_DAYS} days. The bug itself, its status and its fix live on GitHub.`});
  const rows = entries.map(({id, uploaded, report}) => {
    const [sevText, tone] = own(SEVERITY, report.severity) || ['? severity', 'muted'];
    return `<tr><td><a href="/admin/bug-bundle/${esc(id)}"><b>${esc(report.title || 'Bug report')}</b></a><div class="muted small">${esc(report.seen)}</div></td>
<td>${chip(esc(sevText), tone)}</td><td class="small">${esc(own(SOURCE, report.source) || 'tester')}</td><td class="small">${esc(report.journey || 'none')}</td><td class="small">${esc(when(report, uploaded))}</td>
<td class="small"><a href="https://github.com/${PUBLIC_REPO}/issues?q=${esc(id)}">GitHub issue</a> · <a href="/admin/bug-bundle/${esc(id)}">evidence</a></td></tr>`;
  }).join('');
  return `${band}<section class="card"><table class="runs"><thead><tr><th>Bug</th><th>Severity</th><th>Source</th><th>Journey</th><th>When</th><th>Links</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Nothing yet: a bug an AI tester files through Send feedback shows here.</td></tr>'}</tbody></table></section>`;
}

const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Bug bundles</title>
<link rel="icon" href="/favicon-32.png"><style>${CHIP_STYLE}${BAND_STYLE}${STYLE}</style></head><body><main>
<header><h1>🐞 Bug bundles</h1></header>
${body}
</main></body></html>`;

/** GET /admin/testing/bug-bundles. Signed out, or no store on this Worker: a 404 / a note. */
export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  if (!env.LAB_FILLS) return new Response(page('<section class="card"><p class="muted">The bundle store is not configured on this Worker.</p></section>'), {headers: HEADERS});
  return new Response(page(listHtml(await listBundles(env.LAB_FILLS, LIST_MAX))), {headers: HEADERS});
}
