/* global document, location, innerWidth, innerHeight */
// Records the REAL extension filling a fictional form (form.html, served at a reserved .example address) for the product media
// (media). Isolation is the e2e harness's (e2e/lib/real-extension.mjs): a copy of the extension that talks only to a stand-in app,
// a throwaway Chromium profile, no network (every other host resolves to nothing). The stand-in hands over the persona's fictional details and
// answers the form's questions as Claude would for them. Nothing is pressed: the extension fills a marked tab by itself, as after the app's Apply.
// Never submitted: the form's button does nothing.
import fs from 'node:fs';
import path from 'node:path';
import {startRealExtension} from '../desktop/e2e/lib/real-extension.mjs';
import {edgesScript} from './edges.mjs';
import {FILL_MARK} from './fill-mark.mjs';   // the tab mark the extension fills (fill-mark.mjs)
import {holdEvent, holdLeft, OFF_MAX, offScreen, scrollLookIn, SHOW_WAIT, stepMarks} from './hold.mjs';
import {unionBox} from './record-app.mjs';
import {startScreencast, stepLog} from './screencast.mjs';
import {answerReply, formHost, formHtml} from './stand-in.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const VIEW = {width: 1440, height: 900};   // 16:10, captured at 2x

// The panel at rest: while a fill step shows it sits centred over the dimmed page (review.js place()), then it goes back to its corner. A look measured
// mid-move framed the empty centre and lost the panel (hero, 24 Oct 2026), so this waits (up to 8 s) for the corner, then for the box to stop moving.
const panelBox = async page => {
  await page.waitForFunction(() => { const host = document.getElementById('jobadabra-review-host'); return host && !host.style.transform; }, null, {timeout: 8000}).catch(() => {});
  const measure = () => page.evaluate(() => {
    const host = document.getElementById('jobadabra-review-host');
    const card = host?.shadowRoot?.querySelector('.card:not([hidden]), .jp') || host;
    const r = card?.getBoundingClientRect();
    return r && r.width ? {x: r.x, y: r.y, width: r.width, height: r.height} : null;
  });
  let box = await measure();
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(150); const next = await measure(); if (JSON.stringify(next) === JSON.stringify(box)) break; box = next; }
  return box;
};

