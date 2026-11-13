# Cloud runners: two runners, named for what they do, with room, alerts and a staging copy (lg, 13 Nov 2026)

> **Verdict:** keep two runners (Find jobs and Apply), never merge them; give each 100 at once; alert on capacity, memory, CPU, disk, errors and failed runs (🟠/🔴); rename them for what they do; build a staging copy of each, kept off until the first real users.
> Owner, 13 Nov 2026, asked via AskUserQuestion: "Approve all (Recommended)", "100 each (Recommended)", "80% of the ceiling (Recommended)", "Yes, staging for all three"; then "prepare the staging instances, prepare the CICD for staging... but let's keep it disabled until we have first real users" · "I'd like to avoid now long CICD during the developpment phase" · "at the end, store in the readme a graph with the runners and workers".
> Sketch with the measurements and arguments: https://claude.ai/artifact/UnnMg4in4nbGtMbcZ4KMx2

## Why two runners, not one
- They deploy at different paces: Find jobs follows the public engine (public-watch), Apply follows the form-filling code; one image would stop a held night on every engine deploy.
- Only the Apply runner may submit (`desktop/ready-fill/submit-gate.js`); a Find jobs container never holds that code.
- Size and cost are neutral (both standard-1, measured 0.8-1.2 GB a run, ~$0.01 a run).

## PRs
Why (13 Nov 2026, owner: "insead of 5 PRs? can't we make it in 2 or 3 ?" · "each PR adds overhead with it"; asked via AskUserQuestion: "3 PRs (Recommended)").

| # | What |
|---|---|
| 1/3 | Capacity and alerts: `max_instances` 100 on both runners (`RUNNER_CEILING`, 🟠 80 / 🔴 100), and the cloud health check (`shared/cloud-health.js`): container memory, CPU and disk, each Worker's failed replies against its normal week, failed Always on runs and Apply fills; all 🟠 warning / 🔴 critical in the 5-minute tick |
| 2/3 | Rename: `find-jobs-runner` / queue `find-jobs-runs`, `apply-runner` / queue `apply-runs`; README graph of every runner and Worker; old Workers, queues and container apps deleted by hand after the deploy |
| 3/3 | Staging for Find jobs, the site and Apply: each deploys to its staging copy and is checked before production, behind one switch (repo variable `STAGING_GATE`, off until the first real users) |

## Progress
- [x] 1/3 capacity + cloud alerts (#635)
- [x] 2/3 rename + README graph, and the runner 🔴 from a refused start (Gitar on #635) (this PR)
- [ ] 3/3 staging for all three (off)

## Not now (parked with a trigger)
- Apply deploys wait while a night is held: trigger, the first Pro night.
- A per-host pace for boards across hosted people: trigger, 5+ hosted people.
- A staging search spends AI: which account pays is asked before the switch turns on.

## 2/3 after the merge (by hand, in this order)
0. Merge in the day (not 21:47-07:00 UTC): a night held by the old `www-ready-runner` would lose its morning tabs when the site switches to `apply-runner`.
1. `site.yml` and `release-ready-runner.yml` start on the merge: the queues `find-jobs-runs` and `apply-runs` are made, `apply-runner` deploys, then the site (it waits for `apply-runner`).
2. `gh workflow run release-hosted-runner.yml -f target=production` right away: `find-jobs-runner` consumes `find-jobs-runs` (runs the site queues there wait for it, well inside their 30-minute life).
3. Once both new apps show running instances: delete the Workers `www-hosted-runner`, `www-ready-runner` (and their container apps), then the queues `hosted-runs`, `ready-runs` once empty. The staging runner `www-hosted-runner-staging` and `hosted-runs-staging` go in 3/3.
