// What every public page shares: the nav's edge on scroll, sections easing in, the cursor glow on cards, one FAQ answer open, the live numbers, copy buttons,
// close-up strips, and (landing only) old #section links sent to the page that now holds that section. Guarded by test/unit/website/landing.test.js and effects.test.js.
(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  const nav = document.getElementById('topnav');
  if (nav) addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 8), {passive: true});

  // The phone menu: a button after the Download button opens the nav's links below the bar. Escape or a tap on a link closes it. CSS shows it only at phone width.
  if (nav && nav.querySelector('.links')) {
    const links = nav.querySelector('.links');
    links.id = links.id || 'site-links';
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'menu-btn', innerHTML: '<i aria-hidden="true"></i>Menu'});
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', links.id);
    nav.append(button);
    const set = open => { nav.classList.toggle('open', open); button.setAttribute('aria-expanded', String(open)); button.lastChild.textContent = open ? 'Close' : 'Menu'; };
    button.addEventListener('click', () => set(!nav.classList.contains('open')));
    nav.addEventListener('keydown', event => { if (event.key === 'Escape' && nav.classList.contains('open')) { set(false); button.focus(); } });
    links.addEventListener('click', event => { if (event.target.closest('a')) set(false); });
  }

  // Windows download choice (owner, 31 Oct 2026: "offer on the website, a dropdown, to download the Windows version as a binary, or from the Windows Store"). Every Windows button is the Store
  // link (as it was) followed by its own `a.dl-exe` link with the same ?from=; here the pair becomes one split button: the main button stays the Store, the caret opens both choices. Both
  // links are counted by their own route (/download/windows, /download/windows-exe). Without this script both links stay on the page. The words live only here (Store updates weekly, the .exe daily: owner, 7 Nov 2026, "to release less often on Microsoft store, and guide our users if they want more frequent updates, to download the exe").
  // Guarded by test/unit/website/windows-choice.test.js.
  const CHOICES = [
    {title: 'Microsoft Store', note: 'No warning. Updates about once a week, after Microsoft’s review.'},
    {title: 'Direct download (.exe)', note: 'Every update the day it ships. Windows asks once to confirm.'}];
  const splits = [];
  for (const store of document.querySelectorAll('a[href^="/download/windows?"]')) {
    const exe = store.nextElementSibling;
    if (!exe || !exe.matches('a.dl-exe')) continue;
    const wrap = Object.assign(document.createElement('span'), {className: 'dl-split'});
    const caret = Object.assign(document.createElement('button'), {type: 'button', className: 'btn btn-primary dl-caret',
      innerHTML: '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'});
    const menu = Object.assign(document.createElement('div'), {className: 'dl-menu', id: `dl-menu-${splits.length + 1}`, hidden: true});
    for (const [index, link] of [store, exe].entries()) {
      const choice = Object.assign(document.createElement('a'), {href: link.getAttribute('href')});
      choice.append(Object.assign(document.createElement('b'), {textContent: CHOICES[index].title}), Object.assign(document.createElement('span'), {textContent: CHOICES[index].note}));
      menu.append(choice);
    }
    caret.setAttribute('aria-label', 'Other ways to download for Windows');
    caret.setAttribute('aria-haspopup', 'true');
    caret.setAttribute('aria-expanded', 'false');
    caret.setAttribute('aria-controls', menu.id);
    store.before(wrap);
    wrap.append(store, caret, menu);
    exe.remove();
    splits.push({wrap, caret, menu});
  }
  const clippedByAncestor = menu => {
    const box = menu.getBoundingClientRect();
    for (let el = menu.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const edge = el.getBoundingClientRect();
      if (box.bottom > edge.bottom + 0.5 || box.top < edge.top - 0.5 || box.right > edge.right + 0.5 || box.left < edge.left - 0.5) return true;
    }
    return false;
  };
  const closeChoice = ({wrap, caret, menu}) => { wrap.classList.remove('flow'); menu.hidden = true;   // Why (7 Nov 2026, review): a closed menu must not leave the wrapper a grid, or the button jumps after its first use
    caret.setAttribute('aria-expanded', 'false'); };
  for (const split of splits) {
    const {wrap, caret, menu} = split;
    caret.addEventListener('click', () => {
      const open = menu.hidden;
      for (const other of splits) closeChoice(other);
      if (!open) return;
      menu.hidden = false;
      caret.setAttribute('aria-expanded', 'true');
      wrap.classList.remove('flow');   // Why (#243, Gitar): measure from the default position, else the last open's .right/.flow makes the check alternate
      menu.classList.remove('right');
      menu.classList.toggle('right', menu.getBoundingClientRect().right > innerWidth - 12);   // never past the screen's edge
      // Why (7 Nov 2026, owner: "this dropdown is buggy on the pricing page"): a card with `overflow: hidden` (the pricing ticket, the closing panel) cut the floating menu to its first line.
      // Wherever any ancestor would clip it, the menu opens in the flow under the button instead (CSS .dl-split.flow, as on a phone): no page lists the cards that clip.
      if (clippedByAncestor(menu)) wrap.classList.add('flow');
    });
    wrap.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeChoice(split); caret.focus(); } });
    wrap.addEventListener('focusout', event => { if (!menu.hidden && !wrap.contains(event.relatedTarget)) closeChoice(split); });
  }
  if (splits.length) document.addEventListener('click', event => { for (const split of splits) if (!split.wrap.contains(event.target)) closeChoice(split); });

  if (!calm && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in'); seen.unobserve(entry.target); }
    }), {rootMargin: '0px 0px -10% 0px'});
    document.querySelectorAll('.reveal').forEach(el => seen.observe(el));
  } else document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));

  // The cursor glow on every card (effects.css .glow): the light follows a mouse or pen, never a finger, and stays still with reduced motion.
  // A new kind of card joins CARDS, or LEFT_OUT in test/unit/website/effects.test.js says why not.
  const CARDS = ['.glow-panel', '.steps li', '.numbers li', '.next-page', '.os-card', '.trust-grid li', '.stop-panel', '.setup-cols > div', '.pass', '.boarding',
    '.faq details', '.promise', '.plat-card', '.ai-step', '.apply-steps li', '.evidence-stats li', '.first-run li', 'details.tech'];
  for (const card of document.querySelectorAll(CARDS.join(','))) {
    card.classList.add('glow');
    if (calm) continue;
    let queued = null;
    card.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      if (!queued) requestAnimationFrame(() => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${queued.x - box.left}px`);
        card.style.setProperty('--my', `${queued.y - box.top}px`);
        queued = null;
      });
      queued = {x: event.clientX, y: event.clientY};
    }, {passive: true});
  }

  // FAQ: one answer open at a time.
  const answers = document.querySelectorAll('.faq details');
  for (const item of answers) item.addEventListener('toggle', () => { if (item.open) for (const other of answers) if (other !== item) other.open = false; });

  // The live numbers: counts only, from the same daily snapshot the Coverage page reads (/api/coverage), so every page shows the same count and its day.
  // The page keeps its written floor when this fails. Guarded by test/unit/website/site-facts.test.js.
  const slots = document.querySelectorAll('[data-count]');
  if (slots.length) fetch('/api/coverage').then(r => (r.ok ? r.json() : null)).then(data => {
    if (!data || !data.employers) return;
    const day = document.querySelector('[data-count-day]');
    if (day && data.day) day.textContent = `Counts from the employer list’s snapshot of ${data.day}.`;
    for (const slot of slots) {
      const value = data[slot.dataset.count];
      if (typeof value === 'number' && value > 0) slot.textContent = value.toLocaleString('en-US');
    }
  }).catch(() => {});

  for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Copied'; }
    catch { getSelection().selectAllChildren(button.previousElementSibling); button.textContent = 'Press Ctrl+C'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });

  for (const button of document.querySelectorAll('.car-btn')) button.addEventListener('click', () => {
    const track = button.closest('.carousel').querySelector('.car-track');
    const card = track.querySelector('.car-item');
    track.scrollBy({left: Number(button.dataset.dir) * ((card?.offsetWidth || 400) + 20), behavior: calm ? 'auto' : 'smooth'});
  });

  // Links shared before 20 Oct 2026 point at sections of the long landing; each now lives on its own page.
  const MOVED = {how: '/how-it-works', 'your-click': '/how-it-works#control', autoapply: '/how-it-works#fill', app: '/features', learns: '/features#improve',
    see: '/features#find', intelligence: '/intelligence', evidence: '/research', privacy: '/trust', trust: '/trust#download', setup: '/download',
    pricing: '/pricing', early: '/pricing#early', faq: '/faq'};
  if (document.body.dataset.page === 'home') {
    const to = MOVED[location.hash.slice(1)];
    if (to) location.replace(to);
  }
})();
