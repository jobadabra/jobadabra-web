// Email landing links select only fixed desktop pages, including when someone edits the query.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const script = fs.readFileSync(new URL('../../../web/public/open.js', import.meta.url), 'utf8');
for (const [query, expected] of [['?view=jobs', 'jobs'], ['?view=sessions', 'sessions'], ['?view=https://evil.example', 'jobs']]) {
  test(`email landing ${query} opens only ${expected}`, () => {
    const link = {}, location = {search: query};
    vm.runInNewContext(script, {URLSearchParams, location, document: {getElementById: () => link}});
    assert.equal(location.href, `jobadabra://${expected}`);
    assert.equal(link.href, location.href);
  });
}
