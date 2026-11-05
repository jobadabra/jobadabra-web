// The tabs of /admin/growth/email (owner, 5 Nov 2026: "Let's split Emails page in Admin into tabs. We have too many things on one single page"; picked "5 tabs by question").
// Each tab is a link (?tab=<id>), drawn on the server: the back button, a bookmark and the redirects after a press or a test send land on the right tab, and nothing needs a script.
// A page that carries no ?tab= is told by what it came back with (a test result, a switch to confirm), else it opens on Overview. Guard: test/unit/admin/email-tabs.test.js.
import {esc} from '../shared/html.js';

const PAGE = '/admin/growth/email';

/** One question per tab, in the order shown. */
export const TABS = [
  {id: 'overview', name: 'Overview', asks: 'What did our e-mail do?'},
  {id: 'settings', name: 'Settings', asks: 'What is on, and by which rules?'},
  {id: 'people', name: 'People', asks: 'Who can still get our mail?'},
  {id: 'releases', name: 'Releases', asks: 'The what\'s-new mails'},
  {id: 'templates', name: 'Templates', asks: 'What do they look like, and do they arrive?'},
];

/** The tab a request opens: ?tab= when it names one, else the one a result belongs to (a test send -> Templates, a switch awaiting its second press -> Settings), else Overview. */
export function tabOf(params) {
  const named = params.get('tab');
  if (TABS.some(tab => tab.id === named)) return named;
  if (params.has('confirm')) return 'settings';
  if (params.has('test') || params.has('destination')) return 'templates';
  return 'overview';
}

/** The link to a tab. A chosen day window (30 or 90) travels with every tab: Overview counts by it, and Templates prints "sent N in the window" for it. */
export const tabHref = (id, days) => `${PAGE}?tab=${id}${days && days !== 7 ? `&days=${days}` : ''}`;

export const TABS_STYLE = `.etabs{display:flex;gap:2px;margin:6px 0 18px;border-bottom:1px solid #262c33;overflow-x:auto;scrollbar-width:none}.etabs::-webkit-scrollbar{display:none}.etabs a{flex:none;padding:10px 16px 12px;color:#9aa4b2;text-decoration:none;font-size:15px;border-bottom:3px solid transparent;margin-bottom:-1px}
.etabs a:hover{color:#e6e9ee}.etabs a[aria-current=page]{color:#e6e9ee;font-weight:600;border-bottom-color:#f5b54a}.etabs a:focus-visible{outline:2px solid #f5b54a;outline-offset:-2px;border-radius:6px}.etab-asks{margin:0 0 14px}@media(max-width:520px){.etabs a{padding:10px 8px 12px;font-size:13px}}`;   // Why (5 Nov 2026): five tabs must stay one row on a 390 px phone; the bar scrolls sideways inside itself if a screen is narrower still

/** The bar. `active` = a tab id; `days` = the current day window. */
export const tabsNav = (active, days) => `<nav class="etabs" aria-label="E-mail sections">${TABS.map(tab => `<a href="${tabHref(tab.id, days)}"${tab.id === active ? ' aria-current="page"' : ''}>${esc(tab.name)}</a>`).join('')}</nav>
<p class="muted etab-asks">${esc(TABS.find(tab => tab.id === active).asks)}</p>`;
