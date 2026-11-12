// The product's screenshots and videos, made with nobody's hands (owner, 20 Oct 2026): records the app (demo mode, dark) and the real extension on a
// fictional form, adds zooms, cursor and clicks in code from the click log, checks every piece, writes the site's files + manifest.json.
//   node media/media.mjs                                   all pieces → <tmp>/jobadabra-media
//   node media/media.mjs hero stills --out <dir>        some pieces (hero, extension-fill, apply-split, stills, snips); a partial run keeps the others in manifest.json
//   node media/media.mjs --persona <folder>             another search profile (default: personas/nurse-lyon): files laid over desktop/demo + media.json
//   node media/media.mjs --keep                         keep the frames and logs (<out>/.work) for the director (direct.mjs) or a look
// Zooms and captions the AI director chose are in plans/<piece>.json (direct.mjs); without one, the camera frames each hold's `look`.
// Run by hand with tools/media.sh (the one local command; CI never records, owner 21 Oct 2026). Guards: desktop/test/media-*.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {beatTimes, FIT_WARN, fromFirstLook, posterTime, renderPlan, RING, toLastHold, untilEnd} from './camera.mjs';
import {dropChanges, frameCuts, STRAY_MAX, strayFrames, THUMB} from './cuts.mjs';
import {planStrays, smallFrames} from './prestray.mjs';
import {joinFilter, openOnCard, transitions, withCards} from './transitions.mjs';
import {fillSeconds, pipPlan, splitPlan, syncTime} from './pip.mjs';
import {captionAt, captionSize, captionTimes, SAY_FADE, sayTrack, vttOf} from './captions.mjs';
import {leftWords, pieceProblems, realEmails, stallsOf} from './check.mjs';
import {brightness, duration, encodeStill, encodeVideo, framesIn, missingEncoders} from './encode.mjs';
import {edgeCuts, edgeReport} from './edges.mjs';
import {fitReport, shallowLooks} from './fits.mjs';
import {gradeSvg} from './grade.mjs';
import {manifest, stillEntry, videoEntry} from './manifest.mjs';
import {recordAppVideo, shootApp} from './record-app.mjs';
import {recordExtensionVideo} from './record-extension.mjs';
import {jpegWidth, loadPersona, parseArgs, planOf, withPlan} from './options.mjs';
import {partsOf, SNIPS, STILLS, VIDEOS} from './scenes.mjs';
import {rewordLog} from './words.mjs';
import {desktopTake, openWide, phoneTake} from './hold.mjs';
import {chunksOf, limiter, masterEncoder, RENDERS, runChild, TAKES} from './renders.mjs';
import {KEY_FILE, keptTake, reuseTake, takeKey} from './takes.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const desktop = path.resolve(here, '..', 'desktop');
const FPS = 30;

// Writes a render job and runs render.cjs on it; a render that ends short (round 9: the phone copy's renderer quit 17 frames in, exit 0, on a Mac
// low on memory, and the clip came out 0.4 s long) is run once more, then stops the piece. Up to RENDERS run at once (renders.mjs). -> out.
const renderQueue = limiter(RENDERS);
const ELECTRON = path.join(desktop, 'node_modules', '.bin', 'electron');
// Electron unpacks itself on its first start: started once, alone, before renders run side by side (run 30: a fresh .overlay, four renderers at
// once, "File exists" and "Electron failed to install correctly"). The takes start the app one at a time, so a run that records is safe already.
let electronReady = null;
const electronOnce = () => (electronReady ??= runChild(ELECTRON, ['--version'], 5 * 60000).then(run => {
  if (run.status !== 0) throw new Error(`media: Electron does not start (${run.error?.message ?? run.status ?? run.signal}): delete .overlay and run again`);
}));
async function runRender(job, name, tries = 2) {
  // in pieces at once, each through the queue, on the Mac's video chip where there is one (renders.mjs chunksOf, masterEncoder), then joined
  const encoder = masterEncoder(), pieces = chunksOf(job.frames.length);
  const outs = pieces.map((_, i) => (pieces.length === 1 ? job.out : job.out.replace(/\.mp4$/, `.part${i}.mp4`)));
  await Promise.all(pieces.map(([from, to], i) => renderPiece({...job, encoder, frames: job.frames.slice(from, to), out: outs[i]}, name, tries)));
  if (pieces.length > 1) {
    const list = job.out.replace(/\.mp4$/, '.parts.txt');
    fs.writeFileSync(list, outs.map(out => `file '${out.replace(/'/g, "'\\''")}'`).join('\n'));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', job.out]);
    for (const file of [list, ...outs]) fs.rmSync(file, {force: true});
    const made = framesIn(job.out);
    if (made !== job.frames.length) throw new Error(`media: ${name}: ${path.basename(job.out)} joined ${made} of ${job.frames.length} frames`);
  }
  return job.out;
}

