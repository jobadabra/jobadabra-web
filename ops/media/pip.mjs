// Picture in picture, swapped when the lead changes (media; owner, 24 Oct 2026: "I'd like picture in picture, but swapping them at some point":
// Apply = Jobadabra's Applying card main with Chrome in the inset, then Chrome main while it fills with the card in the inset, ticking, then the card
// main again at Ready to submit). Two recordings of the same moment, synced on their `sync` steps; a step marked `lead` makes its recording the main
// picture from then on. The new main grows out of the inset; the old one then settles into the inset's corner. What render.cjs draws (`layers`). Pure.
// Guard: desktop/test/media-pip.test.js.
import {captionAt, captionTimes} from './captions.mjs';
import {ease, renderPlan} from './camera.mjs';

export const PIP = {inset: 0.34, phoneInset: 0.46, margin: 0.025, swap: 0.6, settle: 0.45};   // shares of the width; output seconds

// The recorded time of a log's sync step, and its leads ([t]: holds marked lead, or lead marks). Pure.
export const syncTime = log => {
  const sync = log.events.find(event => event.type === 'sync');
  if (!sync) throw new Error('media: a picture-in-picture recording has no sync step (scenes.mjs `sync: true`)');
  return sync.t;
};
export const leadTimes = log => log.events.filter(event => event.lead || event.type === 'lead').map(event => event.t);

// Seconds the recording's fill took: its sync to the panel's done state ('filled'), else to its next mark or hold. null without a sync. Pure.
export const fillSeconds = log => {
  const i = log.events.findIndex(event => event.type === 'sync');
  if (i < 0) return null;
  const later = log.events.slice(i + 1), done = later.find(event => event.type === 'filled') || later.find(event => event.type === 'mark' || event.type === 'hold');
  return done ? Number((done.t - log.events[i].t).toFixed(2)) : null;
};

// The inset's place and size in output px: the top right corner, `share` of the width, the output's shape.
export const insetRect = (width, height, share) => {
  const w = Math.round(width * share), h = Math.round(w * height / width), m = Math.round(width * PIP.margin);
  return {x: width - w - m, y: m, w, h};
};
const lerp = (a, b, u) => ({x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w: a.w + (b.w - a.w) * u, h: a.h + (b.h - a.h) * u});

// The composite's frames. a, b: {name, log, dir, scale} (b's time is the composite's clock; a runs `offset` = a.sync - b.sync later). -> {frames, from,
// seconds, at}: frames for render.cjs ({layers: [{dir, scale, file, x, y, w, h, rect, alpha, framed}], say, sayAge, tag, cursor: false}); `from`: the
// composite time of frame 0 on b's clock; at(name, t): the composite time of that recording's time t. Recorded seconds throughout (encode.mjs speeds it up).
export function pipPlan({a, b, width, height, fps = 30, speed = 1, phone = null}) {
  const offset = syncTime(a.log) - syncTime(b.log);
  const clock = {[a.name]: t => t + offset, [b.name]: t => t};
  const plans = Object.fromEntries([a, b].map(rec => [rec.name, renderPlan(rec.log, fps, speed, {steady: true, phone})]));
  const captions = Object.fromEntries([a, b].map(rec => [rec.name, captionTimes(rec.log)]));
  // who leads when, on b's clock; before the first lead, the first one to lead
  const marks = [a, b].flatMap(rec => leadTimes(rec.log).map(t => ({t: t - (rec === a ? offset : 0), name: rec.name}))).sort((x, y) => x.t - y.t);
  const leads = marks.filter((lead, k) => !k || lead.name !== marks[k - 1].name);   // only the changes of lead
  if (!leads.length) throw new Error('media: a picture-in-picture piece names no lead (scenes.mjs `lead: true`)');
  const start = Math.min(0, -offset), end = Math.max(b.log.frames.at(-1).t, a.log.frames.at(-1).t - offset);
  const full = {x: 0, y: 0, w: width, h: height}, inset = insetRect(width, height, phone ? PIP.phoneInset : PIP.inset);
  const swap = PIP.swap * speed, settle = PIP.settle * speed, dirs = {[a.name]: a.dir, [b.name]: b.dir}, scales = {[a.name]: a.scale, [b.name]: b.scale};
  const view = (name, t) => {   // that recording's frame and camera at composite time t (held at its first and last frame outside it)
    const plan = plans[name], i = Math.max(0, Math.min(plan.length - 1, Math.round(clock[name](t) * fps)));
    const {file, x, y, w, h} = plan[i];
    return {dir: dirs[name], scale: scales[name], file, x, y, w, h};
  };
  const frames = [];
  for (let i = 0; i <= Math.floor((end - start) * fps); i++) {
    const t = start + i / fps;
    const now = leads.filter(lead => lead.t <= t).at(-1) || leads[0];
    const main = now.name, other = main === a.name ? b.name : a.name, since = t - now.t;
    const changing = now !== leads[0] && since < swap + settle;   // the lead just moved to `main`
    const layers = [];
    if (!changing) layers.push({...view(main, t), rect: full, alpha: 1}, {...view(other, t), rect: inset, alpha: 1, framed: true});
    else {
      const grow = ease(since / swap), place = ease((since - swap * 0.55) / settle);
      layers.push({...view(other, t), rect: full, alpha: 1});   // the old main, still full behind
      layers.push({...view(main, t), rect: lerp(inset, full, grow), alpha: 1, framed: grow < 1});   // the new main grows out of the inset
      if (place > 0) {   // the old main settles into the corner: from a little larger, fading in
        const k = 1.12 - 0.12 * place, w = inset.w * k, h = inset.h * k;
        layers.push({...view(other, t), rect: {x: inset.x + inset.w - w, y: inset.y, w, h}, alpha: place, framed: true});
      }
    }
    // the caption is the main picture's, its age counted from when it took the lead (a caption never pops in mid-way)
    const said = captionAt(captions[main], clock[main](t));
    if (said.say) said.sayAge = Math.min(said.sayAge, since);
    frames.push({layers, cursor: false, cx: 0, cy: 0, x: 0, y: 0, w: 1, h: 1, ...said});
  }
  // at(name, t): composite time (from frame 0) of that recording's time t
  return {frames, from: start, seconds: end - start, at: (name, t) => t - (name === a.name ? offset : 0) - start};
}


