// /admin/job-search/scouting "Bot checks": what installs' browsers met on sites that refused the engine, by ladder step (owner, 21 Oct 2026). Counts and host numbers only. Guards shared/bot-checks.js and admin/bot-checks.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarize} from '../../../shared/bot-checks.js';
import {section} from '../../../admin/bot-checks.js';

const rows = [{outcome: 'opened', step: 'download', sites: 8, installs: 5}, {outcome: 'opened', step: 'tab', sites: 2, installs: 2}, {outcome: 'bot', step: 'tab', sites: 3, installs: 2},
  {outcome: 'refused', step: 'download', sites: 4, installs: 3}, {outcome: 'login', step: null, sites: 1, installs: 1}, {outcome: 'opened', step: null, sites: 5, installs: 4}];

test('the summary counts sites by outcome and step, and says how many are open, stopped by a check, refused or behind a login', () => {
  const sum = summarize(rows);
  assert.deepEqual([sum.total, sum.opened, sum.bot, sum.refused, sum.login], [23, 15, 3, 4, 1]);
  assert.deepEqual([sum.openedAt.download, sum.openedAt.tab, sum.openedAt.unknown], [8, 2, 5], 'old shares carry no step: counted apart');
  assert.deepEqual(summarize([]), {total: 0, opened: 0, bot: 0, refused: 0, login: 0, openedAt: {engine: 0, download: 0, tab: 0, unknown: 0}});
});

test('the section shows the numbers, names the missing counters and holds no host name or page text', () => {
  const html = section(summarize(rows));
  assert.ok(html.includes('Bot checks') && html.includes('8') && html.includes('captcha'));
  assert.ok(html.includes('Not counted yet'), 'solved after a prompt and installs with the incognito switch are not shared yet: said so');
  assert.ok(section(null).includes('Nothing reported yet'));
});
