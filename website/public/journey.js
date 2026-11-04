// The landing's whole-journey panel (index.html #journey): each step is a tab that shows its words below the rows (on a phone: right under the
// step, the list being vertical); arrows, Home and End move along the steps; a dashed loop leads back to the first step. Without this script
// the first step's words show. Guarded by test/unit/website/effects.test.js.
(() => {
  const tabs = [...document.querySelectorAll('#journey [role="tab"]')];
  const show = tab => {
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute('aria-selected', String(on));
      other.tabIndex = on ? 0 : -1;
      document.getElementById(other.getAttribute('aria-controls')).hidden = !on;
    }
    draw();
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => show(tab));
    tab.addEventListener('keydown', event => {
      const at = tabs.indexOf(tab);
      const to = {ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1}[event.key];
      if (to === undefined) return;
      event.preventDefault();
      const next = tabs[(to + tabs.length) % tabs.length];
      show(next);
      next.focus();
    });
  }

  // A phone (home.css, the same width) lists the steps one under the other: each step's words move into its line, and back below the rows after.
  const narrow = matchMedia('(max-width: 560px)');
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const below = document.querySelector('#journey .journey-promises');
  const place = () => panels.forEach((panel, i) => (narrow.matches ? tabs[i].parentElement.append(panel) : below && below.before(panel)));

  // The way back to the first step, drawn where the steps sit now: in rows, from the last step down under the second row, along the left edge
  // and into the first step; in a vertical list, from the last step along the left edge up to the first.
  const rows = document.querySelector('#journey .journey-rows');
  const loop = rows && rows.querySelector('.journey-loop');
  const nodes = rows ? [...rows.querySelectorAll('.node')] : [];
  function draw() {
    if (!loop || nodes.length < 2) return;
    const box = rows.getBoundingClientRect(), from = nodes[nodes.length - 1].getBoundingClientRect(), to = nodes[0].getBoundingClientRect();
    const side = -Math.min(18, box.left - rows.closest('.journey').getBoundingClientRect().left - 4), r = 10;
    const y2 = to.top + to.height / 2 - box.top, x2 = to.left - box.left - 8, text = loop.querySelector('text');
    rows.classList.toggle('looped', !narrow.matches);
    if (narrow.matches) {
      const y1 = from.top + from.height / 2 - box.top, x1 = from.left - box.left - 4;
      loop.setAttribute('width', box.width); loop.setAttribute('height', box.height);
      loop.querySelector('.line').setAttribute('d', `M${x1} ${y1}H${side + r}Q${side} ${y1} ${side} ${y1 - r}V${y2 + r}Q${side} ${y2} ${side + r} ${y2}H${x2 - 6}`);
      loop.querySelector('.head').setAttribute('d', `M${x2} ${y2}l-7 -4v8Z`);
      text.setAttribute('x', 0); text.setAttribute('y', 0);
      text.setAttribute('transform', `translate(${side - 6} ${(y1 + y2) / 2}) rotate(-90)`);
      return;
    }
    text.removeAttribute('transform');
    const x0 = from.right - box.left + 4, y1 = from.top + from.height / 2 - box.top, x1 = x0 + 14;   // leaves the last step on its right, clear of its label
    const bottom = box.height + 18;
    loop.setAttribute('width', box.width); loop.setAttribute('height', bottom + 30);
    loop.querySelector('.line').setAttribute('d', `M${x0} ${y1}H${x1 - r}Q${x1} ${y1} ${x1} ${y1 + r}V${bottom - r}Q${x1} ${bottom} ${x1 - r} ${bottom}H${side + r}Q${side} ${bottom} ${side} ${bottom - r}`
      + `V${y2 + r}Q${side} ${y2} ${side + r} ${y2}H${x2 - 6}`);
    loop.querySelector('.head').setAttribute('d', `M${x2} ${y2}l-7 -4v8Z`);
    text.setAttribute('x', (x1 + side) / 2); text.setAttribute('y', bottom + 18);
  }
  place();
  draw();
  narrow.addEventListener('change', () => { place(); draw(); });
  addEventListener('resize', draw);
  if (document.fonts) document.fonts.ready.then(draw);
})();
