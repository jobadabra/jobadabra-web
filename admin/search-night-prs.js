// The marks on the Night search chart (owner, 10 Nov 2026: "Each merged search PR shows as a mark on the Night search chart, written automatically; the tab goes", replacing the hand-written Experiments tab whose last row was
// 18 Oct): for every stored night, the PRs merged into the public repo that changed the search code between the build of the night before and this night's build. A night = the build (sha) of its workflow run;
// the PRs are the commits on main, in that window, that touch SEARCH_PATHS, read from GitHub (GraphQL history with the PR each commit belongs to). Nothing is typed by hand: the nightly upload (admin/search-night.js ingest)
// fills it, and a night that is still unmarked is filled by the next upload. Counts, PR numbers and PR titles only (public repo): no job, company or CV text. Guard: test/unit/admin/search/search-night-prs.test.js.
//
// Design: a night's `build` is {sha, built} (built = the commit's date) or null (the run is not known to GitHub: terminal); its `prs` is [{n, title}] newest first (+ `prsMore`, the PRs beyond KEEP_PRS), [] when nothing
// changed between the two builds, or null when there is nothing to compare with (the oldest build; terminal). `undefined` is the only state that is still to be filled. A GitHub error throws and writes nothing, so the next upload tries again.
const RUNS_READ = 100;   // the night's workflow runs read at once: a month of nights plus by-hand runs
export const KEEP_PRS = 15;
export const WORKFLOW = 'search-personas.yml';

/**
 * What counts as search code: the files the nightly Search check runs or judges, as repo paths (GitHub's history takes a file or a folder, no pattern).
 * Why (10 Nov 2026): the Find jobs pipeline's own stage files (press-yardstick.yml `paths:`, the list the pipeline PRs are measured on), plus all of src/sources (every job source) and tools/persona-search (the press, the candidates and
 * the blind judge: a change there moves the night's numbers without touching the engine). A test keeps every yardstick stage file inside this list (search-night-prs.test.js).
 */
export const SEARCH_PATHS = [
  'src/press', 'src/sources', 'src/time_budget.py', 'src/daily_search.py', 'src/daily_search_reporting.py', 'src/daily_search_scoring.py', 'src/first_jobs.py', 'src/employer_index.py', 'src/source_rank.py',
  'src/ai/title_triage.py', 'src/ai/title_queue.py', 'src/ai/place_triage.py', 'src/ai/score.py', 'src/ai/slots.py', 'src/ai/batch_scope.py',
  'desktop/lib/search-steps.js', 'desktop/lib/pipeline-args.js', 'desktop/lib/pipeline-env.js',
  'tools/persona-search', `.github/workflows/${WORKFLOW}`,
];

