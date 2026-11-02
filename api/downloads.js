// Website traffic without cookies: page views (POST /api/hit from web/public/track.js) and Download clicks (GET /download/mac|windows|windows-exe|chrome,
// which records the click and redirects to the GitHub release file or the store listing). Called by visitors and by /install (api/install.js), never by /admin.
// The /stats page that reads these tables is admin/stats.js. Stored in Cloudflare D1 (binding STATS, tables in migrations/). A visitor is a hash of
// IP + browser + the day + the secret STATS_SALT: it counts unique people per day and can't be traced back to an address.
// Guarded by test/api/stats.test.js.
import {OWN_HOSTS} from '../shared/hosts.js';
import {net} from './attribution.js';
import {device} from '../shared/device.js';
import {PUBLIC_REPO, githubUrl} from '../shared/repos.js';

const RELEASE = `${githubUrl(PUBLIC_REPO)}/releases/latest/download/`;
// The fixed fallback: the alias every stable release uploads beside its versioned file (the latest stable, desktop-v0.8.60, has both).
export const FILES = {mac: 'Jobadabra-mac-arm64.dmg', 'windows-exe': 'Jobadabra-windows-x64.exe'};
// Store listings (owner, 26 Oct 2026: "Store first, .exe small"): a Microsoft Store install never shows SmartScreen or Edge's Keep/Delete, and the
// Store keeps that copy updated; the .exe stays one small link (windows-exe). Guarded by test/api/store-downloads.test.js.
export const STORES = {windows: 'https://apps.microsoft.com/detail/9NW1JJ7Z90MP',
  chrome: 'https://chromewebstore.google.com/detail/nmbnjhmpofifgcdalfefddbiihccogoi'};
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|monitor/i;

const clip = (value, max = 80) => String(value || '').replace(/[^\w.\-/: ]/g, '').slice(0, max);
const today = (now = new Date()) => now.toISOString().slice(0, 10);


// "linkedin.com" from a referrer URL; our own pages and empty referrers count as direct.
export function sourceOf(referrer, self) {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host && host !== self.replace(/^www\./, '') && !OWN_HOSTS.includes(host) ? clip(host, 60) : 'direct';
  } catch { return 'direct'; }
}

export async function visitor(request, env, day) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const data = new TextEncoder().encode(`${env.STATS_SALT || ''}|${day}|${ip}|${request.headers.get('User-Agent') || ''}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const isBot = request => BOT.test(request.headers.get('User-Agent') || '');

async function base(request, env, now) {
  const day = today(now);
  return {day, at: now.toISOString(), visitor: await visitor(request, env, day), country: clip(request.cf?.country || '', 4),
    device: device(request.headers.get('User-Agent') || '')};
}

// POST /api/hit {page, source}: one page view.
export async function hit(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  if (!env.STATS || isBot(request)) return new Response(null, {status: 204});
  let body = {};
  try { body = JSON.parse(await request.text()); } catch { /* an empty beacon still counts */ }
  const row = await base(request, env, now);
  await env.STATS.prepare('INSERT INTO visits (day, at, visitor, page, source, country, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.day, row.at, row.visitor, clip(body.page) || '/', clip(body.source, 60) || 'direct', row.country, row.device).run();
  return new Response(null, {status: 204});
}

// GET /download/mac?from=hero&page=/&src=linkedin.com: count it (in the background), then send the visitor to the file.
// The latest stable release's own file (Jobadabra-0.8.28-arm64.dmg), so each download is named after its
// version instead of Chrome's "Jobadabra-mac-arm64 (6).dmg". Asked from GitHub at most every 10 minutes (Cloudflare
// cache); if GitHub doesn't answer, the fixed name above still works.
const VERSIONED = {mac: [/^Jobadabra-\d[\w.-]*-arm64\.dmg$/],
  'windows-exe': [/^Jobadabra-\d[\w.-]*-x64\.exe$/]};
export async function versioned(platform, env, fetcher = globalThis.fetch, cache = globalThis.caches?.default) {
  const api = `https://api.github.com/repos/${env.GITHUB_REPO || PUBLIC_REPO}/releases/latest`;
  try {
    let response = cache && await cache.match(api);
    if (!response) {
      // Signed in with the site's GitHub token when it has one: 5,000 lookups an hour, not 60 per (shared) address.
      response = await fetcher(api, {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'jobadabra-web',
        ...(env.GITHUB_TOKEN ? {Authorization: `Bearer ${env.GITHUB_TOKEN}`} : {})}});
      if (!response.ok) return null;
      response = new Response(response.body, response);
      response.headers.set('Cache-Control', 'max-age=600');
      if (cache) await cache.put(api, response.clone());
    }
    const release = await response.json();
    for (const pattern of VERSIONED[platform]) {
      const found = (release.assets || []).find(asset => pattern.test(asset.name));
      if (found) return found.browser_download_url;
    }
    return null;
  } catch { return null; }
}

// One download row; also used by /install (api/install.js), whose client (curl) isn't a bot there.
export async function record(request, env, {platform, button, page = 'unknown', source}, now = new Date()) {
  if (!env.STATS) return;
  const row = await base(request, env, now);
  await env.STATS.prepare(
    'INSERT INTO downloads (day, at, visitor, platform, button, page, source, country, device, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.day, row.at, row.visitor, platform, button, page, source || 'direct', row.country, row.device, await net(request, env)).run();
}

export async function download(request, env, ctx, now = new Date()) {
  const url = new URL(request.url);
  const platform = url.pathname.split('/')[2];
  if (!FILES[platform] && !STORES[platform]) return new Response('Not found', {status: 404});
  const target = STORES[platform] || await versioned(platform, env, env.fetcher || globalThis.fetch) || RELEASE + FILES[platform];  // env.fetcher: tests
  if (env.STATS && request.method === 'GET' && !isBot(request)) {
    // net: the network's hash, so the app's first start can learn this click's channel (api/attribution.js)
    const save = Promise.all([base(request, env, now), net(request, env)]).then(([row, network]) => env.STATS.prepare(
      'INSERT INTO downloads (day, at, visitor, platform, button, page, source, country, device, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.day, row.at, row.visitor, platform, clip(url.searchParams.get('from'), 30) || 'unknown',
        clip(url.searchParams.get('page')) || 'unknown',
        clip(url.searchParams.get('src'), 60) || sourceOf(request.headers.get('Referer'), url.hostname),
        row.country, row.device, network).run()).catch(error => console.log('download stat failed', error.message));
    if (ctx?.waitUntil) ctx.waitUntil(save); else await save;
  }
  // Never kept by the browser: the next click asks again and gets the newest release.
  return new Response(null, {status: 302, headers: {Location: target, 'Cache-Control': 'no-store'}});
}
