// Demo data for /admin/bug-bundle/0123456789abcdef (tools/page-shot.mjs): one made-up bug of a made-up app with a made-up applicant, never a real person's data.
export const bugBundle = async ({env}) => {   // 7 Nov 2026, fb 2/5: the page of one AI tester bug, with the app picture, the logs, the state and the versions
  const fs = await import('node:fs'), kept = new Map(), put = (key, bytes, type) => kept.set(key, {bytes: new Uint8Array(bytes), type});
  const id = '0123456789abcdef', text = value => new TextEncoder().encode(value);
  put(`bundle/${id}/report.json`, text(JSON.stringify({source: 'persona', journey: 'J12', severity: 'high', title: 'Saved phone reads as its field label', at: '2026-11-07T04:43:12Z',
    expected: 'profile-4: a saved answer is what the person typed.', seen: 'After Save the Phone field reads "Phone number".', steps: ['Open Profile', 'Press "Edit your details"', 'Type "+41 79 000 00 00" into Phone', 'Press "Save"']})), 'application/json');
  put(`bundle/${id}/app.jpg`, fs.readFileSync('desktop/docs/ui/actions.jpg'), 'image/jpeg');
  for (const name of ['logs.txt', 'state.json', 'env.json']) put(`bundle/${id}/${name}`, text('demo'), 'text/plain');
  env.LAB_FILLS = {head: async key => (kept.has(key) ? {size: kept.get(key).bytes.length} : null), get: async key => { const o = kept.get(key); return o ? {body: o.bytes, text: async () => new TextDecoder().decode(o.bytes)} : null; }, list: async () => ({objects: [], truncated: false})};
};
