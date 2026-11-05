// Every screen change in the hero comes in by a transition chosen for what it means (round 6, owner 24 Oct 2026: "make a nice transition effect,
// not just an instant screen/image replacement ... use most of them: fade, slide, tiles, title card, whenever it fits better"): each cut look,
// part join and clip switch names one, and each kind is drawn, joined and checked. Loops over the scenes, so a new look or clip is held to it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {renderPlan} from '../../media/camera.mjs';
import {strayFrames, THUMB} from '../../media/cuts.mjs';
import {holdEvent} from '../../media/hold.mjs';
import {VIDEOS} from '../../media/scenes.mjs';
import {CARD, CARD_TEXT_MAX, joinFilter, KINDS, LENGTH, openOnCard, transitions, withCards} from '../../media/transitions.mjs';

const steady = Object.entries(VIDEOS).filter(([, piece]) => piece.camera === 'steady');

test('every cut look after a clip\'s first names its transition; a card says its words and where', () => {
  for (const [name, piece] of steady) {
    const looks = piece.steps.filter(step => step.hold && step.look);
    looks.slice(1).filter(step => step.cut).forEach(step => {
      assert.ok(KINDS.includes(step.into), `${name}: cut look ${JSON.stringify(step.look)} names its transition (into: ${KINDS.join('|')})`);
      if (step.into === 'card') {
        assert.ok(step.card && step.card.length <= CARD_TEXT_MAX, `${name}: the card into ${JSON.stringify(step.look)} has words (≤ ${CARD_TEXT_MAX})`);
        assert.ok(step.tag, `${name}: the card into ${JSON.stringify(step.look)} names the place (tag)`);
      }
    });
  }
});

test('the scenes use the kinds by meaning, not one everywhere', () => {
  const used = new Set(steady.flatMap(([, piece]) => [piece.into, piece.stageInto, ...piece.steps.map(step => step.into)]).filter(Boolean));
  for (const kind of KINDS) assert.ok(used.has(kind), `no change comes in by ${kind}`);
});

test('every part join and every clip switch on the site names its transition, and the page plays it', () => {
  const html = fs.readFileSync(new URL('../../web/public/index.html', import.meta.url), 'utf8');
  for (const [name, piece] of Object.entries(VIDEOS)) {
    for (const part of [piece.before, piece.after].filter(Boolean)) {
      const joinedIn = part === piece.before ? piece : VIDEOS[part];   // the part after the first comes in by its own into
      assert.ok(KINDS.includes(joinedIn.into), `${name}: the join into ${part === piece.before ? name : part} names its transition`);
      if (joinedIn.into === 'card') assert.ok(joinedIn.card?.length <= CARD_TEXT_MAX, `${name}: its join card has words`);
    }
    if (!piece.slide) continue;
    assert.ok(['fade', 'slide', 'tiles'].includes(piece.stageInto), `${name}: the site's switch into it names fade, slide or tiles (stageInto)`);
    assert.match(html, new RegExp(`data-into="${piece.stageInto}" poster="/media/${name}-poster.jpg"`), `index.html plays ${name} in by ${piece.stageInto}`);
  }
});

test('a look\'s log entry carries its transition, and a card part opens on its card', () => {
  const event = holdEvent({hold: 2, look: '#x', cut: true, into: 'card', card: 'She opens the app', tag: 'Actions'}, {x: 0, y: 0, width: 10, height: 10});
  assert.equal(event.into, 'card');
  assert.deepEqual(event.card, {tag: 'Actions', text: 'She opens the app'});
  const opened = openOnCard({into: 'card', card: 'In her browser', steps: [{fill: true}, {hold: 1, look: '#a', tag: 'Chrome'}, {hold: 2, look: '#b'}]});
  assert.deepEqual([opened.steps[1].into, opened.steps[1].card, opened.steps[2].into], ['card', 'In her browser', undefined]);
});

// A clip with one cut look of each kind, 10 frames a second: page n shows from its cut.
const viewport = {w: 1800, h: 1125};
const box = n => ({x: 100 + n * 50, y: 100, width: 600, height: 300});
const clip = () => {
  const events = [{t: 0, type: 'hold', box: box(0), s: 1.5, look: 'a'}];
  const kinds = ['fade', 'slide', 'tiles', 'card'];
  kinds.forEach((kind, k) => {
    const at = 2 + k * 2;
    events.push({t: at, type: 'mark'}, {t: at + 0.1, type: 'hold', box: box(k + 1), s: 1.5, look: kind, cut: true, into: kind, ...(kind === 'card' ? {card: {tag: 'Here', text: 'How she got here'}} : {})});
  });
  const frames = Array.from({length: 100}, (_, i) => ({t: i / 10, file: `f${i}.jpg`}));
  return {viewport, frames, events};
};

