// Email landing links select only fixed desktop pages, including when someone edits the query. And when nothing opens (an app older than the jobadabra:// scheme, no app at all) the page says so after 2 s
// and points to the download (owner, 5 Nov 2026: it sat there; the button "didn't open my Jobadabra desktop app"). Version text is tied to shared/app-needs.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {NEEDS} from '../../../shared/app-needs.js';
const script = fs.readFileSync(new URL('../../../web/public/open.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../../web/public/open.html', import.meta.url), 'utf8');

// A browser stand-in: elements by id, window/document listeners, and timers you fire by hand.
function run(query) {
  const elements = {'open-app': {}, 'open-fallback': {hidden: true}}, listeners = {}, timers = [];
  const target = name => ({addEventListener: (type, fn) => { (listeners[`${name}:${type}`] ||= []).push(fn); }});
  const document = {...target('document'), getElementById: id => elements[id], visibilityState: 'visible'};
  const location = {search: query};
  vm.runInNewContext(script, {URLSearchParams, location, document, window: target('window'), setTimeout: (fn, ms) => timers.push({fn, ms})});
  return {elements, location, document, timers, fire: (name, type) => (listeners[`${name}:${type}`] || []).forEach(fn => fn())};
}

for (const [query, expected] of [['?view=jobs', 'jobs'], ['?view=sessions', 'sessions'], ['?view=https://evil.example', 'jobs']]) {
  test(`email landing ${query} opens only ${expected}`, () => {
    const {elements, location} = run(query);
    assert.equal(location.href, `jobadabra://${expected}`);
    assert.equal(elements['open-app'].href, location.href);
  });
}

test('nothing opened after 2 s (page never lost focus): the "Update the app" note appears', () => {
  const {elements, timers} = run('?view=jobs');
  assert.equal(elements['open-fallback'].hidden, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 2000);
  timers[0].fn();
  assert.equal(elements['open-fallback'].hidden, false);
});

test('the browser lost focus or hid the page (the app, or its permission prompt, took over): no note', () => {
  for (const [name, type] of [['window', 'blur'], ['document', 'visibilitychange'], ['window', 'pagehide']]) {
    const sim = run('?view=jobs');
    sim.document.visibilityState = type === 'visibilitychange' ? 'hidden' : 'visible';
    sim.fire(name, type);
    sim.timers[0].fn();
    assert.equal(sim.elements['open-fallback'].hidden, true, type);
  }
});

test('the note names the first app version that opens it (shared/app-needs.js) and links the download', () => {
  const note = /<p[^>]*id="open-fallback"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] || '';
  assert.ok(note.includes(NEEDS.open), `the note names ${NEEDS.open}`);
  assert.ok(note.includes('href="/download"') && /Update/.test(note));
  assert.match(page, /id="open-fallback"[^>]*\bhidden\b/);
});

test('the page counts a press before it hands over to the app', () => {
  // Owner, 6 Nov 2026: "Count presses, anonymous". After the hand-over the page may be gone, so the count goes first.
  assert.ok(page.indexOf('/track.js') > 0 && page.indexOf('/track.js') < page.indexOf('/open.js'));
});
