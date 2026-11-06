// adminPage adds the Admin menu and stylesheet to every HTML page an admin route answers, whatever its status (owner, 6 Nov 2026: a refused Notifications form came back as a bare page).
// A redirect, a plain-text 404 and JSON pass untouched.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adminPage} from '../../../admin/admin.js';

const page = (status, body = '<!doctype html><html><head></head><body><main><header><h1>T</h1></header></main></body></html>', type = 'text/html; charset=utf-8') => new Response(body, {status, headers: {'Content-Type': type}});

test('an HTML page keeps the Admin look at 200, 400 and 404 (a refused form, a run that is not kept)', async () => {
  for (const status of [200, 400, 404, 500]) {
    const res = await adminPage(page(status), '/admin/operations/notifications', {role: 'superadmin'});
    const html = await res.text();
    assert.equal(res.status, status, 'the status is kept');
    assert.ok(html.includes('class="admin-nav"'), `status ${status}: the top bar is there`);
    assert.ok(html.includes('<style>'), `status ${status}: the stylesheet is there`);
  }
});

test('a redirect, a plain-text 404 and JSON pass untouched', async () => {
  for (const response of [new Response(null, {status: 303, headers: {Location: '/admin'}}), page(404, 'Not found', 'text/plain'), page(200, '{"a":1}', 'application/json')]) {
    const res = await adminPage(response, '/admin', {role: 'superadmin'});
    assert.equal(res, response);
  }
});
