/* global document, localStorage, innerWidth, innerHeight, devicePixelRatio, getComputedStyle */
// Records the desktop app for the product media (media): demo mode on a temp copy of a persona folder, dark, a hidden window,
// never the owner's app, data folder or Keychain. Videos: a CDP screencast (works on a hidden window) + a click log for the renderer.
// Stills and close-ups: screenshots after the steps. Run by media.mjs; the steps come from scenes.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {clipTo} from './camera.mjs';
import {startScreencast, stepLog} from './screencast.mjs';
import {nav} from './scenes.mjs';
import {personaCopy} from './persona-copy.mjs';
import {clickedControl, clickZoom, glideTo, magicTarget, GAP_FLOOR, gapWidth, holdEvent, holdLeft, nextCut, OFF_MAX, offScreen, PRESS_SHOW, scrollLookIn, SHOW_WAIT, stepMarks, wordsCut} from './hold.mjs';
import {fromReports, liveStates} from './live-review.mjs';
import {edgesScript} from './edges.mjs';
import {freePort} from '../desktop/e2e/lib/extension.mjs';

const desktop = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'desktop');
const {_electron: electron} = createRequire(path.join(desktop, 'e2e', 'package.json'))('playwright-core');
export const WINDOW = {width: 1440, height: 900};   // 16:10, the site's hero shape; the app's own zoom lays it out wider, Retina capture is 2x

// The app on a temp copy of the persona (persona-copy.mjs); demo mode reads its data from there too (JOBADABRA_DEMO_DIR, lib/demo.js).
// Apps start one at a time and a failed start is tried once more (run 22: two takes started at once, one app "failed to launch!" and Playwright
// threw it outside any await, killing the run); the recordings themselves still overlap (media.mjs recordQueue).
let starting = Promise.resolve();
function startApp(options) {
  const start = async () => {
    try { return await electron.launch(options); } catch (error) {
      console.log(`media: the app failed to start (${error.message.split('\n')[0]}): starting it again`);
      return electron.launch(options);
    }
  };
  const mine = starting.then(start);
  starting = mine.catch(() => {});
  return mine;
}

export async function launchApp({persona = {folder: path.join(desktop, 'demo')}, settings = null, moment = null, env = {}, window = WINDOW} = {}) {
  const data = personaCopy(persona, {demo: path.join(desktop, 'demo'), moment});
  if (settings) {   // a piece may start the app in another state (the first-run wizard: setupDone false), on the temp copy only
    const file = path.join(data, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), ...settings}, null, 1));
  }
  const app = await startApp({
    executablePath: path.join(desktop, 'node_modules', '.bin', 'electron'),   // a Mac (here or the CI runner): the site shows the Mac app
    // round 9 (owner, 24 Oct 2026: "low resolution"): frames 2.5x the window (3600 px, screencast.mjs's cap) instead of the Retina 2x, so a zoomed
    // look still has a pixel for each of the 1080-wide phone copy's
    args: ['--force-device-scale-factor=2.5', desktop],
    env: {...process.env, ...env, JOBADABRA_DEMO: '1', JOBADABRA_USER_DATA: data, JOBADABRA_CONFIG_DIR: data, JOBADABRA_DATA_DIR: data, JOBADABRA_DEMO_DIR: data,
      JOBADABRA_THEME: 'dark', JOBADABRA_E2E: '1', JOBADABRA_E2E_HIDDEN: '1', JOBADABRA_NO_DOTENV: '1', TZ: persona.tz || 'Europe/Zurich',
      // its own port, never 47111 (round 9): the owner's live app and its extension talk on that one, and two takes recorded at once would share it
      JOBADABRA_PORT: String(await freePort())},
    timeout: 240000,   // a busy Mac (load 60+, 21 Oct 2026) took over 90 s to start the window
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), window);
  await page.emulateMedia({colorScheme: 'dark'});   // Playwright emulates light unless told; the app's own default is dark
  await page.evaluate(() => localStorage.setItem('jp.menu.tour', 'done'));   // the first-run tour bubble would cover every screen
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  const close = async () => { await app.close().catch(() => {}); fs.rmSync(data, {recursive: true, force: true}); };
  return {app, page, data, close};
}

