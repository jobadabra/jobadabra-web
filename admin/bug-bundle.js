// /admin/bug-bundle/<id> (any signed-in admin, as the other admin pages): the evidence of ONE bug an AI tester reported, opened from the link in its GitHub issue (shared/bug-bundles.js). It is not in the Admin menu and has no list, status or count.
// Why (7 Nov 2026, owner: "to avoid polluting Admin... to avoid making it a bug/issue tracker"): GitHub holds the bug; this page only hosts the private pictures, logs and state that must not sit in an issue. Pure drawing: data in, HTML out.
// Guard: test/unit/admin/bug-bundle.test.js.
import {viewer} from '../shared/auth.js';
import {adminPage} from './admin.js';
import {esc} from '../shared/html.js';
import {bundleFile, idOf, readReport} from '../shared/bug-bundles.js';
import {STYLE} from './ai-persona-page.js';
import {CHIP_STYLE, chip} from './chip.js';

const HEADERS = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
const SEVERITY = {high: ['🔴 high', 'bad'], medium: ['🟠 medium', 'warn'], low: ['🟡 low', 'muted']};
const SOURCE = {persona: 'AI persona (invented data)', 'desktop-tester': 'Claude Desktop (a copy of real data)'};
const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null);   // a stored word like "constructor" must not find Object.prototype's keys

/** The page for one bundle. `report`: the stored report.json; `has`: which files exist ({'app.jpg': true, …}); `id`: the bundle id (16 hex). */
export function bundleHtml(report, has, id) {
  const [sevText, tone] = own(SEVERITY, report.severity) || ['? severity', 'muted'];
  const steps = (Array.isArray(report.steps) ? report.steps : []).map(step => `<li>${esc(step)}</li>`).join('');
  const file = name => `/admin/bug-bundle/${esc(id)}/${name}`;
  const shot = (name, label) => (has[name] ? `<figure><img src="${file(name)}" alt="${esc(label)}" loading="lazy"><figcaption class="muted">${esc(label)}</figcaption></figure>` : `<p class="muted">Not in this bundle: ${esc(label.toLowerCase())}.</p>`);
  const link = (name, label) => (has[name] ? `<li><a href="${file(name)}">${esc(label)}</a></li>` : '');
  return `<section class="card"><h2>${esc(report.title || 'Bug report')}</h2>
<p>${chip(esc(sevText), tone)} ${chip(esc(own(SOURCE, report.source) || 'tester'), 'muted')} ${report.journey ? chip(esc(`journey ${report.journey}`), 'muted') : ''}</p>
<dl class="facts"><dt>Expected</dt><dd>${esc(report.expected)}</dd><dt>Seen</dt><dd>${esc(report.seen)}</dd><dt>When</dt><dd>${esc(report.at || '-')}</dd></dl>
${steps ? `<h3>Steps</h3><ol class="steps">${steps}</ol>` : ''}</section>
<section class="card"><h2>Pictures</h2><div class="shots">${shot('app.jpg', 'The app window')}${shot('tab.jpg', 'The job tab')}</div></section>
<section class="card"><h2>Logs, state and versions</h2><ul>${link('logs.txt', 'logs.txt (±5 minutes around the report)')}${link('state.json', 'state.json (the session record and the job row)')}${link('env.json', 'env.json (versions, mode chip)')}</ul></section>
<section class="card"><h2>Replay</h2><pre>npm run twin -- --replay ${esc(id)}</pre><p class="muted">Loads this bundle's state into the twin. Kept 90 days.</p></section>`;
}

const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Bug bundle</title>
<link rel="icon" href="/favicon-32.png"><style>${CHIP_STYLE}${STYLE}.facts{display:grid;grid-template-columns:110px 1fr;gap:4px 12px}.facts dt{color:#8d949c}.facts dd{margin:0}.shots{display:flex;flex-wrap:wrap;gap:12px}.shots img{max-width:520px;width:100%;border:1px solid #2a2f37;border-radius:6px}pre{background:#1a1e24;padding:10px;border-radius:6px;overflow:auto}</style></head><body><main>
<header><h1>🐞 Bug bundle</h1></header>
${body}
</main></body></html>`;

/** GET /admin/bug-bundle/<id> (the page) and /admin/bug-bundle/<id>/<file> (a kept file). Signed out, a bad id or a bundle that is not kept is a 404. */
export async function view(request, env) {
  if (!await viewer(request, env) || !env.LAB_FILLS) return new Response('Not found', {status: 404});
  const [id, name, ...rest] = new URL(request.url).pathname.replace(/^\/admin\/bug-bundle\//, '').split('/');
  if (rest.length || !idOf(id)) return new Response('Not found', {status: 404});
  if (name) return bundleFile(request, env, id, name);
  const report = await readReport(env.LAB_FILLS, id);
  if (!report || typeof report !== 'object' || Array.isArray(report)) return new Response(page('<section class="card"><p class="muted">This bundle is not kept (it is dropped after 90 days).</p></section>'), {status: 404, headers: HEADERS});
  const has = {};
  for (const fileName of ['app.jpg', 'tab.jpg', 'logs.txt', 'state.json', 'env.json']) has[fileName] = Boolean(await env.LAB_FILLS.head(`bundle/${id}/${fileName}`));
  return new Response(page(bundleHtml(report, has, id)), {headers: HEADERS});
}

/**
 * The route: `view` inside the Admin shell (stylesheet, top bar, as every Admin page; it is in no menu group, so none is open). A file answer (a picture, logs) passes untouched.
 * Why (7 Nov 2026, page-shot UNSTYLED): the route called `view` bare, so the page had no site CSS and no bar.
 */
export async function shell(request, env, pathname) {
  const response = await view(request, env);
  return /text\/html/.test(response.headers.get('Content-Type') || '') ? adminPage(response, pathname, await viewer(request, env) || undefined) : response;
}
