// Sort, search and pages on every long admin table (admin/table-tools.js; owner, 27 Oct 2026). The functions, the Closed sites table of the Scouting page
// in a real browser (its reason chips combine with them), and tools/admin-table-tools.mjs over every admin page (the class: every long table gets them).
// The browser parts are skipped where no playwright-core is found; CI installs it. Run: tools/site-run.sh node --test test/integration/table-tools.test.js
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {PAGES, withNav} from '../../admin/admin.js';
import {cellValue, columnKind, compareValues, countLabel, pageRange, rowMatches, TABLE_TOOLS_SCRIPT, TOOLS_MIN} from '../../admin/table-tools.js';
import {launchChromium, workerServer} from '../../tools/worker-server.mjs';

const root = process.cwd();

test('a column reads as dates, numbers or text, and sorts that way with empty cells last', () => {
  assert.equal(columnKind(['2026-10-01', '2026-09-12', 'due now', '']), 'date');
  assert.equal(columnKind(['3', '12', '1,204', '$3.50', '45%', '–']), 'num');
  assert.equal(columnKind(['jobs.a.example', 'b.example', '3']), 'text');
  assert.deepEqual(['12', '3', '1,204', '2.5k'].map(t => cellValue(t, 'num')), [12, 3, 1204, 2500]);
  assert.equal(cellValue('−4 pts', 'num'), -4);
  assert.ok(cellValue('2026-10-25 10:00 UTC', 'date') > cellValue('2026-10-25', 'date'));
  assert.ok(cellValue('due now', 'date') > cellValue('2026-01-01', 'date'), '"due now" is today');
  assert.equal(cellValue('–', 'num'), null);
  const sorted = (values, dir) => [...values].sort((a, b) => compareValues(a, b, dir));
  assert.deepEqual(sorted([3, null, 12, 1], 1), [1, 3, 12, null]);
  assert.deepEqual(sorted([3, null, 12, 1], -1), [12, 3, 1, null], 'empty cells stay last going down too');
  assert.deepEqual(sorted(['item 10', 'item 9', null], 1), ['item 9', 'item 10', null], 'text sorts with its numbers');
});

test('pages of 25 and the search keep every word', () => {
  assert.deepEqual(pageRange(276, 0, 25), {page: 0, pages: 12, from: 0, to: 25});
  assert.deepEqual(pageRange(276, 99, 25), {page: 11, pages: 12, from: 275, to: 276}, 'a page past the end is the last one');
  assert.deepEqual(pageRange(0, 3, 25), {page: 0, pages: 1, from: 0, to: 0});
  assert.deepEqual(pageRange(64, 0, Infinity), {page: 0, pages: 1, from: 0, to: 64}, 'show all');
  assert.equal(countLabel(pageRange(276, 0, 25), 276, 276), '1–25 of 276');
  assert.equal(countLabel(pageRange(32, 1, 25), 32, 276), '26–32 of 32 · 276 rows');
  assert.equal(countLabel(pageRange(0, 0, 25), 0, 276), 'No row matches · 276 rows');
  assert.ok(rowMatches('jobs.demo-4.example Refused 3', 'REFUSED demo'));
  assert.ok(!rowMatches('jobs.demo-4.example Refused 3', 'refused gone'));
  assert.ok(rowMatches('anything', '  '));
});

test('every admin page carries the tools, after the table script', () => {
  const html = withNav('<html><head></head><body><main><table></table></main></body></html>', PAGES[0].path);
  assert.ok(html.includes(TABLE_TOOLS_SCRIPT) && html.indexOf('tableTools(document') > html.indexOf("querySelectorAll('main table')"));
  assert.match(html, /\.tt-bar\{/);
  assert.equal(TOOLS_MIN, 25);
});

test('Closed sites: sorts, searches, pages, and its reason chips combine with them', async t => {
  const browser = await launchChromium(root);
  if (!browser) return t.skip('playwright-core not found');
  const site = await workerServer(root, ['closed-sites']);
  try {
    const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
    await page.goto(site.base + PAGES.find(p => p.name === 'Scouting').path, {waitUntil: 'load'});
    const box = page.locator('#closed-sites'), table = box.locator('table');
    const shown = () => table.locator('tr[data-reason]:visible');
    const column = i => shown().evaluateAll((rows, n) => rows.map(r => r.cells[n].textContent.trim()), i);
    const count = () => box.locator('.tt-bar .tt-count').textContent();
    assert.equal(await table.getAttribute('data-tools'), 'on');
    const total = await table.locator('tr[data-reason]').count();
    assert.ok(total > TOOLS_MIN, `the seed has ${total} closed sites`);
    assert.equal(await shown().count(), 25);
    assert.equal(await count(), `1–25 of ${total}`);

    await box.locator('.tt-bar [aria-label="Next page"]').click();
    assert.equal(await count(), `26–50 of ${total}`);

    const installs = box.getByRole('button', {name: /Installs agreeing/});
    await installs.click();
    assert.equal(await box.locator('th[aria-sort]').textContent(), 'Installs agreeing▼');
    assert.equal(await count(), `1–25 of ${total}`, 'a sort goes back to page 1');
    const down = (await column(2)).map(Number);
    assert.deepEqual(down, [...down].sort((a, b) => b - a), 'numbers, largest first');
    await installs.click();
    assert.equal(await box.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending');
    await box.getByRole('button', {name: /Last seen/}).click();
    const dates = await column(4);
    assert.deepEqual(dates, [...dates].sort().reverse(), 'dates, newest first');

    await box.locator('.tt-q').fill('demo-site');
    assert.equal(await count(), `1–12 of 12 · ${total} rows`);
    await box.locator('.tt-q').fill('');
    await box.locator('[data-closed="refused"]').click();
    const refused = await table.locator('tr[data-reason="refused"]').count();
    assert.equal(await count(), `1–${refused} of ${refused} · ${total} rows`, 'the chip and the pages agree');
    assert.deepEqual([...new Set(await shown().evaluateAll(rows => rows.map(r => r.dataset.reason)))], ['refused']);
    await box.locator('.tt-q').fill('jobs.demo-1');   // demo-10, -15 … among the refused
    assert.ok((await shown().count()) < refused && (await shown().count()) > 0, 'chip and search combine');
    await box.locator('.tt-q').fill('');
    await box.locator('[data-closed=""]').click();
    await box.locator('.tt-all').click();
    assert.equal(await shown().count(), total, 'show all');
    assert.equal(await count(), `1–${total} of ${total}`);
  } finally { await browser.close(); site.close(); }
});

test('every long table on every admin page gets the tools, or a reason to skip, and fits a phone', t => {
  const run = spawnSync(process.execPath, [new URL('../../tools/admin-table-tools.mjs', import.meta.url).pathname, '--min', '5'], {encoding: 'utf8', timeout: 240_000});
  if (run.status === 2) return t.skip(run.stdout.trim());
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /tables over 5 rows: [1-9]\d* with the tools/, 'demo data reaches the tools at all');
});
