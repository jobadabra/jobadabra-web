// A release that includes a fix tells the people who reported it (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 5/7). Owner, 3 Nov 2026: "when we release a new
// beta/stable version which includes a feedback fix, we should automatically inform all the reporters". Called by admin/feedback-release.js (CI, publish key) at every beta and stable build.
// Guarded by test/shared/feedback-release.test.js.
import {releasePr, tellReporter} from './feedback-reply.js';

const PAGE = 200, MAX_PAGES = 50;

/**
 * Tells every waiting reporter whose fix is in this release. `release`: {version, channel: beta|stable, prs: [PR numbers in the release's commit list], cutAt: the time the release was cut}.
 * A card waits when it is `fixed` with `told = 'pending'` (the owner chose "at the next release"). It matches, in order: (1) its link is a public-repo PR whose number is in `prs`; (2) it has no link,
 * no typed version, and was marked fixed before `cutAt` (blank version = "the next update"); (3) the version the owner typed (a leading "v" ignored) equals `release.version`. A match is claimed first
 * (`pending` -> `telling`, one compare-and-set that also checks the link and the time read, so a card the owner changed meanwhile is left alone), then told exactly like "now" (in-app reply, the ticked
 * mail); `fixed_in` becomes "<version> (<channel>)". Never throws for one card: a failure is written on the card ("app, error: ...", never put back to pending, which would mail twice) and listed in
 * `failed`. All waiting cards are read, a page at a time, so cards that cannot match never hide one that can.
 * -> {told: n, waiting: n still waiting after this release, matched: [{ref, told}], failed: [ref]}. Refs only: no contact, text or address leaves.
 */
export async function tellRelease(env, release, now = new Date()) {
  const prs = new Set(release.prs), label = `${release.version} (${release.channel})`, cutAt = new Date(release.cutAt).toISOString(), matched = [], failed = [];
  let waiting = 0, after = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = (await env.STATS.prepare("SELECT ref, state_at, fixed_in, pr_url FROM feedback WHERE state = 'fixed' AND told = 'pending' AND ref > ? ORDER BY ref LIMIT ?").bind(after, PAGE).all()).results || [];
    for (const row of rows) {
      after = row.ref;
      const number = releasePr(row.pr_url), typed = String(row.fixed_in).replace(/^v/i, '');
      const hit = (number && prs.has(number)) || (!row.pr_url && !row.fixed_in && row.state_at < cutAt) || (typed !== '' && typed === release.version);
      if (!hit) { waiting++; continue; }
      const claim = await env.STATS.prepare("UPDATE feedback SET fixed_in = ?, told = 'telling', told_at = ? WHERE ref = ? AND state = 'fixed' AND told = 'pending' AND pr_url = ? AND state_at = ?")
        .bind(label, now.toISOString(), row.ref, row.pr_url, row.state_at).run();
      if (!((claim?.meta?.changes ?? claim?.changes ?? 0) > 0)) { waiting++; continue; }   // another call took it first, or the owner changed it since it was read
      try {
        const told = await tellReporter(env, row.ref, now, `release ${label}`);
        if (told) matched.push({ref: row.ref, told}); else waiting++;
      } catch {
        failed.push(row.ref);
        await env.STATS.prepare("UPDATE feedback SET told = 'app, error: not confirmed', told_at = ? WHERE ref = ? AND told = 'telling'").bind(now.toISOString(), row.ref).run().catch(() => {});
      }
    }
    if (rows.length < PAGE) break;
  }
  return {told: matched.length, waiting, matched, failed};
}
