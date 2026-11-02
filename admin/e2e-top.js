// The top block of the e2e page (the costliest red suites): now one copy, in the public repo (tools/ci-intel/lib/e2e-top.mjs), which the CI collector there, the weekly summary there and this page all use.
// Why (2 Nov 2026, owner: the CI collectors move to the public repo, jobadabra#2989/#2995): two copies of a classifier drift apart (the public one had already learned run ids and "the only try"); "private reads public, never the reverse".
// The code, its doc comments and its tests live there (desktop/test/ci-intel-*.test.js); change it there, not here.
export * from '../tools/ci-intel/lib/e2e-top.mjs';
