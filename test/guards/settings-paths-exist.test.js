// Every "Settings → X" the server sends names a section the app has (26 Oct 2026: Free AI's 429 said "Settings → AI engine", which leads nowhere; the app's own guard is desktop/test/settings-paths-exist.test.js).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';

const DEAD = /Settings → (AI|AI engine|Telegram|Gmail and Calendar)\b/;
const folders = ['../../shared', '../../api'];

const files = dir => readdirSync(new URL(`${dir}/`, import.meta.url), {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : entry.name.endsWith('.js') ? [`${dir}/${entry.name}`] : []);

test('the messages the server sends never point to a Settings section that does not exist', () => {
  const found = folders.flatMap(files).filter(file => DEAD.test(readFileSync(new URL(file, import.meta.url), 'utf8')));
  assert.deepEqual(found, [], 'use "Settings → Connections → AI"');
});

test('Free AI and credit messages name Settings → Connections → AI', async () => {
  const {TRIAL_MESSAGE} = await import('../../shared/free-ai.js');
  const {CREDIT_OUT} = await import('../../shared/pro-ai.js');
  for (const message of [TRIAL_MESSAGE, CREDIT_OUT]) assert.match(message, /Settings → Connections → AI/);
});
