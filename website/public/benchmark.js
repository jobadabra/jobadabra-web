// Public benchmark tables: aggregate counts only, the Compare page's components, and independent phone pickers for each result view.
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pct = (part, total) => total ? (100 * part / total).toFixed(1) + '%' : 'Not observed';
const own = tool => ['ours', 'extension'].includes(tool.key);
const small = text => '<small>' + esc(text) + '</small>';
const counted = (part, total) => (part == null ? '<b>Not recorded</b>' : '<b>' + pct(part, total) + '</b>' + small(part + ' / ' + total));
const width = (part, total) => total ? Math.max(0, Math.min(100, 100 * part / total)) : 0;
// Why (12 Nov 2026, owner: "null remote · null no · null unknown"): a count the round did not record is null; it is written as "not recorded", never as the word null.
const shown = count => (count == null ? 'not recorded' : count);
const segment = (label, count, total, tone) => '<span class="bench-segment ' + tone + '" style="width:' + (count == null ? 0 : width(count, total)) + '%" title="' + esc(label + ': ' + shown(count)) + '"></span>';
const verdicts = t => { const parts = [['yes', t.place], ['remote', t.remote], ['no', t.no], ['unknown', t.unknown]]; return parts.filter(([, n]) => n != null).map(([w, n]) => n + ' ' + w).join(' · ') + (parts.some(([, n]) => n == null) ? (parts.every(([, n]) => n == null) ? '' : ' · ') + 'other verdicts not recorded' : ''); };
const legend = items => '<div class="bench-legend">' + items.map(([label, tone]) => '<span><i class="' + tone + '"></i>' + esc(label) + '</span>').join('') + '</div>';
const details = (label, html) => '<details class="tech bench-method"><summary>' + label + '</summary>' + html + '</details>';

function searchChart(tools) {
  return '<div class="bench-chart"><div class="bench-chart-head"><h3>What matched?</h3><p>Role match and location verdicts, within each channel’s returned listings.</p></div>' +
    '<div class="bench-chart-columns"><span>Channel / sample</span><span>Right kind of work</span><span>Location verdicts</span></div>' +
    tools.map(t => '<div class="bench-search-row' + (own(t) ? ' bench-own' : '') + '"><div class="bench-tool"><b>' + esc(t.name) + '</b><small>' + esc(t.found) + ' listings · ' + esc(t.observedPersonas) + '/10 personas</small></div>' +
      '<div class="bench-role"><div class="bench-bar-label"><span>Role match</span><b>' + pct(t.role, t.found) + '</b></div><div class="bench-track" aria-hidden="true">' + segment('Role yes', t.role, t.found, own(t) ? 'tone-own' : 'tone-yes') + '</div><small>' + esc(t.role + ' / ' + t.found) + ' listings</small></div>' +
      '<div class="bench-location"><span class="sr">Location: </span><div class="bench-track" aria-hidden="true">' + segment('Place yes', t.place, t.found, 'tone-yes') + segment('Remote', t.remote, t.found, 'tone-remote') + segment('Place no', t.no, t.found, 'tone-no') + segment('Unknown', t.unknown, t.found, 'tone-unknown') + '</div><small>' + esc(verdicts(t)) + '</small></div></div>').join('') +
    legend([['Place yes', 'tone-yes'], ['Remote', 'tone-remote'], ['Place no', 'tone-no'], ['Unknown', 'tone-unknown']]) + '</div>';
}

function formChart(tools) {
  return '<div class="bench-chart bench-form-chart"><div class="bench-chart-head"><h3>Every answer counts</h3><p>Share of answerable questions. One repeat per tool; variability not estimated.</p></div>' +
    tools.map((t, i) => {
      const total = t.right + t.wrong + t.empty + t.notReached;
      return '<div class="bench-form-row' + (own(t) ? ' bench-own' : '') + '"><span class="bench-rank">' + (i + 1) + '</span><div class="bench-tool"><b>' + esc(t.name) + '</b><small>' + esc(t.right + ' / ' + total) + ' right answers</small></div><div class="bench-form-bar"><div class="bench-track" aria-hidden="true">' + segment('Right', t.right, total, own(t) ? 'tone-own' : 'tone-yes') + segment('Wrong', t.wrong, total, 'tone-no') + segment('Empty', t.empty, total, 'tone-empty') + segment('Not reached', t.notReached, total, 'tone-unknown') + '</div><small>' + esc(t.wrong + ' wrong · ' + t.empty + ' empty · ' + t.notReached + ' not reached') + '</small></div><b class="bench-score">' + esc(t.score) + '%</b></div>';
    }).join('') + legend([['Right', 'tone-yes'], ['Jobadabra right', 'tone-own'], ['Wrong', 'tone-no'], ['Empty', 'tone-empty'], ['Not reached', 'tone-unknown']]) + '</div>';
}

