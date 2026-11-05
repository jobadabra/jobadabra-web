// The landing hero's stage (index.html #hero-stage; owner, 24 Oct 2026): four short clips of one made-up person and one job, played in turn on one stage.
// A clip ends, the next comes in once its first frame is decoded (owner, 24 Oct 2026: "smooth transitions without blank frames": the old clip stays on
// screen until then, never its end-frame poster), by its `data-into` (round 6: "make a nice transition effect, not just an instant screen/image
// replacement"; media/scenes.mjs stageInto): slide = a soft edge sweeping in from the right (from the left for a step back), tiles = growing tiles
// (time passed), fade; reduced motion switches at once; its caption goes above the stage (a "later" clip leads it with a tag, never over the video) and its step's line fills as it plays. The steps jump to a clip, the pause button
// (or a click on the picture, which then shows a play mark) holds it (as do a hidden tab and a stage scrolled out of view); the next clip is fetched while the current one plays. Phones (the 1080 copies, 4:3) get
// their own posters, and the step's caption under the video (round 9, owner 24 Oct 2026: "move the subtitles/captions out of the video ... at least on
// mobile, they hide some buttons"): the phone copy has none drawn on it; its WebVTT track (media/captions.mjs vttOf) gives the line. With reduced motion nothing plays by itself: the posters show, a step switches them, play starts a clip. Guarded by test/unit/website/landing.test.js.
const root = document.getElementById('hero-stage');
const clips = root ? [...root.querySelectorAll('video.slide')] : [];
const steps = root ? [...root.querySelectorAll('.stage-steps button:not(.stage-pause)')] : [];
const pause = root?.querySelector('.stage-pause');
const screen = root?.querySelector('.stage-screen');
const cap = root?.querySelector('.stage-cap');
const later = root?.querySelector('.stage-later');
const say = root?.querySelector('.stage-say');
const PAUSE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 3h3v10H4zm5 0h3v10H9z"/></svg>';
const SPEED = 1.5;
const PLAY ='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 3l8 5-8 5z"/></svg>';

