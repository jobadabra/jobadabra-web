// The one owner of "is this host a company's own domain": a host that is only a country's public second-level suffix (co.uk, com.br, org.cy) belongs to no board, so a report or an address
// that names it would make every board of that suffix "the same board". Why (14 Nov 2026, sa for the owner; Gitar on jobadabra #4127): the owner approved "same board" as the check on a CI address
// (jobadabra-web #648), and `co.uk` passed it as a reported host. Used by api/ci-boards.js (the door), api/scout-memory.js (the serve side) and shared/board-reach.js (the brand).
export const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);   // co.uk, com.mt, org.cy: the brand is the label before them

/** True when `host` is a company's own domain: two or more labels, and not just a second-level suffix with its country ending (co.uk, com.br, org.cy). */
export function isCompanyDomain(host) {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return labels.length >= 2 && !(labels.length === 2 && SECOND_LEVEL.has(labels[0]) && labels[1].length === 2);
}
