/* global document, createImageBitmap, Path2D, Blob */
// Draws a product video from recorded frames (media): each output frame is a recorded frame moved and scaled through the camera
// (a float transform, so pans are smooth), plus a cursor and a click ring. The app's pixels are never redrawn, only graded (grade.mjs). Electron's canvas does the drawing in a
// hidden window; raw pixels go to ffmpeg, which writes one high-quality master (encode.mjs makes the site's files from it).
// Run by media.mjs: electron render.cjs <job.json>. job: {framesDir, encoder? (ffmpeg's video codec args, renders.mjs masterEncoder), frames: [{file, x, y, w, h, cx, cy, press, say, sayAge, tag, from?, kind?, mix?, card?, cardAlpha?, layers?}], scale, width, height, fps, captionSize, sayFade, out, ffmpeg, gradeSvg (grade.mjs)};
// a frame's `say` is drawn as a caption band at the bottom (captions.mjs), fading in over sayFade seconds of sayAge; a transition (transitions.mjs)
// mixes `from` (the old screen) by `kind` and `mix` (fade, slide, tiles), or lays a title `card` over the frame at `cardAlpha`
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');

const job = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));

// Runs inside the hidden window (nodeIntegration): a canvas, the frames drawn in order, raw RGBA to ffmpeg's stdin.
async function draw(job) {
  const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
  const canvas = document.createElement('canvas');
  canvas.width = job.width; canvas.height = job.height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const ffmpeg = spawn(job.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${job.width}x${job.height}`,
    '-r', String(job.fps), '-i', 'pipe:0', '-an', ...(job.encoder || ['-c:v', 'libx264', '-preset', 'medium', '-crf', '12']), '-pix_fmt', 'yuv420p', job.out], {stdio: ['pipe', 'ignore', 'pipe']});
  let error = '';
  ffmpeg.stderr.on('data', chunk => { error += chunk; });
  const done = new Promise(resolve => ffmpeg.on('close', resolve));
  const write = buffer => new Promise(resolve => { if (ffmpeg.stdin.write(buffer)) resolve(); else ffmpeg.stdin.once('drain', resolve); });
  const s = job.scale, unit = job.width / 1600;   // frame px per page CSS px; the cursor's size follows the output width
  // recorded frames as bitmaps, the last few kept (a transition draws the old screen and the new one for many frames)
  const bitmaps = new Map();
  const load = async (file, dir = job.framesDir) => {
    const key = path.join(dir, file);
    if (bitmaps.has(key)) { const kept = bitmaps.get(key); bitmaps.delete(key); bitmaps.set(key, kept); return kept; }
    const made = await createImageBitmap(new Blob([fs.readFileSync(key)], {type: 'image/jpeg'}));
    bitmaps.set(key, made);
    if (bitmaps.size > 6) { const [old, gone] = bitmaps.entries().next().value; gone.close(); bitmaps.delete(old); }
    return made;
  };
  // picture in picture (pip.mjs): each layer is a recording through its own camera, placed in its rect; an inset is rounded, edged and shadowed
  const layers = async list => {
    ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, job.width, job.height);
    for (const one of list) {
      const bitmap = await load(one.file, one.dir), k = one.scale, r = one.rect, round = one.framed ? job.width * 0.012 : 0;
      ctx.save(); ctx.globalAlpha = one.alpha ?? 1;
      if (one.framed) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = job.width * 0.02; ctx.shadowOffsetY = job.width * 0.004; ctx.fillStyle = '#0b0f14'; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, round); ctx.fill(); ctx.shadowColor = 'transparent'; }
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, round); ctx.clip();
      ctx.drawImage(bitmap, one.x * k, one.y * k, one.w * k, one.h * k, r.x, r.y, r.w, r.h);
      if (one.framed) { ctx.lineWidth = Math.max(2, job.width * 0.0025); ctx.strokeStyle = one.dim ? 'rgba(255, 255, 255, 0.14)' : 'rgba(242, 169, 59, 0.85)'; ctx.stroke(); }   // dim: the split's pane that is not acting (pip.mjs splitPlan)
      ctx.restore();
    }
  };
  // the split's pane names (pip.mjs splitPlan): an amber number, then the words in small spaced capitals, sitting on the pane's top edge
  const labels = list => {
    const size = Math.round(job.width * 0.0085);
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = `${(size * 0.14).toFixed(1)}px`;
    for (const one of list) {
      ctx.font = `700 ${size}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`; ctx.fillStyle = '#ffb224'; ctx.fillText(one.num, one.x + 2, one.y);
      const at = one.x + 2 + ctx.measureText(one.num).width + size * 0.9;
      ctx.font = `600 ${size}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`; ctx.fillStyle = '#93a1b0'; ctx.fillText(one.text.toUpperCase(), at, one.y);
    }
    ctx.restore();
  };
  const view = (target, bitmap, v) => target.drawImage(bitmap, v.x * s, v.y * s, v.w * s, v.h * s, 0, 0, job.width, job.height);
  const layer = document.createElement('canvas'); layer.width = job.width; layer.height = job.height;
  const lctx = layer.getContext('2d'); lctx.imageSmoothingEnabled = true; lctx.imageSmoothingQuality = 'high';
  const tiny = document.createElement('canvas'), tctx = tiny.getContext('2d');
  // tiles: the screen drawn in blocks of `size` px (render a small copy, scale it up unsmoothed)
  const blocks = (bitmap, v, size, alpha) => {
    tiny.width = Math.max(1, Math.round(job.width / size)); tiny.height = Math.max(1, Math.round(job.height / size));
    tctx.imageSmoothingEnabled = true; tctx.drawImage(bitmap, v.x * s, v.y * s, v.w * s, v.h * s, 0, 0, tiny.width, tiny.height);
    ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false; ctx.drawImage(tiny, 0, 0, job.width, job.height); ctx.restore();
  };
  // the demo's grade (grade.mjs): the app's pixels drawn so far go through the SVG filter; captions, tags, cards and the cursor come after, ungraded
  const graded = document.createElement('canvas'); graded.width = job.width; graded.height = job.height;
  const gctx = graded.getContext('2d');
  if (job.gradeSvg) document.body.insertAdjacentHTML('beforeend', job.gradeSvg);
  const grade = () => {
    if (!job.gradeSvg) return;
    gctx.clearRect(0, 0, job.width, job.height); gctx.drawImage(canvas, 0, 0);
    ctx.save(); ctx.clearRect(0, 0, job.width, job.height); ctx.filter = 'url(#grade)'; ctx.drawImage(graded, 0, 0); ctx.restore();
  };
  for (const frame of job.frames) {
    const bitmap = frame.layers ? null : await load(frame.file);
    if (frame.layers) await layers(frame.layers);
    else if (frame.from) {   // a transition (transitions.mjs): the old screen under the new one, mixed by kind
      const old = await load(frame.from.file), m = frame.mix;
      if (frame.kind === 'tiles') {   // blocks grow to ~1/30 of the width, the screens swap at the middle, then the blocks shrink
        const size = Math.max(1, Math.round(job.width / 30 * Math.sin(Math.PI * m)));
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, job.width, job.height);
        blocks(old, frame.from, size, 1);
        blocks(bitmap, frame, size, Math.max(0, Math.min(1, (m - 0.35) / 0.3)));
      } else {
        view(ctx, old, frame.from);
        lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, job.width, job.height); view(lctx, bitmap, frame);
        if (frame.kind === 'slide') {   // a soft edge sweeping in from the right (half the width wide)
          const edge = job.width * (1 - 1.5 * m), wipe = lctx.createLinearGradient(edge, 0, edge + job.width / 2, 0);
          wipe.addColorStop(0, 'rgba(0,0,0,0)'); wipe.addColorStop(1, 'rgba(0,0,0,1)');
          lctx.globalCompositeOperation = 'destination-in'; lctx.fillStyle = wipe; lctx.fillRect(0, 0, job.width, job.height);
          ctx.drawImage(layer, 0, 0);
        } else { ctx.save(); ctx.globalAlpha = m; ctx.drawImage(layer, 0, 0); ctx.restore(); }   // fade
      }
    } else view(ctx, bitmap, frame);
    grade();
    if (frame.labels) labels(frame.labels);   // words come after the grade, like the captions
    const px = (frame.cx - frame.x) * job.width / frame.w, py = (frame.cy - frame.y) * job.height / frame.h;
    if (frame.press != null && frame.press < job.ring) {   // the click ring: grows and fades
      const k = frame.press / job.ring;
      ctx.beginPath(); ctx.arc(px, py, (16 + 50 * k) * unit, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 150, 60, ${0.9 * (1 - k)})`; ctx.lineWidth = 4 * unit; ctx.stroke();
    }
    if (frame.say) {   // the step's caption (captions.mjs): a band low in the frame, under the cursor, fading in
      let size = job.captionSize;
      const font = px => `600 ${px}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
      ctx.save(); ctx.font = font(size);
      // the tag (where the frame is): an amber chip leading the line, in a monospace face (captions.mjs)
      const tagFont = px => `700 ${Math.round(px * 0.78)}px "SF Mono", Menlo, Consolas, monospace`, tag = frame.tag ? frame.tag.toUpperCase() : '';
      const widths = () => { ctx.font = tagFont(size); const t = tag ? ctx.measureText(tag).width + size * 0.9 : 0; ctx.font = font(size); return {t, s: ctx.measureText(frame.say).width}; };
      let m = widths();
      while (m.t + m.s + size * 0.6 > job.width * 0.86 && size > 10) { size -= 1; m = widths(); }
      const gap = tag ? size * 0.6 : 0, w = m.t + gap + m.s, padX = size * 0.75, h = size * 1.9, x = (job.width - w) / 2 - padX, y = job.height - h - size * 0.8;
      ctx.globalAlpha = Math.min(1, (frame.sayAge || 0) / (job.sayFade || 0.25)) * (frame.sayKeep ?? 1);   // gives way to a title card (camera.mjs renderPlan)
      ctx.fillStyle = 'rgba(10, 12, 16, 0.86)'; ctx.beginPath(); ctx.roundRect(x, y, w + 2 * padX, h, size * 0.5); ctx.fill();
      ctx.textBaseline = 'middle';
      if (tag) {
        const ch = size * 1.25;
        ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.roundRect(x + padX, y + (h - ch) / 2, m.t, ch, size * 0.3); ctx.fill();
        ctx.font = tagFont(size); ctx.fillStyle = '#1b1306'; ctx.fillText(tag, x + padX + size * 0.45, y + h / 2 + size * 0.04);
        ctx.font = font(size);
      }
      ctx.fillStyle = '#ffffff'; ctx.fillText(frame.say, x + padX + m.t + gap, y + h / 2 + size * 0.04);
      ctx.restore();
    }
    if (frame.cursor !== false) {
      const c = 1.3 * unit * (frame.press != null && frame.press < 0.12 ? 0.88 : 1);   // pressed: a touch smaller
      ctx.save(); ctx.translate(px, py); ctx.scale(c, c);
      if (frame.wand) {   // the app's own wand cursor (desktop/renderer/assets/wand.svg, owner's pick 25 Oct 2026), its star's centre at the cursor's point
        const line = (y0, y1, color, width) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(0, y1); ctx.stroke(); };
        const star = new Path2D('M0,-10 L2.59,-3.56 L9.51,-3.09 L4.18,1.36 L5.88,8.09 L0,4.4 L-5.88,8.09 L-4.18,1.36 L-9.51,-3.09 L-2.59,-3.56Z');
        ctx.scale(1.25, 1.25); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
        line(6, 23, '#000000', 5.2); ctx.shadowColor = 'transparent';
        line(6, 17, '#f2a93b', 2.6); line(17, 23, '#8a8f9a', 2.6);
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 2.4; ctx.stroke(star); ctx.fillStyle = '#ffd73a'; ctx.fill(star);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4; ctx.stroke(new Path2D('M-3,-4 Q-1,-6.2 1.6,-5.4'));
      } else {
      const arrow = new Path2D('M0 0 L0 24 L6 18.5 L10.5 28 L14 26.5 L9.8 17.3 L17.5 17.3 Z');
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
      ctx.fillStyle = '#ffffff'; ctx.fill(arrow);
      ctx.shadowColor = 'transparent'; ctx.lineWidth = 1.4; ctx.strokeStyle = '#111111'; ctx.stroke(arrow);
      }
      ctx.restore();
    }
    if (frame.card && frame.cardAlpha > 0) {   // a title card over everything: the place's tag and a few words on the page colour
      const size = Math.round(job.width * 0.03), font = `600 ${size}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
      const tagFont = `700 ${Math.round(size * 0.62)}px "SF Mono", Menlo, Consolas, monospace`, tag = (frame.card.tag || '').toUpperCase();
      ctx.save(); ctx.globalAlpha = frame.cardAlpha; ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, job.width, job.height);
      ctx.textBaseline = 'middle'; ctx.font = tagFont; const tw = tag ? ctx.measureText(tag).width + size * 0.8 : 0;
      ctx.font = font; const ww = ctx.measureText(frame.card.text).width, gap = tag ? size * 0.6 : 0, x = (job.width - tw - gap - ww) / 2, y = job.height / 2;
      if (tag) {
        ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.roundRect(x, y - size * 0.7, tw, size * 1.4, size * 0.3); ctx.fill();
        ctx.font = tagFont; ctx.fillStyle = '#1b1306'; ctx.fillText(tag, x + size * 0.4, y + size * 0.04);
      }
      ctx.font = font; ctx.fillStyle = '#ffffff'; ctx.fillText(frame.card.text, x + tw + gap, y + size * 0.04);
      ctx.restore();
    }
    await write(Buffer.from(ctx.getImageData(0, 0, job.width, job.height).data.buffer));
  }
  ffmpeg.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`ffmpeg ${code}: ${error.slice(-400)}`);
  return job.frames.length;
}

app.disableHardwareAcceleration();   // the same pixels on every Mac and runner
app.whenReady().then(async () => {
  const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
  await win.loadURL('about:blank');
  // a renderer killed mid-way (memory) must fail the run, never end it as if done (round 9: a 17-frame phone copy, exit 0)
  win.webContents.on('render-process-gone', (_event, details) => { console.error(`render failed: the renderer is gone (${details.reason})`); app.exit(1); });
  try {
    const frames = await win.webContents.executeJavaScript(`(${draw.toString()})(${JSON.stringify(job)})`);
    console.log(`rendered ${frames} frames`);
    app.exit(0);
  } catch (error) {
    console.error(`render failed: ${error.message}`);
    app.exit(1);
  }
});