export async function recordExtensionVideo({persona, piece, dir}) {
  const template = fs.readFileSync(path.join(here, 'form.html'), 'utf8');
  // the form state the extension reports to the app as it fills (what the real app's Applying card follows), stamped on the recording's clock
  const reports = [];
  let clock = () => null;
  const ext = await startRealExtension({allowAllSites: true, offline: true, contact: persona.applicant,
    answer: {'/extension/answer': body => answerReply(body, persona.answers),
      '/extension/review': body => { try { const one = JSON.parse(body || '{}'); if (Object.keys(one).length) reports.push({t: clock(), ...one}); } catch {} return {}; },
      '/extension/page-kind': () => ({ok: true, kind: 'form', role: 'form', by: 'ai', confidence: 0.95, signal: 'confident'})}});
  try {
    const {page, context} = ext;
    const host = formHost(persona.job);
    await context.route(`https://${host}/**`, route => route.fulfill({status: 200, contentType: 'text/html', body: formHtml(template, persona.job)}));
    const z = piece.zoom || 1, view = piece.window ? {width: Math.round(piece.window.width / z), height: Math.round(piece.window.height / z)} : VIEW, density = piece.window ? 2.5 * z : 2;   // the phone take (round 9): a narrow page, captured sharper
    await page.setViewportSize(view);
    // Playwright emulates light unless told: the form (form.html) and the extension's panel both follow it. A piece with motion 'reduce' (the hero, owner
    // 24 Oct 2026: "remove the large colour sweep") records the panel without its aurora and shimmer (panel-overlay-fx.js adds none under reduced motion).
    await page.emulateMedia({colorScheme: 'dark', ...(piece.motion === 'reduce' ? {reducedMotion: 'reduce'} : {})});
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {width: view.width, height: view.height, deviceScaleFactor: density, mobile: false});
    await page.goto(`https://${host}/jobs/apply`);
    await ext.assertIsolated();
    const cast = await startScreencast(page, path.join(dir, 'frames'));
    clock = cast.clock;
    const log = stepLog(cast.clock, cast.paint);
    for (const item of piece.steps) {
      stepMarks(item, log);   // picture in picture (pip.mjs): where two recordings meet, and who leads
      if (item.fill) {   // what the app's Apply does: the tab, marked for the extension, which then reads and fills the form by itself
        await page.evaluate(mark => { location.hash = mark; }, FILL_MARK);
        // picture in picture: the other recording's card starts ticking when the first field is filled, not while the panel still reads the page
        const firstField = () => page.waitForFunction(() => [...document.querySelectorAll('input, select, textarea')].some(e => (e.type === 'checkbox' ? e.checked : e.type === 'file' ? e.files.length : e.value)), null, {timeout: 60000, polling: 50});
        if (item.sync) firstField().then(() => log.add({type: 'sync'})).catch(() => {});
        await page.waitForFunction(() => document.getElementById('jobadabra-review-host')?.shadowRoot?.querySelector('button'), null, {timeout: 20000});
        log.add({type: 'mark'});
        // picture in picture (pip.mjs fillSeconds): the fill ends at the panel's own done state ('.ready', extension/review.js); the next steps
        // wait for it, so the main picture shows the whole fill and the other recording's card is paced on it
        if (item.sync) {
          // Why (12 Nov 2026): the extension leaves a consent box for the person (the panel's "Remaining field", extension/panel-review-view.js), so
          // "Ready to submit" never comes on the stand-in form: the fill is over at either end state
          await page.waitForFunction(() => { const root = document.getElementById('jobadabra-review-host')?.shadowRoot, left = root?.querySelector('.left');
            return root?.querySelector('.ready') || (left && !left.hidden); }, null, {timeout: 60000, polling: 50});
          log.add({type: 'filled'});
        }
        continue;
      }
      if (item.hold) {
        const started = Date.now();
        await page.waitForTimeout(250);
        const boxOf = async look => (look ? unionBox(await Promise.all([look].flat().map(one => (one === 'panel' ? panelBox(page) : page.locator(one).first().boundingBox())))) : null);
        if (item.look) await Promise.all([item.look].flat().filter(one => one !== 'panel').map(one => page.locator(one).first().waitFor({state: 'visible', timeout: SHOW_WAIT}).catch(() => {})));   // as record-app.mjs
        let box = await boxOf(item.look);
        if (item.look && !box) throw new Error(`media: nothing to look at at ${item.look} (update scenes.mjs)`);
        let phoneBox = await boxOf(item.phoneLook);
        const view = await page.evaluate(() => ({w: innerWidth, h: innerHeight}));
        let out = Math.max(offScreen(box, view), offScreen(phoneBox, view));
        if (out > OFF_MAX && item.fitScroll && await scrollLookIn(page, item.look, box, view, log)) {   // the phone take's short window (hold.mjs)
          box = await boxOf(item.look); phoneBox = await boxOf(item.phoneLook);
          out = Math.max(offScreen(box, view), offScreen(phoneBox, view));
        }
        if (out > OFF_MAX) throw new Error(`media: look "${[item.look].flat().join(', ')}" is ${Math.round(out * 100)}% off screen: ${item.fitScroll ? 'taller than the phone window: give the hold a shorter phoneLook' : 'scroll it into view first'} (scenes.mjs)`);
        const left = holdLeft(item.hold, started, Date.now());
        log.add({...holdEvent(item, box, phoneBox, left), ...(item.phoneLook ? {phoneLook: item.phoneLook} : {}), edges: await page.evaluate(edgesScript).catch(() => [])});   // edges.mjs
        await log.paint();   // a frame now, still page or not (check.mjs captureGaps)
        await page.waitForTimeout(Math.max(0, left * 1000 - 180));
      }
    }
    const frames = await cast.stop();
    const filled = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter(e => (e.type === 'checkbox' ? e.checked : e.type === 'file' ? e.files.length : e.value)).map(e => e.id));
    const result = {viewport: await page.evaluate(() => ({w: innerWidth, h: innerHeight})), frames, events: log.events, filled, reports, text: await page.evaluate(() => document.body.innerText)};
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(result, null, 1));
    return result;
  } finally { await ext.close(); }
}
