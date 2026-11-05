// ⌘K on every /admin page (owner, 27 Oct 2026: "a Cmd + K to /admin that will help us navigate very easily to any page/screen/card/tab/section";
// his first example: "Promo Code" lands on the Promo codes page). Owns PALETTE_STYLE and PALETTE_SCRIPT, added to every page by withNav (admin/admin.js).
// Nothing is listed by hand: the entries are read from the pages themselves: the menu (every page this viewer may open), the tab strips
// (nav.tabs, role=tab) and the section and card headings (h2, h3; a heading without an id gets one from its words, the same on every load).
// The open page is read live (also what its script drew); the other pages are read the same way, each opened for a moment in a hidden frame
// when the palette opens, at most once a day, and kept in the browser. Choosing an entry goes to page#id; on load the page opens the tab that holds it, scrolls to it and flashes it.
// The ranking is the desktop app's (desktop/renderer/palette.js in the public repo): each typed word starts a word of the entry, the title counts more.
// Guards: test/unit/admin/palette.test.js (ranking, ids, the owner's example) and test/integration/palette-pages.test.js (every page, in a browser).

// ---- pure parts (unit-tested, and sent to the browser as they are) ----
export function words(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}
// A heading's id from its words: counts and emoji left out ("🚧 Closed sites · 276" → "closed-sites"), so links and recent picks survive new numbers.
export function slug(text) {
  return words(String(text || '').replace(/\d+/g, ' ')).join('-').slice(0, 60) || 'section';
}
// Best matches first: every meaningful typed word starts a word of the title (4 when it is the first word, else 3) or of the place and
// keywords (1); a recent pick gets 2 more. An empty query lists the recent picks first, then the order given.
export function rank(entries, query, recent = []) {
  const FILLER = ['a', 'an', 'the', 'for', 'to', 'my', 'of', 'in', 'on', 'go', 'open', 'show', 'page', 'tab'];   // words that carry no meaning ("open THE promo codes")
  const typed = words(query), wanted = typed.filter(word => !FILLER.includes(word)), terms = wanted.length ? wanted : typed;
  const boost = entry => (recent.includes(entry.href) ? 2 : 0);
  if (!terms.length) return [...recent.map(href => entries.find(entry => entry.href === href)).filter(Boolean), ...entries.filter(entry => !recent.includes(entry.href))];
  const scored = [];
  entries.forEach((entry, index) => {
    const title = words(entry.title), rest = words(`${entry.where || ''} ${entry.keywords || ''}`);
    let score = boost(entry);
    for (const term of terms) {
      if (title.some(word => word.startsWith(term))) score += title[0].startsWith(term) ? 4 : 3;
      else if (rest.some(word => word.startsWith(term))) score += 1;
      else return;
    }
    scored.push({entry, score: score + (entry.kind === 'Page' ? 0.5 : 0), index});
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.entry);
}
// What a page offers, read from its document: the menu's pages (when withMenu), its tabs, and its section and card headings.
// Headings get their id here when they have none, so the same words give the same id in the live page and in a fetched copy.
export function scan(doc, path, page = {}, withMenu = false) {
  const out = [], seen = new Set(), here = page.name || doc.title || path;
  const add = entry => { if (!seen.has(entry.href)) { seen.add(entry.href); out.push(entry); } };
  const text = el => { const copy = el.cloneNode(true); copy.querySelectorAll('.trend,svg,small,.muted,button,select,input').forEach(x => x.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim(); };
  if (withMenu) {
    let group = '';
    doc.querySelectorAll('.admin-menu .list > *').forEach(el => {
      if (el.tagName === 'H3') group = text(el).replace(/^\W+/, '');
      else el.querySelectorAll('a[href^="/admin"]').forEach(a => add({kind: 'Page', title: text(a), where: group, href: a.getAttribute('href'), keywords: a.title || ''}));
    });
  }
  const used = new Set([...doc.querySelectorAll('[id]')].map(el => el.id));
  doc.querySelectorAll('nav.tabs a[href], [role=tab][href]').forEach(a => {
    const href = a.getAttribute('href'), url = href.startsWith('#') ? path + href : href.startsWith('?') ? path + href : href;
    if (url.startsWith('/admin')) add({kind: 'Tab', title: text(a).replace(/\s·\s\d+$/, ''), where: `${page.group && page.group !== here ? `${page.group} › ` : ''}${here}`, href: url, keywords: page.group || ''});
  });
  // Headings, and the summary of a folded card (a details that is not inside another one or a table).
  doc.querySelectorAll('main h2, main h3, body > section h2, #app h2, #app h3, main details > summary, #app details > summary').forEach(h => {
    if (h.closest('.admin-nav, .admin-menu, dialog, table')) return;
    if (h.tagName === 'SUMMARY' && (h.parentElement.parentElement.closest('details') || h.querySelector('h2, h3'))) return;
    const title = text(h);
    if (!title) return;
    const box = h.closest('section, .card, details');
    let id = h.id || (box && box.id && box.querySelector('h2, h3') === h ? box.id : '');
    if (!id) { const base = slug(title); id = base; for (let n = 2; used.has(id); n++) id = `${base}-${n}`; used.add(id); h.id = id; }
    const panel = h.closest('[role=tabpanel]'), tab = panel && panel.dataset.tab ? ` › ${panel.dataset.tab}` : '';
    const about = box ? box.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : '';   // the card's first words, its muted line included ("AI-credit code")
    add({kind: 'Section', title, where: `${page.group && page.group !== here ? `${page.group} › ` : ''}${here}${tab}`, href: `${path}#${id}`, keywords: `${page.group || ''} ${about}`});
  });
  return out;
}

// ---- the browser side ----
function client(scan, rank) {
  const KEY = 'admin-palette-v1', RECENT = 'admin-palette-recent', DAY = 864e5;
  const store = {get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }};
  const pageOf = path => { const a = document.querySelector(`.admin-menu a[href="${CSS.escape(path)}"]`); return a ? {name: a.textContent.replace(/^\W+/, '').trim(), group: a.closest('.group')?.previousElementSibling?.textContent.replace(/^\W+/, '').trim()} : {}; };
  const here = location.pathname;
  let live = [];
  const rescan = () => { live = scan(document, here, pageOf(here), true); const cache = store.get(KEY, {}); cache[here] = {at: Date.now(), entries: live.filter(e => e.kind !== 'Page')}; store.set(KEY, cache); };
  const all = () => { const cache = store.get(KEY, {}), pages = live.filter(e => e.kind === 'Page'), out = [...live.filter(e => e.kind !== 'Page'), ...pages];
    for (const p of pages) if (p.href !== here && cache[p.href]) out.push(...cache[p.href].entries);
    return out; };
  // The other pages, at most once a day each, one at a time: each opens in a hidden frame for a moment, so its own script draws its tabs and
  // panels and this same palette code in it records what it shows (rescan above); the frame goes when its entries arrive or after 8 s.
  let refreshing = false;
  async function refresh(onMore) {
    if (refreshing || window.top !== window) return; refreshing = true;
    for (const p of live.filter(e => e.kind === 'Page' && e.href !== here)) {
      const fresh = () => { const c = store.get(KEY, {})[p.href]; return c && Date.now() - c.at < DAY; };
      if (fresh()) continue;
      const frame = Object.assign(document.createElement('iframe'), {src: p.href, title: 'admin index', tabIndex: -1});
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden';
      document.body.append(frame);
      for (let t = 0; t < 80 && !fresh(); t++) await new Promise(r => setTimeout(r, 100));
      frame.remove();
      if (fresh()) onMore();
    }
    refreshing = false;
  }
  function open() {
    if (document.getElementById('admin-palette')) return;
    rescan();
    const dialog = Object.assign(document.createElement('dialog'), {id: 'admin-palette', className: 'admin-palette'});
    dialog.setAttribute('aria-label', 'Go to any admin page, tab or card');
    const input = Object.assign(document.createElement('input'), {type: 'search', placeholder: 'Go to a page, tab or card, e.g. promo codes', autocomplete: 'off'});
    input.setAttribute('aria-label', 'Search admin');
    input.setAttribute('aria-controls', 'admin-palette-list');
    const list = Object.assign(document.createElement('ul'), {id: 'admin-palette-list', role: 'listbox'});
    const empty = Object.assign(document.createElement('p'), {className: 'empty muted', textContent: 'Nothing matches.', hidden: true});
    const foot = Object.assign(document.createElement('p'), {className: 'foot muted', textContent: '↑↓ to move · Enter to go · Esc to close'});
    dialog.append(input, list, empty, foot);
    document.body.append(dialog);
    let shown = [], active = 0;
    const close = () => { dialog.close(); dialog.remove(); };
    const go = entry => {
      store.set(RECENT, [entry.href, ...store.get(RECENT, []).filter(h => h !== entry.href)].slice(0, 8));
      close();
      const url = new URL(entry.href, location.origin);
      if (url.pathname === here && url.search === location.search) { if (url.hash) { history.pushState(null, '', url.hash); land(url.hash.slice(1)); } }
      else location.href = entry.href;
    };
    const mark = i => { active = Math.max(0, Math.min(i, shown.length - 1)); [...list.children].forEach((li, n) => li.setAttribute('aria-selected', String(n === active))); list.children[active]?.scrollIntoView({block: 'nearest'}); };
    const render = () => {
      shown = rank(all(), input.value, store.get(RECENT, [])).slice(0, 60);
      const recent = store.get(RECENT, []);
      list.replaceChildren(...shown.map((entry, i) => {
        const li = Object.assign(document.createElement('li'), {role: 'option'});
        li.append(Object.assign(document.createElement('b'), {textContent: entry.title}),
          Object.assign(document.createElement('span'), {textContent: entry.where || ''}),
          Object.assign(document.createElement('small'), {textContent: recent.includes(entry.href) && !input.value ? 'Recent' : entry.kind}));
        li.addEventListener('mousemove', () => { if (active !== i) mark(i); });
        li.addEventListener('click', () => go(entry));
        return li;
      }));
      empty.hidden = shown.length > 0;
      mark(0);
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active - 1); }
      else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); go(shown[active]); }
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    render();
    dialog.showModal();
    input.focus();
    refresh(() => { if (dialog.isConnected) { const at = active; render(); mark(at); } });
  }
  // Landing: the element with this id, once the page has drawn it. A box that hides it (a tab panel, tabs in tabs) is shown by trying the tabs
  // near it that stay on the page (#hash links and buttons, never a link that reloads), outermost first; folded cards open. Then it scrolls and flashes.
  const shownNow = el => el.getClientRects().length > 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function reveal(el) {
    for (let round = 0; round < 4 && !shownNow(el); round++) {
      let hidden = null;
      for (let up = el; up && up !== document.body; up = up.parentElement) if (up.hidden || getComputedStyle(up).display === 'none') hidden = up;
      if (!hidden) break;
      let scope = hidden.parentElement;
      while (scope && scope !== document.body && !scope.querySelector('[role=tab], .tabs a')) scope = scope.parentElement;
      const tabs = scope ? [...scope.querySelectorAll('[role=tab], .tabs a')].filter(t => shownNow(t) && (t.tagName === 'BUTTON' || (t.getAttribute('href') || '').startsWith('#'))) : [];
      for (const tab of tabs) { tab.click(); await wait(60); if (shownNow(hidden) || !hidden.isConnected) break; }
      if (!shownNow(hidden) && hidden.isConnected) break;
    }
    for (let up = el.closest('details'); up; up = up.parentElement.closest('details')) up.open = true;
  }
  async function land(id, tries = 40) {
    const el = document.getElementById(id) || (rescan(), document.getElementById(id));
    if (!el) { if (tries > 0) setTimeout(() => land(id, tries - 1), 100); return; }
    await reveal(el);
    const box = el.closest('section, .card, details') || el;
    // Why (5 Nov 2026, admin charts: the E2E page's Speed and Scorecard cards grew past one screen, so "PR suite jobs" and "Missed, no suite plays it" landed below the fold): a heading that sits further down its card than the
    // screen holds (minus the ~110 px the sticky bar takes) scrolls to the heading itself, not to the card's top.
    const deep = el !== box && el.getBoundingClientRect().bottom - box.getBoundingClientRect().top > innerHeight - 140;
    (deep ? el : box).scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    box.classList.remove('palette-flash'); void box.offsetWidth; box.classList.add('palette-flash');
  }
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); } });
  document.querySelectorAll('.admin-find').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(); }));
  // In a frame (the index above): read the page once its own script has stopped drawing (0.7 s without a change, at most 6 s).
  const settled = () => { let timer, done = false; const finish = () => { if (!done) { done = true; watch.disconnect(); rescan(); } };
    const watch = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(finish, 700); });
    watch.observe(document.body, {childList: true, subtree: true}); timer = setTimeout(finish, 700); setTimeout(finish, 6000); };
  const start = () => { if (window.top !== window) return settled(); rescan(); if (location.hash.length > 1) land(decodeURIComponent(location.hash.slice(1))); };
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
  if (window.top === window) setTimeout(rescan, 2500);   // what the page's own script drew after load (tabs, panels)
  window.adminPalette = {open, land, entries: () => { rescan(); return all(); }};   // for tools/admin-palette-check.mjs and the console
}

