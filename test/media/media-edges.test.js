// Nothing is cut at a hero frame's left or right edge (round 9, owner 24 Oct 2026: "on mobile, the video is stripped ... I don't see the full video
// frame"): a line of words the view crosses is a cut, a card that would fit is shown whole, and the phone copy stops on one (media.mjs edgesOk).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cameraKeys} from '../../media/camera.mjs';
import {cutsIn, edgeCuts, edgeReport} from '../../media/edges.mjs';
import {cutsAt, wholeFrame} from '../../media/whole.mjs';

const view = {x: 100, y: 0, w: 400, h: 300};
const text = (x, w, words = 'words', y = 50) => ({k: 'text', x, y, w, h: 16, text: words});
const card = (x, w, name = '.card', y = 220) => ({k: 'card', x, y, w, h: 200, text: name});

test('a line of words crossing the left or right edge is a cut; one inside, outside or within the slack is not', () => {
  assert.deepEqual(cutsIn(view, [text(450, 100, 'Jobadabra’s AI tasks jus')]), [{k: 'text', side: 'right', text: 'Jobadabra’s AI tasks jus'}]);
  assert.deepEqual(cutsIn(view, [text(60, 100, 'Languages')]), [{k: 'text', side: 'left', text: 'Languages'}]);
  assert.deepEqual(cutsIn(view, [text(150, 200), text(520, 80), text(10, 80), text(115, 370)]), []);
  assert.deepEqual(cutsIn(view, [text(104, 200, 'touches')]).map(cut => cut.side), ['left'], 'a line 4 px from the edge touches it: not whole');
});

test('a card that would fit the widest view is shown whole, even when wider than this one; one wider than any view and anything above or below do not count', () => {
  assert.deepEqual(cutsIn(view, [card(300, 420, '.free')], 1600).map(cut => cut.text), ['.free'], 'the Free card: wider than this view, not than the widest');
  assert.deepEqual(cutsIn(view, [card(300, 300, '.step-card')]), [{k: 'card', side: 'right', text: '.step-card'}]);
  assert.deepEqual(cutsIn(view, [card(50, 600, '.page'), card(300, 300, '.below', 400), text(450, 100, 'under', -40)]), []);
});

// A phone copy (4:3) on a 1600x1000 page, one look: a card of 500 px at x 200 (zoom fits it whole), and words on its right outside the card.
const log = (edges, box = {x: 200, y: 200, width: 500, height: 200}) => ({viewport: {w: 1600, h: 1000}, frames: [{t: 0, file: 'a'}, {t: 3, file: 'b'}],
  events: [{t: 0.5, type: 'hold', look: '#a', phoneLook: '#a .head', box, phoneBox: box, s: 2, say: 'The CV', edges}]});

test('edgeCuts reads the view where the camera settles on each look: the look shown whole passes, a line it crosses is named', () => {
  assert.deepEqual(edgeCuts(log([card(200, 500), text(220, 300, 'words', 250)]), 1, {steady: true}), []);
  assert.deepEqual(edgeCuts(log([card(200, 500), text(560, 400, 'Languages', 250)]), 1, {steady: true}), [], 'the desktop camera frames it whole too');
  const recorded = log([card(200, 500), text(560, 400, 'Languages', 250)]);
  for (const event of recorded.events) event.edges = undefined;   // a camera that did not see the edges, checked against them
  const keys = cameraKeys({...recorded, speed: 1, steady: true});
  const hits = edgeCuts({...recorded, events: recorded.events.map(event => ({...event, edges: [card(200, 500), text(560, 400, 'Languages', 250)]}))}, 1, {steady: true, keys});
  assert.ok(keys.length);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].look, '#a');
  assert.deepEqual(hits[0].cuts.map(cut => cut.side), ['right']);
  assert.match(edgeReport('hero-onboarding', hits, 'desktop'), /hero-onboarding \(desktop\): look "#a" \("The CV"\) cuts text "Languages" at the right: frame a whole card/);
});

