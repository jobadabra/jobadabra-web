// The owner's admin area: every private page under /admin, one menu on all of them, and the old addresses redirected (for the
// owner only: anyone else still gets a 404, so the redirect tells nobody a page is there). Same key as before: ?key= once, then
// a session cookie (shared/auth.js isOwner). The pages keep their own code; this file adds the menu and the small trend charts they share.
import {esc} from '../shared/html.js';
import {viewer} from '../shared/auth.js';
import {TABLE_TOOLS_SCRIPT, TABLE_TOOLS_STYLE} from './table-tools.js';
import {findButton, PALETTE_SCRIPT, PALETTE_STYLE} from './palette.js';

// Every page lives at /admin/{group}/{page} (owner, 27 Oct 2026: "normalize all the page urls"): the group's slug, then the menu name's; /admin itself is the home.
// slug (when set) = the page's part when its menu name would spell it differently (E-mail → email). old = the page's earlier addresses, redirected (test/unit/admin/admin-urls.test.js fails a page off the pattern, or an old address that no longer answers).
export const GROUPS = [['Overview', '🧭'], ['Growth', '📈'], ['Form filling', '📝'], ['Job search', '🔎'], ['Testing', '🧪'], ['Agent Coding', '🤖', 'agents'], ['AI', '🧠'], ['Operations', '⚙️'], ['Feedback', '💬']];
// A group's URL part: its name's, unless the entry says otherwise (owner, 1 Nov 2026: Agents became "Agent Coding" but its addresses stay /admin/agents/…, so no link breaks).
export const groupSlug = ([name, , slug]) => slug || slugOf(name);
export const slugOf = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// overview: true = the section's Overview tab (admin/section-overview.js draws the headline numbers every other page of the group declares in admin/headlines.js).
// name = the short label in the menu row; title (when set) = the page's full name, shown on the Overview cards.
export const PAGES = [
  {path: '/admin', group: 'Overview', question: 'Is Jobadabra healthy today, at a glance?', name: 'Overview', icon: '🧭'},
  {path: '/admin/growth/overview', group: 'Growth', question: 'How is growth doing: visitors, installs, signups, money and feedback at a glance?', old: ['/admin/growth-overview', '/admin/intelligence', '/admin/intelligence/overview', '/admin/intelligence-overview'], name: 'Overview', icon: '🧭', overview: true},
  {path: '/admin/growth/website', group: 'Growth', question: 'Who visits the website, and do they sign up and download?', old: ['/admin/website', '/stats'], name: 'Website', icon: '🌐'},
  {path: '/admin/growth/app', group: 'Growth', question: 'Do the installed apps run well, and where do they fail?', old: ['/admin/app', '/telemetry'], name: 'App', icon: '🖥️'},
  {path: '/admin/growth/email', group: 'Growth', question: 'Who signed up with an e-mail, who can still get our mail, what did it do, and what is waiting to go out?', old: ['/admin/email', '/admin/signups'], slug: 'email', name: 'E-mail', icon: '✉️'},
  {path: '/admin/growth/promo-codes', group: 'Growth', question: 'Which promo codes exist, who used them, and when do they end?', old: ['/admin/promo-codes'], name: 'Promo codes', icon: '🎟️'},
  {path: '/admin/growth/monetization', group: 'Growth', question: 'Do free users turn into Pro buyers, and does the money cover the AI?', old: ['/admin/monetization'], name: 'Monetization', icon: '💰'},
  {path: '/admin/growth/insights', group: 'Growth', question: 'Does the app make good decisions for users?', old: ['/admin/intelligence/insights', '/admin/insights', '/intel'], name: 'Insights', icon: '🧠'},
  {path: '/admin/growth/brain', group: 'Growth', question: 'What did the product brain recommend, and what did we decide?', old: ['/admin/intelligence/brain', '/admin/brain'], slug: 'brain', name: 'Product Brain', icon: '🧠'},
  {path: '/admin/form-filling/overview', group: 'Form filling', question: 'How is form filling doing: real users, our recorded sites, the benchmark and the learning loop?', old: ['/admin/form-overview'], name: 'Overview', icon: '🧭', overview: true},
  {path: '/admin/form-filling/real-users', group: 'Form filling', question: 'How well do real users\' forms get filled, and what still trips the filler?', title: 'Real Form Filling', old: ['/admin/real-form-filling', '/smart-form-filling'], name: 'Real users', icon: '📝'},
  {path: '/admin/form-filling/lab', group: 'Form filling', question: 'Is applying reliable on our recorded sites: do the sites we fixed stay fixed, and did a real site change?', title: 'Lab Form Filling', old: ['/admin/lab-form-filling', '/admin/applying'], name: 'Lab', icon: '🛡️'},
  {path: '/admin/form-filling/benchmark', group: 'Form filling', question: 'How does our form filling compare with other tools on the same forms?', title: 'Benchmark Form Filling', old: ['/admin/benchmark-form-filling'], name: 'Benchmark', icon: '📏'},
  {path: '/admin/form-filling/learning', group: 'Form filling', question: 'Is the learning loop working: learned fixes, the AI\'s answers per family, proposed answers?', title: 'Form Learning', old: ['/admin/form-learning'], name: 'Learning', icon: '🧬'},
  {path: '/admin/form-filling/reports', group: 'Form filling', question: 'Which forms did people report as stuck, and have we fetched them?', title: 'Reported forms', old: ['/admin/reports'], name: 'Reports', icon: '📮'},
  {path: '/admin/job-search/overview', group: 'Job search', question: 'How is job search doing: the Lab, the employer list, installs and the benchmark at a glance?', name: 'Overview', icon: '🧭', overview: true},   // Why (12 Nov 2026, owner: "For both Job search and Lab")
  {path: '/admin/job-search/lab', group: 'Job search', question: 'Does a new user get relevant jobs fast, in any role and place, and did our last change make it better or worse?', title: 'Lab Job Search', old: ['/admin/lab-job-search'], name: 'Lab', icon: '🔬'},
  {path: '/admin/job-search/scouting', group: 'Job search', question: 'Is our central employer list growing, and where is it weak?', old: ['/admin/scouting'], name: 'Scouting', icon: '🛰️'},
  {path: '/admin/job-search/installs', group: 'Job search', question: 'How much do real installs grow and improve our employer list and job search?', old: ['/admin/installs'], name: 'Installs', icon: '🧲'},
  {path: '/admin/job-search/benchmark', group: 'Job search', question: 'How does our job search compare with other tools on the same random searches across Europe?', title: 'Benchmark Job Search', old: ['/admin/benchmark-job-search'], name: 'Benchmark', icon: '🏁'},
  {path: '/admin/agents/overview', group: 'Agent Coding', question: 'How is engineering doing: build, self-healing, errors and AI cost at a glance, and where the time goes?', old: ['/admin/operations/overview'], name: 'Overview', icon: '⏱️', overview: true},
  {path: '/admin/agents/agent-coding', group: 'Agent Coding', question: 'How does our agent code, ship and verify, and where does it go in circles?', old: ['/admin/operations/agent-coding'], name: 'Agent coding', icon: '🧭'},
  {path: '/admin/agents/build-log', group: 'Agent Coding', question: 'What did we build each day, in plain words?', old: ['/admin/operations/build-log'], name: 'Build log', icon: '🗓️'},
  {path: '/admin/ai/agents', group: 'AI', question: 'Which AI jobs on the CI act by themselves, and are they running and green?', name: 'Agents', icon: '🤖'},
  {path: '/admin/ai/steps', group: 'AI', question: 'Which CI jobs use AI to answer a question, on which engine, and did they run?', slug: 'steps', name: 'AI steps', icon: '⚙️'},
  {path: '/admin/ai/runs', group: 'AI', question: 'What happened in each CI agent run, and did it open a PR?', slug: 'runs', name: 'Agent runs', icon: '📋'},
  {path: '/admin/ai/harness', group: 'AI', question: 'Which context layers and sources does the AI fixer have?', slug: 'harness', name: 'Agent harness', icon: '🧰'},
  {path: '/admin/ai/engines', group: 'AI', question: 'Which AI engine answers the CI today, and is any used up?', name: 'Engines', icon: '🔌'},
  {path: '/admin/ai/costs', group: 'AI', question: 'What does the AI cost us, and for which jobs?', old: ['/admin/growth/ai-cost', '/admin/intelligence/ai-cost', '/admin/ai-cost', '/ai-cost'], name: 'Costs', icon: '💸'},
  {path: '/admin/testing/overview', group: 'Testing', question: 'Which ways do we look for bugs, and did each one run green last time?', name: 'Overview', icon: '🧭'},   // its own page (admin/testing-overview.js), not section-overview's tiles: no `overview` flag, so Testing's pages need no headline loaders
  {path: '/admin/testing/synthetic-monitoring', group: 'Testing', question: 'Is the live app and everything it depends on still working right now, even when nobody changes any code?', name: 'Synthetics', slug: 'synthetic-monitoring', icon: '📡'},
  {path: '/admin/testing/ai-persona', group: 'Testing', question: 'What did the AI persona do in each run, which bugs did it argue, and can I watch it?', name: 'AI persona', slug: 'ai-persona', icon: '🤖'},
  {path: '/admin/testing/bug-bundles', group: 'Testing', question: 'Which bugs did the AI testers report, with their pictures and logs?', name: 'Bug bundles', slug: 'bug-bundles', icon: '🐞'},
  {path: '/admin/testing/e2e', group: 'Testing', question: 'Where does our e2e fixing time go: which suites go red, and why?', old: ['/admin/operations/e2e'], name: 'E2E', icon: '🧪'},
  {path: '/admin/testing/gtm-readiness', group: 'Testing', question: 'How ready is the app for go-to-market: how stable is each critical journey?', old: [], name: 'GTM', slug: 'gtm-readiness', icon: '🚦'},
  {path: '/admin/testing/report-only', group: 'Testing', question: 'How are we doing: form filling, AI quality, speed, reliability, bugs?', name: 'Report only', icon: '📊'},
  {path: '/admin/testing/integrations', group: 'Testing', question: 'Are the integration tests green, quick and steady, and how much of e2e has moved to them?', old: ['/admin/operations/integrations'], name: 'Integrations', icon: '🧩'},
  {path: '/admin/testing/pr-checks', group: 'Testing', question: 'Do our PR checks catch real bugs, and how long do they make us wait?', old: ['/admin/operations/pr-checks'], name: 'PR checks', icon: '✅'},
  {path: '/admin/testing/bug-loop', group: 'Testing', question: 'Does the loop that finds, ranks and fixes product bugs work: what it found, what was noise, what got fixed?', old: ['/admin/testing/self-healing', '/admin/self-healing', '/self-heal', '/admin/operations/self-healing'], name: 'Bug loop', icon: '🔁'},
  {path: '/admin/testing/red-main', group: 'Testing', question: 'Which main e2e suites are red now, and which PR broke them?', name: 'Red main', icon: '🚨'},
  {path: '/admin/testing/sentry', group: 'Testing', question: 'What errors do the apps report to Sentry, and did the fixer handle them?', old: ['/admin/sentry', '/admin/operations/sentry'], name: 'Sentry', icon: '🐞'},
  // Why (5 Nov 2026, owner: "add again Operations as top level … put there Scheduled and Notifications"): the Schedules group became Operations; the Testing → Scheduled tab was the same page filtered to Testing, so it went (the Area filter does that).
  {path: '/admin/operations/scheduled', group: 'Operations', question: 'Are all our scheduled jobs running on time and green, and which of them tell me?', old: ['/admin/agents/schedules', '/admin/operations/schedules', '/admin/schedules/all-jobs', '/admin/schedules', '/admin/testing/scheduled'], name: 'Scheduled', icon: '⏰'},
  {path: '/admin/operations/notifications', group: 'Operations', question: 'What reaches me on Telegram, through which bot, and what do I want to be told?', name: 'Notifications', icon: '🔔'},
  {path: '/admin/agents/access', group: 'Agent Coding', question: 'Who can open these admin pages?', old: ['/admin/access', '/admin/operations/access'], name: 'Access', icon: '🔐', superadmin: true},
  {path: '/admin/feedback/inbox', group: 'Feedback', question: 'What are users telling us?', old: ['/admin/growth/feedback', '/feedback'], slug: 'inbox', name: 'Feedback', icon: '💬'},
];
// Old addresses of a page (one or more), a group's own address (its first page), and the sub-routes that moved with their page (the digest downloads,
// the Lab's videos): the ONLY place the old paths may still be written (test/unit/website/form-pages.test.js).
const OLD = {...Object.fromEntries(PAGES.flatMap(page => [page.old].flat().filter(Boolean).map(old => [old, page.path]))),
  ...Object.fromEntries(GROUPS.slice(1).map(group => [`/admin/${groupSlug(group)}`, PAGES.find(page => page.group === group[0]).path])),
  ...Object.fromEntries(['/admin/form-filling', '/admin/real-form-filling'].flatMap(old => ['json', 'md'].map(kind => [`${old}/digest.${kind}`, `/admin/form-filling/real-users/digest.${kind}`]))),
  '/admin/lab-form-filling/video': '/admin/form-filling/lab/video'};
