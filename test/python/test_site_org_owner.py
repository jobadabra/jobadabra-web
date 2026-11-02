"""No workflow, job or admin page names the old owner `GarryOne/` (owner, 2 Nov 2026: the Telegram Build Log said "Nothing was merged on 1 Nov" while 264 PRs had merged).

Why: the public repo moved to the org `jobadabra` on 1 Nov 2026. GitHub's REST calls and git follow a rename, but `gh pr list --search` does NOT: against `GarryOne/jobadabra` it returns 0 rows, so
the digest, the e2e page's PR numbers and the ops overview went blind without an error. A literal owner is also wrong the next time a repo moves. The owner now comes from `shared/repos.js` (code)
or `vars.OWNER_OF_*` / `github.repository_owner` (workflows). Scope: the whole repo except test/ (fixtures) and the ALLOWED files, each with its reason.
"""
import os
import pathlib
import re
import unittest

# This repo's own files: SITE_REPO_DIR (tools/site-run.sh), else .private (CI lays this repo there), else the checkout this file sits in (test/python/ -> two levels up).
HERE = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path(os.environ['SITE_REPO_DIR']) if os.environ.get('SITE_REPO_DIR') else (
    HERE.parent / '.private' if (HERE.parent / '.private' / '.github').is_dir() else HERE.parent.parent)   # joined tree: tests/ sits beside .private; own checkout: test/python/ is two levels below the root
SKIP_DIRS = {'.git', 'node_modules', '.overlay', '.private', 'worktrees', 'test'}   # test/: fixtures pass repo names as data; a test that asserts a DEFAULT fails by itself when the default changes
SUFFIXES = {'.yml', '.yaml', '.js', '.mjs', '.html', '.css', '.md', '.json', '.jsonc', '.toml', '.sql', '.sh', '.py', '.txt'}

# file -> why it may still say the old owner. The list may only shrink; every entry must still be used.
ALLOWED = {
    'ops/db/migrations/0007_triage.sql': 'an applied migration: its comment is history (the lab repo as it was named when the table was made); editing an applied migration is not worth a checksum question',
    'website/public/trust.html': 'the attestation command for builds made BEFORE the move: their provenance names GarryOne/jobadabra (spec item 12: prove -R on an old release, then show both commands)',
    'workers/ai-broker/worker.js': "the broker's accepted OIDC owners list both on purpose until about 8 Nov 2026 (coordinator mac-07 drops it)",
    'workers/ai-broker/wrangler.jsonc': "the broker's REPOSITORY variable lists both owners on purpose (as worker.js)",
    'README.md': 'a history sentence: where the repo was split out from, on 19-20 Oct 2026',
    'CLAUDE.md': "the owner's instructions file: a session does not edit it on a peer's say; the owner or coordinator updates it",
    '.claude/skills/redo-site-hero-video/SKILL.md': "a skill file (instructions): as CLAUDE.md",
}


def scanned():
    for path in sorted(ROOT.rglob('*')):
        parts = set(path.relative_to(ROOT).parts)
        if path.is_file() and path.suffix in SUFFIXES and not parts & SKIP_DIRS and path.name != pathlib.Path(__file__).name:
            yield path


def lines_with_old_owner():
    found = {}
    for path in scanned():
        name = str(path.relative_to(ROOT))
        for number, line in enumerate(path.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
            if 'garryone' in line.lower():   # the bare `owner: GarryOne` of an App-token step too, not only `GarryOne/repo`
                found.setdefault(name, []).append(number)
    return found


class OrgOwner(unittest.TestCase):
    def test_the_scan_reads_the_workflows_jobs_and_pages(self):
        names = {str(path.relative_to(ROOT)) for path in scanned()}
        for needed in ('.github/workflows/daily-digest.yml', 'ops/jobs/daily-digest.mjs', 'admin/build-log.js', 'api/releases.js', 'website/public/trust.html', 'tools/tree.sh'):
            self.assertIn(needed, names, f'positive control: {needed} is read')

    def test_nothing_names_the_old_owner(self):
        left = {name: lines for name, lines in lines_with_old_owner().items() if name not in ALLOWED}
        self.assertEqual(left, {}, 'import the repo names from shared/repos.js (code) or use vars.OWNER_OF_JOBADABRA || github.repository_owner (workflow); never write the owner')

    def test_the_workflows_that_read_the_public_repo_take_its_owner_from_the_variable(self):
        # Why (2 Nov 2026): e2e-intel, integration-intel and ops-overview moved to the public repo (jobadabra#2989), which takes its own repo from github.repository. The code fallback (shared/repos.js) is tested by test/jobs/daily-digest-repo.test.js; this pins the CI side, where the job really gets REPO from.
        for name in ('changelog-publish', 'daily-digest'):
            text = (ROOT / '.github' / 'workflows' / f'{name}.yml').read_text(encoding='utf-8')
            self.assertIn('REPO: ${{ vars.OWNER_OF_JOBADABRA || github.repository_owner }}/jobadabra', text, name)

    def test_the_shell_tools_name_the_same_owner_as_shared_repos(self):
        owner = re.search(r"OWNER = '([^']+)'", (ROOT / 'shared' / 'repos.js').read_text(encoding='utf-8')).group(1)
        shell = (ROOT / 'tools' / 'repos.sh').read_text(encoding='utf-8')
        self.assertEqual(re.findall(r':-([\w-]+)/jobadabra', shell), [owner, owner], 'tools/repos.sh and shared/repos.js (OWNER) must name the same owner')

    def test_every_allowed_entry_is_still_used(self):
        used = lines_with_old_owner()
        self.assertEqual([name for name in ALLOWED if name not in used], [], 'a stale ALLOWED entry: remove it')


if __name__ == '__main__':
    unittest.main()