// The box a look frames: one selector, or several (their union: the form and the extension's panel together). -> null when none is on screen.
export function unionBox(boxes) {
  const found = boxes.filter(Boolean);
  if (!found.length) return null;
  const x = Math.min(...found.map(b => b.x)), y = Math.min(...found.map(b => b.y));
  return {x, y, width: Math.max(...found.map(b => b.x + b.width)) - x, height: Math.max(...found.map(b => b.y + b.height)) - y};
}
const lookBox = async (page, look) => unionBox(await Promise.all([look].flat().map(selector => page.locator(selector).first().boundingBox())));
// A look's text, one box per laid-out line (text nodes' client rects), for the lookWidth check (hold.mjs wordsCut).
const linesOf = async (page, look) => (await Promise.all([look].flat().map(selector => page.locator(selector).first().evaluate(root => {
  const range = document.createRange(), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), lines = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || !node.parentElement?.checkVisibility?.()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.width && r.height) lines.push({x: r.x, y: r.y, width: r.width, height: r.height, text: node.textContent.trim().slice(0, 30)});
  }
  return lines;
}).catch(() => [])))).flat();
// A look whose lookWidth edge cuts through a line of its words is narrowed to the gap before it (hold.mjs gapWidth); only a gap under GAP_FLOOR of the
// asked width stops the recording (round 4: the centred Find jobs card's description crossed it). -> the width to use.
async function checkWords(page, look, box, width, which) {
  if (!width || !box) return width;
  const lines = await linesOf(page, look), edge = box.x + Math.min(box.width, width), fitted = gapWidth(box, width, lines);
  if (fitted === width) return width;
  const crossing = [...new Set(lines.filter(line => line.x < edge - 1 && line.x + line.width > edge + 4).map(line => JSON.stringify(line.text)))].slice(0, 4).join(', ');
  if (fitted) { console.log(`media: ${which} "${[look].flat().join(', ')}" left part ${width} -> ${fitted} px: its edge cut ${crossing}`); return fitted; }
  throw new Error(`media: ${which} "${[look].flat().join(', ')}" keeps its left ${width} px but that edge cuts ${wordsCut(box, width, lines)} px off a line of words (${crossing}), and no gap is left within ${Math.round(GAP_FLOOR * 100)}%: name the part that holds the words (scenes.mjs)`);
}
// A press stays on screen PRESS_SHOW output seconds before what it does (hold.mjs); stills (no speed) don't wait.
const pressShow = log => (log.speed ? PRESS_SHOW * log.speed * 1000 : 0);

export {holdEvent, holdLeft};

// Waits `ms` (with rest=false: only until the look shows, at most ms); meanwhile logs 'ready' the moment the next cut look (log.next, hold.mjs nextCut)
// is on screen: cuts.mjs drops the frames between the page change and it.
const onScreen = async (page, look) => (await Promise.all([look].flat().map(selector => page.locator(selector).first().isVisible().catch(() => false)))).every(Boolean);
async function watch(page, ms, log, rest = true) {
  const end = Date.now() + ms;
  while (log.next && !log.next.ready && Date.now() < end) {
    // in the page is not yet painted (round 3: the calendar was in the page 19 ms after the click, its first frame came ~1 s later): two repaints first
    if (await onScreen(page, log.next.look)) { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))).catch(() => {}); log.add({type: 'ready'}); log.next.ready = true; break; }
    await page.waitForTimeout(60);
  }
  if (rest && end > Date.now()) await page.waitForTimeout(end - Date.now());
}   // pure, in hold.mjs (tests import them without Playwright)

