"""tools/media.sh + tools/media-refresh.sh: the site's media are made by one local command, and only the files the site shows are refreshed."""
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MEDIA = (ROOT / 'tools/media.sh').read_text()
MEDIA_CODE = re.sub(r'(?m)^\s*#.*$', '', MEDIA)


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


class LocalMediaCommandTests(unittest.TestCase):
    """The site's media are made by ONE local command (owner, 21 Oct 2026: "Local only, one command"); CI never records them."""

    def test_no_workflow_that_records_media_runs_by_itself(self):
        for flow in sorted((ROOT / '.github/workflows').glob('*.yml')):
            code = re.sub(r'(?m)^\s*#.*$', '', flow.read_text())
            if 'media.mjs' in code or 'media-refresh' in code or 'tools/media.sh' in code:
                self.assertNotRegex(code, r'(?m)^\s*(schedule|push|pull_request):', f'{flow.name} records media from CI')

    def test_the_refresh_pr_title_has_a_tag_for_the_description_check(self):
        # site#31 was red on "PR description laid out": a title needs an "[xx] " tag (tools/pr-body-check.py)
        self.assertIn('--title "[media] ', (ROOT / 'tools/media-refresh.sh').read_text())

    def test_the_old_ci_recorder_is_gone(self):
        self.assertFalse((ROOT / '.github/workflows/product-media.yml').exists())

    def test_the_command_records_checks_and_opens_the_refresh_pr(self):
        self.assertIn('media/media.mjs', MEDIA_CODE)
        self.assertIn('tools/media-refresh.sh', MEDIA_CODE)
        self.assertIn('tools/overlay.sh', MEDIA_CODE)           # the public tree at origin/main, not a stale one
        self.assertIn('heavy-lock.sh', MEDIA_CODE)              # one heavy run at a time on this Mac
        self.assertIn('--background', MEDIA_CODE)

    def test_webp_comes_from_ffmpeg_full_and_whole_encoder_names(self):
        self.assertIn('brew install ffmpeg-full', MEDIA)
        self.assertIn("grep -qE \" $encoder \"", MEDIA_CODE)

    def test_the_record_hash_works_without_sha256sum(self):
        self.assertIn('shasum -a 256', (ROOT / 'tools/public-watch.sh').read_text())

    def test_no_ai_in_the_command(self):
        self.assertNotIn('ANTHROPIC', MEDIA_CODE)
        self.assertNotIn('direct.mjs', MEDIA_CODE)
        self.assertNotIn('claude', MEDIA_CODE)

    def test_the_command_never_touches_the_owners_app(self):
        self.assertNotIn('Application Support', MEDIA_CODE)
        self.assertNotIn('security find', MEDIA_CODE)

    def test_every_watched_path_exists_in_the_public_tree_names(self):
        paths = (ROOT / 'tools/media-paths.txt').read_text().split()
        self.assertEqual(sorted(paths), sorted(set(paths)))
        self.assertIn('desktop/renderer', paths)
        self.assertIn('extension', paths)


class MediaRefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.repo = self.tmp / 'repo'
        (self.repo / 'website/public/media').mkdir(parents=True)
        (self.repo / 'tools').mkdir()
        for name in ('media-refresh.sh', 'public-watch.sh', 'media-paths.txt', 'repos.sh'):
            shutil.copy(ROOT / 'tools' / name, self.repo / 'tools' / name)
        (self.repo / 'website/public/media/hero.mp4').write_text('old hero')
        (self.repo / 'website/public/media/still-jobs.webp').write_text('old still')
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.')
        git(self.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'start')
        self.tree = self.tmp / 'tree'
        (self.tree / 'desktop/renderer').mkdir(parents=True)
        (self.tree / 'desktop/renderer/app.js').write_text('screen')
        git(self.tree, 'init', '-q', '-b', 'main')
        git(self.tree, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.')
        git(self.tree, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'screens')
        self.set = self.tmp / 'set'
        self.set.mkdir()
        for name, text in (('manifest.json', '{}'), ('hero.mp4', 'new hero'), ('snip-new.webp', 'new piece')):
            (self.set / name).write_text(text)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def refresh(self, folder=None):
        return subprocess.run(['bash', 'tools/media-refresh.sh', str(folder or self.set), str(self.tree), 'abc1234def', '--no-push'],
                              cwd=self.repo, capture_output=True, text=True)

    def test_only_the_files_the_site_shows_are_refreshed_and_the_screens_are_recorded(self):
        run = self.refresh()
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        media = self.repo / 'website/public/media'
        self.assertEqual((media / 'hero.mp4').read_text(), 'new hero')
        self.assertEqual((media / 'still-jobs.webp').read_text(), 'old still', 'a file the set did not make stays')
        self.assertFalse((media / 'snip-new.webp').exists(), 'a new piece is listed, never added')
        self.assertIn('snip-new.webp', run.stdout)
        self.assertIn('still-jobs.webp', run.stdout)
        self.assertEqual(git(self.repo, 'branch', '--show-current').strip(), 'media-refresh')
        self.assertIn('.public-media', git(self.repo, 'show', '--name-only', '--format=', 'HEAD'))

    def test_the_refresh_branch_is_cut_from_the_newest_origin_main(self):
        # site#33 conflicted: the earlier refresh was merged after the run cut its branch
        remote = self.tmp / 'remote.git'
        git(self.tmp, 'clone', '-q', '--bare', str(self.repo), str(remote))
        git(self.repo, 'remote', 'add', 'origin', str(remote))
        git(self.repo, 'fetch', '-q', 'origin')
        other = self.tmp / 'other'
        git(self.tmp, 'clone', '-q', str(remote), str(other))
        (other / 'website/public/media/hero.mp4').write_text('merged meanwhile')
        git(other, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'earlier refresh merged')
        git(other, 'push', '-q', 'origin', 'HEAD:main')
        run = self.refresh()
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(git(self.repo, 'rev-parse', 'media-refresh~1').strip(), git(other, 'rev-parse', 'HEAD').strip(), 'cut from the tip main has now')
        self.assertEqual((self.repo / 'website/public/media/hero.mp4').read_text(), 'new hero', 'the new set wins')

    def test_a_folder_without_a_manifest_is_refused(self):
        (self.set / 'manifest.json').unlink()
        run = self.refresh()
        self.assertNotEqual(run.returncode, 0)
        self.assertEqual((self.repo / 'website/public/media/hero.mp4').read_text(), 'old hero')


if __name__ == '__main__':
    unittest.main()
