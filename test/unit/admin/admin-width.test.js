// The admin menu and every admin page's content share one width, so the menu row and the page edges line up and the menu does not wrap early.
// Why (5 Nov 2026, owner: "should we maybe increase a bit the container? So that we can fit this amount of menu items?"): "super admin" wrapped onto its own line at 1040px; now 1200px on the menu and on each page's `main`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {BASE_STYLE, NAV_STYLE} from '../../../admin/admin.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../admin');
const WIDTH = '1200px';
// Pages that set their own narrower width: the feedback page's 820px is overridden by BASE_STYLE where the page goes through adminPage; the e2e report is a standalone "no report yet" notice.
const OWN_WIDTH = new Set(['feedback-page.js', 'e2e-report.js']);

test('the shared styles that decide the real width (BASE_STYLE for content, NAV_STYLE for the menu row) both say 1200px', () => {
  assert.match(BASE_STYLE, new RegExp(`main\\{max-width:${WIDTH}`));
  assert.match(NAV_STYLE, new RegExp(`\\.admin-nav>div\\{max-width:${WIDTH}`));
});

test('every admin page that sets its content width uses the same one as the menu', () => {
  const widths = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
    for (const match of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/\bmain\s*\{[^}]*?max-width:\s*([\d.]+\w*)/g)) widths.push([file, match[1]]);
  }
  assert.ok(widths.length >= 7, `pages that set a main width: ${widths.length}`);
  assert.deepEqual(widths.filter(([file, width]) => width !== WIDTH && !OWN_WIDTH.has(file)), [], 'a page with its own width no longer lines up with the menu');
});
