---
name: redo-site-hero-video
description: Redo or improve the website's hero video (the landing page's four-step tour of the desktop app: Set up, Find, Apply, Track) from the real app and the real extension in demo mode, judge it inside the hero at desktop and phone width, get the owner's yes on a side-by-side, place and ship it. Use when the owner says "redo the hero", "improve the hero video", "the hero clip is wrong/unreadable", gives feedback on a hero phase or caption, or after an app screen the hero shows changed.
---

# Redo the site's hero video

The hero (`website/public/index.html` `#hero-stage`) is **four short clips played as one continuous tour** on one fixed stage (owner, 24 Oct 2026):
silent autoplay Set up → Find → Apply → Track, captions as HTML above the stage, clickable step labels with a progress line, a discreet pause,
a tighter 4:3 copy for phones, and a **transition at every screen change** (round 6, owner: "make a nice transition effect, not just an instant screen/image replacement"; never a blank frame, never two screens stuck on top of each other). One made-up person (nurse persona) and **one job**
(Institut Cardio Rhône, Registered Nurse, Cardiac Care Unit) from setup to interview. Approved sketch: https://claude.ai/artifact/MD1RKmELpnh7rzkprJkKfg; round 2 storyboard (every beat): https://claude.ai/artifact/SLjpGZdm31SvGeBvuTiBNg

## The loop (one command per step)
0. **Self-improve as you go** (owner, 24 Oct 2026: "this should be a rule, that we always and constantly self-improve"): every bug, wrong frame,
   wrong number or owner remark becomes, in the same change, a test or gate (it fails on the old code) plus a trap line below; every rule the
   owner states goes into "Every owner rule" at once. Never batch lessons for the end; say in each report where each one landed.
1. **Change** what the owner asked (the map below says where), then `tools/site-run.sh node --test "desktop/test/media-*.test.js"`.
2. **Record**: `tools/hero.sh [pieces]` from your site worktree, in the background (`2>&1 | tee <log>` + Monitor `^(hero|media|hero-preview):|FAILED`).
   Pieces: `hero-onboarding` (Set up), `hero` (Find), `hero-fill` (Apply), `hero-track` (Track); none = all four, ~6 min. Records your local edits
   (it syncs `ops/media/ website/ tools/` into `.overlay`), writes the set to `~/.cache/jobadabra-media/hero-<time>/`, one contact-sheet frame **per beat**
   (`sheets/<piece>.png`, `sheets/<piece>-720.png`; the log prints `hero: <piece> beat <n> <t> s: <words>`) and `preview.png`, and opens the preview.
   **Never edit `tools/hero.sh` while it runs** (bash reads it as it goes; the tail breaks): make the sheets/preview by hand then.
   **Record only what changed** (owner, 24 Oct 2026: "you should have rerecord just one 1/4 clips"; a words-only change re-recorded all four,
   15 min): first list which pieces' steps changed and how. Words only (`say`, `card`, `tag`, `beat`, `caption`, `alt`) need **no new recording**:
   the words are drawn on the recorded frames, so redraw the last set's recordings (`tools/hero.sh --words <set dir> [pieces]`, ~1/3 of the time).
   A new look, step, scene or app change re-records only its pieces. Before any run, tell the owner in one line which pieces, why, and how many
   minutes (he asked "are you done?" twice).
   Encoding finds each file's quality by a binary search (encode.mjs `sharpestFit`, ~4 encodes, not up to 9): a clip over budget fails fast.
3. **Read the sheets, then the preview** (checklist below). Fix and re-record only the pieces that are wrong.
4. **Owner's yes on VIDEO** (owner, 24 Oct 2026: "the before/after should be on video clips, not screenshots ... the before we can take from the
   website/master branch"): `node ops/media/compare.mjs <set dir> <scratch>/compare` makes, per clip, `<piece>-compare.mp4` (left: main's published clip,
   `git show origin/main:website/public/media/<piece>.mp4`; right: this set; labelled, the shorter held) and a GIF of it, phone copies too. Open the
   changed pieces' MP4s for him (file names start with your session's short name), plus `preview.png` as the overview of every beat; ask
   AskUserQuestion (ship / change what) with a recommendation. Never ship clips he hasn't watched.
5. **Place**: `tools/hero.sh --place <set dir>`, then CI's two test steps: `tools/site-run.sh bash tools/check.sh --area site` and
   `tools/site-run.sh bash "$PWD/tools/site-guards.sh" . "$PWD"` (background, tee'd). Never `node --test "desktop/test/*.test.js"` in the overlay:
   it runs every public desktop test without `desktop/shared` or their packages (25 Oct 2026: 282 false fails, all "Cannot find module").
   (`tools/hero.sh --preview` re-renders the side-by-side from what is placed).
6. **Ship** from the worktree: `~/jobadabra/tools/ship.sh --background --body=<file>` (body per `~/jobadabra/tools/pr-body-template.md`, with
   one `| What changed | Before | After |` row per changed clip: `<piece>-before.gif` | `<piece>-after.gif`, each linked to `<piece>-compare.mp4`
   (the body check refuses one combined image, and a header other than exactly `| What changed | Before | After |`: run
   `~/jobadabra/tools/pr-body.sh origin/main --body=<body> >/dev/null` before ship: it runs every body rule, also at most 5 pairs
   (PR2, 25 Oct 2026: ship failed twice, on the header and then on 8 pairs: pick the 4-5 clips/shapes that changed most); all published under a tag, not on the branch:
   `GITHUB_REPOSITORY=GarryOne/jobadabra-web node ~/jobadabra/tools/pr-assets.mjs pr-assets-<branch> <files>`; at most 5 rows); stills only for what is not a clip); Monitor `^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|CONFLICT)`. The owner merges; merge = production (www.jobadabra.top).
After that, the daily `tools/media.sh` refresh re-records the hero pieces from origin/main with everything else; the hero needs this skill only to change.

## Where each thing lives
| What | File |
|---|---|
| Each phase's steps, framing, zooms, captions, budgets | `ops/media/scenes.mjs` (the `hero*` entries; `PHONE`, `ROW`) |
| The made-up person and her data | `ops/media/personas/nurse-lyon/` (`draft.json`, `jobs.json`, ...) |
| "2 weeks later" (Track): records changed for one clip | `ops/media/personas/nurse-lyon/moments/later.json` (`applyEdits`: a key names a list, `"."` = the file is a list (runs.json), a map by id, or one record by its id; `null` drops a field, `_first`, `_drop`, `_add` creates) |
| Beat times in the manifest (sheets, preview) | `ops/media/camera.mjs` `beatTimes`, `ops/media/manifest.mjs` `beats` |
| Camera (steady, cut, phone gain) | `ops/media/camera.mjs` |
| Transitions (fade, slide, tiles, card): kinds, cards' time, part joins | `ops/media/transitions.mjs` (scenes: a look's `into`/`card`, a part's `into`, a clip's `stageInto`); drawn by `media/render.cjs`, on the site by `hero-stage.js` `comeIn` |
| Picture in picture (two recordings of one moment, swapped on each `lead`, synced on `sync`) | `ops/media/pip.mjs`; scenes: a piece's `pip: '<part>'`; `recordPip` in `ops/media/media.mjs`; layers drawn by `media/render.cjs` |
| App / extension recorders, look boxes | `ops/media/record-app.mjs`, `ops/media/record-extension.mjs`; a hold's entry and timing (pure) `ops/media/hold.mjs` |
| Stage markup, captions (`data-cap`, `data-sub`, `data-later`), phone posters | `website/public/index.html` `#hero-stage` |
| Playback (order, cut on first frame, pause, steps) | `website/public/hero-stage.js` |
| Look (frame, amber glow, 4:3 on phones, steps line) | `website/public/home.css` `.hero-stage` |
| The side-by-side | `tools/hero-preview.mjs` |
Tests: `desktop/test/media-{camera,persona,options,manifest}.test.js`, `test/unit/website/landing.test.js`, `test/unit/website/hero-redo.test.js`.

