// The homepage's small benchmark summary: the SAME published rounds as /benchmark (it reads /benchmark-results.json, so Publish and Unpublish in Admin move both).
// Why (12 Nov 2026, owner: "a small/summary/preview card or section on the first page of our website with a link to full benchmarks"). Aggregate counts and tool names only, like /benchmark.
// Without the data (offline, a failed fetch) the cards stay hidden and the section keeps its text and the link to /benchmark.
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; };
const own = tool => ['ours', 'extension'].includes(tool.key);
const bar = (name, percent, label, mine) => '<li class="' + (mine ? 'bench-own' : '') + '"><span class="hb-name">' + esc(name) + '</span><span class="hb-track" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, percent)) + '%"></i></span><b class="hb-score">' + esc(label) + '</b></li>';
const card = (title, date, rows, note) => '<article class="bench-mini"><header><h3>' + esc(title) + '</h3>' + (date ? '<span>' + esc(date) + '</span>' : '') + '</header><ul>' + rows + '</ul><p>' + esc(note) + '</p></article>';

/** Cards for the latest published form round and job-search round; either is left out when its data is missing. */
export function summary(data) {
  const f = data.forms, s = data.search, cards = [];
  const forms = (f?.tools || []).filter(t => t.score != null).sort((a, b) => b.score - a.score);
  if (forms.length) cards.push(card('Form filling', day(f.date || data.date), forms.map(t => bar(t.name, t.score, t.score + '%', own(t))).join(''), 'Share of answerable questions filled right, ' + forms.length + ' tools on the same ' + (forms[0].forms ?? '') + ' forms.'));
  // Why (12 Nov 2026, owner via the coordinator: "Right jobs found"): the job-search card counts relevant jobs (right kind of work AND right place) each tool found for the same people; the role-match share stays on /benchmark only.
  const search = (s?.tools || []).filter(t => t.relevant != null).sort((a, b) => b.relevant - a.relevant), top = Math.max(1, ...search.map(t => t.relevant));
  if (search.length) cards.push(card('Job search', day(s.date || data.date), search.map(t => bar(t.name, 100 * t.relevant / top, String(t.relevant), own(t))).join(''), 'Relevant jobs found for the same' + (s.personas?.length ? ' ' + s.personas.length : '') + ' fictional job seekers.'));
  return cards.join('');
}

const host = typeof document === 'undefined' ? null : document.getElementById('home-bench-cards');
if (host) fetch('/benchmark-results.json').then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(data => { const html = summary(data); if (html) { host.innerHTML = html; host.hidden = false; } }).catch(() => {});
