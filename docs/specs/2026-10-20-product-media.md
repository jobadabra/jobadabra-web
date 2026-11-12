# Product media: screenshots and videos that remake themselves

Owner, 20 Oct 2026: "I want me doing nothing and everything being done automatically, with AI." Sketch approved the same day
(https://claude.ai/artifact/3JNoLY2QHGiuH5vkuJkjNf): effects in code + Claude as director, auto re-run when the screens change.
Persona: "Nurse in Lyon" (owner, 20 Oct 2026); another search profile is one option (`--persona <folder>`).
Moved from the public repo to this one on 20 Oct 2026 (owner: "We want to keep everything jobadabra/Jobadabra product related (marketting..) privately").
The public repo keeps only the app's hook `JOBADABRA_DEMO_DIR` (desktop/lib/demo.js, its test desktop/test/demo-dir.test.js).

## How it works
- `tools/site-run.sh bash -c 'node media/media.mjs'` (media/media.mjs, laid over public main): records the app (demo mode, dark, hidden window, temp copy of the persona folder) and the real
  extension filling a fictional form (form.html at a reserved `.example` address, e2e harness isolation), renders zoom/cursor/click from the click
  log in code (camera.mjs + render.cjs: real pixels only), checks (check.mjs), encodes (encode.mjs), writes `manifest.json` (manifest.mjs).
- Director: `node media/direct.mjs <piece>` (Claude on the subscription, never in CI) writes `plans/<piece>.json` (zoom per look, caption).
- Delivery (21 Oct 2026, owner: "Local only, one command"): `tools/media.sh [pieces]` on the owner's Mac lays public origin/main under this repo, records, checks, then `tools/media-refresh.sh` opens the PR `media-refresh` that refreshes the files `web/public/media/` already holds (`tools/media.sh --check` says if the screens changed). No CI schedule or push trigger. The owner merges it; the merge deploys the site.
- Pieces and formats agreed with the site redesign (bd): hero, extension-fill, stills, snips; dark only; captions in the manifest only.

## Progress
- [x] Sketch + owner's decisions (20 Oct 2026) (proof: none: the owner's answers in session 7d; the sketch link above)
- [x] Recorder: app (screencast + click log) and the real extension on a fictional form (proof: media/record-extension.mjs)
- [x] Renderer: zoom, cursor, click ring from the log; MP4/WebM/phone/GIF/poster within budget (proof: desktop/test/media-camera.test.js)
- [x] Stills + close-ups (WebP), manifest, checks (fictional e-mails only, dark, the form filled, capture rate) (proof: desktop/test/media-check.test.js)
- [x] Director (`direct.mjs`) + plans folder (proof: media/plans/hero.json)
- [x] CI workflow, in this repo since 20 Oct 2026: daily check, Mac recording, refresh PR (proof: tests/test_site_media_refresh.py)
- [x] Nurse-in-Lyon persona (owner, 20 Oct 2026), the media's default; dates shift to the recording week; the default person's words refused (proof: desktop/test/media-persona.test.js)
- [x] Stills fill the window (CDP capture), close-ups at 2x, Strategy waited for, extension poster = the filled form (proof: desktop/test/media-persona.test.js, desktop/test/media-camera.test.js)
- [x] apply-split (browser + app side by side) for /how-it-works: the hero's two Apply recordings side by side (pip.mjs splitPlan), `tools/media.sh apply-split` (proof: desktop/test/media-pip.test.js; owner, 12 Nov 2026: the old hand-drawn split still showed the old name)
- [x] First director plans committed for hero and extension-fill (proof: media/plans/extension-fill.json)
- [ ] Retire site-demo.mjs / apply-demo.mjs: the public PR that removes the pipeline from the public repo