// The search button beside the menu (⌘K on a computer, 🔍 in the phone bar) and the palette's look, in the admin colours.
export const findButton = phone => `<button type="button" class="admin-find${phone ? ' phone' : ''}" aria-label="Search admin (⌘K)" title="Search admin (⌘K)">🔍${phone ? '' : '<kbd>⌘K</kbd>'}</button>`;
export const PALETTE_STYLE = `.admin-find{background:transparent;border:1px solid #262c33;color:#8d949c;border-radius:999px;padding:4px 10px;font:13px system-ui,-apple-system,sans-serif;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.admin-find:hover{color:#f4efe3}.admin-nav div>.admin-find{margin-left:auto}.admin-find+.me{margin-left:10px}.admin-find kbd{font:600 11px ui-monospace,monospace;border:1px solid #262c33;border-radius:5px;padding:1px 5px}.admin-find.phone{border:0;font-size:18px;padding:0 6px;min-width:40px;min-height:40px;justify-content:center}
.admin-palette{width:min(620px,92vw);padding:0;margin:12vh auto auto;border:1px solid #262c33;border-radius:14px;background:#14181d;color:#f4efe3;box-shadow:0 20px 60px #000a}
.admin-palette input::-webkit-search-cancel-button{display:none}.admin-palette::backdrop{background:#0008}.admin-palette input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid #262c33;padding:16px 18px;font:17px system-ui,-apple-system,sans-serif;outline:none;background:transparent;color:inherit}
.admin-palette ul{list-style:none;margin:0;padding:6px;max-height:min(56vh,440px);overflow-y:auto}.admin-palette li{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;padding:8px 12px;border-radius:10px;cursor:pointer}
.admin-palette li b{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.admin-palette li span{grid-column:1;color:#8d949c;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.admin-palette li small{grid-column:2;grid-row:1/3;align-self:center;color:#8d949c;font-size:11px;border:1px solid #262c33;border-radius:999px;padding:2px 8px}
.admin-palette li[aria-selected=true]{background:#2a2213}.admin-palette li[aria-selected=true] b{color:#f5b54a}.admin-palette .empty{padding:14px 18px;margin:0}.admin-palette .foot{margin:0;padding:8px 18px;border-top:1px solid #262c33;font-size:12px}
@keyframes palette-flash{0%,30%{box-shadow:0 0 0 3px #f5b54a}100%{box-shadow:0 0 0 3px #f5b54a00}}.palette-flash{animation:palette-flash 1.8s ease-out;scroll-margin-top:110px}
@media (prefers-reduced-motion:reduce){.palette-flash{animation:none;outline:2px solid #f5b54a;outline-offset:2px}}
@media (max-width:700px){.admin-palette{width:100vw;max-width:100vw;margin:0;border-radius:0 0 14px 14px;border-top:0}.admin-palette li{padding:11px 12px}.admin-palette .foot{display:none}}`;
// The pure parts go to the browser as written here (one block, so they call each other by their own names), then the client starts.
export const PALETTE_SCRIPT = `(() => { ${words}\n${slug}\n${rank}\n${scan}\n(${client})(${scan.name}, ${rank.name}); })();`;