// One renderer on frames of a copy (the whole copy, or one piece): queued, rendered again once when it ends short. -> its file.
async function renderPiece(job, name, tries) {
  const file = path.join(path.dirname(job.out), `${path.basename(job.out, '.mp4')}.json`);
  fs.writeFileSync(file, JSON.stringify({...job, gradeSvg: gradeSvg()}));   // every clip graded the same way, the app's pixels only (grade.mjs)
  await electronOnce();
  return renderQueue(async () => { for (let attempt = 1; ; attempt++) {
    const run = await runChild(ELECTRON, [path.join(here, 'render.cjs'), file], 15 * 60000);
    // run.error: it never started (24 Oct 2026, a Mac out of memory printed "failed (null)"): name the cause
    if (run.status !== 0) throw new Error(`media: ${name}: the renderer failed (${run.error ? `could not start: ${run.error.message}` : run.status ?? run.signal})`);
    const made = fs.existsSync(job.out) ? framesIn(job.out) : 0;
    if (made === job.frames.length) return job.out;
    if (attempt >= tries) throw new Error(`media: ${name}: ${path.basename(job.out)} has ${made} of ${job.frames.length} frames: the renderer ended early twice (memory?)`);
    console.log(`media: ${name}: ${path.basename(job.out)} has ${made} of ${job.frames.length} frames: rendering it again`);
  } });
}

// Words only (media.mjs --words <set dir>, words.mjs): the set's kept recordings, redrawn with the scenes' current words; null = record.
let wordsFrom = null;
// What a take's key needs from the run (takes.mjs): the app's commit and the local date. Set by main.
const run = {appSha: '', day: ''};
const recordQueue = limiter(TAKES);   // takes recorded at once (renders.mjs)

