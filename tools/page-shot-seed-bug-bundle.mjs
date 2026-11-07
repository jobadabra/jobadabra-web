// Demo data for /admin/bug-bundle/0123456789abcdef and the list /admin/testing/bug-bundles (tools/page-shot.mjs): one made-up bug of a made-up app with a made-up applicant, never a real person's data.
export const bugBundle = async ({env}) => {   // 7 Nov 2026, fb 2/5: the page of one AI tester bug, with the app picture, the logs, the state and the versions
  const fs = await import('node:fs'), kept = new Map(), put = (key, bytes, type) => kept.set(key, {bytes: new Uint8Array(bytes), type});
  const id = '0123456789abcdef', text = value => new TextEncoder().encode(value);
  put(`bundle/${id}/report.json`, text(JSON.stringify({source: 'persona', journey: 'J12', severity: 'high', title: 'Saved phone reads as its field label', at: '2026-11-07T04:43:12Z',
    expected: 'profile-4: a saved answer is what the person typed.', seen: 'After Save the Phone field reads "Phone number".', steps: ['Open Profile', 'Press "Edit your details"', 'Type "+41 79 000 00 00" into Phone', 'Press "Save"']})), 'application/json');
  put(`bundle/${id}/app.jpg`, fs.readFileSync('desktop/docs/ui/actions.jpg'), 'image/jpeg');
  const others = [['1111111111111111', 'persona', 'medium', 'J04', 'Strategy keeps an old city after Save', 'The old city is still listed after Save.', '2026-11-07T04:51:40Z'],
    ['2222222222222222', 'desktop-tester', 'high', 'J09', 'Ready to send shows a job twice', 'The same job is under Ready and Needs you.', '2026-11-06T16:20:05Z'],
    ['3333333333333333', 'persona', 'low', 'none', 'Count line is cut on a narrow window', 'The "3 of 40" line wraps under the button.', '2026-11-05T04:44:02Z']];
  for (const [other, source, severity, journey, title, seen, at] of others) put(`bundle/${other}/report.json`, text(JSON.stringify({source, journey, severity, title, at, expected: 'it reads as designed', seen, steps: []})), 'application/json');
  for (const name of ['logs.txt', 'state.json', 'env.json']) put(`bundle/${id}/${name}`, text('demo'), 'text/plain');
  env.LAB_FILLS = {head: async key => (kept.has(key) ? {size: kept.get(key).bytes.length} : null), get: async key => { const o = kept.get(key); return o ? {body: o.bytes, text: async () => new TextDecoder().decode(o.bytes)} : null; }, list: async ({prefix = ''} = {}) => ({objects: [...kept.keys()].filter(key => key.startsWith(prefix)).map(key => ({key, uploaded: new Date((key.includes('report.json') ? JSON.parse(new TextDecoder().decode(kept.get(key).bytes)).at : null) || 0)})), truncated: false})};
};
