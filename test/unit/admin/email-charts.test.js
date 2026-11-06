// The charts of /admin/growth/email and the AI-cost steps of /admin/growth/insights: the numbers equal the tables', the tables stay behind "Show table", empty data draws no empty frame.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addressChart, refusedChart, stepCostChart, stoppedChart, templateChart} from '../../../admin/email-charts.js';
import {stacks} from '../../../admin/viz.js';

const templates = [{template: 'digest', sent: 90, refused: 10, last: '2026-11-05T09:30:00Z'}, {template: 'welcome', sent: 20, refused: 0, last: ''}, {template: 'message', sent: 0, refused: 0, last: ''}];

test('by template: one stacked bar per template, sized by its total, split into sent and not sent', () => {
  const html = templateChart(templates);
  assert.match(html, /digest/);
  assert.match(html, /90 sent/);
  assert.match(html, /10 not sent · last 2026-11-05/);
  assert.match(html, /data-tip="digest · 90 sent · 10 not sent · last sent 2026-11-05 09:30"/);
  const widths = [...html.matchAll(/vz-fill" style="width:([\d.]+)%/g)].map(match => Number(match[1]));
  assert.deepEqual(widths, [100, 20]);   // welcome (20) against digest (100); a template with nothing sent has the empty track
  assert.equal(templateChart([]), '');
});

test('stacks: with `scale` a bar is as long as its total against the largest row, without it every bar fills its track', () => {
  const rows = [{label: 'a', text: '', parts: [{value: 3, tone: 's1'}], tip: 'a'}, {label: 'b', text: '', parts: [{value: 1, tone: 's1'}], tip: 'b'}];
  assert.deepEqual([...stacks(rows, [], {scale: true}).matchAll(/vz-fill" style="width:([\d.]+)%/g)].map(match => match[1]), ['100.0', '33.3']);
  assert.doesNotMatch(stacks(rows), /vz-fill/);
});

test('refusals, addresses and stops: one bar per row, the count printed, a label carries both reason and list', () => {
  assert.match(refusedChart([{reason: 'rate', n: 1234}]), /rate[\s\S]*1,234/);
  assert.match(addressChart([['Confirmed', 5], ['Unconfirmed', 3], ['Product news opt-in', 2]]), /Product news opt-in/);
  assert.match(stoppedChart([{reason: 'bounce', list: 'all', n: 2}]), /bounce · all/);
  for (const make of [refusedChart, addressChart, stoppedChart]) assert.equal(make([]), '');
});

test('an AI step: the money is the bar, calls and cost per call sit under the name and in the tooltip; a name is escaped', () => {
  const html = stepCostChart([{action: 'fill <b>', calls: 1200, usd: 3.5, perCall: 0.0029}, {action: 'score', calls: 10, usd: 0.1, perCall: 0.01}]);
  assert.match(html, /fill &lt;b&gt;/);
  assert.match(html, /1,200 calls · \$0\.0029 each/);
  assert.match(html, /\$3\.500/);
  assert.match(html, /width:100\.0%/);
  assert.equal(stepCostChart([]), '');
});

test('by template: the people who pressed Open stand beside the mails sent; a mail nobody pressed says nothing', () => {
  assert.match(templateChart([{...templates[0], opened: 7}]), /10 not sent · 7 pressed Open · last 2026-11-05/);
  assert.doesNotMatch(templateChart(templates), /pressed Open/);
});