const SHA = /^[0-9a-f]{40}$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const headers = env => ({Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jobadabra-web', 'X-GitHub-Api-Version': '2022-11-28'});
const repoOf = env => String(env.GITHUB_REPO || 'jobadabra/jobadabra');

/** The head sha of each recent run of the nightly workflow on main: Map(run id -> sha). Throws on an answer that is not 2xx. */
export async function runShas(env, fetcher = fetch) {
  const answer = await fetcher(`https://api.github.com/repos/${repoOf(env)}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=${RUNS_READ}`, {headers: headers(env), signal: AbortSignal.timeout(20000)});
  if (!answer.ok) throw new Error(`GitHub runs answered ${answer.status}`);
  const runs = (await answer.json())?.workflow_runs;
  return new Map((Array.isArray(runs) ? runs : []).filter(run => SHA.test(run?.head_sha || '')).map(run => [String(run.id), run.head_sha]));
}

async function graphql(env, query, fetcher) {
  const [owner, name] = repoOf(env).split('/');
  const answer = await fetcher('https://api.github.com/graphql', {method: 'POST', headers: {...headers(env), 'Content-Type': 'application/json'}, body: JSON.stringify({query, variables: {owner, name}}), signal: AbortSignal.timeout(25000)});
  if (!answer.ok) throw new Error(`GitHub GraphQL answered ${answer.status}`);
  const body = await answer.json();
  if (body?.errors?.length || !body?.data?.repository) throw new Error(`GitHub GraphQL: ${text(body?.errors?.[0]?.message || 'no repository', 80)}`);
  return body.data.repository;
}

/** The commit date of each sha: Map(sha -> ISO). A sha GitHub does not know is left out. */
export async function commitDates(env, shas, fetcher = fetch) {
  const list = [...new Set(shas)].filter(sha => SHA.test(sha));
  if (!list.length) return new Map();
  const repo = await graphql(env, `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${list.map((sha, i) => `s${i}: object(oid: "${sha}") { ... on Commit { committedDate } }`).join(' ')} } }`, fetcher);
  return new Map(list.map((sha, i) => [sha, repo[`s${i}`]?.committedDate]).filter(([, date]) => date));
}

/**
 * The commits reachable from `tip`, dated after `since`, that touched any SEARCH_PATHS entry: [{oid, date, n, title}] (n = the PR the commit came in with, null for a direct push). One query for all paths; a path that has more than
 * 100 commits is paged (only that path). The PR number comes from GitHub's own link between the commit and its PR, then from the "(#n)" a squash merge puts in the subject.
 */
export async function searchCommits(env, tip, since, fetcher = fetch, paths = SEARCH_PATHS) {
  const found = new Map(), cursors = paths.map(() => null), done = paths.map(() => false);
  for (let round = 0; round < 6 && done.includes(false); round++) {
    const open = paths.map((path, i) => [path, i]).filter(([, i]) => !done[i]);
    const history = ([path, i]) => `h${i}: history(path: ${JSON.stringify(path)}, since: ${JSON.stringify(since)}, first: 100${cursors[i] ? `, after: ${JSON.stringify(cursors[i])}` : ''}) { pageInfo { hasNextPage endCursor } nodes { oid committedDate messageHeadline associatedPullRequests(first: 1) { nodes { number title } } } }`;
    const repo = await graphql(env, `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { object(oid: "${tip}") { ... on Commit { ${open.map(history).join(' ')} } } } }`, fetcher);
    if (!repo.object) throw new Error('GitHub does not know the newest build');
    for (const [, i] of open) {
      const page = repo.object[`h${i}`];
      for (const node of page?.nodes || []) {
        const pull = node.associatedPullRequests?.nodes?.[0], subject = text(node.messageHeadline, 200), squash = /\(#(\d{1,7})\)\s*$/.exec(subject);
        found.set(node.oid, {oid: node.oid, date: node.committedDate, n: pull ? pull.number : squash ? Number(squash[1]) : null, title: text(pull?.title || subject.replace(/\s*\(#\d+\)\s*$/, ''), 90)});
      }
      done[i] = !page?.pageInfo?.hasNextPage;
      cursors[i] = page?.pageInfo?.endCursor || null;
    }
  }
  if (done.includes(false)) throw new Error('a search path has over 600 commits since the oldest build: not marked rather than marked with PRs missing');
  return [...found.values()];
}

/** The PRs of one window (after `from`, up to and including `to`), newest first, one entry per PR: {prs: [{n, title}] (at most KEEP_PRS), more}. */
export function prsIn(commits, from, to) {
  const seen = new Set(), list = [];
  for (const commit of commits.filter(item => item.date > from && item.date <= to).sort((a, b) => b.date.localeCompare(a.date))) {
    const key = commit.n ?? commit.oid;
    if (!seen.has(key)) { seen.add(key); list.push({n: commit.n, title: commit.title}); }
  }
  return {prs: list.slice(0, KEEP_PRS), more: Math.max(0, list.length - KEEP_PRS)};
}

/**
 * Fills the builds and PRs of the nights that still lack them. Returns {nights, changed}; the input is not changed.
 * @param {object} env the Worker env (GITHUB_TOKEN, GITHUB_REPO); without a token nothing is filled
 * @param {object[]} list the stored nights, newest first
 * @throws on a GitHub error, so nothing half-filled is stored
 */
export async function markNights(env, list, fetcher = fetch) {
  if (!env.GITHUB_TOKEN || !list.some(night => night.prs === undefined)) return {nights: list, changed: false};
  const nights = list.map(night => ({...night}));
  const unbuilt = nights.filter(night => night.build === undefined);
  if (unbuilt.length) {
    const shas = await runShas(env, fetcher), dates = await commitDates(env, unbuilt.map(night => shas.get(String(night.run))), fetcher);
    for (const night of unbuilt) { const sha = shas.get(String(night.run)); night.build = sha && dates.has(sha) ? {sha, built: dates.get(sha)} : null; }
  }
  const oldestFirst = [...nights].sort((a, b) => a.night.localeCompare(b.night));
  const jobs = [];   // [night, the build before it]
  oldestFirst.forEach((night, index) => {
    if (night.prs !== undefined) return;
    const before = oldestFirst.slice(0, index).reverse().find(item => item.build?.built);
    if (!night.build || !before) night.prs = null;
    else jobs.push([night, before.build]);
  });
  if (jobs.length) {
    const newest = jobs[jobs.length - 1][0].build, since = jobs.map(([, before]) => before.built).sort()[0];
    const commits = await searchCommits(env, newest.sha, since, fetcher);
    for (const [night, before] of jobs) {
      const {prs, more} = prsIn(commits, before.built, night.build.built);
      night.prs = prs;
      if (more) night.prsMore = more; else delete night.prsMore;
    }
  }
  return {nights, changed: true};
}
