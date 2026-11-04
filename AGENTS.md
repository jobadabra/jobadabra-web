# jobadabra-web: instructions for any agent (Claude, Codex, or other)

This is the private repo of the Jobadabra website, `/admin` and the CI that feeds them. The rules are in **[CLAUDE.md](CLAUDE.md)** (written for Claude Code, valid for any agent) and **[README.md](README.md)**.

In one breath:
- **Private reads public, public never reads private.** Work inside the joined tree: `tools/site-run.sh <cmd>`.
- **Changes land by PR to `main`**, shipped with `~/jobadabra/tools/ship.sh --background --body=<file>` (body per `~/jobadabra/tools/pr-body-template.md`; never a bare `gh pr create`) (wait for the check "All checks passed"); merging deploys production, so try "Release · Website staging" first.
- **Where a file goes:** `{website,admin,api,shared,workers/www}` (see `website/README.md`); `test/guards/boundary.test.js` guards the imports.
- **A change on both sides lands here first**, then the public PR lists and uses it (owner, 21 Oct 2026); public-listed-but-missing here stays red.
- **Secrets** only in the Keychain, GitHub secrets and Worker secrets; the owner sets them; never print one.
- The project's wider rules (change tiers, red main, reading websites, ask before AI spend) are in the public repo: `~/jobadabra/AGENTS.md` and `CLAUDE.md`.
