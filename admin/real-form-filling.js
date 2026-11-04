// /admin/form-filling/real-users (Form filling): how well REAL users' forms get filled, and what still trips the filler: headline, top weaknesses, what the fill missed, how applications ended,
// efficiency day by day, the "*" cross-check. The lab's recorded sites are on /admin/form-filling/lab; the learning loop on /admin/form-filling/learning. The digest download lives here. Guard: test/unit/website/form-pages.test.js.
import {viewer} from '../shared/auth.js';
import {digest, markdown} from '../shared/digest.js';
import {efficiencySection, marksSection, realTiles, realUseSection, resultsSection, weaknessesSection} from './form-sections.js';
import {pageView, shell} from './form-shell.js';
import {reportCounts, reportsSection} from './report-counts.js';
import {leftEmptyHeadlineCard, leftEmptySection} from './left-empty.js';

export const page = (data, url = new URL('https://www.jobadabra.top/admin/form-filling/real-users')) => shell({title: 'Real Form Filling', icon: '📝', data, url,
  inner: d => [leftEmptyHeadlineCard(d.leftEmpty), realTiles(d), reportsSection(d.reports), weaknessesSection(d.learning), leftEmptySection(d.leftEmpty, {headline: false}), realUseSection(d), resultsSection(d.results), efficiencySection(d.learning), marksSection(d.marks)].join('\n')});

export const view = pageView(page, async db => ({reports: await reportCounts(db)}));

// GET /admin/form-filling/real-users/digest.json | .md: the learning digest (any admin, or the scripts' key for the weekly AI pass).
export async function digestView(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const d = await digest(env.STATS, now);
  if (new URL(request.url).pathname.endsWith('.md')) return new Response(markdown(d), {headers: {'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
  return Response.json(d, {headers: {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
