// Sort, search and pages on every long admin table (owner, 27 Oct 2026: "let's add pagination/ordering/filtering to this table", on /admin/job-search/scouting
// Closed sites, 276 rows on one page; then: every long admin table). admin/admin.js withNav adds TABLE_TOOLS_STYLE and TABLE_TOOLS_SCRIPT to every page,
// after TABLE_SCRIPT. A table gets the tools when it has more than TOOLS_MIN body rows in one plain grid (one header row on top, no merged cells):
// a click on a header sorts (numbers as numbers, dates as dates, ▲/▼ and aria-sort), a search box keeps the rows holding every word, pages of PER rows.
// A page's own filter (rows it sets `hidden`, as the Closed sites reason chips do) combines with them: the tools only count and page the rows it left.
// A table opts out with data-no-tools; one whose page sorts it already (th.sortable, as /admin/form-filling/lab draws them) is left alone. Tests: test/integration/table-tools.test.js (the functions, the Closed sites table in a browser) and
// tools/admin-table-tools.mjs (every admin page on demo data: each long table gets them, nothing breaks, phone taps ≥ 40 px).
export const TOOLS_MIN = 25, PER = 25;

// Each function below also runs in the browser (TABLE_TOOLS_SCRIPT is their source): no imports, no outside names.
// A cell's value to sort by, for a column of that kind: a number, a time (ms) or lower-case text; null for an empty cell (sorted last either way).
// In a date column "due now" / "today" is now, so it sorts before the dates to come.
export function cellValue(text, kind) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (/^[–—-]?$/.test(t)) return null;
  if (kind === 'date') {
    const m = t.match(/^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d(?::\d\d)?)?/);
    if (m) return Date.parse(m[0].length > 10 ? m[0].replace(' ', 'T') + 'Z' : m[0] + 'T00:00:00Z');
    return /\b(now|today)\b/i.test(t) ? Date.now() : null;
  }
  if (kind === 'num') {
    const m = t.replace(/\u2212/g, '-').match(/^[<>~≈]?\s*([+-]?)\s*[$€£]?\s*(\d[\d,']*(?:\.\d+)?)\s*([kKM](?![a-z]))?/);
    if (!m) return null;
    const n = Number(m[2].replace(/[,']/g, '')) * (m[3] === 'M' ? 1e6 : m[3] ? 1e3 : 1);
    return m[1] === '-' ? -n : n;
  }
  return t.toLowerCase();
}
// What a column holds, from its cells' texts: 'date' when half or more start with a date, 'num' when 80% read as numbers, else 'text'.
export function columnKind(texts) {
  const filled = texts.map(t => String(t ?? '').replace(/\s+/g, ' ').trim()).filter(t => !/^[–—-]?$/.test(t));
  if (!filled.length) return 'text';
  const dates = filled.filter(t => /^\d{4}-\d\d-\d\d/.test(t)).length;
  if (dates && dates * 2 >= filled.length) return 'date';
  const nums = filled.filter(t => cellValue(t, 'num') != null).length;
  return nums >= filled.length * 0.8 ? 'num' : 'text';
}
// Two values of one column, dir 1 (up) or -1 (down); empty cells always last.
export function compareValues(a, b, dir) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, {numeric: true})) * dir;
}
// The rows one page shows: from (0-based) to (exclusive), the page number kept inside the pages there are.
export function pageRange(total, page, per) {
  const pages = Math.max(1, Math.ceil(total / per)), at = Math.min(Math.max(0, page), pages - 1);
  const from = at && at * per;   // per may be Infinity (show all): 0 × Infinity is NaN
  return {page: at, pages, from, to: Math.min(total, from + per)};
}
// A row stays when its text holds every word of the search, in any case and order.
export function rowMatches(text, query) {
  const hay = String(text).toLowerCase();
  return String(query).toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
}
// "1–25 of 276"; "1–25 of 32 · 276 rows" when a filter or the search left fewer; "No row matches · 276 rows".
export function countLabel(range, shown, total) {
  return (shown ? `${range.from + 1}–${range.to} of ${shown}` : 'No row matches') + (shown !== total ? ` · ${total} rows` : '');
}

// The browser half: runs once on the page, with the functions above in scope.
function tableTools(doc, min, per) {
  const make = (tag, className, text) => { const el = doc.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };
  const button = (className, text, label) => { const b = make('button', className, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
  const cellText = cell => (cell ? (cell.dataset.sort ?? cell.textContent) : '');
  doc.querySelectorAll('main table:not([data-no-tools])').forEach(table => {
    const rows = [...table.rows].filter(r => r.parentNode !== table.tFoot), head = rows[0];
    if (rows.length - 1 <= min) return;
    // a long table that is not one plain grid keeps its order and length; the reason is left on it for tools/admin-table-tools.mjs
    const body = rows.slice(1), parent = body[0].parentNode, cells = rows.flatMap(r => [...r.cells]);
    const skip = head.querySelector('th.sortable, th[aria-sort]') ? 'sorts itself' : !head.querySelector('th') || head.querySelector('td') ? 'no header row on top' : cells.some(c => c.colSpan > 1 || c.rowSpan > 1) ? 'merged cells'
      : body.some(r => !r.querySelector('td') || r.cells.length !== head.cells.length) ? 'rows of other shapes' : body.some(r => r.parentNode !== parent) ? 'several bodies' : '';
    if (skip) { table.dataset.tools = `skip: ${skip}`; return; }
    table.classList.add('tt');
    table.dataset.tools = 'on';
    const state = {col: -1, dir: 1, page: 0, all: false, q: ''}, hay = new Map(body.map(r => [r, r.textContent.replace(/\s+/g, ' ')]));
    let order = body.slice();
    [...head.cells].forEach((th, i) => {
      const kind = columnKind(body.map(r => cellText(r.cells[i]))), sort = button('tt-sort');
      while (th.firstChild) sort.append(th.firstChild);
      const arrow = make('span', 'tt-arrow', '↕');
      arrow.setAttribute('aria-hidden', 'true');
      sort.append(arrow);
      th.append(sort);
      th.classList.add('tt-th');
      sort.onclick = () => {
        state.dir = state.col === i ? -state.dir : kind === 'text' ? 1 : -1;
        state.col = i;
        state.page = 0;
        order = body.map((r, n) => ({r, n, v: cellValue(cellText(r.cells[i]), kind)})).sort((a, b) => compareValues(a.v, b.v, state.dir) || a.n - b.n).map(x => x.r);
        parent.append(...order);
        [...head.cells].forEach((other, j) => {
          if (j === i) other.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending'); else other.removeAttribute('aria-sort');
          other.querySelector('.tt-arrow').textContent = j === i ? (state.dir > 0 ? '▲' : '▼') : '↕';
        });
        draw();
      };
    });
    const bar = make('div', 'tt-bar'), search = make('input', 'tt-q'), foot = make('div', 'tt-foot');
    search.type = 'search';
    search.placeholder = `Search ${body.length} rows`;
    search.setAttribute('aria-label', 'Search this table');
    const pager = where => {
      const count = make('span', 'tt-count'), prev = button('filter tt-nav', '‹', 'Previous page'), next = button('filter tt-nav', '›', 'Next page');
      if (where === bar) count.setAttribute('aria-live', 'polite');
      prev.onclick = () => turn(-1);
      next.onclick = () => turn(1);
      where.append(count, prev, next);
      return {count, prev, next};
    };
    const all = button('filter tt-all', 'Show all');
    bar.append(search);
    const pagers = [pager(bar), pager(foot)];
    bar.append(all);
    const box = table.parentElement.matches('.table-scroll, .scroll') && table.parentElement.children.length === 1 ? table.parentElement : table;
    box.before(bar);
    box.after(foot);
    const turn = step => {
      state.page += step;
      draw();
      const top = bar.getBoundingClientRect().top;
      if (top < 0) window.scrollTo({top: top + window.scrollY - 70});
    };
    search.oninput = () => { state.q = search.value; state.page = 0; draw(); };
    all.onclick = () => { state.all = !state.all; state.page = 0; all.textContent = state.all ? `${per} per page` : 'Show all'; draw(); };
    function draw() {
      const kept = [];
      for (const r of order) {
        if (r.hidden) { r.classList.remove('tt-miss', 'tt-off'); continue; }
        const hit = rowMatches(hay.get(r), state.q);
        r.classList.toggle('tt-miss', !hit);
        if (hit) kept.push(r);
      }
      const range = pageRange(kept.length, state.page, state.all ? Infinity : per);
      state.page = range.page;
      kept.forEach((r, n) => r.classList.toggle('tt-off', n < range.from || n >= range.to));
      for (const p of pagers) {
        p.count.textContent = countLabel(range, kept.length, body.length);
        p.prev.disabled = range.page === 0;
        p.next.disabled = range.page >= range.pages - 1;
        p.prev.hidden = p.next.hidden = range.pages < 2;
      }
      all.hidden = !state.all && kept.length <= per;
      foot.hidden = range.pages < 2;
    }
    // the page's own filter hid or showed rows: back to page 1 of what it left
    new MutationObserver(changes => { if (changes.some(c => c.target.tagName === 'TR')) { state.page = 0; draw(); } })
      .observe(parent, {attributes: true, subtree: true, attributeFilter: ['hidden']});
    draw();
  });
}

export const TABLE_TOOLS_SCRIPT = `(function(){${cellValue}${columnKind}${compareValues}${pageRange}${rowMatches}${countLabel}${tableTools}
tableTools(document,window.__tableToolsMin||${TOOLS_MIN},${PER})})();`;

export const TABLE_TOOLS_STYLE = `.tt-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0 8px}.tt-foot{display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:8px 0 0}
.tt-q{flex:1 1 200px;max-width:300px;min-width:0;box-sizing:border-box;background:#0b0d10;color:#f4efe3;border:1px solid #262c33;border-radius:999px;padding:6px 12px;font:13px/1.3 system-ui,-apple-system,sans-serif}
.tt-q:focus{outline:none;border-color:#f5b54a}.tt-count{margin-left:auto;color:#8d949c;font-size:12px;font-variant-numeric:tabular-nums}
.tt-bar .filter,.tt-foot .filter{cursor:pointer}.tt-nav{min-width:34px;justify-content:center}.tt-bar .filter:disabled,.tt-foot .filter:disabled{opacity:.35;cursor:default}
table.tt tr.tt-miss,table.tt tr.tt-off{display:none}
.tt-sort{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px}.tt-sort:hover{color:#f4efe3}.tt-sort:focus-visible{outline:2px solid #f5b54a;outline-offset:2px;border-radius:4px}
.tt-arrow{color:#5b6470;font-size:10px}th[aria-sort] .tt-sort{color:#f4efe3}th[aria-sort] .tt-arrow{color:#f5b54a}
@media (max-width:700px){table.tt th:first-child,table.tt td:first-child{min-width:9em}.tt-q{flex-basis:100%;max-width:none;min-height:40px;font-size:16px}.tt-sort{min-height:40px}.tt-nav{min-width:40px}}`;
