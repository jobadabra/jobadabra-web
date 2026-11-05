// The charts of Benchmark (Tech and non-tech), Scouting and Agent coding's CI minutes: the numbers equal the tables', escaped, an empty list draws no empty frame.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {employerKindChart, familyChart, freshnessChart, kindsChart, usefulChart} from '../../../admin/jobsearch-charts.js';

test('tech and non-tech: one bar chart per kind of role, a tool without a number for it is left out, our own tool is marked', () => {
  const view = {tools: [{tool: 'Jobadabra', ours: true}, {tool: 'Rival <b>'}], kinds: {tech: {Jobadabra: {relevant: 12, relevantShare: 60}, 'Rival <b>': {relevant: 5, relevantShare: 25}}, 'non-tech': {Jobadabra: {relevant: 7, relevantShare: 35}}}};
  const html = kindsChart(view);
  assert.match(html, /Tech roles[\s\S]*Jobadabra[\s\S]*ours[\s\S]*60%/);
  assert.match(html, /Non-tech roles[\s\S]*35%/);
  assert.match(html, /Rival &lt;b&gt;/);
  assert.equal((html.match(/vz-row/g) || []).length, 3);
  assert.equal(kindsChart({tools: [], kinds: {}}), '');
});

test('employers per kind: the All column is the bar, the regions are in the tooltip, biggest first', () => {
  const html = employerKindChart({software: 5, health: 12}, {'health|DE': 8, 'health|FR': 4, 'software|DE': 5}, ['DE', 'FR']);
  assert.ok(html.indexOf('health') < html.indexOf('software'));
  assert.match(html, /data-tip="health · 12 employers · DE 8 · FR 4"/);
  assert.equal(employerKindChart({}, {}, []), '');
});

test('shared per AI family: one small chart per measure, the families that reported only', () => {
  const html = familyChart({claude: {sharing7: 3, shared: 1200, dead: 4, boardsMatched: 9}, openai: {sharing7: 1, shared: 80, dead: 0, boardsMatched: 2}});
  assert.equal((html.match(/vz-cap2/g) || []).length, 4);
  assert.match(html, /Employer job sites shared[\s\S]*1,200/);
  assert.doesNotMatch(html, /Unknown/);
});

test('freshness and most useful employers: the bar is interviews, or the jobs matched when nobody got one; a name is escaped', () => {
  assert.match(freshnessChart([['Failing', 3], ['Shrinking', 0]]), /Failing[\s\S]*3[\s\S]*Shrinking/);
  const some = usefulChart([{company: 'A <i>', interviews: 4, applied: 9, hits: 30, installs: 3, jobs: 40}, {company: 'B', interviews: 0, applied: 1, hits: 2, installs: 1, jobs: 5}]);
  assert.match(some, /A &lt;i&gt;/);
  assert.match(some, /4 interviews/);
  assert.match(some, /9 applied · 30 matched · 3 installs/);
  assert.match(usefulChart([{company: 'B', interviews: 0, applied: 1, hits: 2, installs: 1, jobs: 5}]), /2 matched/);
  assert.equal(usefulChart([]), '');
});