function comparison(id, tools, metrics) {
  const rivals = tools.filter(t => !own(t));
  const picker = '<div class="cmp-controls"><label for="' + id + '-with">Compare with</label><select id="' + id + '-with">' +
    rivals.map(t => '<option value="' + esc(t.key) + '">' + esc(t.name) + '</option>').join('') + '<option value="all">All tools</option></select></div>';
  const attrs = tool => own(tool) ? ' class="us"' : ' data-tool="' + esc(tool.key) + '"';
  const head = '<thead><tr><th scope="col"><span class="sr">Measure</span></th>' +
    tools.map(t => '<th scope="col"' + attrs(t) + '>' + esc(t.name) + '</th>').join('') + '</tr></thead>';
  const body = metrics.map(m => '<tr><th scope="row">' + esc(m.label) + (m.note ? small(m.note) : '') + '</th>' +
    tools.map(t => '<td' + attrs(t) + ' data-label="' + esc(t.name) + '"><span class="ans">' + m.value(t) + '</span></td>').join('') + '</tr>').join('');
  return '<div class="cmp" data-benchmark-compare>' + picker + '<div class="cmp-wrap"><table class="cmp-table"><caption class="sr">' +
    esc(id === 'forms' ? 'Form-filling results' : id === 'search' ? 'Job-search results' : 'Job-search results by persona') +
    '</caption>' + head + '<tbody>' + body + '</tbody></table></div></div>';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; };

/** The page's headings, dates and notes, all computed from the data (owner, 12 Nov 2026: the page shows only what he published; no round's numbers or dates are written in the HTML). */
export function texts(data) {
  const s = data.search, f = data.forms, scored = f.tools.filter(t => t.score != null), ours = scored.find(own), best = scored.find(t => !own(t));
  const lead = ours && best ? (ours.score >= best.score ? [ours, best] : [best, ours]) : scored.slice(0, 2);
  const roles = s.personas.map(p => p.title), judged = s.judgedJobs == null ? '' : '<li><b>' + esc(s.judgedJobs) + '</b><span>distinct jobs judged, deduplicated within each persona</span></li>';
  return {text: {
    searchMeta: 'Job search · ' + (day(s.date) || 'latest round'),
    searchLede: esc(s.personas.length) + ' fictional job seekers, from ' + esc(roles[0] || '') + ' in ' + esc(s.personas[0]?.city || '') + ' to ' + esc(roles.at(-1) || '') + ' in ' + esc(s.personas.at(-1)?.city || '') + '. We judged the kind of work and the location separately.' +
      // Why (13 Nov 2026, owner): from this round Jobadabra runs the app’s own AI tiers; rounds before ran Haiku only, so the two are not comparable. A Haiku round (or the 27 Oct snapshot) says nothing extra.
      (s.ai === 'app' ? ' Jobadabra ran on the app’s own AI tiers (Haiku + Sonnet) in this round; earlier rounds ran Haiku only, so they are not comparable.' : ''),
    searchStats: '<li><b>' + esc(s.personas.length) + '</b><span>fictional roles and cities</span></li>' + judged + '<li><b>' + esc(s.returnedRows) + '</b><span>returned rows; some jobs appeared in several channels</span></li>',
    formsMeta: 'Form filling · fair round · ' + (day(f.date) || '27 Oct 2026'),
    formsTitle: esc(f.tools[0]?.forms ?? '') + ' forms. ' + esc(f.tools.length) + ' tools. Every miss counted.',
    formsLede: lead.length === 2 ? esc(lead[0].name) + ' scored ' + esc(lead[0].score) + '%; ' + esc(lead[1].name) + ' scored ' + esc(lead[1].score) + '%. This is one observed run per tool, with a blind judge and the same Haiku model.' : '',
    links: '<a class="btn btn-ghost" href="/benchmark-results.json" download>Download aggregate data</a>' + (f.runId ? '<a class="btn btn-ghost" href="https://github.com/jobadabra/jobadabra-benchmarks/actions/runs/' + encodeURIComponent(f.runId) + '">Scored form run</a>' : '') + (s.verdictsUrl ? '<a class="btn btn-ghost" href="' + esc(s.verdictsUrl) + '">Search verdicts</a>' : ''),
    formsNote: 'All ' + esc(f.tools.length) + ' contestants ran on CI on the same ' + esc(f.tools[0]?.forms ?? '') + ' unseen forms, with the same fictional applicant. The score includes wrong answers, answerable fields left empty, and questions another tool reached but this run did not. No application was submitted.',
  }};
}