// One take of a clip: recorded (or, words only, the set's kept take redrawn with the scenes' words), cut at its looks and checked. The desktop take
// uses the scene's window; the phone take (round 9) the phone shape's narrow window, where the app lays out one column. -> {log, dir, scale}
async function takeOf(name, piece, persona, dir) {
  const record = piece.source === 'extension' ? recordExtensionVideo : recordAppVideo, label = path.basename(dir);
  // a capture that stalled on a loaded Mac is recorded again (check.mjs stallsOf), at most twice; then pieceProblems fails the piece
  let recorded;
  if (wordsFrom) {
    const kept = path.join(wordsFrom, label);
    if (!fs.existsSync(path.join(kept, 'log.json'))) throw new Error(`media: ${label}: no kept recording in ${kept} (tools/hero.sh keeps one per set)`);
    fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
    fs.cpSync(path.join(kept, 'frames'), path.join(dir, 'frames'), {recursive: true});
    recorded = rewordLog(JSON.parse(fs.readFileSync(path.join(kept, 'log.json'), 'utf8')), piece, label);
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(recorded, null, 1));
    console.log(`media: ${label}: words only, redrawn from ${kept}`);
  } else {
    // a take nothing it records changed since an earlier set is reused (takes.mjs; owner: "let's do all the optimizations possible")
    const key = takeKey({label, piece, persona, ...run}), kept = process.env.HERO_FRESH ? null : keptTake(path.dirname(path.dirname(dir)), label, key);
    if (kept) {
      recorded = reuseTake(kept, dir);
      console.log(`media: ${label}: nothing it records changed: the take from ${path.basename(path.dirname(path.dirname(kept)))} reused`);
    } else for (let attempt = 1, failed = 0; attempt <= 3; attempt++) {
      fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
      // a take that fails is recorded once more (run 23: with two takes at once, Find's list was not on screen yet at its look); twice: it stops
      try { recorded = await recordQueue(() => record({persona, piece, dir})); } catch (error) {
        if (++failed > 1) throw error;
        console.log(`media: ${label}: ${error.message.split('\n')[0]}: recording again`);
        continue;
      }
      const stalls = stallsOf(recorded, piece.quiet);   // the final gate's own stall checks (check.mjs)
      if (!stalls.length || attempt === 3) break;
      console.log(`media: ${label}: ${stalls.join('; ')}: recording again (${attempt + 1} of 3)`);
    }
    fs.writeFileSync(path.join(dir, KEY_FILE), key);
  }
  // the hero starts at its first look (camera.mjs), each cut look when it shows, checked against its frames (cuts.mjs)
  const px = jpegWidth(fs.readFileSync(path.join(dir, 'frames', recorded.frames[0].file))) / recorded.viewport.w, thumbs = new Map();
  const thumb = (file, box) => {   // a frame's grey thumbnail of a box in CSS px (cuts.mjs frameCuts), clamped to the page
    const x = Math.max(0, Math.round(box.x * px)), y = Math.max(0, Math.round(box.y * px)), key = `${file} ${x} ${y} ${box.width} ${box.height}`;
    const w = Math.max(2, Math.round(box.width * px)), h = Math.max(2, Math.round(box.height * px)), crop = `crop=min(${w}\\,iw-${x}):min(${h}\\,ih-${y}):${x}:${y}`;
    if (!thumbs.has(key)) thumbs.set(key, execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'frames', file), '-vf', `${crop},scale=${THUMB.w}:${THUMB.h},format=gray`, '-f', 'rawvideo', '-']));
    return thumbs.get(key);
  };
  // a title card's time is added at its cut (transitions.mjs withCards): the beats, captions and the gate all read this log
  const log = piece.camera === 'steady' ? toLastHold(withCards(frameCuts({log: dropChanges(fromFirstLook(untilEnd(recorded))), thumb}), piece.speed || 1)) : recorded;
  console.log(`media: ${label}: recorded ${log.frames.length} frames, ${log.frames.at(-1).t.toFixed(1)} s`);
  return {log, dir, scale: jpegWidth(fs.readFileSync(path.join(dir, 'frames', log.frames[0].file))) / log.viewport.w};
}

// A frame drawn without its caption and tag: the phone copy's (round 9), whose captions the site shows under the video.
const noWords = ({say, sayAge, tag, ...frame}) => frame;

