# The hosted Always on image (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §1): the public engine as the app runs it, serving `python -m src hosted --serve`.
# Cloudflare Container, instance standard-1; the Worker POSTs /run {site, token} per run. AI goes through our route. Build from the repo root: docker build -f hosted/Dockerfile .
# The headless browser (src/sources/render.py) reads job boards and careers pages built by scripts, as the Mac app and the GitHub runs do (owner, 19 Oct 2026).
# Why (12 Nov 2026, hi, coordinator): the floating `python:3.12-slim` is the same class of surprise as the Playwright range below (a base that moves under an unchanged repo); exact tag of what built green on 12 Nov (Python 3.12.16, Debian trixie). Raise it on purpose, with this build green.
FROM python:3.12.16-slim-trixie
WORKDIR /engine
COPY requirements.txt requirements-render.txt ./
# Why (12 Nov 2026, hi): requirements-render.txt says `playwright>=1.47`, so the build took whatever was newest. Playwright 1.65.0 (released 9 Nov 21:09Z) ships a node driver that needs libatomic.so.1, which python:3.12-slim lacks:
# `playwright install` exited 127 and this image, and hosted-e2e on main, were red from 9 Nov 23:35Z. Pinned to the last version that built (1.64.1); raise it on purpose, with this build green (and libatomic1 installed if the driver needs it).
ARG PLAYWRIGHT_VERSION=1.64.1
RUN pip install --no-cache-dir -r requirements.txt -r requirements-render.txt "playwright==${PLAYWRIGHT_VERSION}" && playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY src ./src
COPY config ./config
COPY templates ./templates
ENV JOBADABRA_NO_DOTENV=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
# The run token arrives in the POST body, per run; nothing secret is baked in.
CMD ["python", "-m", "src", "hosted", "--serve"]