## The toolbox: every way to tell a step, and when it fits (owner, 24 Oct 2026)
Pick per moment, by what the viewer must understand; never one method everywhere. A method not built yet is built into the tool (with a test), not faked in a scene.
| Method | Use it when | Example |
|---|---|---|
| Zoom on a look | one thing on the screen is the point | her job's fit, the count |
| Pan (one camera move) | the point moves within the same screen | the count → "Ready to submit" |
| Click zoom + short hold | how she got to the next screen must be seen | Find: her row → the drawer |
| One after another (parts) | one place finishes before the next starts | Jobs → Applying → Chrome |
| Picture in picture, swapped | two places change at once and one leads at a time; swap when the lead changes | Apply: the card follows Chrome's fill |
| Side by side (split) | two places change at once and matter equally | (sketched, not used yet) |
| Slide | moving from one screen to another | a page, Jobadabra ↔ Chrome, the next clip |
| Tiles | time passed in reality | the search ran, "2 weeks later" |
| Title card | the flow is not obvious: say how we got there | "Jobadabra checks the mail" |
| Fade | the same screen changing | the AI's proposal replacing "reading your CV" |
| Something drawn in the page | it happens outside the app | the Gmail notification |
| Caption + tag chip | always: what happens and where | every step |

## Scene vocabulary (`ops/media/scenes.mjs`)
- A piece: `env` (extra app env for that recording, e.g. `JOBADABRA_DEMO_STRATEGY_DELAY` so the demo "Claude reads your CV" step lasts), `camera: 'steady'` (opens framed, clicks never move it), `phone: PHONE` (the 720×540 copy), `budget` (bytes), `speed`, `moment`,
  `motion: 'reduce'` (extension: no aurora/shimmer sweep), `settings` (app wizard state), `caption`.
- **Every look names its `beat`**: the one thing the viewer reads there, ≥ 12 characters, unique (test: media-options). A phase is **the user's real
  sequence, one beat per step**, at least three beats (Apply excepted). Write the beats first (the storyboard), then the steps.
- Steps: `{go: 'jobs'}` (a page: the camera may `cut` here), `{js: '...'}`, `{click: sel, zoom}`, `{tap: sel}` (shows a press without clicking),
  `{fill: true}` (extension), `{hold: s, look: sel | [sels] | 'panel', zoom, phoneZoom, phoneLook, cut, poster}`.
- **Every step that names a beat `say`s a caption** (round 3, owner: "we need to explain the journey better"; ≤ 44 characters, test: media-captions):
  drawn under the clip from the step's moment, a cut look's from its cut, until the next one. Write the says with the beats: the viewer reads them.
- **Every clip says where it is** (round 4, owner: "we kind of need to highlight each of the steps"): a step's `tag` (≤ 12 characters: `Set up 1/5`,
  `Jobs`, `Chrome`, `Gmail`) leads the caption band as an amber chip and stays until a step names another; each clip's first caption has one (test:
  media-captions). Set up's looks include the app's own "Step n of 5" heading, and its says never start with "Step n" (the tag counts).
- **A clip in two places** (round 3, Apply: "start on the Jobs screen... then moving to the browser"): `before: '<part>'` records a `part: true` piece first
  (its own `moment`, app state and steps) and plays it ahead; both parts share `speed`, `camera` and the one-move budget; each opens on its own look.
- **Demo mode refuses a real action** (Use Free AI, Check Gmail now, Apply): `{tap: sel, then: js}` shows the press, then the page script moves the
  app on (a wizard step through its sidebar entry; a session opened through its row on the Applying page's list, which opens the page on it).
- **Something not in the app** (a new e-mail arriving): draw it in the page with a `js` step (plain, no brand), hold on it, remove it in the next step.
- **The camera shows a hero look whole across** (`fitWidth`, round 2): a look wider than its zoomed view gets a lower zoom, never a cut edge; the log says
  `media: <piece>: look ... shown whole at zoom X (asked Y)` and adds `SMALL TEXT, pick a narrower look` when it dropped below 85%: then look at a part
  (a row's cells, a card's column), never raise the zoom back. **The phone copy too** (round 8): it is never cut either; a tighter phone shot comes
  from a narrower `phoneLook`, never from zooming past the look.
- **Measure before choosing a look** (a probe printing `getBoundingClientRect` of the look and its children, CSS px on the 1800-px page): a look fits
  zoom z when its width ≤ 1800/z − 24 (z 2.2 → 794, 2 → 876, 1.64 → 1073). A wider card: name its left part with `lookWidth`, ending in a gap between
  columns (the job row's fit/role/company = 862); ask a zoom at or above the fit so the view hugs the look. Known limit: a look narrower than the view at
  MAX_ZOOM (2.4 → 750) shows its neighbours, cut at the view's edge (the calendar's grid beside Coming up); pick the look so they are context, not text.
- **A hero clip starts at its first look** (`fromFirstLook`): what the scene does before it (feeding the Find card, folding a section) is never on screen.
- **One deliberate move per phase** (test: media-options): the first look frames, one later look moves; a `cut: true` look switches at the page change.
  `poster: true` marks the result moment (the poster and the preview frame). Every look's `phoneZoom` > its `zoom`.

## Owner's rules for the hero (24 Oct 2026)
- Readable **at the website's size**: job title, match reason, completion status, interview date. Desktop result zoom ~2+ (14 px app text ≈ 14 px
  on a 1440 screen); phone zoom ~3.5. Secondary details may stay small. Judge in the preview, never fullscreen.
- Captions (HTML, AA): "Add your CV. Shape your search." / "Find matching jobs. See why they fit." / "Fill applications with your details."
  + "Review your answers, then submit." / "Your interviews and next steps, together." Set up shows the user **confirming** proposed preferences
  (salary/places are proposals, not facts read from every CV).
- Apply: form and extension framed together, **never cut off the panel**, no colour sweep. Track (round 2): starts on the Gmail check that found the
  interview invitation, then that interview's recording, review, patterns and practice, then its calendar event; no busy month grid; "2 weeks later"
  is part of the made-up example and sits in the caption line.
- The stage stays inside the page's content column (no negative margin into the page margin; test: landing.test.js). At 1440 it is 700 px wide, so result zooms ~2.2 give ~12 px text.
- ~31 s in total, every step shown (owner, 24 Oct 2026, round 2; was ~18 s); sizes are budgets (desktop ≤ 2.5 MB total, phone ≤ 1.1 MB); check small text survives compression.
- Demo data only (the persona); never the owner's app, profile or accounts; no AI spend (the recorder uses none).