async function recordClip(name, persona, work, {tune = piece => piece, layer = false} = {}) {
  const piece = openWide(tune(openOnCard(withPlan(VIDEOS[name], planOf(name)))));   // every new screen opens wide (hold.mjs)   // a part that comes in by a card opens on it (transitions.mjs)
  const stale = leftWords(`${piece.caption || ''} ${piece.shows} ${piece.alt || ''}`, persona.forbid);
  if (stale.length) throw new Error(`${name}: the plan's words name the default demo person (${stale.join(', ')}): run direct.mjs ${name} again`);
  const phoneShape = typeof piece.phone === 'object' ? piece.phone : null;
  // phones: the same steps again in a narrow window, the app in one column (round 9, owner 24 Oct 2026, of three options: "Narrow window"), so a
  // phone frame shows whole cards with big text; the phone camera puts its edges in gaps (whole.mjs) and edgesOk proves it. Both takes at once.
  const [main, narrow] = await Promise.all([takeOf(name, desktopTake(piece), persona, path.join(work, name)),
    phoneShape?.window ? takeOf(name, phoneTake(piece, phoneShape), persona, path.join(work, `${name}-phone`)) : null]);
  const steady = piece.camera === 'steady';
  // a hero look too wide for its zoom is shown whole at a lower zoom (camera.mjs fitWidth); much lower reads small, so the log names it (round 2)
  const onFit = copy => (event, asked, used) => console.log(`media: ${name} (${copy}): look ${JSON.stringify(event.look)} (${Math.round(((copy === 'phone' && event.phoneBox) || event.box).width)} px wide) shown whole at zoom ${used.toFixed(2)} (asked ${asked.toFixed(2)})${used < asked * FIT_WARN ? ': SMALL TEXT, pick a narrower look' : ''}`);
  let said = [];   // the phone copy's captions in its played seconds: the site shows them under it (captions.mjs sayTrack)
  const phone = phoneShape ? {aspect: phoneShape.width / phoneShape.height} : null;
  const render = (take, out, width, height, phone = null) => {
    const captions = captionTimes(take.log);   // the hero's step captions (captions.mjs), drawn by render.cjs on the desktop copy only (round 9)
    const frames = renderPlan(take.log, FPS, piece.speed || 1, {steady, phone, onFit: onFit(phone ? 'phone' : 'desktop')}).map((frame, i) => ({...frame, ...captionAt(captions, i / FPS)}));
    if (phone) said = sayTrack(frames, FPS, piece.speed || 1);
    return runRender({framesDir: path.join(take.dir, 'frames'), frames: phone ? frames.map(noWords) : frames, scale: take.scale, width, height, fps: FPS, ring: RING, captionSize: captionSize(width, Boolean(phone)), sayFade: SAY_FADE, out, ffmpeg: 'ffmpeg'}, name);
  };
  const checked = () => {
    const problems = [main, narrow].filter(Boolean).flatMap(take => pieceProblems({name: path.basename(take.dir), source: piece.source, log: take.log,
      posterBrightness: brightness(path.join(take.dir, 'frames', take.log.frames[0].file)), forbid: persona.forbid, quiet: piece.quiet}));
    if (problems.length) throw new Error(problems.join('\n'));
  };
  const layerOf = take => ({name, log: take.log, dir: path.join(take.dir, 'frames'), scale: take.scale});
  if (layer) { checked(); return {...layerOf(main), piece, phone: layerOf(narrow || main)}; }
  // every check before any render (round 9, owner: "can we parallelize it more?"): a bad scene stops a minute in, not after minutes of rendering
  edgesOk(name, main.log, piece.speed || 1, steady, null);
  if (phone) edgesOk(name, (narrow || main).log, piece.speed || 1, steady, phone);
  fitsOk(name, main.log, piece.speed || 1, steady);
  checked();
  if (steady) for (const [take, shape] of [[main, null], ...(phone ? [[narrow || main, phone]] : [])]) {   // stray frames, from the plan (prestray.mjs)
    const strays = planStrays({log: take.log, speed: piece.speed || 1, fps: FPS, phone: shape, small: smallFrames(path.join(take.dir, 'frames'), take.log)});
    if (strays.length) throw new Error(strays.map(s => `media: ${path.basename(take.dir)}: a frame of another page at ${s.at} s (recorded), ${s.side} the cut to ${JSON.stringify(s.look)} (differs ${s.diff} > ${STRAY_MAX}), found before rendering: record again; if it repeats, the cut's timing is wrong (cuts.mjs)`).join('\n'));
  }
  // -> finish(): both copies rendered at once (renders.mjs), when every take of the run is recorded (main)
  return async () => {
    const [master, phoneMaster] = await Promise.all([render(main, path.join(main.dir, 'master.mp4'), piece.width, piece.height),
      phone ? render(narrow || main, path.join(main.dir, 'master-phone.mp4'), phoneShape.width, phoneShape.height, phone) : null]);
    return {name, piece, log: main.log, phoneLog: (narrow || main).log, master, phoneMaster, said, seconds: duration(master), phoneSeconds: phoneMaster ? duration(phoneMaster) : null};
  };
}

// A desktop look that ends below 1.5x stops the piece before any render (fits.mjs; owner, 25 Oct 2026: "zoom deeper, about 1.5x"); HERO_FITS=warn only logs.
function fitsOk(name, log, speed, steady) {
  const hits = steady ? shallowLooks(log, speed) : [];
  if (!hits.length) return;
  if (process.env.HERO_FITS !== 'warn') throw new Error(fitReport(name, hits));
  console.log(fitReport(name, hits));
}

// A phone copy whose view cuts a line of words or a card at its left or right edge stops (edges.mjs; round 9, owner 24 Oct 2026: "the video is
// stripped"); the desktop copy's cuts are named in the log. A kept recording from before round 9 has no edges: nothing to check.
function edgesOk(name, log, speed, steady, phone) {
  const hits = edgeCuts(log, speed, {steady, phone});
  if (!hits.length) return;
  const report = edgeReport(name, hits, phone ? 'phone' : 'desktop');
  if (process.env.HERO_EDGES !== 'warn' && phone) throw new Error(report);   // the phone copy; the desktop copy's frame keeps 1.5x (camera.mjs DESKTOP_FLOOR), so it names what it cuts
  console.log(report);
}

