// Every old host × every kind of request: where the worker sends it. People's page views (public pages and /admin pages) move to
// www.jobadabra.top; scripts, the admin pages' own fetches, signed report files, writes and the API stay answered on the old host
// (installed apps, central-scout.yml's PUT /api/index on workers.dev). Owner, 27 Oct 2026: workers.dev /admin "still not" redirected.
// A host added to OLD_HOSTS is checked here without editing this file. Guards shared/hosts.js and shared/admin-hop.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {OLD_HOSTS} from '../../../shared/hosts.js';
import {SESSION_COOKIE, sessionToken} from '../../../shared/auth.js';

const now = Date.now();
const kv = () => { const m = new Map(); return {get: async k => m.get(k) ?? null, put: async (k, v) => m.set(k, v), list: async () => ({keys: []})}; };
const db = {prepare: () => ({bind: () => db.stmt, ...db.stmt})};
db.stmt = {run: async () => ({}), first: async () => null, all: async () => ({results: []})};
const env = () => ({STATS_KEY: 'owner-key', WAITLIST: kv(), STATS: db, ASSETS: {fetch: async () => new Response('page')}});
const html = {Accept: 'text/html,application/xhtml+xml'};
const ADMIN = '/admin/form-filling/lab?tab=cases';

// Each kind: the request on `host`, and where it must go there (a Location prefix, or null: answered in place).
const KINDS = cookie => ({
  'public page': [host => new Request(`https://${host}/pricing?from=x`, {headers: html}), 'https://www.jobadabra.top/pricing?from=x'],
  '/admin page, signed in': [host => new Request(`https://${host}${ADMIN}`, {headers: {...html, Cookie: cookie}}), 'https://www.jobadabra.top/admin/hop?t=h1.'],
  '/admin page, signed out': [host => new Request(`https://${host}${ADMIN}`, {headers: html}), `https://www.jobadabra.top${ADMIN}`],
  'admin JSON (the page\'s own fetch)': [host => new Request(`https://${host}/admin/form-filling/lab?json`, {headers: {Accept: '*/*', 'X-Caller': 'page-tab', Cookie: cookie}}), null],
  'admin JSON with text/html but X-Caller': [host => new Request(`https://${host}/admin/form-filling/lab?json`, {headers: {...html, 'X-Caller': 'page-tab', Cookie: cookie}}), null],
  'admin script (Bearer)': [host => new Request(`https://${host}/admin/form-filling/lab?json`, {headers: {...html, Authorization: 'Bearer owner-key'}}), null],
  'admin script (?key)': [host => new Request(`https://${host}/admin/form-filling/lab?key=owner-key`, {headers: html}), null],
  'invite link': [host => new Request(`https://${host}/admin/join?t=x`, {headers: html}), null],
  'hop': [host => new Request(`https://${host}/admin/hop?t=x&to=/admin`, {headers: html}), null],
  'e2e report file (signed address)': [host => new Request(`https://${host}/admin/operations/e2e/report/1/tok/index.html`, {headers: html}), null],
  'old e2e report file': [host => new Request(`https://${host}/admin/e2e/report/1/tok/index.html`, {headers: html}), null],
  'admin POST': [host => new Request(`https://${host}/admin/form-filling/lab`, {method: 'POST', headers: {...html, Cookie: cookie}, body: '{}'}), null],
  'e2e report PUT': [host => new Request(`https://${host}/admin/testing/e2e`, {method: 'PUT', headers: {Authorization: 'Bearer owner-key'}, body: '{}'}), null],
  'API POST': [host => new Request(`https://${host}/api/feedback`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}), null],
  'API PUT (central-scout)': [host => new Request(`https://${host}/api/index`, {method: 'PUT', headers: {Authorization: 'Bearer owner-key'}, body: '{}'}), null],
  'report POST': [host => new Request(`https://${host}/report/fill-failure`, {method: 'POST', body: '{}'}), null],
  'telemetry POST': [host => new Request(`https://${host}/telemetry`, {method: 'POST', body: '{}'}), null],
});

const isRedirect = status => status >= 300 && status < 400;

test('every old host: page views move to www.jobadabra.top, everything else is answered in place', async () => {
  assert.deepEqual(OLD_HOSTS, ['www.jobpilotto.top', 'www.jobpilotto.workers.dev']);
  for (const host of OLD_HOSTS) {
    const e = env(), kinds = KINDS(`${SESSION_COOKIE}=${await sessionToken(e, now)}`);
    for (const [kind, [make, to]] of Object.entries(kinds)) {
      const r = await worker.fetch(make(host), e, {waitUntil: () => {}});
      const where = `${host}: ${kind}`;
      if (to === null) { assert.ok(!isRedirect(r.status), `${where} is answered, got ${r.status} -> ${r.headers.get('Location')}`); continue; }
      assert.ok(isRedirect(r.status), `${where} moves, got ${r.status}`);
      assert.ok(r.headers.get('Location').startsWith(to), `${where}: ${r.headers.get('Location')}`);
      if (kind.startsWith('/admin')) {   // 302 no-store: a cached 301 would skip the hop on a later signed-in visit
        assert.equal(r.status, 302, where);
        assert.equal(r.headers.get('Cache-Control'), 'no-store', where);
      } else assert.equal(r.status, 301, where);
    }
  }
});

test('the bare jobpilotto.top sends everything to its www in one step, which then follows the rows above', async () => {
  const e = env(), kinds = KINDS(`${SESSION_COOKIE}=${await sessionToken(e, now)}`);
  for (const [kind, [make]] of Object.entries(kinds)) {
    const request = make('jobpilotto.top'), r = await worker.fetch(request, e, {});
    const u = new URL(request.url);
    assert.equal(r.status, 301, kind);
    assert.equal(r.headers.get('Location'), `https://www.jobpilotto.top${u.pathname}${u.search}`, kind);
  }
});

test('the main host and staging never send /admin anywhere: no loop', async () => {
  for (const host of ['www.jobadabra.top', 'www-staging.jobpilotto.workers.dev']) {
    const e = env(), kinds = KINDS(`${SESSION_COOKIE}=${await sessionToken(e, now)}`);
    for (const kind of ['/admin page, signed in', '/admin page, signed out']) {
      const r = await worker.fetch(kinds[kind][0](host), e, {});
      assert.ok(!isRedirect(r.status), `${host}: ${kind} got ${r.status} -> ${r.headers.get('Location')}`);
    }
  }
});
