// Value cells on the admin pages are chips (owner, 27 Oct 2026: "this column values/cells should be displayed as chips"; then "Yes, after a preview" for the other pages):
// one helper (admin/chip.js), its style in each page, every page in CHIP_PAGES drawing its kinds, states and results with it, and a page that starts using it listed.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {CHIP_PAGES, CHIP_STYLE, chip} from '../../../admin/chip.js';
import {page as accessPage} from '../../../admin/access.js';
import {page as e2ePage} from '../../../admin/e2e-page.js';
import {bugRow, principlesSection} from '../../../admin/selfheal.js';
import {servedSection} from '../../../admin/scoutingadmin.js';

const admin = new URL('../../../admin/', import.meta.url);
const source = name => readFileSync(new URL(`${name}.js`, admin), 'utf8');
const now = Date.parse('2026-10-27T12:00:00Z'), day = n => new Date(now + n * 86400000).toISOString();

test('chip(): a tone picks its colour class, muted is grey, an unknown tone is a plain outline; the style never wraps', () => {
  assert.equal(chip('Active', 'good'), '<span class="chip good">Active</span>');
  assert.equal(chip('Removed', 'muted'), '<span class="chip off">Removed</span>');
  assert.equal(chip('beta'), '<span class="chip">beta</span>');
  assert.equal(chip('x', 'nope'), '<span class="chip">x</span>');
  assert.match(CHIP_STYLE, /\.chip\{[^}]*white-space:nowrap/);
  for (const tone of ['good', 'warn', 'bad', 'off']) assert.match(CHIP_STYLE, new RegExp(`\\.chip\\.${tone}[,{]`), tone);
});

test('every page in CHIP_PAGES imports the helper and puts its style in its own page; no raw value cell is left', () => {
  assert.ok(CHIP_PAGES.length >= 7, 'the list is read (positive control)');
  for (const name of CHIP_PAGES) {
    const text = source(name);
    assert.match(text, /from '\.\/chip\.js'/, `${name}: imports admin/chip.js`);
    assert.match(text, /\$\{CHIP_STYLE\}/, `${name}: puts CHIP_STYLE in its <style>`);
    assert.doesNotMatch(text, /<td>\$\{esc\([a-z]+\.(kind|status|state|severity|outcome|conclusion)\)\}<\/td>/, `${name}: a value cell drawn as plain text`);
    assert.doesNotMatch(text, /<td class="\$\{[a-z]+\.tone\}">/, `${name}: a state drawn as coloured text instead of a chip`);
  }
  const users = readdirSync(admin).filter(file => file.endsWith('.js') && file !== 'chip.js' && /from '\.\/chip\.js'/.test(readFileSync(new URL(file, admin), 'utf8')));
  assert.deepEqual(users.map(file => file.replace(/\.js$/, '')).sort(), [...CHIP_PAGES].sort(), 'a page that uses chip() is listed in CHIP_PAGES (so this test checks it)');
  // A page that shows another chip page's section (not its whole page) must bring the chip style itself (#189: installsimpact showed scouting's table unstyled).
  for (const file of readdirSync(admin).filter(name => name.endsWith('.js'))) {
    const text = readFileSync(new URL(file, admin), 'utf8');
    for (const [, names, from] of text.matchAll(/import \{([^}]*)\} from '\.\/([a-z-]+)\.js'/g)) {
      if (CHIP_PAGES.includes(from) && /\b\w+(Section|Row)\b/.test(names)) assert.match(text, /\$\{CHIP_STYLE\}/, `${file} shows ${from}'s ${names.trim()}: put CHIP_STYLE in its <style>`);
    }
  }
});

test('the pages draw their chips: access status, e2e kind and result, self-heal status, severity and bug status, scouting kind', () => {
  const access = accessPage({now, list: [
    {id: 'a', name: 'A', expires_at: day(20), invite_used_at: day(-3)}, {id: 'b', name: 'B', expires_at: day(20)},
    {id: 'c', name: 'C', expires_at: day(-1), invite_used_at: day(-30)}, {id: 'd', name: 'D', expires_at: day(20), revoked_at: day(-2)}]});
  for (const want of ['good">Active', 'warn">Link not opened yet', 'bad">Expired', 'off">Removed']) assert.ok(access.includes(`<td><span class="chip ${want}</span></td>`), want);
  const e2e = e2ePage({at: day(0), days: [], fails: [], latest: [{runId: 1, day: '2026-10-27', kind: 'beta', conclusion: 'failure', minutes: 3},
    {runId: 2, day: '2026-10-27', kind: 'pr', conclusion: 'cancelled', minutes: 1}, {runId: 3, day: '2026-10-27', kind: 'pr', conclusion: 'success', minutes: 2}]}, {now: new Date(now)});
  for (const want of ['<span class="chip">beta</span>', 'chip bad">red', 'chip off">cancelled', 'chip good">green']) assert.ok(e2e.includes(want), want);
  assert.match(principlesSection(), /<span class="chip warn">new<\/span>|<span class="chip good">in force<\/span>/);
  const bug = bugRow({url: '#', number: 7, title: 'T', detector: 'dom', severity: 'high', status: 'fixed'});
  assert.ok(bug.includes('<span class="chip bad">high</span>') && bug.includes('<span class="chip good">fixed</span>'), bug);
  assert.ok(bugRow({url: '#', number: 8, title: 'T', detector: 'dom', severity: 'medium', status: 'queued'}).includes('<span class="chip warn">queued</span>'));
  assert.ok(servedSection([{kind: 'boards', day: '2026-10-27', n: 3}], new Date(now)).includes('<td><span class="chip">boards</span></td>'));
});
