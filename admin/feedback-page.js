// The HTML of the owner's feedback page (routes in admin/feedback.js). Live list, filters by state and impact, a ⋯ menu per card, inline forms for the actions that need a word or a second click.
// Everything from the server is put on the page with textContent. Guarded by test/shared/feedback.test.js and test/admin/feedback-actions.test.js.
// Why (3 Nov 2026, owner: "Make all the action buttons under a 3 dot dropdown menu"): the card shows state and impact; every action lives in one menu, and the menu lists only what the state table allows (the server sends `actions`).
export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Feedback · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a;--red:#f0716b;--violet:#9d93ee;--blue:#5b9bf0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px 48px}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
h1{margin:0;font-size:24px}a{color:var(--amber)}.muted{color:var(--muted)}.live{font-size:13px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:6px}
.live.on .dot{background:var(--green);animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.35}}
.summary{display:flex;gap:6px 18px;flex-wrap:wrap;align-items:baseline;margin:0 0 10px}.summary b{font-size:20px;font-variant-numeric:tabular-nums}
.filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 6px}.sep{width:1px;height:18px;background:var(--line);margin:0 4px}
.chip{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);white-space:nowrap}
button.chip{cursor:pointer}button.chip:hover{color:var(--text)}button.chip[aria-pressed="true"]{color:var(--bg);background:var(--text);border-color:var(--text)}
.chip.new{color:var(--green);border-color:var(--green)}.chip.running,.chip.deferred{color:var(--violet);border-color:var(--violet)}.chip.pr{color:var(--blue);border-color:var(--blue)}.chip.fixed{color:var(--green);border-color:var(--green)}
.chip.dismissed{color:var(--muted)}.chip.false_positive{color:var(--amber);border-color:var(--amber)}.chip.ai{color:var(--violet);border-color:var(--violet)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.card.fresh{border-color:var(--amber)}.card.quiet{opacity:.72}.top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.meta{font-size:12px;color:var(--muted);margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.warn{color:var(--amber);font-weight:700}.shot{display:block;max-width:240px;max-height:160px;border:1px solid var(--line);border-radius:8px;margin-top:10px}
.files{margin-top:10px;font-size:13px}.logs{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 ui-monospace,monospace;max-height:420px;overflow:auto;background:#0b0d10;border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:6px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}.reply{margin-top:8px;font-size:13px}.badge{color:var(--amber);font-weight:700}.note{margin-top:6px;font-size:13px;color:var(--muted)}
.impact{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted)}
.menu{position:relative;flex:none}.menu>button{font:inherit;font-size:18px;line-height:1;color:var(--muted);background:transparent;border:1px solid var(--line);border-radius:8px;padding:2px 9px;cursor:pointer}
.menu>button:hover,.menu>button[aria-expanded="true"]{color:var(--text);border-color:var(--muted)}
.pop{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:210px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:5px;box-shadow:0 8px 24px #0009;display:grid;gap:2px}
.pop button{font:inherit;font-size:13px;text-align:left;color:var(--text);background:transparent;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}.pop button:hover,.pop button:focus-visible{background:#ffffff14;outline:0}
.pop .danger{color:var(--red);border-top:1px solid var(--line);margin-top:3px}
button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.panel{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px}.panel input{flex:1 1 220px;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:5px 9px}
.panel button{font:inherit;font-size:13px;font-weight:600;color:var(--text);background:transparent;border:1px solid var(--line);border-radius:8px;padding:5px 12px;cursor:pointer}.panel .go{border-color:var(--amber);color:var(--amber)}.panel .danger{border-color:var(--red);color:var(--red)}
.form{margin-top:10px;display:grid;gap:8px;font-size:13px;border-top:1px solid var(--line);padding-top:10px}.form label{display:grid;gap:3px;color:var(--muted);font-size:12px}.form .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.form input[type=text],.form select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:5px 9px;width:100%}.form .check{display:flex;gap:6px;align-items:center;color:var(--text);font-size:13px}
.form button{font:inherit;font-size:13px;font-weight:600;color:var(--text);background:transparent;border:1px solid var(--line);border-radius:8px;padding:5px 12px;cursor:pointer}.form .go{border-color:var(--amber);color:var(--amber)}
a.chip{text-decoration:none}.told{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.chip.warn{color:var(--amber);border-color:var(--amber)}
.toast[hidden]{display:none}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 14px;font-size:13px;display:flex;gap:12px;align-items:center;z-index:9;box-shadow:0 8px 24px #000a}
.toast button{font:inherit;font-size:13px;font-weight:600;color:var(--amber);background:transparent;border:0;cursor:pointer}.toast.bad{border-color:var(--red)}
</style></head><body><main>
<header><h1>💬 Feedback</h1><span class="muted"><span class="live" id="live"><span class="dot"></span><span id="state">connecting…</span></span></span></header>
<p class="warn" id="alert" hidden></p>
<p class="summary" id="summary"></p>
<div class="filters" id="statef" role="group" aria-label="Filter by state"></div>
<div class="filters" id="impactf" role="group" aria-label="Filter by impact"></div>
<div id="list"><p class="muted">Loading…</p></div>
<div class="toast" id="toast" role="status" hidden></div>
<script>
const list = document.getElementById('list'), stateEl = document.getElementById('state'), live = document.getElementById('live'), toast = document.getElementById('toast');
let known = null, rows = [], canAct = false, stateFilter = location.hash.length > 1 ? 'all' : 'open', impactFilter = '', sortBy = 'newest';
const STATE = {new: ['🆕 New', 'new'], dismissed: ['🙈 Dismissed', 'dismissed'], false_positive: ['🚫 False positive', 'false_positive'], deferred: ['⏳ Deferred', 'deferred'],
  ai_running: ['🤖 AI running', 'running'], ai_pr: ['🔀 PR open', 'pr'], fixed: ['✅ Fixed', 'fixed']};
const OPEN = ['new', 'ai_running', 'ai_pr'];
const STATE_FILTERS = [['open', 'Open', r => OPEN.includes(r.state)], ['all', 'All', () => true], ['deferred', '⏳ Deferred', r => r.state === 'deferred'], ['fixed', '✅ Fixed', r => r.state === 'fixed'],
  ['dismissed', '🙈 Dismissed', r => r.state === 'dismissed'], ['false_positive', '🚫 False positive', r => r.state === 'false_positive']];
const IMPACT_FILTERS = [['high', '▲ High'], ['medium', '● Medium'], ['low', '▽ Low'], ['none', 'Unrated']];
const RANK = {high: 0, medium: 1, low: 2, '': 3};
const eff = row => row.impact || row.impact_ai || '';   // the owner's rating wins; until he rates it, the AI's suggestion counts for the filters and the sort
const NAME = {high: 'High', medium: 'Medium', low: 'Low'};
const LABEL = {fixed: '✅ Fixed + tell the reporter…', defer: '⏳ Acknowledge + defer…', dismiss: '🙈 Dismiss', false_positive: '🚫 False positive…', reopen: '↩ Reopen', delete: '🗑 Delete…'};
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };

let toastTimer;
const say = (text, {undo, bad} = {}) => {
  toast.replaceChildren(el('span', '', text)); toast.className = 'toast' + (bad ? ' bad' : ''); toast.hidden = false;
  if (undo) { const b = el('button', '', 'Undo'); b.onclick = async () => { toast.hidden = true; await send(undo, 'Back to new.'); }; toast.append(b); }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, undo ? 8000 : 4000);
};
async function send(body, done, options) {
  try {
    const response = await fetch('/admin/growth/feedback/act', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const answer = await response.json().catch(() => ({}));
    if (!response.ok || !answer.ok) throw new Error(answer.error || 'Failed (' + response.status + ')');
    say(done, options); await refresh(); return true;
  } catch (error) { say(error.message, {bad: true}); return false; }
}

let openMenu = null;
const closeMenu = () => { if (openMenu) { openMenu.pop.remove(); openMenu.button.setAttribute('aria-expanded', 'false'); openMenu = null; } };
document.addEventListener('click', event => { if (openMenu && !openMenu.wrap.contains(event.target)) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && openMenu) { const b = openMenu.button; closeMenu(); b.focus(); } });

function menuOf(row, card) {
  const wrap = el('div', 'menu'), button = el('button', '', '⋯');
  button.type = 'button'; button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'Actions for this feedback');
  button.onclick = () => {
    if (openMenu && openMenu.button === button) return closeMenu();
    closeMenu();
    const pop = el('div', 'pop'); pop.setAttribute('role', 'menu');
    for (const action of row.actions) {
      const item = el('button', action === 'delete' ? 'danger' : '', LABEL[action]); item.type = 'button'; item.setAttribute('role', 'menuitem');
      item.onclick = () => { closeMenu(); choose(row, action, card); };
      pop.append(item);
    }
    wrap.append(pop); button.setAttribute('aria-expanded', 'true'); openMenu = {wrap, button, pop}; pop.querySelector('button')?.focus();
  };
  wrap.append(button); return wrap;
}
function choose(row, action, card) {
  card.querySelector('.panel, .form')?.remove();
  if (action === 'fixed' || action === 'defer') return card.append(formFor(row, action));
  if (action === 'dismiss') return send({ref: row.ref, action}, 'Dismissed.', {undo: {ref: row.ref, action: 'reopen', from: 'dismissed'}});
  if (action === 'reopen') return send({ref: row.ref, action}, 'Back to new.');
  const panel = el('div', 'panel'), go = el('button', action === 'delete' ? 'danger' : 'go', action === 'delete' ? 'Delete' : 'Save'), cancel = el('button', '', action === 'delete' ? 'Keep' : 'Cancel');
  go.type = cancel.type = 'button'; cancel.onclick = () => panel.remove();
  if (action === 'delete') {
    panel.append(el('span', '', 'Delete forever? Its screenshot, logs and data go too.'), go, cancel);
    go.onclick = () => send({ref: row.ref, action}, 'Deleted.');
  } else {
    const input = el('input'); input.type = 'text'; input.maxLength = 200; input.placeholder = 'Why? (works as designed, duplicate of …)'; input.setAttribute('aria-label', 'Why is this a false positive');
    panel.append(input, go, cancel);
    go.onclick = () => { if (!input.value.trim()) return input.focus(); send({ref: row.ref, action, note: input.value}, 'Marked as a false positive.'); };
    input.onkeydown = event => { if (event.key === 'Enter') go.click(); };
    setTimeout(() => input.focus());
  }
  card.append(panel);
}

// The two forms that carry the owner's words to the reporter. The server validates everything again (shared/feedback-reply.js); this only asks for it.
function formFor(row, action) {
  const form = el('div', 'form'), fixed = action === 'fixed', field = (label, input) => { const l = el('label', '', label); l.append(input); form.append(l); return input; };
  const text = (max, placeholder) => { const i = el('input'); i.type = 'text'; i.maxLength = max; i.placeholder = placeholder; return i; };
  const version = fixed ? field('Fixed in (a version; blank = the next update)', text(40, 'e.g. 0.9.12')) : null;
  const link = field(fixed ? 'PR or commit link (lets a release find it and tell the reporter by itself)' : 'Linear issue (optional)', text(200, fixed ? 'https://github.com/…/pull/123' : 'https://linear.app/…/issue/JOB-12'));
  const message = field('Message to the reporter (blank = the standard sentence)', text(300, fixed ? 'Thank you: this is fixed.' : 'Thank you: we saw this and parked it for later.'));
  const mail = el('input'); mail.type = 'checkbox'; mail.disabled = !row.mailable; mail.checked = !!row.mailable;
  const mailRow = el('label', 'check'); mailRow.append(mail, row.mailable ? 'Also e-mail ' + row.contact : 'No e-mail: the contact is not an address (they are told in the app)');
  form.append(mailRow);
  let when = null, impact = null, tell = null;
  if (fixed) {
    when = el('select'); let touched = false;
    for (const [value, label] of [['release', 'Tell automatically at the first release that includes it'], ['now', 'Tell now'], ['never', 'Do not tell']]) when.append(Object.assign(el('option', '', label), {value}));
    when.onchange = () => { touched = true; }; version.oninput = () => { if (!touched) when.value = version.value.trim() ? 'now' : 'release'; };
    field('When to tell the reporter', when);
  } else {
    tell = el('input'); tell.type = 'checkbox'; tell.checked = true; const t = el('label', 'check'); t.append(tell, 'Tell the reporter in the app'); form.append(t);
    if (!row.impact) { impact = el('select'); for (const [value, label] of [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) impact.append(Object.assign(el('option', '', label), {value})); impact.value = row.impact_ai || 'low'; field('Impact', impact); }
  }
  const buttons = el('div', 'row'), go = el('button', 'go', 'Save'), cancel = el('button', '', 'Cancel'); go.type = cancel.type = 'button'; cancel.onclick = () => form.remove();
  go.onclick = () => send({ref: row.ref, action, message: message.value, mail: mail.checked && !mail.disabled, ...(fixed ? {fixed_in: version.value, pr_url: link.value, when: when.value} : {linear_url: link.value, tell: tell.checked, ...(impact ? {impact: impact.value} : {})})},
    fixed ? 'Marked as fixed.' : 'Deferred.');
  buttons.append(go, cancel); form.append(buttons); setTimeout(() => (version || message).focus());
  return form;
}

const toldChips = row => {
  const box = el('div', 'told');
  if (row.fixed_in) box.append(el('span', 'chip', 'in ' + row.fixed_in));
  for (const [url, label] of [[row.pr_url, 'PR ↗'], [row.linear_url, 'Linear ↗']]) if (url) { const a = el('a', 'chip', label); a.href = url; a.target = '_blank'; a.rel = 'noopener'; box.append(a); }
  if (row.told === 'pending') box.append(el('span', 'chip deferred', '⏳ waiting for a release to tell the reporter'));
  else if (/^app, mail refused/.test(row.told)) box.append(el('span', 'chip warn', '⚠ told in the app; ' + row.told.slice(5)));
  else if (row.told) box.append(el('span', 'chip fixed', row.told === 'app+mail' ? '✉ told in the app and by e-mail' : '✉ told in the app'));
  if (row.seen_at) box.append(el('span', 'chip', '👁 seen by the reporter'));
  return box;
};

const make = row => {
  const card = el('div', 'card' + (OPEN.includes(row.state) ? '' : ' quiet')), top = el('div', 'top'), meta = el('div', 'meta'), text = el('div', 'text');
  const [label, tone] = STATE[row.state] || STATE.new;
  meta.append(el('span', 'chip ' + tone, label));
  const parts = [String(row.at).slice(0, 16).replace('T', ' ') + ' UTC', row.version + ' · ' + row.platform, 'install ' + String(row.install).slice(0, 8)];
  for (const part of parts) meta.append(el('span', '', part));
  top.append(meta); if (canAct && row.actions.length) top.append(menuOf(row, card));
  text.textContent = row.text;
  card.append(top, text);
  if (row.state_note) card.append(el('div', 'note', row.state === 'false_positive' ? 'Why: ' + row.state_note : row.state_note));
  card.id = row.ref || '';
  if (row.fixed_in || row.pr_url || row.linear_url || row.told || row.seen_at) card.append(toldChips(row));
  if (canAct || row.impact || row.impact_ai) {
    const box = el('div', 'impact'); box.append('Impact');
    for (const [value, name] of [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) {
      if (!canAct) { if (row.impact === value) box.append(el('span', 'chip', name)); continue; }
      const chip = el('button', 'chip', name); chip.type = 'button'; chip.setAttribute('aria-pressed', String(row.impact === value));
      chip.onclick = () => send({ref: row.ref, action: 'impact', impact: row.impact === value ? '' : value}, row.impact === value ? 'Impact cleared.' : 'Impact: ' + name + '.');
      box.append(chip);
    }
    if (row.impact_ai && row.impact !== row.impact_ai && canAct) {
      const use = el('button', 'chip ai', '🤖 AI suggests ' + NAME[row.impact_ai] + ' · use it'); use.type = 'button'; use.title = row.impact_why;
      use.onclick = () => send({ref: row.ref, action: 'impact', impact: row.impact_ai}, 'Impact: ' + NAME[row.impact_ai] + '.'); box.append(use);
    } else if (row.impact_ai) box.append(el('span', 'chip ai', '🤖 AI: ' + NAME[row.impact_ai]));
    if (row.impact_why) box.append(el('span', row.impact_ai ? '' : 'warn', (row.impact_ai ? '' : '⚠ ') + row.impact_why));
    card.append(box);
  }
  if (row.notified === 'sent') { /* delivered: nothing to say */ } else if (row.notified) {
    const flag = el('div', 'warn reply', row.notified === 'off' ? '⚠ Telegram is not set up: you were not told about this one.' : '⚠ Not delivered to Telegram (' + row.notified.replace(/^failed: /, '') + ')');
    card.append(flag);
  }
  if (row.ref && row.shot) {
    const link = el('a'), img = el('img', 'shot'), href = '/admin/growth/feedback/file?ref=' + encodeURIComponent(row.ref) + '&kind=screen';
    link.href = href; link.target = '_blank'; link.rel = 'noopener'; img.alt = 'Screenshot of the app window'; img.loading = 'lazy'; img.src = href; link.append(img); card.append(link);
  }
  const lazyFile = (kind, label, url) => {
    const files = el('details', 'files'), pre = el('pre', 'logs');
    files.append(el('summary', '', label), pre);
    files.addEventListener('toggle', async () => {
      if (!files.open || pre.dataset.loaded) return;
      pre.textContent = 'Loading…';
      try { const r = await fetch(url, {cache: 'no-store'}); pre.textContent = r.ok ? (kind === 'history' ? (await r.json()).lines.join(String.fromCharCode(10)) || 'Nothing yet.' : await r.text()) : 'Gone (kept 90 days).'; pre.dataset.loaded = '1'; }
      catch (error) { pre.textContent = 'Could not load this.'; }
    });
    card.append(files);
  };
  for (const [kind, flag, label] of [['logs', row.logs, 'Logs'], ['page', row.page, 'Screen data'], ['profile', row.profile, 'Profile snapshot (the person turned it on)']]) {
    if (row.ref && flag) lazyFile(kind, label, '/admin/growth/feedback/file?ref=' + encodeURIComponent(row.ref) + '&kind=' + kind);
  }
  if (canAct && row.ref) lazyFile('history', 'History', '?history=' + encodeURIComponent(row.ref));
  if (row.contact) card.append(el('div', 'reply', '↩︎ ' + row.contact));
  return card;
};
const cards = new Map();   // key -> {sig, card}: one card per message, kept across polls (an open Logs viewer and a loaded screenshot stay) and rebuilt only when what it shows changed
const mark = (card, fresh) => {   // NEW lasts one poll: a decoration set on the kept card each time
  card.classList.toggle('fresh', fresh);
  const badge = card.querySelector('.badge');
  if (!fresh) badge?.remove();
  else if (!badge) card.querySelector('.meta').prepend(el('span', 'badge', 'NEW'));
};
const chips = (host, items, current, pick) => host.replaceChildren(...items.map(([value, label, count]) => {
  const chip = el('button', 'chip', label + (count === undefined ? '' : ' ' + count)); chip.type = 'button'; chip.setAttribute('aria-pressed', String(current === value));
  chip.onclick = () => { pick(value === current ? '' : value); paint(); }; return chip;
}));
function paint() {
  const count = test => rows.filter(test).length;
  const open = count(r => OPEN.includes(r.state)), deferred = count(r => r.state === 'deferred'), noise = count(r => r.state === 'false_positive');
  const summary = document.getElementById('summary');
  summary.replaceChildren();
  for (const [n, name] of [[open, 'open'], [deferred, 'deferred'], [rows.length, 'total']]) { const s = el('span'); s.append(el('b', '', String(n)), ' ' + name); summary.append(s); }
  if (noise) summary.append(el('span', 'muted', 'False positive: ' + noise + ' of ' + rows.length + ' (' + Math.round(noise * 100 / rows.length) + '%)'));
  chips(document.getElementById('statef'), STATE_FILTERS.map(([value, label, test]) => [value, label, count(test)]), stateFilter, value => { stateFilter = value || 'open'; });
  chips(document.getElementById('impactf'), IMPACT_FILTERS.map(([value, label]) => [value, label, count(r => (eff(r) || 'none') === value)]), impactFilter, value => { impactFilter = value; });
  const sort = el('button', 'chip', 'Sort: ' + (sortBy === 'newest' ? 'newest' : 'impact first')); sort.type = 'button'; sort.onclick = () => { sortBy = sortBy === 'newest' ? 'impact' : 'newest'; paint(); };
  document.getElementById('impactf').append(el('span', 'sep'), sort);
  const keep = (STATE_FILTERS.find(f => f[0] === stateFilter) || STATE_FILTERS[0])[2];
  let shown = rows.filter(r => keep(r) && (!impactFilter || (eff(r) || 'none') === impactFilter));
  if (sortBy === 'impact') shown = shown.slice().sort((a, b) => RANK[eff(a)] - RANK[eff(b)] || (a.at < b.at ? 1 : -1));
  const keyOf = row => row.ref || row.at + row.install, seen = new Set(known || []), first = known === null;
  list.replaceChildren(...(shown.length ? shown.map(row => {
    const sig = [row.notified, row.shot, row.logs, row.page, row.profile, row.state, row.state_note, row.impact, row.impact_ai, row.impact_why, row.actions.join(), row.fixed_in, row.pr_url, row.linear_url, row.told, row.seen_at, canAct].join('|'), kept = cards.get(keyOf(row));
    let card = kept && kept.sig === sig ? kept.card : null;
    if (!card) { card = make(row); cards.set(keyOf(row), {sig, card}); }
    mark(card, !first && !seen.has(keyOf(row))); return card;
  }) : [el('p', 'muted', rows.length ? 'Nothing matches these filters.' : 'No feedback yet.')]));
  known = rows.map(keyOf);
  for (const key of cards.keys()) if (!known.includes(key)) cards.delete(key);   // a deleted message's card does not stay in memory
}
async function refresh() {
  try {
    const response = await fetch('?json=1', {cache: 'no-store'});
    if (!response.ok) throw new Error(response.status);
    const data = await response.json(), firstLoad = known === null;
    rows = data.rows; canAct = data.canAct;
    const alert = document.getElementById('alert'); alert.hidden = !data.undelivered; alert.textContent = '⚠ ' + data.undelivered + ' feedback message' + (data.undelivered === 1 ? '' : 's') + ' did not reach your Telegram.';
    paint();
    if (firstLoad && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    stateEl.textContent = 'live · updated ' + new Date().toLocaleTimeString();
    live.classList.add('on');
  } catch (error) { stateEl.textContent = 'offline, retrying…'; live.classList.remove('on'); }
}
// Every 60 s while the tab is visible, and once when it becomes visible again (a timer that ignored a hidden tab kept reading D1 all night: 11 Oct 2026, test/poll-timers.test.js).
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
</script></main></body></html>`;