export const movedTo = pathname => OLD[pathname];
export const oldPaths = () => Object.keys(OLD);

// A script calling an old address with its key (CI's `curl -s` of the Lab's ?json and the digest, its POST upload to the Lab: none follow a 301) is answered
// as at the new address, so nothing that calls the site breaks when a page moves; the public repo then moves its links at its own pace.
export function inPlace(request) {
  const url = new URL(request.url), target = OLD[url.pathname];
  if (!target || !request.headers.has('Authorization')) return request;
  return new Request(`${url.origin}${target}${url.search}`, request);
}

// An old address: the owner is sent to the new one (query kept, so ?key= and ?days= still work); anyone else gets the 404 they got.
export async function redirectOld(request, env) {
  const url = new URL(request.url), target = OLD[url.pathname];
  if (!target) return null;
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  // A form sent to an old address (POST) is sent on with its method and body: 308.
  return new Response(null, {status: request.method === 'GET' || request.method === 'HEAD' ? 301 : 308, headers: {Location: `${target}${url.search}`, 'Cache-Control': 'no-store'}});
}

// One look on every admin page: the shared base comes after each page's own styles, so the width, type, colours, cards and
// tables are the same everywhere; a page keeps only what is its own (its charts, badges, grids).
export const BASE_STYLE = `body{margin:0;background:#0b0d10;color:#f4efe3;font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1200px;margin:0 auto;padding:0 16px 48px}h1{margin:0;font-size:24px;line-height:1.2}h2{font-size:15px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 18px}
a{color:#f5b54a}.muted{color:#8d949c}.card{background:#14181d;border:1px solid #262c33;border-radius:14px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:500;color:#8d949c;font-size:12px}td{border-top:1px solid #262c33}
.card{padding:16px}h2{font-size:15px}main>.card,main>section.card{margin-bottom:16px}
th,td{padding:10px 8px;vertical-align:top}td.num,td.n,th.num,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.nowrap,.pill,.badge{white-space:nowrap}
.filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.filter-label{color:#8d949c;font-size:13px;margin-right:2px}.filter-rows{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}.filter{color:#8d949c;text-decoration:none;padding:5px 10px;border:1px solid #262c33;border-radius:999px;font-size:13px;background:transparent;font-weight:400}
.filter:hover{color:#f4efe3}.filter.on{background:#f5b54a;color:#0b0d10;border-color:#f5b54a;font-weight:600}
.seg button{border-radius:999px;border-color:#262c33;color:#8d949c}.seg button[aria-pressed=true]{background:#f5b54a;border-color:#f5b54a;color:#0b0d10;font-weight:600}
.table-scroll{overflow-x:auto}
@media (max-width:700px){main .card{overflow-x:auto}main table.wide{min-width:600px}.card{padding:14px}
main{overflow-wrap:break-word}main img,main svg,main video,main canvas,main iframe{max-width:100%}main pre{white-space:pre-wrap;overflow-wrap:anywhere}
main .tabs{display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}main .tabs::-webkit-scrollbar{display:none}main .tabs>*{flex:none}
main .filter,main .tabs a,main .seg button{min-height:40px;display:inline-flex;align-items:center}}`;