// A piece played picture in picture with another recording of the same moment (pip.mjs; owner, 24 Oct 2026, Apply: the Applying card and Chrome,
// swapped when the lead changes). The piece is recorded first; the other's `review` is paced on the piece's real fill (sync → its next mark), so
// the card ticks while the fields fill. -> a clip like recordClip's, with its own beats and poster (no stray-frame check: no cut inside).
// The phone copy composes the two phone takes (round 9), with its own captions and poster.
async function recordPip(name, persona, work) {
  const piece = VIDEOS[name], speed = piece.speed || 1;
  const b = await recordClip(name, persona, work, {layer: true});
  const fill = fillSeconds(b.log);   // its sync to the panel's done state
  // the card replays the extension's own reports from the fill's start when the take kept them (live-review.mjs fromReports), else ticks its listed fields evenly
  const reports = b.log.reports?.length ? {reports: b.log.reports, sync: syncTime(b.log)} : null;
  const pace = steps => steps.map(step => (step.review && reports ? {...step, review: {...step.review, ...reports}}
    : step.review && fill ? {...step, review: {...step.review, every: Math.round(fill * 1000 / step.review.fields.length)}} : step));
  const a = await recordClip(piece.pip, persona, work, {layer: true, tune: other => ({...other, steps: pace(other.steps)})});
  console.log(`media: ${name}: ${piece.layout === 'split' ? 'side by side' : 'picture in picture'} with ${piece.pip}${fill ? `, the card paced on a ${fill.toFixed(1)} s fill` : ''}`);
  const dir = path.join(work, name);
  let said = [];
  const recsOf = phone => [a, b].map(rec => ({...(phone ? rec.phone : rec), name: rec.name}));
  const compose = async (out, width, height, phone = null) => {
    const recs = recsOf(phone);
    const plan = piece.layout === 'split' ? splitPlan({a: recs[0], b: recs[1], width, height, fps: FPS, speed, labels: piece.labels})   // side by side (/how-it-works)
      : pipPlan({a: recs[0], b: recs[1], width, height, fps: FPS, speed, phone});
    if (phone) said = sayTrack(plan.frames, FPS, speed);   // the phone copy: no captions on it (round 9), the site shows these
    await runRender({framesDir: dir, frames: phone ? plan.frames.map(noWords) : plan.frames, scale: 1, width, height, fps: FPS, ring: RING, captionSize: captionSize(width, Boolean(phone)), sayFade: SAY_FADE, out, ffmpeg: 'ffmpeg'}, name);
    return plan;
  };
  const phoneShape = typeof piece.phone === 'object' ? piece.phone : null, phone = phoneShape ? {aspect: phoneShape.width / phoneShape.height} : null;
  for (const copy of [null, ...(phone ? [phone] : [])]) for (const rec of recsOf(copy)) edgesOk(rec.name, rec.log, speed, true, copy);   // checks before renders
  return async () => {   // finish(): both copies rendered at once (renders.mjs)
    const [plan, phonePlan] = await Promise.all([compose(path.join(dir, 'master.mp4'), piece.width, piece.height),
      phone ? compose(path.join(dir, 'master-phone.mp4'), phoneShape.width, phoneShape.height, phone) : null]);
    const beats = [a, b].flatMap(rec => beatTimes(rec.log.events, rec.piece.steps, speed).map(beat => ({...beat, t: Number((plan.at(rec.name, beat.t * speed) / speed).toFixed(2))})))
      .filter(beat => beat.t >= 0).sort((x, y) => x.t - y.t);
    const master = path.join(dir, 'master.mp4'), phoneMaster = phoneShape ? path.join(dir, 'master-phone.mp4') : null;
    return {name, piece, pip: true, beats, posterAt: Math.max(0, plan.seconds - 0.2 * speed), phonePosterAt: phonePlan ? Math.max(0, phonePlan.seconds - 0.2 * speed) : null,
      master, phoneMaster, said, seconds: duration(master), phoneSeconds: phoneMaster ? duration(phoneMaster) : null};
  };
}