- Phase stories (round 2, owner 24 Oct 2026): **Set up** = CV dropped → a note typed → Build my strategy → the demo "reading your CV" → proposed goals
  → Save (confirm). **Find** = the Find jobs card searching → done → scroll to THE job → its Match tab. **Track** = the Gmail check card ("Interview
  scheduled" for THE job) → its interview recording → the review → insights/patterns → practise next → that interview first on the calendar.

## Every owner rule, round by round (24 Oct 2026; read all before a redo, a newer round wins)
**How we work on the hero**
- Medium or large change: an Artifact sketch first (mockups on real frames, decisions with a recommendation), build after the yes.
- Every set: the before | after as VIDEO (`node ops/media/compare.mjs`: main's published clip | the new one, desktop + phone), the still preview
  as the overview, and the owner's yes before shipping; then ship at once. The PR shows the same clips (GIF linked to MP4), never only stills.
- "Whatever fixes you do now for the hero video, document them, update the skill/command/script, so next time we don't repeat the same mistakes":
  every fix lands as a tool rule + test + a trap line here; "check against yourself for other bugs" before showing anything.
- "Did you fix the root causes permanently?": fix the tool's rule first, then the scene (section below).
- App words or looks that are wrong in the clip are fixed in the app (a public PR, a hand-off session), never painted over in the scene.

**Round 1-2: one readable tour**
- Four clips, one tour, one person (nurse persona), one job from setup to interview. Focus is not a 5th clip.
- Every step of the user's real sequence shown (~31 s then; ~56 s with round 5), one beat per step, readable at the website's size.
- Track = a Gmail check that finds the interview invitation → the interview (preparation, recording, insights/patterns) → the calendar.

**Round 3: "explain the journey better"**
- A caption on every step; "it moves screens very fast, it's not clear how we get from a step to another": show the in-between (an e-mail
  arriving in her Gmail, then our app triggering the Gmail check), never a jump.
- Set up starts at step 1 (Connect your AI), no step skipped. "Make each journey more coherent."
- Find from a fresh setup: Jobs with the big "Find jobs" card, the click on it highlighted, the card's searching state animated, then a
  slower way into the job drawer ("not clear how we got there").
- Apply starts on Jobs: the press on Apply → the Applying screen/card → the browser.
- No hard-coded "Claude": "Free AI", or "AI is filling", or generic.
- No glitch frame (the "Sonnet" flash): every cut checked frame by frame.

**Round 4: "highlight each of the steps"**
- Each clip says where it is: the tag chip + caption band (A + B), Set up shows the app's "Step n of 5".
- The Find jobs card centred. After a press, wait half a second before the screen changes ("not natural so fast").
- "We cropped too hard, let's leave a bit of space": a margin around every look.

**Round 5: the app follows the fill**
- The Applying card shows a real status when the form opens ("Complete the application in Chrome"), never "Checking…".
- Show the session card in the app updating live while the extension fills the form: first one after another, then side by side.
- The card framed close on its count (B), then one pan to the "Ready to submit" pill.
- The video's colours are the app's colours (BT.709 + sRGB tag; judge in Chrome).
- Track: "show the Action screen where we click on 'check gmail' card", never an empty panel waiting.
- The app and extension are amber (public #1808): re-record after an app look change.

**Round 6: transitions and the side by side**
- A transition at every screen change: a cut look inside a clip, a join between parts (app ↔ Chrome), the switch between clips on the site
  and the loop back to Set up. "Fading/moving or even some tiles/text", never an instant replacement.
- **The transition is chosen for what the change means** (owner: "use most of them: fade, slide, tiles, title card... whenever it fits better";
  samples https://claude.ai/artifact/MfH6fvdPHAV3tTf4Kw9dYf):
  - **Slide**: "when we just move from one screen to another" (another page, Jobadabra ↔ Chrome, the next clip).
  - **Tiles**: "when in reality more/long time passed" (the search running, "2 weeks later").
  - **Title card**: "when we need to explain how we got there, when the flow is not obvious enough": a short card (place tag + a few words)
    between the two screens; it adds its time to the clip.
  - **Fade**: the same screen changing (a result appearing, the AI's proposal replacing "reading your CV"), the softest.
  - Every cut look, part join and clip switch names its transition; pick by the meaning above, never one style everywhere.
- Apply: **picture in picture, swapped twice** (owner: "I'd like picture in picture, but swapping them at some point"; it replaces round 5's one
  after another and the split-screen sketch https://claude.ai/artifact/GdQuKaFdKnQp3du6QDsuJX): (1) Jobadabra's Applying screen and session card
  main, Chrome in the inset; (2) swap: Chrome full screen while the fields fill, the session card in the inset, ticking; (3) swap back: the card
  main at "Ready to submit", Chrome in the inset.
- "The skill should possess all of these possibilities ... and we should use whenever it's the right time for that method": the toolbox below.


**Round 7: impersonal words**
- **No "she", "he", "her" or "his"** in anything a viewer reads (owner, 24 Oct 2026: "Let's not put 'She' or 'He'. Let it be impersonal", on the card
  "She opens Jobadabra to check her mail"): captions, cards, tags, the site caption and alt, and the beats on the preview name the thing (the CV,
  the job, the form, the calendar) or the action ("Strategy confirmed", "Find jobs: the search starts"). Test: media-captions.test.js.

**Round 8: phones and contrast** (owner, 24 Oct 2026)
- **Phone copies centred and whole** ("On mobile ... the content overflows a bit, the videos are not centered"): the phone camera zoomed 1.8x past each
  look and read it from its left edge, so 18 of 24 phone shots lost 6-49% of their right side and showed the sidebar on the left. Each phone look is
  shown whole and centred (`camera.mjs` fitWidth for both copies; test "a phone look is never cut"); a wide look gets a narrower `phoneLook` (the score,
  title and tags, not the whole row) so the text stays big. `media: <piece>: look ... SMALL TEXT` on the phone copy = pick a narrower phoneLook.
  A phone look narrower than the view shows its neighbours cut at the edges and, at a page's left, the sidebar: give it the content's left part
  (`phoneLookWidth` from the content's left edge), not one heading. In picture in picture the phone inset (46% wide) covers the main's top right: a
  phone look there sits on the left (round 8: the "Ready to submit" pill was hidden under Chrome). A list row's phone look keeps the company beside its button.
  Check the phone copies on the 4 contact sheets (or `ffmpeg ... tile=5x3` of each `-720.mp4`) before the preview: a cut right edge is visible there.
- **High contrast, not washed** ("it looks washed. it doesn't have a high contrast"; chose option C of three on one frame): the recording is the app's
  exact pixels, so the grade is ours: deeper blacks, brighter grey text, a little more colour, sharper text (`ops/media/grade.mjs`, an SVG filter render.cjs
  applies to the APP's pixels only). Captions, tags, title cards and the cursor are drawn after it: a whole-frame grade turned the brand amber yellow.
- **A dull colour: find which layer made it before fixing anything** ("is maybe the recording/rendering ... the problem?"): compare the app's CSS token
  (`desktop/renderer/tokens.css`) with the raw frame (`.work/<piece>/frames`) and the decoded clip. The ring green was the APP's bug (the dark theme
  had no `--good-bright`, so it drew the light theme's #2e9e6a): fixed in the app (jobadabra PR, merged first), then the hero recorded again.
- **Phone copies are gentle** (owner, 25 Oct 2026: "we shouldn't be that aggressive on mobile ... zoom a bit, but not that much"): a step's `phoneZoom` shows at `PHONE_SCALE` (0.8) of itself, `PHONE_GAIN` 1.4, cap 2.8, in a 960x720 window. The phone take hides `#sessions-dock` and `#activity-toggle` (not `#activity-panel`: Track's mail card lives in it); Find's tab holds frame `DRAWER_TAB`, not the whole drawer.
- **No toast in a clip** (owner, 25 Oct 2026, "Its result was not saved" over Find's first job): the demo feeds the Find card by hand, so the app toasts. The `NO_TOASTS` step removes toasts as they appear; a CSS hide in the recorder changed the stray-frame gate's timing and failed it.
- **The hero cache keeps the newest 3 sets**: a set not yet placed is pruned by the next run, so copy or `--place` it first. A combined four-piece run once failed on Find's job row where single pieces passed: record Find alone and merge its files and manifest item into the set.

**Round 9: phones show whole frames, captions under the video, 1080** (owner, 24 Oct 2026)
- **Nothing cut at a phone frame's edge** ("the video is stripped ... I don't see the full video frame"; chose "whole column, centred" over the whole
  window, whose text is ~3 px on a phone): round 8 showed each LOOK whole, but its neighbours were still cut mid-word at the edges. The recorder now
  notes the words and cards on screen at every look (`edges.mjs` edgesScript → `edges` in log.json); the phone camera picks, nearest its centred frame,
  a view whose both edges fall in gaps, zooming out a step when none exists (`whole.mjs`); `edges.mjs` edgeCuts then STOPS the phone copy if a line or
  a card that would fit is still cut (`HERO_EDGES=warn` lists them all and goes on). **The desktop copy too** (owner, after the phone preview: "port
  this to desktop as well, because on desktop it was also cropped", with shots of the logo and cards cut): same camera rule, same stop.
  The phone take's short window (528 css) scrolls a look below it to the middle before measuring (`fitScroll`, hold.mjs scrollLookIn).
  **Faster redo** (owner: "Is there anyway we can speed up the recording process? ... can we parallelize it more?"; measured: renders ~80% of a
  redo, one copy at a time on 1 of 8 cores): every take is recorded and checked first (edges, page problems: a bad scene stops ~1 min in), then
  every copy renders through `renders.mjs`, `HERO_RENDERS` at once (default 3; memory). The edge check reads the hold's middle, where the camera
  rests (at its end the camera is already gliding on: false cuts), and the camera frames with `MARGIN` 2 px over the check (float rounding).
  A camera or check change needs no new recording: re-check a kept take's `log.json` with edgeCuts in seconds, or `--words` to redraw.
  **Never run the site tests while hero.sh records** (run 17: `SITE_OVERLAY_FRESH=1 tools/site-run.sh` rebuilt `.overlay`, the app the recorder
  runs from, and the take died on `page.reload: net::ERR_FILE_NOT_FOUND`): test before starting the recording, or after it ends.
  Now a gate for the whole run, renders included (25 Oct 2026: a media test run rebuilt a render's overlay; its preview lost playwright-core):
  hero.sh and media.sh mark `.overlay/.git/in-use`, `tools/overlay.sh` refuses a marked tree (exit 3), and site-run's hourly rebuild skips it.
  Test in another worktree meanwhile. Media tests that need ffmpeg run on CI too (tests.yml installs it; #98 was red without it): never a skip there.
  Same for Electron (#100): check the binary (`node_modules/electron/path.txt`), never the npm shim `.bin/electron` (CI has the shim only);
  CI installs it plus xvfb and runs the guards under `xvfb-run`. `site-run.sh` lays the worktree's files over `.overlay` on every run (three
  stale runs on 25 Oct 2026), so no `SITE_OVERLAY_FRESH=1` after an edit; it is for a new public main only.
  Desktop text (owner, 25 Oct 2026): the desktop take runs the app at text size 1 (`desktop: DESKTOP` in scenes.mjs: a 1440-px page, 25% bigger
  than the 0.8 default); a click zooms to `TAP_ZOOM` (3) wherever its part still has its one deliberate move.
  A phone shot that had to zoom out says so (`shown whole at zoom`): hand-picked `phoneLookWidth` left parts are no longer needed.
  **Phone looks are whole looks** (run 20: Track's 460-px left part cut words mid-line): phoneTake drops `lookWidth`/`phoneLookWidth`; a look too
  wide or tall for the phone window gets a shorter `phoneLook` (its title + the one block you mean), never a cropped part.
  **The edge check samples each hold 10 times and counts a cut only when most samples show it, once per moment** (run 20: in picture in picture
  the camera reaches its look late, one sample showed a cut that no viewer sees; a first fix counted 10 rows of one moment as 10 samples).
  **A click must land on its own target** (run 21: in the one-column phone layout the insight head's middle was its confidence chip, the card never
  opened and the next look timed out): record-app's `clickedControl` stops a click whose centre hits another control; click the toggle itself.
  **Takes are reused while nothing they record changed** (`takes.mjs`: piece, recorder sources, app commit, persona files, today's date → `take-key`
  in `.work/<take>/`; `HERO_FRESH=1` records all): a camera, check or caption fix re-renders only. **Two takes record at once** (`HERO_TAKES`),
  each app on its own free port (never 47111), **apps start one at a time with one retry** (run 22: two Electron launches at once → Playwright
  "Process failed to launch!" crashed node with no `media: FAILED`; stray errors now print it), and **a failed take is recorded once more**
  (run 23: under two takes' load Find's list was not on screen yet at its look). Measured: 12 takes ~2:40 (was ~6 min); a reuse run ~30 s.
  **A phone copy can fail the stray-frame check where the desktop copy passes** (run 24, 3 of 4 clips): the phone frame is the page's narrow column,
  so a small change fills more of it. Causes found: (1) a cut hold's `fitScroll` scroll ran after the new page painted, so the early-cut search
  (cuts.mjs frameCuts, which reads the new look's AFTER-scroll box) missed the change and the unscrolled new page played under the old look;
  (2) a status line that hides by itself in the hold's last tenth (Track's "Last refresh") made the old page differ from its 90% beat.
- **The phone copy is its own take in a narrow window** (owner chose "Narrow window" of three): on the wide 1800-px layout, long lines (up to
  1500 px) left only near-whole-window phone frames (zoom 1.2, ~3-px text). Each hero clip is recorded twice: the desktop window, then
  `PHONE.window` 880 x 660 (the app lays out 1100 x 825, one column; Jobs' sidebar folds to icons), and the phone master, its captions (.vtt),
  poster and stray-frame check come from that take (`media.mjs` takeOf/recordClip; picture in picture composes both phone takes). A redo takes ~2x
  as long; `<piece>-phone/` sits beside `<piece>/` in `.work`, and `--words` redraws both.
  **The window alone is not narrow enough** (run 14): at the app's own zoom 0.8 the 880-px window lays out 1100 css, and Jobs' cards span 980 px
  (< 92% of the page, so "show whole") → the phone frame was the whole window, ~4-px text. `PHONE.zoom` 1.25 sets the app's text size in the
  phone take (settings `zoom`; the extension's page is the window / zoom): 704 x 528 css, the column readable. The window can't go below 640 x 640
  (main-window.js minWidth/minHeight), so narrow by zoom, not by size. Probe a layout in seconds with a CDP shot (Playwright's own crops the
  zoomed app) before a 25-min redo. The page's own border never counts as a cut, and the zoom-out step is 0.5%: a frame pinned at a border
  moves its far edge only by zooming, and a clean spot in a 16-px gutter is ~8 px wide.
- **A render can end short and say nothing** (round 9: the phone copy's renderer quit 17 of 572 frames in, exit 0, on a 16-GB Mac with ~60 MB
  free; only the missing poster stopped the run): `runRender` now counts the frames it got (`framesIn`), renders once more, then fails the piece;
  render.cjs exits 1 when its renderer is gone. A clip much shorter than its recording is this, not a scene bug.
- **Captions under the video on phones** ("they hide some buttons/actions"; "Phones only"): the phone copy is drawn with no caption or tag; the
  desktop copy's captions go to `<piece>.vtt` (captions.mjs sayTrack/vttOf, played seconds), the page adds it as a hidden metadata `<track>` and
  hero-stage.js writes the current cue under the video (`.stage-say`, one line, height kept). Title cards stay in the video.
- **Higher quality** ("Low resolution. Let it be higher quality"): phone copies 1080 x 810 (were 720), CRF ladders start at 22 for both copies and the
  budgets are ceilings; the app is recorded at `--force-device-scale-factor=2.5` (3600-px frames) so a zoomed look still has a pixel per output pixel.
  Old `-720` files are `git rm`-ed by `hero.sh --place`. A changed look or edges need a NEW recording; `--words` only redraws words.
- **Every new screen opens on the whole app window, then glides in** (owner, 25 Oct 2026, a GENERAL rule for every clip and both copies: "too
  zoomed, hard to understand what's it ... show a bigger part of the screen and slowly zoom in"; "let's start from a zoomed out position"; "This
  should be I think a general rule"; "Let the user understand where is that zoomed part placed in the app. Basically how to get there. Like the
  context/surroundings"). The first look and every cut look: the whole window (sidebar and page title in view) for `OPEN_WIDE`, then a slow glide
  (`GLIDE_IN`) to the look; the hold is lengthened by both (hold.mjs `openWide`), so the look still rests its own time. Never open a screen already
  zoomed. A click zoom is framed whole like a look, and no frame edge cuts a line or a card at the top or bottom either (the bottom edge cut Set
  up's Back/Continue in run 25). The glide always leaves the look `REST` (0.6 s) at rest before the hold ends OR the next screen cuts in,
  whichever is first (run 26: a phone hold's scroll, and Set up's proposal painting mid-hold, left no rest; the edge check read the glide and
  the next look's frames as cuts); the edge check reads only that rest, up to the next cut.
## When something is wrong: fix the mechanism, then the scene (owner, 24 Oct 2026: "did you fix the root causes permanently?")
A bad crop, a missing step or a wrong frame is first a question about the tool: which camera/recorder/tool rule let it through? Fix that rule, add a test
that loops over every hero look or scene (it fails on the old code), add a trap line below; only then tune the scene's numbers. A scene-only tweak
comes back at the next redo.

## Checklist before showing the owner
  - Every check that compares frames must know the wide opening (run 27: the stray check compared the whole-window frames after a cut with the zoomed look and stopped on 6 false alarms). The timing lives in ONE place, `camera.mjs wideOpening`, used by the camera and by `cuts.mjs strayFrames`; a new frame check uses it too. Wide openings make clips longer: Track's WebM (listed first, so what Chrome plays) needed its budget raised to 2.6 MB (total 8.1 MB), then 2.8 MB (run 29: 2.63 MB at VP9 CRF 50; a denoise changed nothing, 819 vs 817 KB on a slice; VP9 is simply bigger than H.264 on these screens, 817 vs 537 KB). Open: drop the WebM or list the MP4 first (CI PR).
- Each beat frame: its beat's words are readable and inside the crop; the crop ends on a gap between columns/cards, never through one.
- Each sheet: the story holds (same job everywhere), nothing important cut at an edge, no empty frame, the move happens once.
- Preview: every caption matches its clip; the result text readable at desktop AND phone; Apply's whole panel in frame; Track's interview is the
  first thing in Focus and in Coming up.
- Every cut, frame by frame at 10 fps: no frame of another page (the gate checks it too).
- Sizes from `tools/hero.sh --place` within budget; site tests green.

## Traps already hit
- **A screen the hero shows was redesigned on main mid-round** (round 8, 24 Oct 2026: another session reworked the Find card at 19:55 and 20:10; the
  new phoneLook `#find-card .insight-head` no longer existed, the run waited 30 s and failed after Set up). Before recording, read the app's recent
  history of the screens in the scenes (`git -C ~/jobadabra log --since=<last recording> -- desktop/renderer/pages/<screen>*`) and check each new
  look's selector in the app's current markup; re-record only the pieces after the failure (the finished ones are kept in their set).
- **A look matched a hidden element** (`.focus-item:has-text(...)` found one off-screen): scope it (`#focus-list .focus-item:has-text("Prepare for ...")`). "nothing to look at at <sel>" is this, unless the Mac is loaded: both recorders wait up to `SHOW_WAIT` (10 s, hold.mjs) for a look to become visible first (runs 26-27: Track's e-mail and Find's phone row were still drawing; each miss cost a whole re-recorded take). A miss that repeats WITH the wait is a scene bug, not load: run 28's Track e-mail look missed again because the step meant to open the results panel clicked its toggle, and the app had already opened the panel for the run, so the click shut it. A step SETS a panel open or shut (`panel(true|false)` in scenes.mjs, reading `.hidden` first), never toggles it; guard: media-options.test.js.
- **Run 28's lessons (a loaded Mac):** (1) ONE stall check (`check.mjs stallsOf`) for the take loop and the final gate: the frame-rate stall was only checked after all 12 takes, so it failed the run instead of re-recording the take. (2) Words the app itself hides are not words on screen: the edges script clips each line to its overflow boxes (the Interviews tip ticker read as a cut line). (3) A hold keeps at least half its time after the recorder measures (`HOLD_KEEP`): Track's 1.8-s look kept 0.3 s and the camera never arrived.
- **A check that can run before the render, does** (owner, 25 Oct 2026: "did you improve your process, how many bugs are still to be discovered?"): each bug cost a 25-minute run because the stray check read only the rendered copies. `prestray.mjs` runs it on the render plan (64x40 thumbnails cut from small grey frames through the camera's view) in seconds per take before any render; on runs 27-28's takes it matched the final gate. The check on the played copies stays the last gate. A new check: make it read the plan, not the copies.
- **Renders move to GitHub CI** (owner, 25 Oct 2026: "should we do the rendering on the Github CI? will it be faster?" / "we can have a manually triggerable workflow"; chose "after PR2"): the Mac is shared by ~10 sessions (load 100-312 on 8 cores), so local parallel renders only split the same CPU (PR3: ~25 -> ~20 min). Plan: a workflow_dispatch workflow, one macOS runner per clip (Mac fonts: never Linux), recording from public main with the demo persona, videos back as an artifact or a commit on the PR branch. Also: reuse the graded picture when only the caption or cursor changed (45% of run 29's 6,638 frames).
  **Built** (`.github/workflows/hero-render.yml`): `gh workflow run hero-render.yml -R GarryOne/jobadabra-web --ref <branch with the scenes> -f clips="hero-track" [-f branch=<PR branch>]`;
  each clip is an artifact `hero-<clip>` (site files, sheets, preview.png, hero.log); with `branch` a last job runs `hero.sh --place` and commits there.
  macOS minutes are free only while the repo is public; it runs by hand only (guard: test/unit/website/hero-render-workflow.test.js).
  **A workflow change runs once on its PR branch before the owner merges** (`gh workflow run hero-render.yml --ref <branch>`): #101 merged untested
  and run 1 stopped all 4 clips in 30 s (Homebrew's slim ffmpeg has no libwebp: #104 installs ffmpeg-full); run 2: two takes at once on the
  3-core runner stalled the capture and painted late after cuts (HERO_TAKES=1 there). A job's log exists only once the job ends (mid-run the logs
  URL answers BlobNotFound): mid-run read its steps (`gh api repos/GarryOne/jobadabra-web/actions/jobs/<id> --jq '.steps[]|"\(.name) \(.status)"'`),
  after it `gh run view <run> --log --job <id>`. A runner clip takes 8-10 min (measured 25 Oct 2026, about 2x the Mac per clip; the 4 run side by side: ~10 min, 35 runner min, ~350 counted min if the repo is private).
- **MP4 only, no WebM** (owner, 25 Oct 2026, chose "MP4 for all"): VP9 came out bigger and blurrier than H.264 on app screens (Track: 2.63 MB at
  VP9's lowest step vs 2.25 MB H.264 near its best; then 2.82 MB, over budget, run 40154540314), and its ladder was the slowest encode. Every browser
  plays the MP4. Guard: desktop/test/media-mp4-only.test.js. **Every budgeted copy logs `CRF n (a-b), X of Y MB`** (ops/media/encode.mjs budgetLine);
  `LOWEST QUALITY` means the next, slightly heavier take fails: raise that clip's budget in scenes.mjs or shorten the scene.
- **A clip keeps its last hold whole** (camera.mjs toLastHold): the recorder gets a frame only when the page changes and the video ends at the last
  frame, so a still last hold was cut and the poster (90% into it) fell past the end: "ffmpeg -ss 38.98 ... poster.jpg" failed on the runner (run
  40156280319). The held frame is marked `held` so stallsOf does not count it. A slow machine shows timing bugs the Mac hides: read the runner's
  failure as a bug, not as noise.
- **The media cache prunes itself** (owner, 25 Oct 2026: "make an auto-prune of the media recordings"; 99 kept runs filled 42 GB, 3.9 GB free): `ops/media/prune.mjs` keeps the newest few of every kind tools/hero.sh and tools/media.sh write (hero runs: HERO_KEEP=3 with the new one; previews, media sets, their logs, package caches); a folder with a KEEP file stays. A new tool that writes to the cache adds its rule there. The newest are the last written (mtime), never the latest name: the names are local time and the clocks went back an hour on 25 Oct 2026 (run 30's set sorted before run 29's).
- **Electron starts once, alone, before parallel renders** (run 30, words only on a freshly rebuilt .overlay: four first starts at once collided unpacking Electron, "File exists"): `media.mjs electronOnce`.
- **Mixed row classes**: the calendar's Coming up has `.cal-row` and `.cal-row-wrap`; `#cal-upcoming > :first-child` is the first interview.
- **The panel moves**: during a fill it sits centred, then returns to its corner; `panelBox` waits for the corner. A union of the panel and a far field is wider than the zoomed view and gets framed from its left edge: look at `'panel'` alone.
- **Persona gaps show as app gaps**: `draft.json` needs `search.target_roles` (else "Target roles: Not set") and a numeric `usd` (step 3 crashes without it). That's old data, not a product bug.
- `querySelector` in a `js` step can't take Playwright's `:has-text`; use `[...document.querySelectorAll(...)].find(...)`.
- A `ops/media/plans/<piece>.json` (the old AI director's plan) overrides a scene's framing and captions; the hero pieces have none, keep it that way.
- `tools/media-refresh.sh` only refreshes files the site already has: a NEW file (e.g. a new phone poster) is placed once by hand (`--place`).
- **Round 1 (24 Oct 2026) skipped steps and cropped through columns** because looks were picked without a written beat and checked only at the
  result moment: hence the beat rule, beat sheets and the per-beat preview. Don't go back to "one frame per phase".
- **A cached strategy draft skips "Build my strategy"**: set `window.__jp.shared.rebuildAsked = true` before opening the step (`OPEN_BUILD` in scenes.mjs).
- **The Find jobs card is overwritten by the app within ~1 s**: feed it through `window.__jp.findCard(state)` on a 150 ms timer (`FIND_RUN`), then clear the timer.
- **Probe screenshots**: Playwright `page.screenshot` draws the app at its 0.8 zoom = **1.6 px per CSS px** (not 2); compute crops with that factor.
- **A row near the bottom hides under the "Application sessions" bar**: scroll it to the middle before a look (`scrollTo` in scenes.mjs).
- **The "2 weeks later" tag lives in the caption line** (`.stage-later` before `.stage-title`), never positioned over the video (test: landing.test.js).
- **A moment written after the last sync shows nothing**: `tools/hero.sh` syncs, but a hand probe needs `rsync -a ops/media/ .overlay/media/` first.
- **Recent activity stays open across pages** and covers the next page (Track's "Open review" click timed out): toggle it closed before the next `go` (test: media-options).
- **The app recorded is public main at record time**: `tools/hero.sh` rebuilds `.overlay` when public main moved (it was built once and went stale). To record a public PR branch that redesigns a hero screen before it merges: `HERO_PUBLIC_REF=<branch> tools/hero.sh <piece>`; ship the clip only after that PR merges.
- **Beat frames after the page moved on**: a hold's log time is stamped after its boxes are measured (slow under load); the log's `s` is the time left (`holdLeft`), so beats and posters fall inside the look. Don't log `item.hold` again.
- **Clicking Save in Set up opens "Demo mode: nothing is sent"**: the scene `tap`s it (a press, no click). Keep it a tap.
- **Holds: the owner's floors are tested** (media-options): every view ≥ 1.1 s on screen, each result (poster) ≥ 2 s, at most 2x speed.
- **Never write into `.overlay` while `tools/hero.sh` runs** (it may rebuild it: `rm: .overlay: Directory not empty`, FAILED). Run tests meanwhile in a scratch overlay (`tools/overlay.sh <scratch>/ov`).
- **"Reading it from your store…" in Set up**: on a loaded Mac the strategy's Job preferences card is still loading when the clip reaches it (it loads
  in ~2 s otherwise). Keep it out of the look, or re-record when the machine is quiet; it is load timing, not a demo bug.
- **App words the hero shows come from the app**: a wrong tag on a nurse job ("Observability", 24 Oct 2026) was a public-repo fix (#1758): tags now
  come from each job's `skills`, so the persona's `jobs.json` gives every job its own (cardiac care, telemetry, ...), never a scene crop.
- **Not built yet**: a pre-recording storyboard (each look's box and fitted zoom without recording). Until then the `media: ... shown whole at zoom`
  lines and the beat sheets are the check.
- **A look with no frame = a stalled capture; a still page is not one** (24 Oct 2026): the screencast sends frames only when the page changes, so a
  frame gap proves nothing (a gap-after-click check failed a good Set up). Each look's hold forces one repaint (`screencast.mjs paint`); a look with no
  frame within 1 s is a stall (`check.mjs captureGaps`), recorded again up to twice (`media: <piece>: the capture stalled`), then the piece fails.
  Read the raw frames (`.work/<piece>/frames`, `log.json`) before naming a stall: run 3's "frozen Set up" was a look measured before its frame came.
- **The phone copy's `phoneLook` is shown whole too**: give it the cells you mean (`[ROW .fit-cell, ROW .role]`) or its left part (`phoneLookWidth`), never a full-width row or banner.
- **A test that imports `record-app.mjs` needs Playwright, which the site CI job lacks** (PR #47 went red): pure helpers live in `ops/media/hold.mjs`; "Cannot find module 'playwright-core'" in a local run is this same failure, never "just my setup".
- **A stray frame at a cut** (round 3, owner: "a small glitch in the first clip (showing something about Sonnet)"; four more like it in Track and Find):
  the frames between a page change and the next look being painted showed the old framing over the new page, or the new framing over the old one.
  Now: the recorder logs `ready` when the next `cut` look is in the page AND painted (two repaints), stamps every change BEFORE its action, and
  `cuts.mjs dropChanges` cuts those frames out (the cut lands on the first frame after `ready`). The gate `cuts.mjs strayFrames` reads the played clip
  and fails a piece with "a frame of another page at <s>, before/after the cut to <look>" (clean cuts ≤ 0.7, glitches 5.6–16.9). Look at every cut
  frame by frame (`ffmpeg ... fps=10,tile`) before showing the owner; the sheets show one frame per beat and miss these.
- **A page that changes by itself is noticed late** (round 3: the strategy proposal showed 1-3 frames under the loading look's framing; polling plus two
  repaints noticed it ~0.1 s late, and the hold's first 250 ms were not watched at all). Now the hold watches for its own cut look from its start, and
  `cuts.mjs frameCuts` moves such a cut to the first recorded frame that looks like the new page (thumbnails of the frames themselves), and cuts out
  old frames after any cut (a page painted late, the calendar).
- **A look that fills in by itself failed the gate** (round 3: the searching card went 0 → 31 found; its first frames differed 3.8 from its end):
  right after a cut the gate also accepts the frame half a second in, but only when that frame is the new page; never raise `STRAY_MAX` for this.
- **A zoomed press before a cut holds the camera past the cut** (round 3: the tap on Use Free AI zoomed, the camera stayed on it after the page changed):
  a press right before a page change got no zoom. Owner, 25 Oct 2026 ("zoom in more on the click area"): it gets the close zoom again; the stray-frame check reads the zoomed old
  page as the old page (`cuts.mjs strayFrames`, from where the press's zoom has arrived; test: media-cuts), the camera still cuts to the new look at the page change.
- **The demo shows another person's data where a persona lacks a file** (round 3: the nurse had no `ready.json`, so the DevOps list marked her job "Review & submit"):
  when a screen shows something odd, check which demo file feeds it and give the persona its own.
- **lookWidth on a centred card cut its words** (round 4: the empty Find jobs card is full width with its words centred; lookWidth 1040 kept its
  left part, so its centred description ran across the edge). The recorder now stops when a lookWidth edge cuts through a line of the look's words,
  naming them; columns wholly right of the edge are left out on purpose. End it in a gap, or name the part that holds the words.
- **Too tight a crop** (round 4, owner: "we cropped too hard, let's leave a bit of space"): the camera keeps `LOOK_MARGIN` (40 CSS px) around every
  look, its top too; a look at the page's very top still touches the page edge, so frame from a block that has room above.
- **The screen changed the instant she pressed** (round 4, owner: "when clicking Apply, the screen changes too fast, let's wait half a second"):
  every press in a video stays on screen `PRESS_SHOW` (0.5 s played) before its action; the press is `held` and the mark logged when the action runs
  is the page change the camera and the cut use. Clips get ~0.5 s longer per press.
- **The first step flashed by** (round 4, Set up step 1 was 1.4 s, its "STEP 1 OF 5" cut at the top): a clip's first look holds ≥ 2.4 s played
  (hold ≥ 3.6 at speed 1.5): the viewer is still arriving.
- **A cut hides how she got there**: a cut look is a jump. Where the owner wants the way in seen (Find: the click on a job, the drawer opening),
  use a click zoom and a short hold on the in-between screen, not `cut`.
- **The video looked bluer than the app** (owner, 24 Oct 2026: "a different background than it is actually on the real app"): the files were
  BT.601 and untagged; Chrome decoded them as BT.709 (card 16,25,33 played as 16,27,39). `encode.mjs` now writes BT.709 with the sRGB transfer
  tag (`videoFilter`, `COLOR_TAGS`; a BT.709 transfer tag crushed the darks). Judge colours in Chrome playing the file, never from an ffmpeg frame.
- **A look measured off screen framed the wrong thing** (round 5: the Applying page kept the Jobs page's scroll; her job header was at y -308 and the
  camera showed the needs list): both recorders now stop when more than 10% of a look is outside the window (`offScreen`, `OFF_MAX`, hold.mjs).
  Scroll it into view in the step that opens the page.
- **A still app page read as a stalled capture** (round 5: "Checking Chrome…" used to spin): mark an app part whose page is still `quiet: true`; each
  hold's forced frame still catches a real stall.
- **Live app state comes over the app's own messages** (round 5, the Applying card ticking): a `review` step sends the extension's form states
  through Electron (`live-review.mjs`); an `after:` part plays behind its piece. A hold without a look keeps its beat.
- **Show where the user acts** (round 5, owner: "show the Action screen where we click on 'check gmail' card"): an empty panel waiting for a press
  reads as nothing; frame the screen and control the person really uses.
- **Transitions and the stray-frame gate** (round 6): a transition's mixed frames are neither page, so `strayFrames` stops at a transition's start
  and checks again from its end (`windows`); never raise `STRAY_MAX` for a transition. A title card adds its time to the clip (`withCards`), so
  beats, captions and the gate read the log after it. Tests: `desktop/test/media-transitions.test.js` (every cut look, join and clip switch names one).
- **Picture in picture** (round 6, Apply): the piece (Chrome) is recorded first; the other recording's `review` is paced on the piece's real fill
  (its `sync` to its next mark), so the card ticks while the fields fill; both meet at their `sync` steps. A step marked `lead` makes its
  recording the main picture; the caption is always the main picture's (so write each recording's says for the stage it leads). The inset sits
  top right (34% wide, 46% on phones): keep the main look's words out of that corner. Tests: `desktop/test/media-pip.test.js`.
- **After a cut, wait for the settled page, by the gate's measure** (round 7, Track's Actions on a loaded Mac): the frame at the cut was the page half
  drawn ("closer to new" than old, so frameCuts kept it), and the quiet page sent nothing else for 1.1 s; the gate (≤ STRAY_MAX from the look's
  beat frame) failed it twice. frameCuts now cuts to the first frame the gate would pass, searching up to the new look's hold. A stray that repeats
  on a new recording is the tool's timing: replay the cut on the kept recording (frames + log.json) before recording a third time.
- **A join never shows the same place on both sides** (round 6, take 4): the app part ended on the Applying card and the picture in picture opened on
  the same card a few pixels apart; the fade doubled every line (a ghost). End the part on its press instead (`{tap, end: true}`: camera.mjs
  `untilEnd` drops what follows) and join by a slide. Test: media-pip.test.js loops over every join by the looks' `tag`.
- **A look on one small control in a wide row cuts the row's words** at the frame's edge (take 4: the pill alone, "…wers and legal boxes"): frame
  the section the control belongs to (its count, bar and pill) unless the control is the only thing that changes.
- **Two pictures of one moment must agree** (round 6, picture in picture): the first take ticked the card's 10 fields in 0.1 s (the fill was
  timed to the panel's first paint) and the card said "of 10" while the panel beside it said "of 6". Now the fill syncs at its first filled field,
  ends at the panel's own done state (`.ready`, `fillSeconds`), and the card ticks the stand-in form's required fields only. Read every frame of
  a picture in picture for numbers, words or states that disagree between the two pictures before showing the owner.
- **Check a recording's numbers, not just its look**: the recorder prints `the card paced on a N s fill`; a value under ~1 s means the sync or
  the done state was missed.
- **A narrow look can still end at 1.2x** (run 1, 25 Oct 2026: a 286-px calendar card, a 403-px Set up card): the camera zoomed OUT until both frame edges fell in a gap between
  lines of words, and a page of text has none (`whole.mjs`). Now the desktop copy never zooms out below `DESKTOP_FLOOR` 1.5 for clean edges: it takes the frame whose edges cut the
  fewest lines and cards, and `edges.mjs` only names what it cuts (the phone copy still stops on a cut). Test: media-fits.
- **The depth gate** (owner, 25 Oct 2026: "zoom deeper, about 1.5x"): `fits.mjs` stops a desktop piece before any render when a look ends below `MIN_ZOOM` 1.5, naming the look, its box width
  and the width 1.5x shows (880 CSS px at 1440; the 1080-px strategy card needs `lookWidth` or a column). A whole-screen look says `wide: true`; a test fails a scene asking below 1.5.
  A failed gate is the fastest probe: read each clip's `hero.log` FAILED line for the widths, fix, run again (a clip records ~4 min before the gate).
- **A cut look opens wide on a page that has not changed yet** (owner: "the Find jobs card appears once more after it is clicked"): the idle card showed zoomed out for a second before the
  search began. A look that only exists after the change (the searching card's title and chips) needs no `cut`: the camera glides in after the press and the hold waits for the element.
- **A drawn overlay must hide the app under it**: the Gmail card's frame was shifted left (owner: "left of centre") because the faded app's words sat at the frame's edges
  (whole.mjs). `MAIL_IN` hides the app behind its backdrop (`visibility: hidden`, which `edgesScript` skips).
- **A caption gives way to a title card** (owner: the next part's caption showed over the Gmail one): `renderPlan` sets `sayKeep` = 1 - 2 x the card's alpha, `render.cjs` multiplies the caption by it. Test: media-transitions.
- **A piece may name `moves`** (owner, 25 Oct 2026): Set up and Find make two deliberate moves (a close zoom on the press, then the result); `media-options` allows the piece's own number.
- **Frames stay centred** (owner, 25 Oct 2026, two shots of the Find jobs card): the clean-edge search slid the frame up to hundreds of px off the look's centre. The desktop copy slides at most
  `DESKTOP_SHIFT` 40 px (`whole.mjs shift`); a frame needing more is not looked for, the zoom steps down to the floor, and at the floor the centred frame is the answer. Test: media-fits.
- **A tab-by-tab look is one look**: the job drawer's nine tabs share ONE look (`DRAWER`, `wide: true`, zoom 1.4: the panel is ~960 px wide), no `cut` (a cut opens wide, which read as reloading the
  app: owner "we start again from zoomed out"); a look equal to the one before moves nothing (media-options counts it 0). Click zoom on every main button (Build my strategy, Find jobs, Check Gmail,
  Use Free AI). A piece whose pages hold still for seconds says `quiet: true` (else 262 frames in 52 s read as a stalled capture).
- **The wand cursor** (owner, 25 Oct 2026): `wand: true` on a piece or a step draws the magic wand (render.cjs `frame.wand`, tip at the click point; `camera.mjs wandAt`) from that step until the next
  click or look that does not say it. The owner saw it and said "Remove the magic wand for now. I don't like it how it looks" (25 Oct 2026): no scene sets it now; the drawing stays for a redo.  Test: media-camera.
- **Every drawer tab needs demo data** (owner: "a very complete job with conversations, timelines, reviews, interviews"): the persona's `job-pages.json` gives her job a kit, a record, prep, a recruiter
  message, notes, five dated events and a recorded, reviewed phone screen; add data there before adding a tab to a scene.
- **Do not split Set up, Find or Track into joined parts** (weighed and dropped, owner, 25 Oct 2026: "with no real gained value"): the clips already render in parallel (Set up 9 min, Find 15 min),
  so parts save minutes and add a join job, a start state per part and a visible cut. Apply keeps its parts. Propose it again only with new numbers.
- **The wand and the glow come from the app, not from a scene** (owner, 25 Oct 2026, after the app got its own wand and glow): the recorder reads `.magic-go`, `[data-wand]` and `[data-magic]` on each click and tap
  (hold.mjs `magicTarget`), draws the app's `wand.svg` and glides the real pointer over a glow card (`glideTo`). Never add a `wand` flag to a scene; a button the app does not mark shows the arrow. Test: media-magic.
- **Two speeds, both on purpose** (owner, 25 Oct 2026: "impose a 1.5x speed for all the clips"): the render plays each clip at 1.5x of real time (scenes.mjs `speed: 1.5`) and the page adds 1.5x (hero-stage.js `SPEED`),
  2.25x in all. The owner meant 50% faster than the clips he had watched, which were already 1.5x; I first read it as 1.5x of real time, called #115 a bug and reverted it, then restored it. When a speed is asked for,
  ask "faster than what you watched?" before reading the pieces' `speed`. Test: mobile-hero asserts SPEED and a rate on every clip.
- **Every click and tap zooms** (owner, 25 Oct 2026: "zoom enough always when we do a click, so that the user sees and understands where we clicked"; Build my strategy was only an example): the recorder gives a
  step with no `zoom` the default (hold.mjs `clickZoom`, 3 = TAP_ZOOM). The one way out is `zoom: false`, only for the job drawer's tabs (one zoom for all nine). Test: media-click-zoom loops over every step of every piece.