// What CSS alone can't do, on every admin page: a number column's header aligned like its numbers, dates on one line, a table
// with only its "nothing yet" row shown without its header, and wide tables (4+ columns) scrolling inside their card on a phone
// (a wide table outside any card gets a box of its own that scrolls, so the page never does: owner, 26 Oct 2026).
export const TABLE_SCRIPT = `document.querySelectorAll('main table').forEach(t=>{const rows=[...t.rows],head=rows.find(r=>r.querySelector('th'));
if(head&&head.cells.length>=4){t.classList.add('wide');if(!t.closest('.card,.table-scroll')){const box=document.createElement('div');box.className='table-scroll';t.before(box);box.append(t)}}const body=rows.filter(r=>r!==head&&r.querySelector('td'));
if(head&&body.length===1&&body[0].cells.length===1&&body[0].cells[0].colSpan>1)head.hidden=true;
if(head)[...head.cells].forEach((th,i)=>{const cells=body.map(r=>r.cells[i]).filter(Boolean);if(cells.length&&cells.every(c=>c.classList.contains('num')||c.classList.contains('n')||!c.textContent.trim()))th.classList.add('num')});
body.forEach(r=>[...r.cells].forEach(c=>{if(/^\\d{4}-\\d\\d-\\d\\d( \\d\\d:\\d\\d)?( UTC)?$/.test(c.textContent.trim()))c.classList.add('nowrap')}))});`;
// A row of filter links (a period, a status): the current one amber, as on every admin page. `label` = a word before the chips ("Repo"), kept in the same row and centred on the chips
// (owner, 1 Nov 2026: "let's improve text alignment here": the labels sat higher than their chips, top-aligned in a stretched flex row).
export const filterLinks = (options, current, label = '') => `<nav class="filters" aria-label="${esc(label || 'Filter')}">${label ? `<span class="filter-label">${esc(label)}</span>` : ''}${options.map(([value, text, href]) =>
  `<a class="filter${value === current ? ' on' : ''}" href="${esc(href)}"${value === current ? ' aria-current="true"' : ''}>${esc(text)}</a>`).join('')}</nav>`;