/** Render allowlisted aggregate measurements; source labels are escaped and absent observations stay distinct from zero. */
export function renderResults(data) {
  const s = data.search, f = data.forms;
  const search = searchChart(s.tools) + details('Compare all search measurements', comparison('search', s.tools, [
    {label: 'Returned listings', note: 'Rows saved by this channel', value: t => esc(t.found)},
    {label: 'Right kind of work', note: 'Role yes ÷ returned listings', value: t => counted(t.role, t.found)},
    {label: 'Place yes', note: 'The judge returned “yes” for location', value: t => counted(t.place, t.found)},
    {label: 'Remote', note: 'Separate location verdict; not counted as place yes', value: t => counted(t.remote, t.found)},
    {label: 'Both role and place yes', note: 'Strict intersection of the two verdicts', value: t => counted(t.relevant, t.found)},
    {label: 'Personas with returned rows', note: 'Out of 10; not a successful-run count', value: t => esc(t.observedPersonas + ' / ' + s.personas.length)},
  ]));
  const forms = formChart(f.tools) + details('Compare all form measurements', comparison('forms', f.tools, [
    {label: 'Score', note: 'Right ÷ (right + wrong + empty + not reached)', value: t => '<b class="bench-score">' + esc(t.score) + '%</b>'},
    {label: 'Right answers', value: t => esc(t.right)},
    {label: 'Wrong answers', value: t => esc(t.wrong)},
    {label: 'Empty, but answerable', value: t => esc(t.empty)},
    {label: 'Not reached', note: 'Another tool answered a question this run never saw', value: t => esc(t.notReached)},
    {label: 'Forms / repeats', value: t => esc(t.forms + ' / ' + t.repeats)},
    {label: 'Repeat spread', note: 'One repeat cannot estimate variability', value: t => t.spread ? esc(t.spread.join('–')) + '%' : 'Not estimated'},
  ])) + '<p class="source-note bench-pending">' + (f.productBuild ? 'Tested Jobadabra build <code>' + esc(f.productBuild) + '</code>.' : '') +
    ((f.newerUnjudgedRuns || []).length ? ' The newer post-fix rounds are <b>not scored</b>: captures exist, but judging did not complete. Their outcomes are not included here.' : '') + '</p>' +
    (f.leftOut || []).map(l => '<p class="source-note bench-leftout"><b>Form ' + esc(l.form) + ' not run for ' + esc(l.tools.join(', ')) + (l.why ? ' (' + esc(l.why) + ')' : '') + '.</b> Every score here counts only the ' + esc(f.forms.length) + ' forms all tools ran.</p>').join('');
  const personas = comparison('personas', s.tools, s.personas.map(p => ({
    label: p.title + ' · ' + p.city, note: p.judgedJobs == null ? 'Judged jobs not recorded' : p.judgedJobs + ' distinct pooled jobs judged',
    value: t => p.tools[t.key] ? esc(p.tools[t.key].relevant + ' / ' + p.tools[t.key].found) : '<span title="No returned rows in saved data">Not observed</span>',
  })));
  return {search, forms, personas, ...texts(data)};
}

function pickers(root) {
  for (const box of root.querySelectorAll('[data-benchmark-compare]')) {
    const select = box.querySelector('select'), wide = matchMedia('(min-width: 1001px)');
    let chosen = select.options[0].value;
    const fit = () => {
      const tool = wide.matches ? 'all' : chosen;
      select.value = tool;
      for (const cell of box.querySelectorAll('[data-tool]')) cell.hidden = tool !== 'all' && cell.dataset.tool !== tool;
    };
    select.addEventListener('change', () => { chosen = select.value; fit(); });
    wide.addEventListener('change', fit);
    fit();
  }
}

if (typeof document !== 'undefined') {
  fetch('/benchmark-results.json').then(response => {
    if (!response.ok) throw new Error('Results unavailable');
    return response.json();
  }).then(data => {
    const parts = renderResults(data), {text, ...slots} = parts;
    for (const [key, html] of Object.entries(slots)) document.querySelector('[data-benchmark="' + key + '"]').innerHTML = html;
    for (const [key, html] of Object.entries(text)) document.querySelector('[data-text="' + key + '"]').innerHTML = html;
    pickers(document);
  }).catch(() => {
    for (const slot of document.querySelectorAll('[data-benchmark]')) slot.textContent = 'Results could not load. Please reload, or use the aggregate data link below.';
  });
}
