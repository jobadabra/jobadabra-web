import {FAMILIES} from '../shared/pool-tags.js';

/** The role families of a Scout board fact whose CURRENT count came from the board's own LIST of jobs (a board with no role search, read page by page and
 *  grouped by field), not from the board's own search for the field: an array of pool families, deduped, each also a key of the fact's `family_jobs`.
 *  Anything else is dropped (never the board, never its counts); undefined when nothing is left, so a fact with none is stored and served as today.
 *  Why (13 Nov 2026, owner via sa; plan docs/superpowers/plans/2026-11-13-proven-boards.md in jobadabra): installs read `measured` as "the board's own search returned
 *  N for this field", but a count grouped from a list is only what the list holds: it keeps `right` (installs still order boards by it) and says `listed` instead. */
export function listedFamiliesOf(raw, familyJobs) {
  if (!Array.isArray(raw) || !familyJobs) return undefined;
  const kept = [...new Set(raw)].filter(family => FAMILIES.includes(family) && Object.hasOwn(familyJobs, family));
  return kept.length ? kept : undefined;
}
