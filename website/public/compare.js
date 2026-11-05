// The Compare page's picker (owner, 24 Oct 2026: "All on desktop, one on phone"): from 1001px every tool shows in the table; up to 1000px Jobadabra sits
// next to one tool, Simplify first, and "Compare with" switches it (or shows all). Without this script every tool shows. Guarded by test/unit/website/compare-page.test.js.
(() => {
  const box = document.getElementById('cmp');
  const select = document.getElementById('cmp-with');
  if (!box || !select) return;
  const wide = matchMedia('(min-width: 1001px)');
  const show = tool => {
    box.dataset.tool = tool;
    select.value = tool;
    for (const cell of box.querySelectorAll('[data-tool]:not(#cmp)')) cell.hidden = tool !== 'all' && cell.dataset.tool !== tool;
  };
  let chosen = null;   // what the person picked; a resize keeps it
  select.addEventListener('change', () => show(chosen = select.value));
  const fit = () => show(wide.matches ? 'all' : chosen || 'simplify');
  wide.addEventListener('change', fit);
  fit();
})();
