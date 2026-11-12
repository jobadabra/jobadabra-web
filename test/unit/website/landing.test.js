// The redesigned site (owner, 20 Oct 2026: a landing 80% shorter, the detail spread over its own pages, reached from the menu or "More info"):
// every page shares one menu and footer, Mac and Windows downloads are equal wherever one is offered, old landing links still land, and the sitemap
// lists every public page. Loops over the files, so a page added later is checked too.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../../web/public/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8');
const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
const UNLISTED = ['friends.html', 'ready-live.html', 'open.html'];   // a page for early testers and the hand-off page the app opens: linked, never indexed
const NO_MENU = ['ready-live.html', 'open.html'];
const nav = html => (html.match(/<nav class="topnav[\s\S]*?<\/nav>/) || [''])[0].replace(/ aria-current="page"/g, '');
const foot = html => (html.match(/<footer class="site-foot"[\s\S]*?<\/footer>/) || [''])[0];
const pageOf = href => href.replace(/#.*$/, '').replace(/^\/$/, '/index').replace(/^\//, '') + '.html';

test('every page with a menu has the landing\'s menu, word for word, and marks where you are', () => {
  const menu = nav(read('index.html'));
  assert.match(menu, /href="\/download">Download<\/a>/);
  for (const name of pages.filter(page => !NO_MENU.includes(page))) {
    assert.equal(nav(read(name)), menu, `${name}: the menu differs from the landing's`);
    const here = `/${name.replace(/\.html$/, '')}`;
    if (menu.match(/<div class="links">[\s\S]*?<\/div>/)[0].includes(`href="${here}"`)) assert.match(read(name), new RegExp(`<a href="${here}" aria-current="page">`), `${name}: not marked`);
  }
});

test('every listed page has the landing\'s footer, and loads the shared script', () => {
  const footer = foot(read('index.html'));
  assert.ok(footer, 'the landing has a footer');
  for (const name of pages.filter(page => !UNLISTED.includes(page))) assert.equal(foot(read(name)), footer, `${name}: the footer differs`);
  for (const name of pages.filter(page => !NO_MENU.includes(page))) assert.match(read(name), /<script src="\/?site\.js"/, name);
});

test('every footer carries the maker line once, as one small accent card under the brand line (owner, 24 Oct 2026)', () => {
  for (const name of pages.filter(page => foot(read(page)))) {
    const found = foot(read(name)).match(/<p class="maker">.*?<b>Built by an SRE in Geneva<\/b><small>Used daily by its maker\.<\/small><\/span><\/p>/g) || [];
    assert.equal(found.length, 1, `${name}: the maker line is not there exactly once`);
  }
  assert.doesNotMatch(read('styles.css'), /\.maker/, 'the old hero card styles are gone');
});

test('Mac and Windows downloads are equally visible wherever a download is offered (owner, 20 Oct 2026)', () => {
  const link = /<a ([^>]*?)href="\/download\/(mac|windows)\?from=([\w-]+)"[^>]*>/g;
  for (const name of pages) {
    const seen = {};
    for (const [, before, os, from] of read(name).matchAll(link)) {
      const look = (before.match(/class="([^"]*)"/) || [, 'plain'])[1];
      (seen[`${from} ${look}`] ||= {mac: 0, windows: 0})[os]++;
    }
    for (const [where, count] of Object.entries(seen)) assert.equal(count.mac, count.windows, `${name}: ${where} offers Mac ${count.mac}x, Windows ${count.windows}x`);
  }
});

test('every moved section of the old landing still lands: its anchor sends the visitor to the page and section it moved to', () => {
  const script = read('site.js');
  const map = Object.fromEntries([...script.match(/const MOVED = \{([\s\S]*?)\};/)[1].matchAll(/'?([\w-]+)'?: '([^']+)'/g)].map(m => [m[1], m[2]]));
  for (const [id, to] of Object.entries(map)) {
    assert.ok(existsSync(new URL(pageOf(to), dir)), `#${id} -> ${to}: no such page`);
    const section = to.split('#')[1];
    if (section) assert.match(read(pageOf(to)), new RegExp(` id="${section}"`), `#${id} -> ${to}: no such section`);
  }
  assert.match(read('index.html'), /<body[^>]* data-page="home"/);
});

test('every picture and video a page shows exists (the media set is placed by file name, so a renamed file fails here)', () => {
  for (const name of pages) {
    for (const [, path] of read(name).matchAll(/(?:src|poster)="(\/?(?:media|images)\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(path.replace(/^\//, ''), dir)), `${name}: ${path} is missing`);
    }
  }
});

test('robots.txt does not hide the public Intelligence page', () => {
  assert.doesNotMatch(read('robots.txt'), /Disallow: \/intelligence/);   // a leftover from the owner's old private dashboard; the page is public
});

test('the sitemap lists every public page, and only pages that exist', () => {
  const listed = [...read('sitemap.xml').matchAll(/<loc>https:\/\/www\.jobadabra\.top(\/[^<]*)<\/loc>/g)].map(m => pageOf(m[1]));
  assert.deepEqual([...listed].sort(), pages.filter(page => !UNLISTED.includes(page)).sort());
});

test('the landing stays short: one hero, the numbers, three cards, the whole journey, privacy first, the benchmark summary, one closing download', () => {
  const html = read('index.html');
  assert.equal((html.match(/<section\b/g) || []).length, 6, 'sections on the landing');   // numbers, steps, journey, privacy-first, benchmarks, start; the hero is a header. Why (6 Nov 2026, owner): "a small section … saying that we value the Privacy"; (12 Nov 2026, owner): "a small/summary/preview card or section on the fist page of our website with a link to full benchmarks"
  assert.equal((html.match(/class="card-foot arrow-link" href="\/how-it-works#/g) || []).length, 3, 'each card leads to its detail');
  for (const href of html.matchAll(/href="(\/[\w-]*)(?:#[\w-]+)?"/g)) {
    if (/^\/(download|install|api)\b/.test(href[1])) continue;
    assert.ok(existsSync(new URL(pageOf(href[1]), dir)), `link to missing page ${href[1]}`);
  }
});

// The hero's stage (owner, 24 Oct 2026, sketch MD1RKmELpnh7rzkprJkKfg + his review): one stage, four clips of one made-up person and one job, the owner's
// captions above the clip, steps with a progress line and a pause button, tighter phone copies with their own posters, nothing autoplays under reduced motion.
const CAPTIONS = ['Add your CV. Shape your search.', 'Find matching jobs. See why they fit.', 'Fill applications with your details.', 'Your interviews and next steps, together.'];
test('the hero is one stage of four clips: the first loads, the rest wait; each has its caption, posters and a phone copy', () => {
  const html = read('index.html');
  const stage = html.match(/<div class="hero-stage"[\s\S]*?<div class="stage-steps"[\s\S]*?<\/div>/)[0];
  const clips = [...stage.matchAll(/<video class="slide[^>]*>[\s\S]*?<\/video>/g)].map(match => match[0]);
  assert.equal(clips.length, 4);
  clips.forEach((clip, i) => {
    assert.match(clip, new RegExp(`preload="${i === 0 ? 'auto' : 'none'}"`), `clip ${i + 1} preload`);
    assert.match(clip, /poster="\/media\/[^"]+-poster\.jpg"/, `clip ${i + 1} poster`);
    assert.match(clip, /data-phone-poster="\/media\/[^"]+-1080-poster\.jpg"/, `clip ${i + 1} phone poster`);
    assert.match(clip, /-1080\.mp4" type="video\/mp4" media="\(max-width: 720px\)"/, `clip ${i + 1} phone copy (round 9: 1080 wide)`);
    assert.match(clip, /data-captions="\/media\/[a-z-]+\.vtt"/, `clip ${i + 1}: its captions for the line under the phone copy`);
    assert.ok(clip.includes(`data-cap="${CAPTIONS[i]}"`), `clip ${i + 1} caption`);
    assert.match(clip, /data-sub="[^"]{10,}"/, `clip ${i + 1} supporting line`);
    assert.match(clip, /\(made-up example\)"/, `clip ${i + 1} says it is an example`);
    assert.doesNotMatch(clip, i === 0 ? /loop/ : /autoplay|loop/, `clip ${i + 1}: the script advances it; only the first asks the browser to autoplay (iOS, owner 25 Oct 2026), none loops`);
  });
  assert.ok(stage.includes(`<b class="stage-title"><span class="m-hide">${CAPTIONS[0]}</span>`), 'the first caption is there without the script');
  assert.match(clips[2], /data-sub="Review your answers, then submit\."/, 'Apply hands over to the person');
  assert.match(clips[3], /data-later="2 weeks later"/, 'Track is later in the same example');
  // Round 2 (owner, 24 Oct 2026: "label not on the text"): the "later" words are a tag in the caption line above the stage, never drawn over the video.
  assert.match(stage, /<p class="stage-cap"><span class="stage-later" hidden><\/span><b class="stage-title">/, 'the later tag leads the caption');
  assert.doesNotMatch(stage.match(/<div class="stage-screen">[\s\S]*?<video/)[0], /stage-later/, 'nothing sits on top of the video');
  assert.doesNotMatch(read('home.css').match(/\.stage-later \{[^}]*\}/)[0], /position: absolute/, 'the tag flows in the caption line');
  assert.equal((stage.match(/<button type="button" aria-label="(Set up|Find|Apply|Track)"/g) || []).length, 4, 'one step per clip');
  assert.match(stage, /class="stage-pause" aria-label="Pause"/);
  assert.match(html, /<script type="module" src="hero-stage\.js">/);
});

test('the stage script: plays in turn, steps jump, pause, phone posters, nothing plays by itself under reduced motion', () => {
  const js = read('hero-stage.js');
  for (const hook of [/addEventListener\('ended'/, /prefers-reduced-motion: reduce/, /max-width: 720px/, /dataset\.phonePoster/, /IntersectionObserver/, /visibilitychange/, /--played/])
    assert.match(js, hook);
  const css = read('home.css');
  assert.match(css, /@media \(max-width: 720px\) \{ \.stage-screen \{ aspect-ratio: 4 \/ 3; \} \}/, 'phones show the 4:3 copies');
  assert.match(css, /\.stage-screen \{[^}]*rgb\(255 178 36/, 'a restrained amber glow around the frame');
  // 440px (was 420 until 31 Oct 2026): the Mac button and the Windows split button (its caret) must fit one row in the words column.
  assert.match(css, /\.hero\.split \{ grid-template-columns: minmax\(440px, 3\.8fr\) minmax\(0, 8fr\)/, 'the hero is one row: words left, the stage right');
});

// Round 9 (owner, 24 Oct 2026: "move the subtitles/captions out of the video, let's put them below, at least on mobile, they hide some buttons/actions"):
// phones show the step's caption in a line under the video, read from the clip's WebVTT track; desktop keeps it drawn in the video.
test('on phones the step caption sits under the video, from the clip\'s caption track; the line keeps its height', () => {
  const html = read('index.html'), js = read('hero-stage.js'), css = read('home.css');
  const stage = html.match(/<div class="stage-screen">[\s\S]*?<div class="stage-steps"/)[0];
  assert.match(stage, /<\/video>\s*<\/div>\s*<p class="stage-say" hidden><b class="stage-say-tag"><\/b><span class="stage-say-text"><\/span><\/p>\s*<div class="stage-steps"/, 'between the video and the steps, never on the video');
  for (const hook of [/kind: 'metadata', src: clip\.dataset\.captions/, /el\.track\.mode = 'hidden'/, /addEventListener\('cuechange'/, /JSON\.parse\(cue\.text\)/, /phone && say \?/])
    assert.match(js, hook);
  assert.match(css, /\.stage-say \{ display: none; \}/, 'desktop: no line (the caption is in the video)');
  assert.match(css, /@media \(max-width: 720px\) \{\n  \.stage-say:not\(\[hidden\]\) \{ display: flex;[^}]*min-height: 1\.9rem/, 'phones: one line, its height kept');
  assert.match(css, /\.stage-say\.is-empty \{ visibility: hidden; \}/, 'no caption: the space stays, the steps never jump');
});

// Round 6 (owner, 24 Oct 2026: "make a nice transition effect, not just an instant screen/image replacement"): every switch between clips (the end of
// one, a step clicked, the loop back to Set up) comes in by the clip's data-into; reduced motion switches at once.
test('every clip switch on the stage comes in by its transition, never an instant swap', () => {
  const js = read('hero-stage.js'), css = read('home.css');
  assert.match(js, /async function show\(i\) \{[\s\S]*?comeIn\(clips\[before\], clips\[on\]/, 'show() (ended, steps, the first clip) runs the transition');
  assert.match(js, /if \(still \|\| !from \|\| from === to/, 'reduced motion: no transition');
  for (const kind of ['fade', 'slide', 'tiles']) assert.match(js, new RegExp(`${kind}: \\d+`), `the script knows ${kind}`);
  assert.match(css, /\.slide\.is-leaving \{ opacity: 1; z-index: 0; \}/, 'the old clip stays under the new one until it is in');
  assert.match(css, /\.is-coming\.in-slide \{[^}]*mask-image: linear-gradient\(to right/, 'slide: a soft edge from the right');
  assert.match(css, /\.is-coming\.in-tiles \{[^}]*radial-gradient\(circle, #000 var\(--tile\)/, 'tiles: tiles growing');
  assert.match(css, /@property --tile/, 'the tiles size animates');
});

// Owner, 24 Oct 2026 ("allow pause of the video", shot of a click on the picture): the picture itself pauses and plays, through the same switch as the
// button, and a paused stage shows a play mark over it, so a click on the video never does nothing.
test('a click on the hero picture pauses and plays it, and a paused stage shows a play mark', () => {
  const js = read('hero-stage.js');
  assert.match(js, /const screen = root\?\.querySelector\('\.stage-screen'\)/, 'the script finds the picture');
  assert.match(js, /screen\.addEventListener\('click', \(\) => setPaused\(!paused\)\)/, 'a click on the picture toggles like the button');
  assert.match(js, /pause\.addEventListener\('click', \(\) => setPaused\(!paused\)\)/, 'the button still toggles');
  assert.match(js, /screen\.classList\.toggle\('is-paused', paused\)/, 'only the person\'s pause shows the mark, not a hidden tab or a scrolled-away stage');
  const css = read('home.css');
  assert.match(css, /\.stage-screen \{[^}]*cursor: pointer/, 'the picture looks clickable');
  assert.match(css, /\.stage-screen\.is-paused::after \{/, 'a paused stage draws a play mark');
  assert.match(css, /\.stage-screen::after \{[^}]*pointer-events: none/, 'the mark never takes the click');
});

test('the hero stage stays inside the page\'s content column (owner, 24 Oct 2026: "the video goes out of the site content wrapper")', () => {
  const css = read('home.css');
  const visual = (css.match(/\.hero\.split \.hero-visual \{[^}]*\}/) || [''])[0];
  assert.ok(visual, 'the split hero styles its visual column');
  assert.doesNotMatch(visual, /margin(-right|-inline)?\s*:[^;]*-/, 'no negative margin pulls the stage into the page margin');
  assert.doesNotMatch(css, /\.hero-stage[^{]*\{[^}]*margin[^;]*:\s*(calc\()?-/, 'nor on the stage itself');
});
