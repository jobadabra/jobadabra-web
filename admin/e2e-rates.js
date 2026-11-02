// The night report-only suites' measured rates: now one copy, in the public repo (tools/ci-intel/lib/e2e-rates.mjs), which the CI collector there and this page both use.
// Why (2 Nov 2026, owner: the CI collectors move to the public repo, jobadabra#2989): two copies of a classifier drift apart and the page and the collector then disagree; "private reads public, never the reverse".
// The code, its doc comments and its tests live there (desktop/test/ci-intel-*.test.js); change it there, not here.
export * from '../tools/ci-intel/lib/e2e-rates.mjs';
