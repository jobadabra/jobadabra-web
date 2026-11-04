"""No scheduled job here calls the Anthropic API (owner, 31 Oct 2026, after four "AI credit is 0 anthropic" alerts: "Why Anthropic is reached? We should use fully the Codex").

Writing or judging done for the owner (the changelog, the daily digest) runs on the Codex broker (workers/ai-broker, desktop/e2e/lib/broker-client.mjs). The only workflow lines that may still name an Anthropic
key are the ENGINE UNDER TEST, listed below with a reason each. The list may only shrink: every entry must still be used (a stale entry fails), and MAX_ENTRIES is lowered when one goes. A new job that needs
Anthropic is a new decision for the owner, not a new line here.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
if (ROOT / '.private' / '.github').is_dir():   # CI runs this repo's tests in the public tree, with this repo at .private: its own files only
    ROOT = ROOT / '.private'

# (file, token) -> why it is allowed. Why (31 Oct 2026): these measure what users run, so they must not move to the Codex broker (owner's 28 Oct rule: the engine under test keeps its own engine).
ALLOWED = {
    ('.github/workflows/random-draw.yml', 'RANDOM_DRAWS_ANTHROPIC_KEY'): "the search robot's SDK talks to the local Free AI relay with its throwaway key (the engine under test is Free AI, not Anthropic); only the variable's name says Anthropic",
    ('.github/workflows/random-draw.yml', 'ANTHROPIC_BASE_URL'): 'points that SDK at http://127.0.0.1:8787/api/ai, the local Free AI relay',
}
MAX_ENTRIES = 2   # lower this when an entry goes; never raise it

# Allowed by name anywhere, not on the shrinking list. Why (1 Nov 2026, coordinator 31 Oct 2026 in the public repo's tests/test_ci_no_anthropic.py; ai-cost-billed.yml moved here, rs 6a/6):
# the Admin key only READS what Anthropic billed; it makes no model call and spends nothing. This guard bans keys that buy model calls.
COST_READERS = {'ANTHROPIC_ADMIN_KEY'}

PATTERN = re.compile(r'\b[A-Z0-9_]*ANTHROPIC[A-Z0-9_]*\b|claude-code-action|CLAUDE_CODE_OAUTH[A-Z_]*|api\.anthropic\.com')


def code_lines(path):
    for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.lstrip().startswith('#'):   # a comment may say the word; only a line that does something counts
            yield number, line.split('   #')[0] if path.suffix in ('.yml', '.yaml') else line


def uses(paths):
    found = {}
    for path in paths:
        for number, line in code_lines(path):
            for token in PATTERN.findall(line):
                found.setdefault((str(path.relative_to(ROOT)), token), []).append(number)
    return found


# Why (layout 2/3, #318, 2 Nov 2026): in this repo's own files the jobs sit at ops/jobs (CI reads .private); in the joined tree (tools/site-run.sh) tools/layout-map.txt puts them at jobs/.
JOBS_DIR = ROOT / 'ops' / 'jobs' if (ROOT / 'ops' / 'jobs').is_dir() else ROOT / 'jobs'
WORKFLOWS = sorted((ROOT / '.github' / 'workflows').glob('*.y*ml'))
JOBS = sorted(JOBS_DIR.glob('*.mjs'))


class NoAnthropic(unittest.TestCase):
    def test_the_scan_reads_the_workflows_and_jobs(self):
        self.assertGreater(len(WORKFLOWS), 10, 'positive control: the workflow folder is read')
        self.assertTrue(any(path.name == 'changelog-publish.mjs' for path in JOBS), 'positive control: the jobs are read')

    def test_no_workflow_passes_an_anthropic_key_except_the_named_engines_under_test(self):
        extra = {key for key in uses(WORKFLOWS) if key not in ALLOWED and key[1] not in COST_READERS}
        self.assertEqual(extra, set(), 'a workflow names an Anthropic key: move the job to the Codex broker (broker-client.mjs), or ask the owner; do not add to ALLOWED')

    def test_no_job_script_calls_the_anthropic_api(self):
        self.assertEqual(uses(JOBS), {}, 'a jobs/*.mjs file names Anthropic: use askBroker (desktop/e2e/lib/broker-client.mjs)')

    def test_the_allowlist_only_shrinks(self):
        self.assertLessEqual(len(ALLOWED), MAX_ENTRIES)
        self.assertEqual(set(ALLOWED) - set(uses(WORKFLOWS)), set(), 'an entry is no longer used: delete it and lower MAX_ENTRIES')
        self.assertTrue(all(len(reason) > 20 for reason in ALLOWED.values()), 'every entry says why')

    def test_the_moved_jobs_prove_themselves_with_the_run_token_not_a_key(self):
        for name in ('changelog-publish.yml', 'daily-digest.yml'):
            text = (ROOT / '.github' / 'workflows' / name).read_text(encoding='utf-8')
            self.assertRegex(text, r'(?m)^  id-token: write\b', f'{name}: the broker takes the run\'s OIDC token')
            self.assertNotRegex(text, r'ai-cost-report\.mjs --job (changelog-publish|daily-digest) --file', f'{name}: its cost row is tagged --provider openai (the Codex plan), never counted as Anthropic on /ai-cost')
        for name in ('changelog-publish.mjs', 'daily-digest.mjs'):
            self.assertIn('askBroker', (JOBS_DIR / name).read_text(encoding='utf-8'), name)


if __name__ == '__main__':
    unittest.main()