test('the phone camera frames the same look so that line is whole: its edges fall in gaps', () => {
  const phone = {aspect: 4 / 3}, recorded = log([card(200, 500), text(560, 400, 'Languages', 250)]);
  assert.deepEqual(edgeCuts(recorded, 1, {steady: true, phone}), []);
  const plain = cameraKeys({...log(undefined), steady: true, phone})[0], whole = cameraKeys({...recorded, steady: true, phone})[0];
  assert.ok(whole.z < plain.z, `zoomed out to show the line whole (${whole.z.toFixed(2)} < ${plain.z.toFixed(2)})`);
});

test('wholeFrame keeps the zoom and slides the view when a gap is in reach; zooms out a step at a time when none is', () => {
  const viewport = {w: 1600, h: 1000}, aspect = 4 / 3, look = {x: 600, y: 300, width: 300, height: 100};
  const frameAt = z => ({cx: look.x + look.width / 2, cy: 350, z});   // centred on the look
  // at zoom 4 the view is 400 px wide, 550..950; a line 900..1000 crosses its right edge, a gap is at 500..550 + the line moves out by sliding left
  const slid = wholeFrame({frameAt, z: 4, least: 1, look, edges: [text(905, 120, 'right', 340)], viewport, aspect});
  assert.equal(slid.z, 4);
  assert.ok(slid.cx < 750 && slid.cx - 200 <= look.x && slid.cx + 200 >= look.x + look.width, 'slid left, the look still in view');
  // a table: words every 150 px, no clean 400-px window near the look: it zooms out until both edges sit in gaps
  const table = Array.from({length: 11}, (_, i) => text(i * 150, 120, `col ${i}`, 340));   // 30-px gutters: room for the edge and its clearance
  const out = wholeFrame({frameAt, z: 4, least: 1, look, edges: table, viewport, aspect});
  const w = viewport.w / out.z, left = Math.min(Math.max(out.cx - w / 2, 0), viewport.w - w), top = 0, bottom = viewport.h;
  assert.ok(!cutsAt(left, 'left', table, top, bottom, 1600) && !cutsAt(left + w, 'right', table, top, bottom, 1600), 'no column cut');
});

// The class: whatever the layout, the phone copy's view at a look cuts no line of words and no card that would fit (owner: "I don't see the full frame").
test('on any app-like layout (columns, gutters, cards, words), the phone camera\'s view at each look cuts nothing', () => {
  let seed = 7, checked = 0;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 0; n < 40; n++) {
    // an app-like page: columns 120-260 px wide with 16-px gutters; cards span 1-3 columns, lines of words inside them
    const cols = [];
    for (let x = 0; x < 1600;) { const w = Math.min(1600 - x, 120 + rand() * 140); cols.push({x, w}); x += w + 16; }
    const edges = [];
    for (let i = 0; i < cols.length;) {
      const span = Math.min(cols.length - i, 1 + Math.floor(rand() * 3)), x = cols[i].x, w = cols[i + span - 1].x + cols[i + span - 1].w - x, y = rand() * 700;
      edges.push(card(x, w, '.c', y), ...Array.from({length: 3}, (_, k) => text(x + 8, (w - 16) * (0.4 + rand() * 0.6), 'w', y + 20 + k * 30)));
      i += span;
    }
    const box = {x: 200 + rand() * 900, y: 100 + rand() * 600, width: 120 + rand() * 300, height: 60 + rand() * 120};
    // a frame that cuts nothing over the page's whole height and holds the look exists (brute force): then the camera finds a clean one too
    const pad = 40, exists = Array.from({length: 117}, (_, k) => 400 + k * 8).some(w => {
      for (let left = Math.max(0, box.x + box.width + pad - w); left <= Math.min(1600 - w, box.x - pad); left += 2) if (!cutsAt(left, 'left', edges, 0, 1000, 1600 / 1.2) && !cutsAt(left + w, 'right', edges, 0, 1000, 1600 / 1.2)) return true;
      return false;
    });
    if (exists) { checked++; assert.deepEqual(edgeCuts(log(edges, box), 1.5, {steady: true, phone: {aspect: 4 / 3}}), [], `layout ${n}`); }
  }
  assert.ok(checked >= 20, `most layouts have a clean frame (${checked} of 40)`);
});

