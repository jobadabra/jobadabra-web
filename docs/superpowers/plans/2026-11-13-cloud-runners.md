# Cloud runners: two runners, named for what they do, with room and a staging copy (lg, 13 Nov 2026)

> **Verdict:** keep two runners (Find jobs and Apply), never merge them; give each 100 at once with a 🟠/🔴 alert; rename them for what they do; build a staging copy of each, kept off until the first real users.
> Owner, 13 Nov 2026, asked via AskUserQuestion: "Approve all (Recommended)", "100 each (Recommended)", "80% of the ceiling (Recommended)", "Yes, staging for all three"; then "prepare the staging instances, prepare the CICD for staging... but let's keep it disabled until we have first real users" · "I'd like to avoid now long CICD during the developpment phase" · "at the end, store in the readme a graph with the runners and workers".
> Sketch with the measurements and arguments: https://claude.ai/artifact/UnnMg4in4nbGtMbcZ4KMx2

## Why two runners, not one
- They deploy at different paces: Find jobs follows the public engine (public-watch), Apply follows the form-filling code; one image would stop a held night on every engine deploy.
- Only the Apply runner may submit (`desktop/ready-fill/submit-gate.js`); a Find jobs container never holds that code.
- Size and cost are neutral (both standard-1, measured 0.8-1.2 GB a run, ~$0.01 a run).

## PRs
| # | What | Left on |
|---|---|---|
| 1/5 | Capacity: `max_instances` 100 on both runners, `RUNNER_CEILING`, 🟠 at 80 / 🔴 at 100 in the 5-minute tick | this plan |
| 2/5 | Rename: `find-jobs-runner` / queue `find-jobs-runs`, `apply-runner` / queue `apply-runs`; README graph of every runner and Worker; old Workers, queues and container apps deleted by hand after the deploy | |
| 3/5 | Find jobs staging gate: the staging runner deploys first and runs one search before production, behind one switch (repo variable `STAGING_GATE`, off) | |
| 4/5 | Site staging gate: `www-staging` deploys and is probed before `www`, same switch, off | |
| 5/5 | Apply staging Worker + gate, same switch, off | |

## Progress
- [x] 1/5 capacity (this PR)
- [ ] 2/5 rename + README graph
- [ ] 3/5 Find jobs staging gate (off)
- [ ] 4/5 site staging gate (off)
- [ ] 5/5 Apply staging Worker + gate (off)

## Not now (parked with a trigger)
- Apply deploys wait while a night is held: trigger, the first Pro night.
- A per-host pace for boards across hosted people: trigger, 5+ hosted people.
- A staging search spends AI: which account pays is asked before the switch turns on.