// One step on the app's page; `log` gets what the renderer needs (click targets, holds and their boxes, page changes as marks).
async function step(page, item, log, app = null) {
  // a page change is stamped BEFORE its action (round 3: stamped after, a frame of the new page could arrive first and show under the old framing)
  const say = item.say && !item.hold ? {say: item.say, ...(item.tag ? {tag: item.tag} : {})} : {};   // a caption on an action shows from its moment (captions.mjs)
  stepMarks(item, log);   // picture in picture (pip.mjs): where two recordings meet, and who leads
  if (item.go) { log.add({type: 'mark', ...say}); await page.evaluate(selector => document.querySelector(selector)?.click(), nav(item.go)); await watch(page, 900, log); await settle(page); return; }
  if (item.js) { log.add({type: 'mark', ...say}); await page.evaluate(item.js); await watch(page, 900, log); return; }
  if (item.review) {   // the form card updating live (round 5, owner): the extension's fill reports, sent over the app's own 'review' message; no page change
    if (!app) throw new Error('media: a review step needs the app (recordAppVideo)');
    const send = state => app.evaluate(({BrowserWindow}, sent) => BrowserWindow.getAllWindows()[0].webContents.send('review', sent), state);
    if (item.review.reports) {   // the extension's own reports of the fill, at their recorded times (live-review.mjs fromReports)
      const start = Date.now();
      for (const {at, state} of fromReports(item.review)) { await page.waitForTimeout(Math.max(0, start + at * 1000 - Date.now())); await send(state); }
    } else for (const state of liveStates({start: Date.now(), ...item.review})) {   // real times: the card's list times each field from the first
      await send(state);
      await page.waitForTimeout(item.review.every || 300);
    }
    await watch(page, 300, log);
    return;
  }
  if (item.tap) {   // the cursor glides to a control and presses it, nothing is clicked (a demo-disabled control, or the clip's last gesture), then `then` runs
    const tapped = page.locator(item.tap).first(), box = await tapped.boundingBox();
    if (!box) throw new Error(`media: nothing to tap at ${item.tap} (update scenes.mjs)`);
    const magic = await tapped.evaluate(magicTarget).catch(() => ({})), wand = item.wand ?? magic.wand;   // the app's own wand and glow marks, as for a click
    log.add({type: 'click', selector: item.tap, box, ...say, ...(wand ? {wand: true} : {}), ...(clickZoom(item) ? {zoom: clickZoom(item)} : {}), ...(item.phoneZoom ? {phoneZoom: item.phoneZoom} : {})});
    if (magic.glow || magic.wand) await glideTo(page, box, log, 700); else await page.waitForTimeout(700); log.add({type: 'press', selector: item.tap, box, ...(item.then && pressShow(log) ? {held: true} : {})});
    if (item.end) { await page.waitForTimeout(pressShow(log) || 400); log.add({type: 'end'}); return; }   // the part ends on this press (camera.mjs untilEnd)
    if (item.then) { await page.waitForTimeout(pressShow(log)); log.add({type: 'mark'}); await page.evaluate(item.then); }
    await watch(page, item.then ? 900 : 300, log);
    return;
  }
  if (item.press) { log.add({type: 'mark', ...say}); await page.keyboard.press(item.press); await watch(page, 400, log); return; }   // a key changes the page too (Escape closes a dialog)
  if (item.click) {
    const target = page.locator(item.click).first();
    const box = await target.boundingBox();
    if (!box) throw new Error(`media: nothing to click at ${item.click} (has the screen changed? update scenes.mjs)`);
    // a click lands on the target's middle: another control there (run 21: the phone take's one column put the confidence chip under the insight
    // head's middle, so the card never opened and the next look timed out) would get it instead
    const under = await target.evaluate(clickedControl).catch(() => null);
    if (under) throw new Error(`media: the click on ${item.click} would land on "${under}" inside it: click a part that is only the target (scenes.mjs)`);
    const magic = await target.evaluate(magicTarget).catch(() => ({}));   // what the app itself marks: a wand cursor on its AI buttons, a pointer-following glow on its magic cards
    const wand = item.wand ?? magic.wand;
    log.add({type: 'click', selector: item.click, box, ...say, ...(wand ? {wand: true} : {})});
    if (magic.glow || magic.wand) await glideTo(page, box, log, 700); else await page.waitForTimeout(700);   // the cursor's glide, drawn by the renderer
    const wait = pressShow(log);
    log.add({type: 'press', selector: item.click, box, ...(wait ? {held: true} : {})});
    if (wait) { await page.waitForTimeout(wait); log.add({type: 'mark'}); }
    await target.click();
    if (clickZoom(item)) Object.assign(log.events.findLast(event => event.type === 'click'), {zoom: clickZoom(item), ...(item.phoneZoom ? {phoneZoom: item.phoneZoom} : {})});
    await watch(page, 800, log, false);
    return;
  }
  if (item.hold) {
    const started = Date.now();
    // a cut look not yet seen is watched for from here too (round 3: the proposal replaced "reading your CV" in this gap, cut 0.4 s late)
    if (log.self) { const after = log.next; log.next = log.self; await watch(page, 250, log); log.next = after; } else await page.waitForTimeout(250);
    // a look still drawing on a loaded Mac (run 26-27: Track's e-mail and Find's row were in the page, not yet visible) is waited for, up to SHOW_WAIT
    if (item.look) await Promise.all([item.look].flat().map(selector => page.locator(selector).first().waitFor({state: 'visible', timeout: SHOW_WAIT}).catch(() => {})));
    let box = item.look ? await lookBox(page, item.look) : null;
    if (item.look && !box) throw new Error(`media: nothing to look at at ${item.look} (update scenes.mjs)`);
    let phoneBox = item.phoneLook ? await lookBox(page, item.phoneLook) : null;
    const view = await viewportOf(page);
    let out = Math.max(offScreen(box, view), offScreen(phoneBox, view));
    if (out > OFF_MAX && item.fitScroll && await scrollLookIn(page, item.look, box, view, log)) {   // the phone take's short window (hold.mjs)
      box = await lookBox(page, item.look); phoneBox = item.phoneLook ? await lookBox(page, item.phoneLook) : null;
      out = Math.max(offScreen(box, view), offScreen(phoneBox, view));
    }
    if (out > OFF_MAX) throw new Error(`media: look "${[item.phoneLook && offScreen(phoneBox, view) > OFF_MAX ? item.phoneLook : item.look].flat().join(', ')}" is ${Math.round(out * 100)}% off screen: ${item.fitScroll ? 'taller than the phone window: give the hold a shorter phoneLook' : 'scroll it into view first'} (scenes.mjs)`);
    item = {...item, lookWidth: await checkWords(page, item.look, box, item.lookWidth, 'look'),
      phoneLookWidth: await checkWords(page, item.phoneLook, phoneBox, item.phoneLookWidth, 'phoneLook')};
    const left = holdLeft(item.hold, started, Date.now());
    // the words and cards on screen, so edges.mjs can prove no copy's view cuts one at its left or right edge (round 9)
    log.add({...holdEvent(item, box, phoneBox, left), ...(item.phoneLook ? {phoneLook: item.phoneLook} : {}), edges: await page.evaluate(edgesScript).catch(() => [])});
    await log.paint();   // a frame now, still page or not (check.mjs captureGaps)
    await watch(page, Math.max(0, left * 1000 - 180), log);   // a page that changes by itself (the AI's proposal replacing "reading your CV") is cut when it shows
  }
}

