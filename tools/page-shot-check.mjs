// "Is this page styled?" for tools/page-shot.mjs (owner, 25 Oct 2026: jobadabra-web#92's PR images were the admin page as raw HTML).
// Pure: takes what the browser saw and returns the reasons the shot must not be used (empty = styled). Guard: test/tooling/page-shot-check.test.js.
const DEFAULT_SERIF = /times|^serif$/i;   // what a page with no font-family of its own computes to
const BLANK = /^(rgba\(0, 0, 0, 0\)|transparent)$/;

// seen: {failed: [{url, type, reason}], status, bodyFont, bodyBackground, background, sheets: number of stylesheets with rules, expectDark: boolean|null}
export function unstyledReasons(seen) {
  const reasons = [];
  if (seen.status >= 400) reasons.push(`the page answered ${seen.status}`);
  for (const request of seen.failed || []) {
    if (['stylesheet', 'font'].includes(request.type)) reasons.push(`${request.type} did not load: ${request.url} (${request.reason})`);
  }
  if (DEFAULT_SERIF.test(String(seen.bodyFont || '').split(',')[0].replace(/["']/g, '').trim())) reasons.push(`the body font is the browser default (${seen.bodyFont}): no site CSS reached the page`);
  if (BLANK.test(seen.bodyBackground || '') && BLANK.test(seen.background || '')) reasons.push('the page has no background colour of its own');
  if (!seen.sheets) reasons.push('the page has no stylesheet rules at all');
  return reasons;
}
