"""No workflow, job or admin page names the old owner `GarryOne/` (owner, 2 Nov 2026: the Telegram Build Log said "Nothing was merged on 1 Nov" while 264 PRs had merged).

Why: the public repo moved to the org `jobadabra` on 1 Nov 2026. GitHub's REST calls and git follow a rename, but `gh pr list --search` does NOT: against `GarryOne/jobadabra` it returns 0 rows, so
the digest, the e2e page's PR numbers and the ops overview went blind without an error. A literal owner is also wrong the next time a repo moves. The owner now comes from `shared/repos.js` (code)
or `vars.OWNER_OF_*` / `github.repository_owner` (workflows). Scope: .github, ops, admin (api/, shared/ and tools/ are the org-move spec's step 6/7 sweep).
"""
import os
import pathlib
import unittest

# This repo's own files: SITE_REPO_DIR (tools/site-run.sh), else .private (CI lays this repo there), else the checkout this file sits in (test/python/ -> two levels up).
HERE = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path(os.environ['SITE_REPO_DIR']) if os.environ.get('SITE_REPO_DIR') else (
    HERE.parent / '.private' if (HERE.parent / '.private' / '.github').is_dir() else HERE.parent.parent)   # joined tree: tests/ sits beside .private; own checkout: test/python/ is two levels below the root
FOLDERS = ['.github', 'ops', 'admin']
SUFFIXES = {'.yml', '.yaml', '.js', '.mjs', '.sql', '.json', '.sh', '.py'}

# file -> why it may still say the old owner. The list may only shrink; every entry must still be used.
ALLOWED = {
    'ops/db/migrations/0007_triage.sql': 'an applied migration: its comment is history (the lab repo as it was named when the table was made); editing an applied migration is not worth a checksum question',
}


def scanned():
    for folder in FOLDERS:
        for path in sorted((ROOT / folder).rglob('*')):
            if path.is_file() and path.suffix in SUFFIXES:
                yield path


def lines_with_old_owner():
    found = {}
    for path in scanned():
        name = str(path.relative_to(ROOT))
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if 'garryone' in line.lower():   # the bare `owner: GarryOne` of an App-token step too, not only `GarryOne/repo`
                found.setdefault(name, []).append(number)
    return found


class OrgOwner(unittest.TestCase):
    def test_the_scan_reads_the_workflows_jobs_and_pages(self):
        names = {str(path.relative_to(ROOT)) for path in scanned()}
        for needed in ('.github/workflows/daily-digest.yml', 'ops/jobs/daily-digest.mjs', 'admin/build-log.js'):
            self.assertIn(needed, names, f'positive control: {needed} is read')

    def test_nothing_names_the_old_owner(self):
        left = {name: lines for name, lines in lines_with_old_owner().items() if name not in ALLOWED}
        self.assertEqual(left, {}, 'import the repo names from shared/repos.js (code) or use vars.OWNER_OF_JOBADABRA || github.repository_owner (workflow); never write the owner')

    def test_the_workflows_that_read_the_public_repo_take_its_owner_from_the_variable(self):
        # Why (2 Nov 2026): the code fallback (shared/repos.js) is tested by test/jobs/daily-digest-repo.test.js; this pins the CI side, where the job really gets REPO from.
        for name in ('changelog-publish', 'daily-digest', 'e2e-intel', 'integration-intel', 'ops-overview'):
            text = (ROOT / '.github' / 'workflows' / f'{name}.yml').read_text(encoding='utf-8')
            self.assertIn('REPO: ${{ vars.OWNER_OF_JOBADABRA || github.repository_owner }}/jobadabra', text, name)

    def test_every_allowed_entry_is_still_used(self):
        used = lines_with_old_owner()
        self.assertEqual([name for name in ALLOWED if name not in used], [], 'a stale ALLOWED entry: remove it')


if __name__ == '__main__':
    unittest.main()