test('a recording from before round 9 (no edges) has nothing to check', () => {
  const old = log(undefined);
  delete old.events[0].edges;
  assert.deepEqual(edgeCuts(old, 1, {steady: true, phone: {aspect: 4 / 3}}), []);
});

test('both recorders note the edges at every look, and media.mjs checks each copy (a phone cut stops it) before drawing it', () => {
  for (const file of ['record-app.mjs', 'record-extension.mjs']) {
    const source = fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
    assert.match(source, /log\.add\(\{\.\.\.holdEvent\([^)]*\)[^\n]*edges: await page\.evaluate\(edgesScript\)/, file);
  }
  const media = fs.readFileSync(new URL('../../media/media.mjs', import.meta.url), 'utf8');
  assert.match(media, /edgesOk\(name, main\.log, piece\.speed \|\| 1, steady, null\);\n\s+if \(phone\) edgesOk\(name, \(narrow \|\| main\)\.log/, 'both copies of a clip');
  assert.match(media, /for \(const copy of \[null, \.\.\.\(phone \? \[phone\] : \[\]\)\]\) for \(const rec of recsOf\(copy\)\) edgesOk\(/, 'both copies of picture in picture');
  // owner, 25 Oct 2026 ("zoom deeper, about 1.5x"): only the phone copy's cut stops it; the desktop frame keeps 1.5x (camera.mjs DESKTOP_FLOOR) and logs what it cuts
  assert.match(media, /if \(process\.env\.HERO_EDGES !== 'warn' && phone\) throw new Error\(report\)/, 'a cut stops the phone copy');
});

// Round 9 (owner, 24 Oct 2026, of three options: "Narrow window"): a wide app page has lines up to 1500 px, so no phone frame of it is both whole and
// readable; the phone copy is its own take with the app in a narrow 4:3 window (one column), and its captions and poster come from that take.
test('every hero clip\'s phone copy is its own narrow-window take, with its own captions, poster and stray-frame check', async () => {
  const {VIDEOS} = await import('../../media/scenes.mjs');
  const phones = Object.entries(VIDEOS).filter(([, piece]) => typeof piece.phone === 'object');
  assert.ok(phones.length >= 4);
  for (const [name, piece] of phones) {
    const {width, height} = piece.phone.window || {};
    assert.ok(width && Math.abs(width / height - piece.phone.width / piece.phone.height) < 0.01, `${name}: a window of the phone copy's shape`);
    const css = width / (piece.phone.zoom || 0.8);   // the app's own zoom in an 880-px window is 0.8
    assert.ok(css <= 800, `${name}: the app lays out ${css} css px: one column narrow enough that the whole column is readable on a phone (Jobs at 1100 css: 4-px text)`);
  }
  const media = fs.readFileSync(new URL('../../media/media.mjs', import.meta.url), 'utf8');
  assert.match(media, /phoneShape\?\.window \? takeOf\(name, phoneTake\(piece, phoneShape\), persona, path\.join\(work, `\$\{name\}-phone`\)\)/, 'recordClip records the phone take');
  assert.match(media, /render\(narrow \|\| main, path\.join\(main\.dir, 'master-phone\.mp4'\)/, 'the phone master is drawn from it');
  assert.match(media, /const recsOf = phone => \[a, b\]\.map\(rec => \(\{\.\.\.\(phone \? rec\.phone : rec\)/, 'picture in picture composes the phone takes');
  assert.match(media, /if \(phone\) said = sayTrack\(frames/, 'the captions under the phone copy are timed on the phone take');
  assert.match(media, /strayIn\(files\.phone, phoneStarts/, 'the phone copy is checked for stray frames too');
  assert.match(fs.readFileSync(new URL('../../media/record-app.mjs', import.meta.url), 'utf8'), /\.\.\.\(piece\.window \? \{window: piece\.window\} : \{\}\)/);
  assert.match(fs.readFileSync(new URL('../../media/record-extension.mjs', import.meta.url), 'utf8'), /view = piece\.window \? \{width: Math\.round\(piece\.window\.width \/ z\)/);
});

test('the phone take frames each hold\'s phoneLook in the phone window; other steps and looks stay as they are', async () => {
  const {phoneTake} = await import('../../media/hold.mjs');
  const piece = {speed: 1.5, steps: [{go: 'jobs'}, {hold: 2, look: ['.job-row >> nth=0', '#her'], lookWidth: 862, phoneLook: '#her .role', phoneLookWidth: 300}, {hold: 1, look: '#card'}]};
  const take = phoneTake(piece, {window: {width: 880, height: 660}});
  assert.deepEqual(take.window, {width: 880, height: 660});
  assert.deepEqual(take.steps[0], {go: 'jobs'});
  assert.ok(take.steps.filter(step => step.hold).every(step => step.fitScroll), 'every phone hold may scroll its look into the short window');
  assert.equal(take.steps[1].look, '#her .role');
  assert.equal(take.steps[1].lookWidth, undefined, 'shown whole: no hand-picked left part in the one-column layout');
  assert.equal(take.steps[1].phoneLookWidth, undefined);
  assert.equal(take.steps[2].look, '#card');
  assert.equal(piece.steps[1].look[1], '#her', 'the desktop steps are not changed');
});

test('the phone take sets the app\'s text size; the extension\'s page shrinks by it; a piece\'s own settings stay', async () => {
  const {phoneTake} = await import('../../media/hold.mjs');
  const take = phoneTake({settings: {setupDone: false}, steps: []}, {window: {width: 880, height: 660}, zoom: 1.25});
  assert.deepEqual(take.settings, {setupDone: false, zoom: 1.25});
  assert.equal(take.zoom, 1.25);
  assert.equal(phoneTake({steps: []}, {window: {width: 880, height: 660}}).settings, undefined, 'no zoom: the app\'s own');
});

test('the page\'s own border cuts nothing: a frame of the whole window is whole', () => {
  const page = 704, side = [card(12, 48, '.nav.active', 100), text(2, 40, 'icon', 300)], right = [card(560, 144, '.stat', 100)];
  assert.deepEqual(cutsIn({x: 0, y: 0, w: page, h: 528}, [...side, ...right], page, page), []);
  assert.deepEqual(cutsIn({x: 4, y: 0, w: 600, h: 528}, [...side, ...right], page, page).map(cut => cut.text), ['.nav.active', 'icon', '.stat'], 'inside the page the same items are cut');
});

test('a look off the phone window is scrolled to its middle by both recorders, then measured again', async () => {
  const {centreDelta} = await import('../../media/hold.mjs');
  assert.equal(centreDelta({y: 400, height: 300}, {w: 704, h: 528}), 286, 'a look 43% below the window comes up to the middle');
  assert.equal(centreDelta({y: -200, height: 100}, {w: 704, h: 528}), -414);
  for (const file of ['record-app.mjs', 'record-extension.mjs']) {
    const source = fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
    assert.match(source, /if \(out > OFF_MAX && item\.fitScroll && await scrollLookIn\(page, item\.look, box, view, log\)\) \{/, file);
  }
});

test('a cut is what most of a hold shows (the camera glides in late or out early), and the camera keeps a margin over the check', async () => {
  const {MARGIN} = await import('../../media/whole.mjs');
  assert.ok(MARGIN >= 1);
  // a card ending 0.04 px past the edge: a cut for the check, and the camera, framing with MARGIN, treats one 1 px inside the same way
  assert.deepEqual(cutsIn({x: 207, y: 0, w: 818, h: 528}, [card(12, 199.04, '.current', 100)]).map(cut => cut.text), ['.current']);
  assert.ok(cutsAt(208, 'left', [card(12, 199, '.current', 100)], 0, 528, 2000, 2000, MARGIN), 'the camera avoids an edge within the margin');
  assert.ok(!cutsAt(208, 'left', [card(12, 199, '.current', 100)], 0, 528, 2000, 2000), 'that the check alone lets pass');
  // a camera that arrives late in the hold (picture in picture, run 20): the glide in crosses the sidebar, the rest of the hold is whole
  const late = {viewport: {w: 1800, h: 1125}, frames: [{t: 0, file: 'a'}, {t: 12, file: 'b'}],
    events: [{t: 8.1, type: 'hold', look: '#card', box: {x: 566, y: 360, width: 1184, height: 78}, s: 1.3, edges: [text(200, 100, 'Work', 300)]}]};
  const glide = [{t: 0, cx: 1009, cy: 560, z: 1.15}, {t: 8.4, cx: 1009, cy: 560, z: 1.15}, {t: 8.5, cx: 900, cy: 562, z: 1}];
  assert.deepEqual(edgeCuts(late, 1.5, {steady: true, keys: glide}), [], 'a passing edge is not a cut');
  const rows = {...late, events: [{...late.events[0], edges: Array.from({length: 12}, (_, i) => text(200, 100, 'Work', 300 + i * 20))}]};
  assert.deepEqual(edgeCuts(rows, 1.5, {steady: true, keys: glide}), [], 'twelve lines crossed in one moment of the glide are still one moment');
  assert.equal(edgeCuts(late, 1.5, {steady: true, keys: [{t: 0, cx: 1009, cy: 560, z: 1.15}]}).length, 1, 'held all along: a cut');
});

test('a click whose middle lands on another control inside its target stops the take and names that control', async () => {
  const {clickedControl} = await import('../../media/hold.mjs');
  const control = {tagName: 'BUTTON', classList: ['iv-confidence'], closest: () => control};
  const head = {getBoundingClientRect: () => ({x: 0, y: 0, width: 100, height: 40}), contains: () => true};
  globalThis.document = {elementFromPoint: () => control};
  try {
    assert.equal(clickedControl(head), 'button.iv-confidence');
    globalThis.document = {elementFromPoint: () => ({closest: () => null})};
    assert.equal(clickedControl(head), null, 'plain text under the middle: the click reaches the target');
    const button = {getBoundingClientRect: () => ({x: 0, y: 0, width: 40, height: 40}), contains: () => true};
    globalThis.document = {elementFromPoint: () => ({closest: () => button})};
    assert.equal(clickedControl(button), null, 'the target is the control itself (its icon under the middle)');
  } finally { delete globalThis.document; }
  assert.match(fs.readFileSync(new URL('../../media/record-app.mjs', import.meta.url), 'utf8'), /const under = await target\.evaluate\(clickedControl\)/);
});

test('the edges script notes only the part of a line its boxes let show: a sideways ticker\'s hidden start is not words on screen (run 28)', async () => {
  const vm = await import('node:vm');
  const {edgesScript} = await import('../../media/edges.mjs');
  const rect = (left, top, width, height) => ({left, top, right: left + width, bottom: top + height, x: left, y: top, width, height});
  const el = (parent, box, style = {}) => ({parentElement: parent, getBoundingClientRect: () => box, style: {overflowX: 'visible', overflowY: 'visible', visibility: 'visible', opacity: '1', borderLeftWidth: '0', ...style}, checkVisibility: () => true});
  const body = el(null, rect(0, 0, 1800, 1125)), page = el(body, rect(230, 0, 1570, 1125));
  const strip = el(page, rect(240, 80, 760, 30), {overflowX: 'hidden', overflowY: 'hidden'});   // the tip strip: its text scrolled left
  const text = (parent, words, box) => ({textContent: words, parentElement: parent, rects: [box]});
  const nodes = [text(strip, 'Review an interview within a day', rect(14, 88, 574, 15)), text(strip, 'Gone off the left', rect(-300, 88, 200, 15)),
    text(page, 'Interviews', rect(250, 20, 120, 24))];
  let current;
  const document = {body, documentElement: null, createRange: () => ({selectNodeContents: node => { current = node; }, getClientRects: () => current.rects}),
    createTreeWalker: () => { let i = -1; return {nextNode: () => nodes[++i] || null}; }};
  document.body.querySelectorAll = () => [];
  const out = vm.runInNewContext(`(${edgesScript.toString()})()`, {innerWidth: 1800, innerHeight: 1125, document, NodeFilter: {SHOW_TEXT: 4}, getComputedStyle: e => e.style});
  assert.deepEqual(JSON.parse(JSON.stringify(out)).map(item => [item.text.slice(0, 12), Math.round(item.x), Math.round(item.w)]), [['Review an in', 240, 348], ['Interviews', 250, 120]],
    'the ticker from the strip\'s left edge on; the line scrolled out of the strip is gone');
});

