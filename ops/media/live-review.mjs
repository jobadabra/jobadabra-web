// The form states a `review` step sends the app (media): one more field filled each time, as the extension reports a fill (extension/review.js),
// the last one Ready to submit. record-app.mjs sends each over the app's own 'review' message; the Applying page's form card follows. Pure.
// Guarded by desktop/test/media-live-review.test.js.

// {id, url, fields: [label...], every?} -> [{id, url, left, total, ready, filled: [{label, at}], missing, pending, states, proposals, optional}]
export function liveStates({id, url = '', fields, start = 0, every = 300}) {
  if (!id || !fields?.length) throw new Error('media: a review step names its session id and the fields it fills (scenes.mjs)');
  const total = fields.length;
  return fields.map((_, i) => {
    const filled = fields.slice(0, i + 1).map((label, j) => ({label, at: start + j * every}));
    const left = fields.slice(i + 1);
    return {id, url, left: left.length, total, ready: !left.length, filled, missing: left, pending: left, states: {}, proposals: [], optional: []};
  });
}

// The extension's own reports of one fill (record-extension.mjs keeps every '/extension/review' it sent, stamped on its recording's clock), replayed
// on the app's card from the fill's start (`sync`, the first field filled): the card counts exactly what the panel counts, the field left for the person
// included (12 Nov 2026: the extension leaves the consent box to you, so a hand-written list said 6 of 6 while the panel said 6 of 7, 1 left).
// {id, url, reports, sync} -> [{at, state}]: seconds after the step starts, each report as the card's state with the demo session's id and url. Pure.
export function fromReports({id, url = '', reports, sync = 0}) {
  if (!id || !reports?.length) throw new Error('media: replayed reports need the session id and at least one report');
  const later = reports.filter(report => report.t >= sync), before = reports.filter(report => report.t < sync).at(-1);
  return [...(before ? [{...before, t: sync}] : []), ...later].map(report => {
    const {t, tab, boot, job, session, ...state} = report;
    return {at: Number((t - sync).toFixed(3)), state: {...state, id, url}};
  });
}