test('each kind is drawn over the frames it covers, from the old screen to the new; a card adds its time', () => {
  const raw = clip(), log = withCards(raw), list = transitions(log);
  assert.deepEqual(list.map(item => item.kind), ['fade', 'slide', 'tiles', 'card']);
  assert.ok(Math.abs(log.frames.at(-1).t - raw.frames.at(-1).t - CARD.hold) < 1e-6, 'the card adds its hold to the clip');
  const plan = renderPlan(log, 30, 1, {steady: true});
  plan.forEach((frame, i) => {
    const t = i / 30, on = list.find(item => t >= item.from && t < item.to);
    if (!on) return assert.ok(!frame.from && !frame.card, `frame ${i} (${t.toFixed(2)} s) is outside every transition`);
    if (on.kind === 'card') return assert.ok(frame.card && frame.cardAlpha >= 0 && frame.cardAlpha <= 1, `frame ${i}: the card`);
    assert.equal(frame.kind, on.kind, `frame ${i}: ${on.kind}`);
    assert.ok(frame.from.file !== frame.file || t < on.at + 0.1, `frame ${i}: the old screen under the new one`);
    assert.ok(frame.mix >= 0 && frame.mix <= 1);
  });
  for (const item of list.filter(x => x.kind !== 'card')) {
    const span = plan.filter((_, i) => i / 30 >= item.from && i / 30 < item.to);
    assert.ok(Math.abs(span.length / 30 - LENGTH[item.kind]) < 0.05, `${item.kind} lasts ${LENGTH[item.kind]} s`);
    assert.ok(span[0].mix < 0.1 && span.at(-1).mix > 0.9, `${item.kind} goes from the old screen to the new`);
  }
  const card = list.find(item => item.kind === 'card'), opaque = plan.filter((frame, i) => frame.cardAlpha === 1 && i / 30 >= card.at);
  assert.ok(opaque.length >= Math.floor(CARD.hold * 30) - 1, 'the card stays fully on for its hold');
  // owner, 25 Oct 2026 (Track): the next part's caption showed over the Gmail one; a caption is gone before its card is half in, and every frame says so
  for (const frame of plan.filter(each => each.card)) assert.equal(frame.sayKeep, Math.max(0, 1 - 2 * frame.cardAlpha), 'a caption gives way to the card');
  assert.ok(plan.some(frame => frame.card && frame.sayKeep === 0), 'a caption is fully hidden while the card shows');
});

test('parts are joined by their kinds, each over the held last frame of the one before (no part loses time)', () => {
  const {filter, out} = joinFilter([4, 6, 3], ['card', 'slide'], 1.5);
  assert.equal((filter.match(/xfade=/g) || []).length, 2);
  assert.match(filter, /xfade=transition=fade:duration=0\.45:offset=4\.000/, 'a card part comes in by a fade into its card');
  assert.match(filter, /xfade=transition=smoothleft:duration=0\.75:offset=10\.000/, 'a slide at the second join, after both parts');
  assert.match(filter, /tpad=stop_mode=clone:stop_duration=0\.45/);
  assert.equal(out, '[j2]');
});

test('the stray-frame gate skips a transition\'s mixed frames, and still catches an old frame after it', () => {
  const size = THUMB.w * THUMB.h, page = level => new Uint8Array(size).fill(level), look = {x: 100, y: 100, width: 600, height: 300};
  const log = {viewport, frames: [], events: [{t: 0, type: 'hold', box: look, s: 1.5, look: 'a'}, {t: 1.6, type: 'mark'}, {t: 1.6, type: 'hold', box: look, cut: true, into: 'fade', s: 1.5, look: 'b'}]};
  const windows = transitions(log);
  const frames = Array.from({length: 96}, (_, j) => (j / 30 < 1.6 ? page(40) : j / 30 < 1.6 + LENGTH.fade ? page(65) : page(90)));
  assert.notDeepEqual(strayFrames({log, thumb: j => frames[j], frames: frames.length}), [], 'without the window the mixed frames read as another page');
  assert.deepEqual(strayFrames({log, thumb: j => frames[j], frames: frames.length, windows}), [], 'a fade passes');
  frames[66] = page(40);   // 2.2 s: the old page after the fade ended
  assert.equal(strayFrames({log, thumb: j => frames[j], frames: frames.length, windows})[0]?.side, 'after');
});
