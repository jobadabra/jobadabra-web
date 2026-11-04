// /admin/testing/ai-persona (any signed-in admin, as the other admin pages: viewer()): the AI persona's runs (the nightly one and the replays), each with its path, its notes and its video (owner, 4 Nov 2026: "a dedicated tab in admin where I'll see all the runs/paths/bugs found…
// and video recording for each"). Reads what CI uploaded into the private bucket (shared/agent-runs.js); no AI, no write. ?run=<id> is one run. The pictures are drawn by admin/ai-persona-page.js.
import {viewer, remember} from '../shared/auth.js';
import {listRuns, readRun, runOf} from '../shared/agent-runs.js';
import {documentHtml, listHtml, runHtml} from './ai-persona-page.js';

const HEADERS = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.LAB_FILLS) return new Response(documentHtml('<section class="card"><p class="muted">The run store is not configured on this Worker.</p></section>'), {headers: HEADERS});
  const id = runOf(url.searchParams.get('run'));
  if (!id) return new Response(documentHtml(listHtml(await listRuns(env.LAB_FILLS))), {headers: HEADERS});
  const record = await readRun(env.LAB_FILLS, id);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return new Response(documentHtml(`<p><a href="?">← All runs</a></p><section class="card"><p class="muted">Run ${id} is not kept (older than the keep time, or never uploaded).</p></section>`), {status: 404, headers: HEADERS});
  const has = {video: Boolean(await env.LAB_FILLS.head(`agent/${id}/video.webm`))};
  return new Response(documentHtml(runHtml(record, has)), {headers: HEADERS});
}
