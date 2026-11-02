// The digest reads the repo GitHub knows today (owner, 2 Nov 2026: the Telegram Build Log said "Nothing was merged on 1 Nov" at 06:55 while 264 PRs had merged).
// Cause: the public repo moved to the org `jobadabra`; `gh pr list --search` (GitHub search) does not follow a rename, REST does. This plays that: a `gh` on PATH that answers a search only for the org's repo.
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {PUBLIC_REPO} from '../../shared/repos.js';

const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
writeFileSync(join(dir, 'gh'), `#!/bin/sh
# pr list --repo <r> [--search ...]: GitHub search finds nothing under a name the repo was renamed from; a plain list (no --search) is REST and still redirects
repo=""; search=""; prev=""
for a in "$@"; do [ "$prev" = "--repo" ] && repo="$a"; [ "$prev" = "--search" ] && search="$a"; prev="$a"; done
case "$repo" in jobadabra/*) owner=org;; *) owner=old;; esac
if [ -n "$search" ] && [ "$owner" = old ]; then echo '[]'; exit 0; fi
case "$*" in *--state\\ merged*) echo '[{"number":957,"title":"[0c] A change","mergedAt":"2026-11-01T10:00:00Z","body":"x"}]';; *) echo '[]';; esac
`);
chmodSync(join(dir, 'gh'), 0o755);

test('the digest finds the PRs merged on 1 Nov: its search names the org, not the repo as it was called', async () => {
  process.env.PATH = `${dir}:${process.env.PATH}`;
  delete process.env.REPO; delete process.env.GITHUB_REPOSITORY;
  const {collect} = await import('../../jobs/daily-digest.mjs');
  const {prs} = collect('2026-11-01');
  assert.deepEqual(prs.map(pr => pr.number), [957], 'a search against GarryOne/jobadabra reads 0 rows');
  assert.match(PUBLIC_REPO, /^jobadabra\//);
});
