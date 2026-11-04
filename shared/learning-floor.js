// How many different installs must report the same thing before the site learns from it: a question's wording kept for the wording learner
// (shared/knowledge.js), a wording -> field pair started as shared data (api/aliases.js), a page/job meaning voted by installs (api/meanings.js).
// NOW: 1 for everything (owner, 9 Oct 2026: "1 install, public form text only"): with one install nothing was ever learned. What is kept is
// unchanged: the employer's public form wording, cleaned of anything that looks personal (alias-schema.js cleanLabel), never a value.
// LATER (switch back with a larger user base, as LEARNING_CANARY): the floors below, which keep one install from teaching everyone alone.
// Guarded by test/unit/shared/learning-floor.test.js (now) and the knowledge, aliases and meanings tests (later).
// geo: 3 now too (owner, 18 Oct 2026, "local, then shared pack (k>=3)"): one install's wrong coordinates would place a town for everyone.
// geoChecked (owner, 20 Oct 2026, trust rule): a coordinate answer the server checks itself (country known, point inside its box, api/meanings.js
// geoChecked) is served after 1 install, also LATER; an answer it cannot check keeps geo's 3.
const NOW = {question: 1, alias: 1, aliasSensitive: 1, meaning: 1, geo: 3, geoChecked: 1};
const LATER = {question: 3, alias: 2, aliasSensitive: 3, meaning: 3, geo: 3, geoChecked: 1};
let floors = NOW;
export const installsNeeded = kind => floors[kind];
export const useLaterFloors = (on = true) => { floors = on ? LATER : NOW; };   // tests of the later rule
