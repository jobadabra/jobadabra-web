// The search robot's alarm (owner, 26 Oct 2026: "What we need more to be able to catch all of the app problems automatically, including this search problem";
// sketch https://claude.ai/artifact/5PjZZy6TyTBNQZYB6PaofR): a search below its floor files a GitHub issue in the app repo, in the Finder's title style and labels
// ("[auto-search] <role> · <place> · <path>: <what>", fp:<fingerprint>), with its funnel. One issue per field × place × path: a later sighting is a dated comment on it, a
// later draw of the same three that passes closes it. Used by the daily draw (draw-alarm.mjs) and the real installs' check (real-alarm.mjs). Counts and fixed words only.
// Guard: test/jobs/search-alarm.test.js.
import {execFileSync} from 'node:child_process';
import {PUBLIC_REPO} from '../../shared/repos.js';

export const REPO = PUBLIC_REPO, LABEL = 'auto-search';
const PATH_WORDS = {first: 'first search', 'field-change': 'field change, 2nd search', again: 'same search again', real: 'real installs, latest search'};
const slug = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'any';
const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));

// A case: {source: 'random-draw'|'real-installs', field (a role kind), role?, place_kind?, place, path, engine?, date, severity, why: [...], counts: {...}, funnel?: {...}, run?}
export const fingerprint = c => `search-${slug(c.field)}-${c.place_kind === 'remote' ? 'remote' : slug(c.place)}-${slug(c.path || 'first')}`;
export const placeWords = c => (c.place_kind === 'remote' ? `remote (${c.place})` : c.place);
export function title(c) {
  const what = c.why.some(reason => reason.startsWith('a step crashed')) ? 'the search crashed' : c.why.some(reason => reason.startsWith('0 relevant')) ? '0 relevant jobs' : 'few relevant jobs';
  return `[${LABEL}] ${c.role || c.field} · ${placeWords(c)} · ${PATH_WORDS[c.path] || c.path}: ${what}`;
}
export const labels = c => [LABEL, 'kind:search-gap', `source:${c.source}`, `severity:${c.severity || 'medium'}`, `path:${c.path || 'first'}`, `field:${slug(c.field)}`,
  ...(c.engine ? [`engine:${c.engine}`] : []), `fp:${fingerprint(c)}`];

const FUNNEL_ROWS = [['Employers picked', f => (f.employers_picked == null ? null : `${num(f.employers_picked)} of ${num(f.employers_in_places)}`)],
  ['… for the kinds', f => (f.kinds?.length ? f.kinds.join(', ') : null)], ['Employer sites read', f => f.employer_sites_read], ['Job boards read', f => f.boards_read],
  ['Board jobs · relevant', f => `${num(f.board_jobs)} · ${num(f.board_relevant)}`], ['Web searches · sources found', f => `${num(f.web_searches)} · ${num(f.web_found)}`],
  ['Jobs listed', f => f.looked], ['Title matches', f => f.matches], ['AI calls Free AI refused (caps, errors, web search off)', f => f.ai_refused]];

export function body(c) {
  const lines = [`**Below the floor:** ${c.why.join('; ')}.`, '',
    `${c.source === 'random-draw' ? 'Random draw' : 'Real installs'} ${c.date}${c.engine ? ` · engine ${c.engine}` : ''}${c.run ? ` · [run](${c.run})` : ''}`, '',
    '| Funnel | Count |', '|---|---|'];
  for (const [name, read] of c.funnel ? FUNNEL_ROWS : []) { const value = read(c.funnel); if (value != null) lines.push(`| ${name} | ${typeof value === 'number' ? num(value) : value} |`); }
  for (const [name, value] of Object.entries(c.counts || {})) lines.push(`| ${name} | ${num(value)} |`);
  lines.push('', c.source === 'random-draw'
    ? `Re-run: Actions → "CI · Random draw", seed \`${c.date}\`${c.role ? `, role \`${c.role}\`` : ''}. A fictional CV on a throwaway install; a site that refuses a data-centre address is "not reached".`
    : 'Counts from installs with Technical reports on, 3 or more installs (k ≥ 3); no person, CV or job title.',
  '', `One issue per field × place × path (\`fp:${fingerprint(c)}\`): a later sighting is a comment here; a passing one closes it. Filed by jobs/persona-search/search-alarm.mjs.`);
  return lines.join('\n');
}

const gh = (args, run = execFileSync) => run('gh', args, {encoding: 'utf8'}).trim();

// Files, updates or closes the case's issue. -> 'filed #n' | 'seen again #n' | 'closed #n' | 'nothing'. `pass`: the case passed (close an open one). `run(cmd, args)` is for tests.
export function act(c, {pass = false, repo = REPO, run} = {}) {
  const fp = fingerprint(c);
  const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', `fp:${fp}`, '--json', 'number', '--limit', '1'], run) || '[]')[0];
  if (pass) {
    if (!open) return 'nothing';
    gh(['issue', 'close', String(open.number), '--repo', repo, '--reason', 'completed', '--comment', `A ${c.source === 'random-draw' ? 'draw' : 'check'} of the same field × place × path passed on ${c.date}${c.run ? ` ([run](${c.run}))` : ''}.`], run);
    return `closed #${open.number}`;
  }
  if (open) {
    gh(['issue', 'comment', String(open.number), '--repo', repo, '--body', `Seen again ${c.date}${c.role ? ` (${c.role})` : ''}: ${c.why.join('; ')}.${c.run ? ` [run](${c.run})` : ''}`], run);
    return `seen again #${open.number}`;
  }
  for (const label of labels(c)) gh(['label', 'create', label, '--repo', repo, '--force', '--color', label.startsWith('severity:high') ? 'D93F0B' : 'BFD4F2', '--description', 'The search robot (jobs/persona-search/search-alarm.mjs)'], run);
  const url = gh(['issue', 'create', '--repo', repo, '--title', title(c), '--body', body(c), ...labels(c).flatMap(label => ['--label', label])], run);
  return `filed #${url.split('/').pop()}`;
}