// Masters of a piece's parts, one after the other (round 3, owner 24 Oct 2026: Apply starts in the app, then the browser), each coming in by its
// part's `into` (round 6: never an instant replacement; transitions.mjs joinFilter). -> the joined file.
function joined(files, kinds, speed, out) {
  if (files.length === 1) return files[0];
  const {filter, out: last} = joinFilter(files.map(file => duration(file)), kinds, speed);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap(file => ['-i', file]), '-filter_complex', `${filter};${last}format=yuv420p[v]`,
    '-map', '[v]', ...masterEncoder(), '-pix_fmt', 'yuv420p', out]);
  return out;
}

// A video piece with its parts (scenes.mjs partsOf): each recorded on its own app state, moment and steps, played in order.
// Records and checks every part, -> finish(): renders them, joins, encodes and checks the played copies, -> the manifest entry.
async function makeVideo(name, persona, work, out) {
  const finishes = await settled(partsOf(name).map(part => (part === name && VIDEOS[name].pip ? recordPip(name, persona, work) : recordClip(part, persona, work))));
  return async () => {
    const clips = await Promise.all(finishes.map(finish => finish()));
    const {piece} = clips.find(clip => clip.name === name), speed = piece.speed || 1, dir = path.join(work, name);
    const starts = clips.map((_, i) => clips.slice(0, i).reduce((sum, clip) => sum + clip.seconds, 0));   // recorded seconds where each part starts
    const kinds = clips.slice(1).map(clip => clip.piece.into);   // how each later part comes in
    const master = joined(clips.map(clip => clip.master), kinds, speed, path.join(dir, 'master-joined.mp4'));
    const phoneMaster = clips[0].phoneMaster ? joined(clips.map(clip => clip.phoneMaster), kinds, speed, path.join(dir, 'master-phone-joined.mp4')) : null;
    const phoneStarts = clips.map((_, i) => clips.slice(0, i).reduce((sum, clip) => sum + (clip.phoneSeconds ?? clip.seconds), 0));   // the phone takes run their own time
    const posterOf = (at, logOf, pipAt) => clips.map((clip, i) => (clip.pip ? at[i] + pipAt(clip) : clip.piece.steps.some(step => step.poster) ? at[i] + posterTime(logOf(clip).events) : null)).filter(t => t !== null).at(-1) ?? 0;
    const posterAt = posterOf(starts, clip => clip.log, clip => clip.posterAt), phonePosterAt = posterOf(phoneStarts, clip => clip.phoneLog || clip.log, clip => clip.phonePosterAt ?? clip.posterAt);
    const {files, bytes} = await encodeVideo({master, phoneMaster, name, piece, outDir: out, posterAt, phonePosterAt});
    console.log(`media: ${name}: ${Object.entries(bytes).map(([kind, n]) => `${kind} ${(n / 1e6).toFixed(2)} MB`).join(', ')}`);
    if (piece.camera === 'steady') {   // no frame of another page around a cut (cuts.mjs strayFrames), read off each played copy, part by part
      const strayIn = (file, at, logOf) => {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(out, file), '-vf', `scale=${THUMB.w}:${THUMB.h},format=gray`, '-f', 'rawvideo', '-'], {maxBuffer: 1 << 28});
        const size = THUMB.w * THUMB.h, total = Math.floor(raw.length / size);
        return clips.flatMap((clip, i) => {
          if (clip.pip) return [];   // two recordings with no cut inside: each was checked as it was recorded
          const from = Math.round(at[i] / speed * FPS), to = i + 1 < clips.length ? Math.round(at[i + 1] / speed * FPS) : total, log = logOf(clip);
          return strayFrames({log, frames: to - from, thumb: j => raw.subarray((from + j) * size, (from + j + 1) * size), speed, fps: FPS, windows: transitions(log, speed)})
            .map(s => ({...s, file, at: Number((s.at + from / FPS).toFixed(2))}));
        });
      };
      const stray = [...strayIn(files.mp4, starts, clip => clip.log), ...(phoneMaster && files.phone ? strayIn(files.phone, phoneStarts, clip => clip.phoneLog || clip.log) : [])];
      if (stray.length) throw new Error(stray.map(s => `media: ${name}: ${s.file}: a frame of another page at ${s.at} s, ${s.side} the cut to ${JSON.stringify(s.look)} (differs ${s.diff} > ${STRAY_MAX}): record again; if it repeats, the cut's timing is wrong (cuts.mjs)`).join('\n'));
    }
    const seconds = duration(path.join(out, files.mp4));
    const said = clips.flatMap((clip, i) => (clip.said || []).map(cue => ({...cue, t: Number((cue.t + phoneStarts[i] / speed).toFixed(3))})));
    if (files.phone && said.some(cue => cue.say)) {   // the captions the phone copy leaves out, in its own time, for the site to show under it (captions.mjs vttOf)
      files.captions = `${name}.vtt`;
      fs.writeFileSync(path.join(out, files.captions), vttOf(said, duration(path.join(out, files.phone))));
      bytes.captions = fs.statSync(path.join(out, files.captions)).size;
    }
    const beats = clips.flatMap((clip, i) => (clip.pip ? clip.beats : beatTimes(clip.log.events, clip.piece.steps, speed)).map(b => ({...b, t: Number((b.t + starts[i] / speed).toFixed(2))})));
    return videoEntry({name, piece, files, bytes, seconds, beats});
  };
}

