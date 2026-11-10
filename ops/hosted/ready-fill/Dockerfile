# The Ready to send image (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): Chromium, the extension as the app ships it, and the night's runner. No secret, no user data baked in: the token and the batch arrive at run time.
# Cloudflare Container, standard-1; the Worker POSTs /run {site, token}. Build from the repo root: docker build -f hosted/ready-fill/Dockerfile .
FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /night
COPY hosted/ready-fill/package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY desktop/ready-fill/*.mjs ./
COPY hosted/ready-fill/*.mjs ./
COPY extension ./extension
COPY app-core/src ./app-core/src
# The app's files the night imports, at /desktop/... so `../../desktop/lib/x.js` resolves from /night as it does in the repo; desktop/package.json says they are ES modules.
# Why (8 Nov 2026, cloud runner 2/4): form-address.js is the fill's; the rest are the readiness night's (read-night.mjs and down). test/integration/ready-fill-image.test.js follows every import and fails on a file missing here.
COPY desktop/lib/form-address.js desktop/lib/triage-reader.js desktop/lib/triage-read.js desktop/lib/session-tab.js /desktop/lib/
# Why (10 Nov 2026, cs 2/4): the Full automation night's one Submit gate is a .js file (the *.mjs copy above does not take it) with the Mac's shared proof and eligibility checks; cs 3/4 imports it from the night.
COPY desktop/ready-fill/submit-gate.js ./
COPY desktop/lib/submit-proof.js desktop/lib/apply-eligibility.js /desktop/lib/
COPY desktop/lib/ladder/rung1-kept.js desktop/lib/ladder/rung2-sketch.js desktop/lib/ladder/rung3-digest.js /desktop/lib/ladder/
COPY desktop/lib/ai/models.js /desktop/lib/ai/models.js
# desktop/shared/alias-schema.js is generated in the app by scripts/stage.mjs from this file, so the image takes it from its source.
COPY extension/alias-schema.js /desktop/shared/alias-schema.js
COPY desktop/package.json /desktop/package.json
ENV NODE_ENV=production EXTENSION_DIR=/night/extension
EXPOSE 8080
CMD ["node", "main.mjs"]
