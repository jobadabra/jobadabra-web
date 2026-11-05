// The What's new page: the versions from changelog.json (CI drafts them, the site stores them; src/changelog-store.js), newest first.
// The newest is a full card, the next shows three highlights, older ones are compact rows that open on a click; long releases fold the rest
// under "View all N changes". Text goes in as text, never as HTML. Guarded by test/unit/website/changelog-page.test.js.
const KINDS = [['features', 'New'], ['improvements', 'Improved'], ['fixes', 'Fixed']];
const CHANNELS = {stable: 'Stable', beta: 'Beta', start: 'Project start'};
const HIGHLIGHTS = 3, FIRST_ROWS = 6, MORE_ROWS = 8;

const make = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const changes = entry => KINDS.flatMap(([kind, label]) => ((entry.groups || []).find(g => g.kind === kind)?.items || []).map(item => ({...item, label, kind})));

function list(items) {
  const ul = make('ul', 'changes');
  for (const item of items) {
    const li = make('li'), tag = make('span', `tag ${item.kind}`, item.label), body = make('span');
    body.append(make('b', '', `${item.lead}. `), item.text);
    li.append(tag, body); ul.append(li);
  }
  return ul;
}
const chip = entry => make('span', `channel ${entry.channel}`, CHANNELS[entry.channel] || entry.channel);
const heading = (entry, tag) => { const h = make(tag, 'rel-head'), time = make('time', '', entry.date); h.append(make('b', 'ver', `Version ${entry.version}`), chip(entry), time); return h; };
const counts = entry => KINDS.map(([kind, label]) => [label, changes(entry).filter(c => c.kind === kind).length]).filter(([, n]) => n).map(([label, n]) => `${n} ${label.toLowerCase()}`).join(' · ');

// A card: the first `show` changes, the rest under "View all N changes".
function card(entry, show) {
  const box = make('article', 'release card'), all = changes(entry);
  box.id = `v${entry.version}`; box.append(heading(entry, 'h2'), list(all.slice(0, show)));
  if (all.length > show) {
    const more = make('details', 'more'), summary = make('summary', '', `View all ${all.length} changes`);
    more.append(summary, list(all.slice(show))); box.append(more);
  }
  return box;
}
function row(entry) {
  const box = make('details', 'release row'), summary = make('summary');
  box.id = `v${entry.version}`;
  summary.append(heading(entry, 'span'), make('span', 'counts', counts(entry)));
  box.append(summary, list(changes(entry)));
  return box;
}

function render(root, entries) {
  root.replaceChildren();
  entries.forEach((entry, i) => { if (i < 2) root.append(card(entry, i ? HIGHLIGHTS : 6)); });
  const older = entries.slice(2), rows = make('div', 'rows');
  if (!older.length) return;
  root.append(make('h2', 'older-title', 'Earlier releases'), rows);
  let shown = 0;
  const button = make('button', 'btn btn-ghost btn-small load', 'Load earlier releases');
  const more = () => { older.slice(shown, shown ? shown + MORE_ROWS : FIRST_ROWS).forEach(entry => rows.append(row(entry))); shown = rows.children.length; button.hidden = shown >= older.length; };
  button.addEventListener('click', more); more(); root.append(button);
  const target = location.hash && root.ownerDocument.getElementById(location.hash.slice(1));
  if (!target) return;
  while (!target.isConnected && !button.hidden) more();
  if (target.tagName === 'DETAILS') target.open = true;
  target.scrollIntoView();
}

const TABS = [['all', 'All', () => true], ['stable', 'Stable', e => e.channel === 'stable'], ['beta', 'Beta', e => e.channel === 'beta']];
fetch('changelog.json').then(r => (r.ok ? r.json() : [])).catch(() => []).then(entries => {
  const root = document.getElementById('release-list'), tabs = document.getElementById('release-tabs');
  if (!Array.isArray(entries) || !entries.length) { document.getElementById('releases-empty').hidden = false; return; }
  document.getElementById('releases-note').hidden = false; tabs.hidden = false;
  const pick = key => {
    for (const button of tabs.children) button.setAttribute('aria-selected', String(button.dataset.tab === key));
    render(root, entries.filter(TABS.find(([k]) => k === key)[2]));
  };
  for (const [key, label] of TABS) { const b = make('button', '', label); b.type = 'button'; b.role = 'tab'; b.dataset.tab = key; b.addEventListener('click', () => pick(key)); tabs.append(b); }
  pick('all');
});
