// The mail rules the owner agreed on 5 Nov 2026, on /admin/growth/email (owner: "store in the Admin -> Email all these settings we agreed on"). It prints the tables the code sends by
// (shared/mail-lists.js MAIL_TYPES, shared/mail.js DAILY_MAX), so the card cannot drift from what happens. Guard: test/unit/admin/email.test.js.
import {esc} from '../shared/html.js';
import {DAILY_MAX} from '../shared/mail.js';
import {MAIL_TYPES} from '../shared/mail-lists.js';

/** The card: the three types, then the rules that hold across them. `dayMax` = the whole product's daily limit, `n` formats a number. */
export function mailTypesCard(dayMax, n) {
  const rows = MAIL_TYPES.map(type => `<tr><td><b>${esc(type.name)}</b></td><td>${esc(type.carries)}</td><td><span class="pill ${type.starts === 'On' ? 'on' : 'off'}">${esc(type.starts)}</span></td><td>${esc(type.who)}</td></tr>`).join('');
  const rules = [
    'Each mail\'s stop link stops that type only. A bounce or a complaint stops all four.',
    'The boxes in the app and on the e-mail settings page show what the site holds. No stored answer means the default applies.',
    'An unconfirmed address gets no What\'s new, no News and tips and no Job digest.',
    'What\'s new and News and tips are off until the person says yes. A website waitlist signup counts as a yes to What\'s new.',
    'At most one What\'s new or News and tips mail per person per week.',
    'People who joined the waitlist from the app get only the Pro launch mail until the app\'s dialog names release mails.',
    `Per address: ${DAILY_MAX} mails a day, all types together. Test mails sit outside this limit.`,
    'The alert test mail goes at most once a day per address.',
    `Whole product: ${n(dayMax)} mails a day, test mails included.`,
    'What\'s new and News and tips need the MARKETING_MAIL switch on. The Pro launch also needs MAIL_LAUNCH.',
  ].map(rule => `<li>${esc(rule)}</li>`).join('');
  return `<section class="card" id="mail-types" style="margin-bottom:16px"><h2>Mail types and rules</h2><div style="overflow-x:auto"><table><tr><th>Type</th><th>Carries</th><th>Starts</th><th>Who gets it</th></tr>${rows}</table></div><ul>${rules}</ul></section>`;
}
