// The one place that names the GitHub owner of the jobadabra repos for the site's pages and CI jobs (org move, 2 Nov 2026; spec docs/superpowers/specs/2026-11-01-github-org-move-design.md in the public repo).
// Why (2 Nov 2026, owner: the Build Log said "Nothing was merged on 1 Nov" with 264 merged): `gh pr list --search` does not follow a renamed or transferred repo (REST and git do), so a literal old
// owner made the digest, the e2e page's PR numbers and the ops overview read 0 rows without an error. Change OWNER here when a repo moves again; workflows use vars.OWNER_OF_JOBADABRA || github.repository_owner.
// Guard: test/python/test_site_org_owner.py (no old-owner literal in .github, ops, admin).
export const OWNER = 'jobadabra';
export const PUBLIC_REPO = `${OWNER}/jobadabra`;
export const WEB_REPO = `${OWNER}/jobadabra-web`;
export const LAB_REPO = `${OWNER}/jobadabra-lab`;

/** https://github.com/<owner>/<repo> for a "owner/repo" name. */
export const githubUrl = repo => `https://github.com/${repo}`;