if (root && clips.length) {
  const phone = matchMedia('(max-width: 720px)').matches;
  if (phone) clips.forEach(clip => { if (clip.dataset.phonePoster) clip.poster = clip.dataset.phonePoster; });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Every clip plays at SPEED on top of its render (scenes.mjs speed 1.5): 2.25x of real time in all (owner, 25 Oct 2026: "impose a 1.5x speed for all the clips", meaning 50% faster
  // than the clips he had watched); the captions follow, they are timed on the clip's own clock.
  clips.forEach(clip => { clip.defaultPlaybackRate = SPEED; clip.playbackRate = SPEED; });
  // A browser that refuses to start a clip by itself (iOS in Low Power Mode, owner's phone 25 Oct 2026: stuck on the poster) shows the play mark; a tap starts it.
  const start = clip => {
    clip.playbackRate = SPEED;
    clip.play().catch(error => { if (error.name === 'NotAllowedError' && clip === clips[on] && seen) setPaused(true); });   // before the stage has been seen (a play() below the fold, which iOS refuses) the observer retries once it shows
  };
  // Phones: each clip's captions as a hidden metadata track (loaded with the page, read as the clip plays); the line under the video shows the current one.
  const tracks = phone && say ? clips.map(clip => {
    if (!clip.dataset.captions) return null;
    const el = Object.assign(document.createElement('track'), {kind: 'metadata', src: clip.dataset.captions, default: true});
    clip.append(el); el.track.mode = 'hidden';
    return el.track;
  }) : [];
  if (tracks.some(Boolean)) say.hidden = false;
  const sayNow = () => {
    if (!tracks.length) return;
    let line = null;
    try { const cue = tracks[on]?.activeCues?.[0]; line = cue ? JSON.parse(cue.text) : null; } catch { line = null; }
    say.querySelector('.stage-say-tag').textContent = line?.tag || '';
    say.querySelector('.stage-say-text').textContent = line?.say || '';
    say.classList.toggle('is-empty', !line?.say);
  };
  let on = 0, paused = still, hidden = false, away = false, seen = !('IntersectionObserver' in window);
  const warm = i => { const clip = clips[i % clips.length]; if (clip.preload !== 'auto') { clip.preload = 'auto'; clip.load(); } };
  const playing = () => !paused && !hidden && !away;

  let ask = 0;
  // Ready to show: the clip has its frame at 0 decoded. Gives up after 3 s (a slow network): the cut then shows the poster rather than hang.
  const ready = clip => new Promise(done => {
    const go = () => { clearTimeout(late); clip.removeEventListener('seeked', check); clip.removeEventListener('loadeddata', check); done(); };
    const check = () => { if (clip.readyState >= 2 && !clip.seeking) go(); };
    const late = setTimeout(go, 3000);
    clip.addEventListener('seeked', check); clip.addEventListener('loadeddata', check);
    warm(clips.indexOf(clip));
    try { clip.currentTime = 0; } catch { /* no metadata yet: it starts at 0 */ }
    check();
  });

  // The incoming clip's mask moves across it (home.css .is-coming); the old one stays under it until the end.
  const IN = {fade: 450, slide: 500, tiles: 700};
  let leaving = null;
  const comeIn = (from, to, back) => {
    const kind = IN[to.dataset.into] ? to.dataset.into : 'fade';
    leaving?.classList.remove('is-leaving');
    if (still || !from || from === to || !to.animate) return;
    from.classList.add('is-leaving'); leaving = from;
    to.classList.add('is-coming', `in-${kind}`); to.classList.toggle('is-back', back);
    const frames = kind === 'fade' ? [{opacity: 0}, {opacity: 1}]
      : kind === 'tiles' ? [{'--tile': '0%'}, {'--tile': '100%'}]
      : back ? [{maskPosition: '100% 0', webkitMaskPosition: '100% 0'}, {maskPosition: '0% 0', webkitMaskPosition: '0% 0'}]
      : [{maskPosition: '0% 0', webkitMaskPosition: '0% 0'}, {maskPosition: '100% 0', webkitMaskPosition: '100% 0'}];
    const run = to.animate(frames, {duration: IN[kind], easing: 'cubic-bezier(.45,0,.25,1)'});
    const done = () => { from.classList.remove('is-leaving'); to.classList.remove('is-coming', 'is-back', 'in-fade', 'in-slide', 'in-tiles'); if (leaving === from) leaving = null; };
    run.onfinish = done; run.oncancel = done;
  };

  async function show(i) {
    const next = (i + clips.length) % clips.length, mine = ++ask;
    if (playing()) await ready(clips[next]);   // paused (or reduced motion): the poster is the picture, switch at once
    if (mine !== ask) return;   // a later step click won
    const before = on;
    on = next;
    clips.forEach((clip, k) => {
      clip.classList.toggle('is-on', k === on);
      if (k !== on) clip.pause();
    });
    comeIn(clips[before], clips[on], on < before && !(before === clips.length - 1 && on === 0));
    steps.forEach((step, k) => {
      if (k === on) step.setAttribute('aria-current', 'true'); else step.removeAttribute('aria-current');
      step.style.setProperty('--done', k < on ? '1' : '0');
      step.style.setProperty('--played', '0');
    });
    const clip = clips[on];
    const title = cap.querySelector('.stage-title');
    title.querySelector('.m-hide').textContent = clip.dataset.cap || '';
    title.querySelector('.m-only').textContent = clip.dataset.short || clip.dataset.cap || '';
    cap.querySelector('.stage-step').textContent = `0${on + 1} / ${steps[on].getAttribute('aria-label')}`;   // the phone's one short label above the title
    cap.querySelector('.stage-sub').textContent = clip.dataset.sub || '';
    if (later) { later.textContent = clip.dataset.later || ''; later.hidden = !clip.dataset.later; }
    sayNow();
    if (playing()) start(clip);
  }

  tracks.forEach((track, k) => track?.addEventListener('cuechange', () => { if (k === on) sayNow(); }));
  clips.forEach((clip, k) => {
    clip.addEventListener('playing', () => { if (k === on) warm(on + 1); });
    clip.addEventListener('ended', () => { if (k === on && playing()) show(on + 1); });
  });
  steps.forEach((step, k) => step.addEventListener('click', () => show(k)));
  function setPaused(value) {
    paused = value;
    pause.innerHTML = paused ? PLAY : PAUSE;
    pause.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    screen.classList.toggle('is-paused', paused);   // the person's pause only: a hidden tab or a scrolled-away stage shows no mark
    if (playing()) start(clips[on]); else if (!clips[on].paused) clips[on].pause();   // pause() on a clip still waiting to autoplay cancels the browser's own start (iOS)
  }
  pause.addEventListener('click', () => setPaused(!paused));
  screen.addEventListener('click', () => setPaused(!paused));   // a click on the picture pauses and plays it too (owner, 24 Oct 2026); the button stays the keyboard way
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; setPaused(paused); });
  if ('IntersectionObserver' in window) new IntersectionObserver(([entry]) => { away = !entry.isIntersecting; seen = true; setPaused(paused); }).observe(root);

  // The step's line: how far the current clip has played.
  const line = () => {
    const clip = clips[on], step = steps[on];
    if (step && clip.duration) step.style.setProperty('--played', String(Math.min(1, clip.currentTime / clip.duration)));
    requestAnimationFrame(line);
  };
  setPaused(still);
  show(0);
  requestAnimationFrame(line);
}