// A video piece: frames + log.json in `dir`. -> the log.
export async function recordAppVideo({persona, piece, dir}) {
  const {app, page, close} = await launchApp({persona, settings: piece.settings, moment: piece.moment, env: piece.env, ...(piece.window ? {window: piece.window} : {})});
  try {
    // the phone copy leaves out the two bars that sit under every page (Application sessions, Last refresh): they took a third of the window (owner, 25 Oct 2026: the tab's content got a thin strip)
    if (piece.window) await page.addStyleTag({content: '#sessions-dock, #activity-toggle {display: none !important}'});
    const cast = await startScreencast(page, path.join(dir, 'frames'));
    const log = stepLog(cast.clock, cast.paint);
    log.speed = piece.speed || 1;   // a press's on-screen time (pressShow) is in output seconds
    for (const [i, original] of piece.steps.entries()) {
      const item = original.wand === undefined && piece.wand ? {...original, wand: true} : original;   // a piece's wand cursor (scenes.mjs), a step's own `wand` wins
      log.self = item.hold && item.cut && !(log.next?.ready && log.next.look === item.look) ? {look: item.look} : null;
      log.next = nextCut(piece.steps, i); await step(page, item, log, app);
    }
    await page.waitForTimeout(200);
    const frames = await cast.stop();
    const result = {viewport: await viewportOf(page), frames, events: log.events, text: await pageText(page)};
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(result, null, 1));
    return result;
  } finally { await close(); }
}

