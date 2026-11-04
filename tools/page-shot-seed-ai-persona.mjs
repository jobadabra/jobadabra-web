// Demo data for /admin/testing/ai-persona (tools/page-shot.mjs): made-up runs of a made-up app, never a real person's data. Kept apart because page-shot-seeds.mjs is near the 500-line limit.
export const aiPersona = async ({env}) => {   // /admin/testing/ai-persona (4 Nov 2026, AI user agents 9/12 part 3): a night and two replays of a made-up app, one with a video (PAGE_SHOT_VIDEO = a .webm file) and a boxed screenshot
  const fs = await import('node:fs'), kept = new Map(), put = (key, bytes, type, meta = {}) => kept.set(key, {bytes: new Uint8Array(bytes), type, meta});
  const shot = fs.readFileSync('desktop/docs/ui/actions.jpg'), video = process.env.PAGE_SHOT_VIDEO && fs.existsSync(process.env.PAGE_SHOT_VIDEO) ? fs.readFileSync(process.env.PAGE_SHOT_VIDEO) : null;
  const trace = (goal, steps) => steps.map((did, i) => ({goal, n: i + 1, action: 'click', did, view: 'settings', failed: false}));
  const runs = [
    {run: '41867308961', at: '2026-11-04T16:26:00Z', kind: 'replay', commit: 'df66db1', plan: 'learned-questions', secs: video ? 240 : 0,
      goals: [{n: 1, group: 'settings', label: 'Open What we learned and go through the questions one by one', verdict: 'bug', summary: 'the list is empty under "1 of 1 open"', steps: 7}],
      trace: trace(1, ['Open profile', 'Press "What we learned"', 'Press "New 1"', 'Press "Open"', 'Press "Open"', 'Press "Expand all"', 'Press "Expand all"']),
      notes: [{goal: 1, title: 'Open question is missing', type: 'ux', kind: 'empty-state', severity: 'medium', view: 'settings', expected: 'the open question appears under New', observed: 'the list is empty although it says 1 of 1 open', why: 'the count and the list disagree', judge: 'agrees', judgeReason: '', filed: true, shot: 1, videoSec: 41, control: {x: 520, y: 238, w: 150, h: 36, window: {w: 1100, h: 681}}, trail: []}]},
    {run: '41860394127', at: '2026-11-04T15:41:00Z', kind: 'replay', commit: 'f5fc837', plan: 'learned-questions', secs: 0,
      goals: [{n: 1, group: 'settings', label: 'Open What we learned and go through the questions one by one', verdict: 'could-not-finish', summary: 'it kept doing the same thing, "Press Next question" 5 times on the same page, and the page did not change', steps: 13}],
      trace: trace(1, ['Open profile', 'Press "Next question"', 'Press "Next question"', 'Press "Next question"', 'Press "Next question"', 'Press "Next question"']), notes: []},
    {run: '41850000001', at: '2026-11-04T04:40:00Z', kind: 'night', commit: 'f5fc837', plan: '',  secs: 0,
      goals: [{n: 1, group: 'jobs', label: 'Open a job and read its fit', verdict: 'worked', summary: 'the fit shows with its reasons', steps: 4}, {n: 2, group: 'settings', label: 'Change the interface language', verdict: 'doubts', summary: 'the page did not say it saved', steps: 6}],
      trace: trace(1, ['Open jobs', 'Press "Open"']).concat(trace(2, ['Open settings', 'Press "Language"'])), notes: []},
  ];
  for (const run of runs) {
    const record = {...run, persona: 'Ana', seed: 20261103, stopped: 'goals', cost: {calls: 14, tokens: 552000, minutes: 2}, video: run.secs ? {secs: run.secs, bytes: video?.length || 0} : null};
    const count = verdict => String(run.goals.filter(goal => goal.verdict === verdict).length);
    put(`agent/${run.run}/run.json`, new TextEncoder().encode(JSON.stringify(record)), 'application/json', {at: run.at, kind: run.kind, commit: run.commit, plan: run.plan, worked: count('worked'), bug: count('bug'), doubts: count('doubts'), stuck: count('could-not-finish'), notes: String(run.notes.length), calls: '14', tokens: '552000', minutes: '2', bytes: '1000'});
    if (run.notes.length) put(`agent/${run.run}/shot-1.png`, shot, 'image/jpeg');
    if (run.secs && video) put(`agent/${run.run}/video.webm`, video, 'video/webm', {bytes: String(video.length)});
  }
  env.LAB_FILLS = {head: async key => (kept.has(key) ? {size: kept.get(key).bytes.length, httpMetadata: {contentType: kept.get(key).type}} : null),
    get: async (key, {range} = {}) => { const o = kept.get(key); if (!o) return null; const part = range ? o.bytes.slice(range.offset, range.offset + range.length) : o.bytes; return {body: part, size: o.bytes.length, text: async () => new TextDecoder().decode(o.bytes), httpMetadata: {contentType: o.type}}; },
    list: async ({prefix = ''} = {}) => ({objects: [...kept].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({key, customMetadata: o.meta})), truncated: false})};
};
