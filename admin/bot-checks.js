// /admin/job-search/scouting "Bot checks": how many refused sites the ladder opened, at which step, and how many stay stopped (owner, 21 Oct 2026). Numbers from shared/bot-checks.js; no host name or page text.
// Not counted yet (said on the card): a check solved after the app's prompt, and installs that switched on Chrome's Allow in Incognito: both need a counts-only field in the daily share first.
// Guarded by test/unit/admin/bot-checks.test.js.
export function section(sum) {
  if (!sum || !sum.total) return `<section class="card" id="bot-checks"><h2>🤖 Bot checks</h2><small class="muted">Nothing reported yet.</small></section>`;
  const at = sum.openedAt, cell = (label, n, note = '') => `<tr><td>${label}</td><td class="n">${n}</td><td class="muted">${note}</td></tr>`;
  return `<section class="card" id="bot-checks"><h2>🤖 Bot checks · ${sum.total} refused sites reported</h2>
<small class="muted">Sites that refused the engine, read once in the person's Chrome: the latest outcome and the ladder step that got there, per install.</small>
<div class="scroll"><table><tr><th>Outcome</th><th>Sites</th><th></th></tr>
${cell('Open at the Chrome download', at.download)}${cell('Open in the real tab', at.tab, 'needs Allow in Incognito')}${cell('Open at the engine', at.engine)}${cell('Open, step not shared', at.unknown, 'older shares')}
${cell('Stopped by a captcha', sum.bot, 'yours to solve, never ours')}${cell('Refused', sum.refused)}${cell('Behind a login', sum.login)}</table></div>
<small class="muted">Not counted yet: a check solved after the app's prompt, and installs with Allow in Incognito on.</small></section>`;
}
