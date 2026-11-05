// tools/page-shot.mjs end to end: the promo page renders through the real Worker on demo data, styled, and the PNG is written (needs Chrome: skipped without it).
// Run: tools/site-run.sh node --test test/tooling/page-shot.test.js
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('page-shot renders /admin/growth/promo-codes styled at two widths and never writes an unstyled one', {skip: !fs.existsSync(chrome) && 'no Chrome'}, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'page-shot-'));
  try {
    execFileSync('node', ['tools/page-shot.mjs', '--path', '/admin/growth/promo-codes', '--width', '1440,390', '--seed', 'promo-codes', '--name', 't', '--out', out], {stdio: 'pipe'});
    assert.deepEqual(fs.readdirSync(out).sort(), ['t-1440.png', 't-390.png']);
    assert.ok(fs.statSync(path.join(out, 't-1440.png')).size > 10000);
    assert.throws(() => execFileSync('node', ['tools/page-shot.mjs', '--path', '/no-such-page', '--out', out, '--name', 'bad'], {stdio: 'pipe'}), /status 1|Command failed/);   // an error page is refused
    assert.ok(!fs.existsSync(path.join(out, 'bad-1440.png')));
  } finally { fs.rmSync(out, {recursive: true, force: true}); }
});

test('page-shot renders a public page (/download) styled: the old-host redirect to www.jobadabra.top is served locally', {skip: !fs.existsSync(chrome) && 'no Chrome'}, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'page-shot-'));
  try {
    execFileSync('node', ['tools/page-shot.mjs', '--path', '/download', '--width', '390', '--name', 'p', '--out', out], {stdio: 'pipe'});
    assert.ok(fs.statSync(path.join(out, 'p-390.png')).size > 10000);
  } finally { fs.rmSync(out, {recursive: true, force: true}); }
});