// Stills and close-ups, all in one app session (each after its own steps, from Focus). -> [{name, file, kind, text}]
export async function shootApp({persona, stills, snips, dir}) {
  const {page, close} = await launchApp({persona});
  const shots = [];
  try {
    const log = stepLog(() => 0);
    for (const [name, still] of Object.entries(stills)) {
      await page.keyboard.press('Escape');
      for (const item of still.steps) await step(page, item, log);
      await settle(page, `still ${name}`);
      const file = path.join(dir, `still-${name}.png`);
      await capture(page, file);
      shots.push({name, kind: 'still', file, text: await pageText(page)});
    }
    for (const [name, snip] of Object.entries(snips)) {
      await page.keyboard.press('Escape');
      for (const item of snip.steps) await step(page, item, log);
      await page.locator(snip.selector).first().scrollIntoViewIfNeeded().catch(() => {});   // a card below the fold
      await page.waitForTimeout(300);
      const box = await page.locator(snip.selector).first().boundingBox();
      if (!box) throw new Error(`media: close-up ${name}: nothing at ${snip.selector} (update scenes.mjs)`);
      const view = await viewportOf(page), m = snip.margin;
      const clip = clipTo({x: box.x - m, y: box.y - m, width: box.width + 2 * m, height: box.height + 2 * m}, view);
      if (!clip) throw new Error(`media: close-up ${name}: ${snip.selector} is off screen`);
      await settle(page, `close-up ${name}`);
      const file = path.join(dir, `snip-${name}.png`);
      await capture(page, file, clip);
      shots.push({name, kind: 'snip', file, text: await pageText(page)});
    }
  } finally { await close(); }
  return shots;
}

// The page's size in CSS px (the app's zoom makes it wider than the window), the unit of every box in the log.
// Waits until the page shows no loading state (a pill, skeleton rows, a shimmer), at most 10 s; then says what still loads.
const LOADING = '.loading-pill, .skeleton, .skeletons, .is-loading, .shimmer, .shimmering';
async function settle(page, what = '') {
  const loading = () => page.evaluate(selector => [...document.querySelectorAll(selector)].some(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'), LOADING);
  for (let waited = 0; waited < 10000 && await loading(); waited += 250) await page.waitForTimeout(250);
  if (what && await loading()) console.log(`media: ${what}: still loading after 10 s, taken as it is`);
}

// A PNG of the window through CDP: Playwright's own screenshot leaves an empty band under the app's zoomed page (devicePixelRatio 1.6).
// A clip is in the page's CSS pixels; the close-up comes out at 2x them.
async function capture(page, file, clip = null) {
  const cdp = await page.context().newCDPSession(page);
  try {
    // CDP's clip is in the window's units: the page's CSS pixels times the app's zoom (0.8); scale 2/devicePixelRatio makes it 2x the page.
    const {cssVisualViewport: {zoom = 1} = {}} = await cdp.send('Page.getLayoutMetrics');
    const dpr = await page.evaluate(() => devicePixelRatio);
    const at = clip && {x: clip.x * zoom, y: clip.y * zoom, width: clip.width * zoom, height: clip.height * zoom, scale: 2 / dpr};
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', ...(at ? {clip: at} : {})});
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  } finally { await cdp.detach().catch(() => {}); }
}

export const viewportOf = page => page.evaluate(() => ({w: innerWidth, h: innerHeight}));

// What the screen says, for the privacy check (check.mjs): the page's visible text.
const pageText = page => page.evaluate(() => document.body.innerText).catch(() => '');