// Side by side (the split of /how-it-works, scenes.mjs `layout: 'split'`): the two panes in output px, b (the piece) left and a (its part) right,
// each in the recordings' own shape (`aspect`, so each pane shows its recording's desktop camera unchanged), as wide as the margins leave, low in
// the frame; the labels sit in the band above them. Pure. -> {left, right, labelY}
export const SPLIT = {margin: 0.017, label: 0.012};   // shares of the width: the gaps, and the label's lift above its pane
export const splitRects = (width, height, aspect) => {
  const m = Math.round(width * SPLIT.margin), w = Math.floor((width - 3 * m) / 2), h = Math.round(w / aspect), y = height - m - h;
  if (y < m * 2) throw new Error(`media: a split of ${width} x ${height} has no room for its labels over two ${w} x ${h} panes: make it taller`);
  return {left: {x: m, y, w, h}, right: {x: 2 * m + w, y, w, h}, labelY: Math.round(y - width * SPLIT.label)};
};

// The split's frames: both recordings on b's clock (as pipPlan), each through its own camera in its pane for the whole clip; the pane whose
// recording leads (its `lead` marks) is edged amber, the other dimly; `labels` (1 left, 2 right) are drawn above the panes. No captions: the labels
// say who is who. -> {frames, from, seconds, at} as pipPlan. Pure.
export function splitPlan({a, b, width, height, fps = 30, speed = 1, labels = []}) {
  const offset = syncTime(a.log) - syncTime(b.log);
  const clock = {[a.name]: t => t + offset, [b.name]: t => t};
  const plans = Object.fromEntries([a, b].map(rec => [rec.name, renderPlan(rec.log, fps, speed, {steady: true})]));
  const marks = [a, b].flatMap(rec => leadTimes(rec.log).map(t => ({t: t - (rec === a ? offset : 0), name: rec.name}))).sort((x, y) => x.t - y.t);
  const start = Math.min(0, -offset), end = Math.max(b.log.frames.at(-1).t, a.log.frames.at(-1).t - offset);
  const aspect = b.log.viewport.w / b.log.viewport.h, rects = splitRects(width, height, aspect), pane = {[b.name]: rects.left, [a.name]: rects.right};
  const recs = {[a.name]: a, [b.name]: b};
  const view = (name, t) => {
    const plan = plans[name], i = Math.max(0, Math.min(plan.length - 1, Math.round(clock[name](t) * fps)));
    const {file, x, y, w, h} = plan[i];
    return {dir: recs[name].dir, scale: recs[name].scale, file, x, y, w, h};
  };
  const named = labels.map((text, i) => ({text, num: String(i + 1), x: (i ? rects.right : rects.left).x, y: rects.labelY}));
  const frames = [];
  for (let i = 0; i <= Math.floor((end - start) * fps); i++) {
    const t = start + i / fps, lead = (marks.filter(mark => mark.t <= t).at(-1) || marks[0])?.name;
    const layers = [b.name, a.name].map(name => ({...view(name, t), rect: pane[name], alpha: 1, framed: true, dim: name !== lead}));
    frames.push({layers, labels: named, cursor: false, cx: 0, cy: 0, x: 0, y: 0, w: 1, h: 1});
  }
  return {frames, from: start, seconds: end - start, at: (name, t) => t - (name === a.name ? offset : 0) - start};
}