export const NAV_STYLE = `.admin-nav{position:sticky;top:0;z-index:5;background:#0b0d10ee;backdrop-filter:blur(6px);border-bottom:1px solid #262c33;margin:0 0 18px}
.admin-nav>div{max-width:1200px;margin:0 auto;padding:10px 16px;display:flex;gap:2px;flex-wrap:wrap;align-items:center;font:13.5px/1.3 system-ui,-apple-system,sans-serif}
.admin-nav b{color:#f4efe3;margin-right:6px;white-space:nowrap}.admin-nav a{color:#8d949c;text-decoration:none;padding:5px 6px;border-radius:999px;white-space:nowrap}
.admin-nav .me{margin-left:auto;color:#8d949c;font-size:12px;white-space:nowrap}.admin-nav a:hover{color:#f4efe3;background:#1b2027}.admin-nav a[aria-current]{color:#0b0d10;background:#f5b54a;font-weight:600}
.trend{float:right;display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#8d949c;margin-left:12px}.trend svg{display:block}
.trend .up{color:#3fb68b}.trend .down{color:#e5484d}
.admin-nav .admin-sub{padding-top:0;font-size:13px}.admin-nav .admin-sub a[aria-current]{background:#1b2027;color:#f5b54a}
.admin-question{margin:-10px 0 16px;color:#8d949c;font:14px/1.4 system-ui,-apple-system,sans-serif}
.admin-menu{display:none;font:15px/1.3 system-ui,-apple-system,sans-serif}.admin-menu summary{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 16px;list-style:none;cursor:pointer}
.admin-menu summary::-webkit-details-marker{display:none}.admin-menu .here{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f5b54a;font-weight:600}
.admin-menu .burger{font-size:20px;color:#f4efe3;width:40px;height:40px;display:grid;place-items:center;border:1px solid #262c33;border-radius:10px}.admin-menu[open] .burger{background:#1b2027}
.admin-menu .list{max-height:calc(100vh - 56px);overflow-y:auto;padding:0 16px 14px;border-top:1px solid #262c33}.admin-menu h3{margin:14px 0 4px;font-size:12px;font-weight:600;color:#8d949c;text-transform:uppercase;letter-spacing:.04em}
.admin-menu .group{display:grid;grid-template-columns:1fr 1fr;gap:4px}.admin-menu .group a{display:flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;background:#14181d;color:#f4efe3;white-space:normal}
.admin-menu .group a[aria-current]{background:#f5b54a;color:#0b0d10}.admin-menu .me{display:block;margin:14px 0 0;font-size:13px}
@media (max-width:700px){.admin-nav>div{display:none}.admin-menu{display:block}.admin-nav{margin-bottom:14px}.admin-question{margin-top:-8px}}`;

