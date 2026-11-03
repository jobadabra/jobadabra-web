// The routes of the AI section of /admin (owner, 3 Nov 2026): /admin/ai/agents, /admin/ai/steps, /admin/ai/engines. Each checks the owner like its siblings, reads the stored "agents" card and the broker's /health, and draws the page.
import {viewer, remember} from '../shared/auth.js';
import {readBroker} from './jobcost.js';
import {latestCard} from './ai-section.js';
import {agentsPage} from './ai-agents.js';
import {stepsPage} from './ai-steps.js';
import {enginesPage} from './ai-engines.js';

const HEADERS = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
const route = draw => async (request, env, now = new Date()) => {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  return new Response(await draw(env, now), {headers: HEADERS});
};
export const agentsView = route(async (env, now) => agentsPage(await latestCard(env), (await readBroker(env))?.tally || null, now));
export const stepsView = route(async (env, now) => stepsPage(await latestCard(env), (await readBroker(env))?.tally || null, now));
export const enginesView = route(async (env, now) => enginesPage(await readBroker(env), now));