async function makeStills(kinds, persona, work, out) {
  const dir = path.join(work, 'stills');
  fs.mkdirSync(dir, {recursive: true});
  const shots = await shootApp({persona, stills: kinds.includes('stills') ? STILLS : {}, snips: kinds.includes('snips') ? SNIPS : {}, dir});
  return shots.map(shot => {
    const emails = realEmails(shot.text);
    if (emails.length) throw new Error(`media: ${shot.kind} ${shot.name}: an e-mail address that may be real is on screen: ${emails.join(', ')}`);
    const left = leftWords(shot.text, persona.forbid);
    if (left.length) throw new Error(`media: ${shot.kind} ${shot.name}: the default demo person shows through: ${left.join(', ')}`);
    const encoded = encodeStill({png: shot.file, name: shot.name, kind: shot.kind, outDir: out});
    return stillEntry({name: shot.name, kind: shot.kind, ...encoded, shows: (shot.kind === 'still' ? STILLS : SNIPS)[shot.name].shows});
  });
}

// All of them to their end (a failure lets the others' recordings and renders finish), then every failure named at once. -> the values.
async function settled(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) throw new Error(failed.map(result => result.reason?.message || String(result.reason)).join('\n'));
  return results.map(result => result.value);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const persona = loadPersona(options.persona);
  const missing = missingEncoders();
  if (missing.length) throw new Error(`this ffmpeg lacks ${missing.join(', ')} (brew install ffmpeg)`);
  const work = path.join(options.out, '.work');
  if (options.words) {
    if (options.words === options.out) throw new Error('media: --words reads another set: give a new --out');
    wordsFrom = path.join(options.words, '.work');
  }
  fs.mkdirSync(work, {recursive: true});
  execFileSync(process.execPath, [path.join(desktop, 'scripts', 'stage.mjs')], {cwd: desktop, stdio: 'ignore'});   // the app imports shared/ (npm start does the same)
  const entries = [];
  // every take of every piece recorded (TAKES at once) and checked first (a bad scene stops in a minute), then every copy rendered, RENDERS at once
  run.appSha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: desktop, encoding: 'utf8'}).trim();
  run.day = new Date().toLocaleDateString('sv');   // YYYY-MM-DD, local: the demo's dates follow it
  const finishes = await settled(options.pieces.filter(piece => VIDEOS[piece] && !VIDEOS[piece].part).map(name => makeVideo(name, persona, work, options.out)));
  entries.push(...await settled(finishes.map(finish => finish())));
  const kinds = options.pieces.filter(piece => piece === 'stills' || piece === 'snips');
  if (kinds.length) entries.push(...await makeStills(kinds, persona, work, options.out));
  const file = path.join(options.out, 'manifest.json');
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: desktop, encoding: 'utf8'}).trim();
  fs.writeFileSync(file, `${JSON.stringify(manifest({entries, previous, made: {sha, at: new Date().toISOString(), persona: persona.name}}), null, 2)}\n`);
  if (!options.keep) fs.rmSync(work, {recursive: true, force: true});
  console.log(`media: DONE ${entries.length} piece(s) → ${options.out}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  // an error a library throws outside our awaits (run 22: Playwright's "Process failed to launch!") still ends as a named failure
  for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { console.error(`media: FAILED ${error?.message || error} (${event})`); process.exit(1); });
  main().catch(error => { console.error(`media: FAILED ${error.message}`); process.exit(1); });
}