// The menu for this viewer, in five groups (owner, 6 Oct 2026: one row of eleven pages had grown too long; 17 Oct 2026: Operations had ten, split in
// Form filling and Engineering, which was renamed Operations again on 18 Oct 2026: Lab and Benchmark are engineering too): the groups on the first row, the pages of the open group on a second (at most 6); the Access page is not in a row,
// it is a lock link beside "super admin" and only for the super admin.
export function nav(active, who = {role: 'superadmin'}) {
  const isSuper = who.role === 'superadmin';
  const shown = PAGES.filter(page => !page.superadmin);
  const access = isSuper ? PAGES.find(page => page.superadmin) : null;
  const me = isSuper ? 'super admin' : `${who.name} · admin`;
  const open = PAGES.find(page => page.path === active)?.group;
  const groups = GROUPS.map(([name, icon]) => {
    const first = shown.find(page => page.group === name);
    return first ? `<a href="${first.path}"${name === open ? ' aria-current="page"' : ''}>${icon} ${esc(name)}</a>` : '';
  }).join('');
  const pages = shown.filter(page => page.group === open);
  const second = pages.length > 1 ? `<div class="admin-sub">${pages.map(page =>
    `<a href="${page.path}"${page.path === active ? ' aria-current="page"' : ''}>${page.icon} ${esc(page.name)}</a>`).join('')}</div>` : '';
  const lock = access ? ` <a href="${access.path}"${access.path === active ? ' aria-current="page"' : ''} title="${esc(access.name)}" aria-label="${esc(access.name)}">${access.icon}</a>` : '';
  return `<nav class="admin-nav" aria-label="Admin pages"><div><b>✈ Admin</b>${groups}${findButton(false)}<span class="me">${esc(me)}${lock}</span></div>${second}${phoneMenu(active, shown, open, me, lock)}</nav>`;
}
// On a phone the two rows give way to one bar (owner, 26 Oct 2026: "a horrible responsiveness in admin"; the rows wrapped to 5-6 lines, 150-212 px,
// pinned while scrolling): the open group and page, and ☰ that lists every page by group in 44 px taps. Shown by NAV_STYLE under 700 px only.
function phoneMenu(active, shown, open, me, lock) {
  const here = PAGES.find(page => page.path === active);
  const label = here ? `${here.group === here.name ? '' : `${esc(here.group)} › `}${here.icon} ${esc(here.title || here.name)}` : 'Admin';
  const groups = GROUPS.map(([name, icon]) => {
    const pages = shown.filter(page => page.group === name);
    return pages.length ? `<h3>${icon} ${esc(name)}</h3><div class="group">${pages.map(page =>
      `<a href="${page.path}"${page.path === active ? ' aria-current="page"' : ''}>${page.icon} ${esc(page.name)}</a>`).join('')}</div>` : '';
  }).join('');
  return `<details class="admin-menu"><summary><b>✈</b><span class="here">${label}</span>${findButton(true)}<span class="burger" aria-label="All admin pages">☰</span></summary>`
    + `<div class="list">${groups}<span class="me">${esc(me)}${lock}</span></div></details>`;
}
// The question a page answers, under the menu on every page (owner, 6 Oct 2026): what to read it for, in one line.
export function question(active) {
  const page = PAGES.find(item => item.path === active);
  return page?.question ? `<p class="admin-question">${esc(page.question)}</p>` : '';
}
// The menu and the shared styles, added to a page's HTML (its own design stays): after <body>, and before </head>.
export function withNav(html, active, who) {
  // The question goes under the page's own title (owner, 7 Oct 2026: a muted line, no yellow label); a page without a header gets it under the menu.
  let out = String(html).replace('</head>', `<style>${BASE_STYLE}\n${NAV_STYLE}\n${TABLE_TOOLS_STYLE}\n${PALETTE_STYLE}</style></head>`).replace(/<body([^>]*)>/, `<body$1>${nav(active, who)}`);
  out = out.includes('</header>') ? out.replace('</header>', `</header>${question(active)}`) : out.replace('</nav>', `</nav>${question(active)}`);
  return out.replace('</body>', `<script>${TABLE_SCRIPT}\n${TABLE_TOOLS_SCRIPT}</script><script>${PALETTE_SCRIPT}</script></body>`);
}
// A page response with the menu added; anything that is not an HTML page (a plain 404, a redirect, JSON) passes untouched.
// Why (6 Nov 2026, #ns, owner: "seems like the page UI is broken"): a refused form answers an HTML page with a 400 and a "run not kept" page a 404; keyed on `response.ok` they came out without the top bar and the stylesheet. The content type decides, never the status.
export async function adminPage(response, active, who) {
  if (!/text\/html/.test(response.headers.get('Content-Type') || '') || response.status < 200 || (response.status >= 300 && response.status < 400) || response.status === 204) return response;   // no page: a redirect or an empty answer
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(withNav(await response.text(), active, who), {status: response.status, headers});
}

// ---- trends: one number per week, oldest first ----
export const WEEKS = 8;
const DAY = 86400000;
export const dayOf = date => date.toISOString().slice(0, 10);
// The first day of the window, and the week (0 = the last 7 days, 1 = the 7 before ...) a day falls in.
export const since = (now, weeks = WEEKS) => dayOf(new Date(now.getTime() - (weeks * 7 - 1) * DAY));
export function weekOf(day, now) {
  const age = Math.floor((Date.parse(`${dayOf(now)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY);
  return age < 0 ? 0 : Math.floor(age / 7);
}
// rows [{day, ...}] -> per week: reduce(rowsOfThatWeek) -> number or null, oldest week first.
export function byWeek(rows, now, reduce, weeks = WEEKS) {
  const buckets = Array.from({length: weeks}, () => []);
  for (const row of rows || []) { const w = weekOf(row.day, now); if (w < weeks) buckets[w].push(row); }
  return buckets.map(reduce).reverse();
}
export const sum = key => rows => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
export const ratio = (top, bottom) => rows => { const b = sum(bottom)(rows); return b ? sum(top)(rows) / b : null; };

// A small bar chart of the weeks, the last bar marked, and this week's value with an arrow against the week before.
// `breaks` = bar indexes where the thing measured changed (owner, 13 Nov 2026: the benchmark's AI switched, rounds before and after are not comparable): a wider gap and a dashed line before that bar, and no arrow when the last two bars straddle one.
export function spark(values, {format = value => String(Math.round(value)), higherIsBetter = true, width = 96, height = 22, breaks = []} = {}) {
  const list = (values || []).map(v => (v == null || Number.isNaN(v) ? null : Number(v)));
  const split = [...new Set(breaks)].filter(i => i > 0 && i < list.length).sort((a, b) => a - b), jump = 6;
  const max = Math.max(...list.filter(v => v != null), 0) || 1, gap = 2, bar = (width - gap * (list.length - 1) - jump * split.length) / Math.max(list.length, 1);
  const left = i => i * (bar + gap) + jump * split.filter(b => b <= i).length;
  const bars = list.map((v, i) => {
    const h = v == null ? 1 : Math.max(1, Math.round((v / max) * (height - 2)));
    return `<rect x="${left(i).toFixed(1)}" y="${height - h}" width="${bar.toFixed(1)}" height="${h}" rx="1" fill="${i === list.length - 1 ? '#f5b54a' : v == null ? '#262c33' : '#5b6470'}"/>`;
  }).join('') + split.map(i => `<line class="brk" x1="${(left(i) - (gap + jump) / 2).toFixed(1)}" x2="${(left(i) - (gap + jump) / 2).toFixed(1)}" y1="0" y2="${height}" stroke="#e0a43a" stroke-dasharray="2 2"><title>AI changed here: the bars before and after are not comparable</title></line>`).join('');
  const now = list.at(-1), before = list.at(-2);
  let arrow = '';
  if (now != null && before != null && now !== before && !split.includes(list.length - 1)) arrow = `<span class="${(now > before) === higherIsBetter ? 'up' : 'down'}">${now > before ? '▲' : '▼'}</span>`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="last ${list.length} weeks${split.length ? ', AI changed during them' : ''}">${bars}</svg><span>${now == null ? '–' : esc(format(now))} ${arrow}</span>`;
}
// The chip a section header carries: what is counted, and its weeks.
export const trendChip = (label, values, options) => `<span class="trend" title="${esc(label)}, per week, last ${(values || []).length} weeks">${esc(label)} ${spark(values, options)}</span>`;
