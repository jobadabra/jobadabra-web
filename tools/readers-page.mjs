// Draws the AI-step table of /how-it-works (#ai-reads; /about-you was folded in there, 12 Nov 2026) from the public repo's docs/about-you-readers.json
// (live steps only); run it again whenever a step ships.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const MARK = ['<!-- readers:start -->', '<!-- readers:end -->'];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/**
 * The table for the live steps of the public export. Invariant: a step is drawn only when the export says live, and a part is marked read only when
 * it is in that step's `through` (the public test checks the export against the app's code), so this page cannot claim more than the app does.
 */
export function readersTable(data) {
  const live = data.readers.filter(reader => reader.live);
  if (!live.length) throw new Error('No live step in the export');
  const parts = data.parts.filter(part => live.some(reader => reader.through.includes(part.key) || reader.pages.includes(part.key)));   // a column only for a part a live step reads or is built to read
  const head = '<tr><th scope="col">AI step</th>' + parts.map(part => `<th scope="col">${esc(part.label)}</th>`).join('') + '<th scope="col">Never reads</th></tr>';
  const rows = live.map(reader => `<tr data-step="${esc(reader.key)}"><th scope="row">${esc(reader.label)}</th>` + parts.map(part => {
    const read = reader.through.includes(part.key);
    return `<td data-label="${esc(part.label)}"><span class="rd-dot${read ? ' on' : ''}" role="img" aria-label="${read ? 'Reads' : 'Does not read'} ${esc(part.label)}"></span></td>`;
  }).join('') + `<td data-label="Never reads" class="rd-never">${esc(reader.never.join(', ') || 'Nothing is held back')}</td></tr>`).join('\n');
  return `<table class="rd-table"><thead>${head}</thead><tbody>\n${rows}\n</tbody></table>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, page] = process.argv.slice(2);
  if (!source || !page) throw new Error('Usage: readers-page.mjs <about-you-readers.json> website/public/how-it-works.html');
  const html = fs.readFileSync(page, 'utf8');
  const [from, to] = MARK.map(mark => html.indexOf(mark));
  if (from < 0 || to < from) throw new Error('The page has no readers markers');
  const table = readersTable(JSON.parse(fs.readFileSync(source, 'utf8')));
  fs.writeFileSync(page, html.slice(0, from + MARK[0].length) + '\n' + table + '\n' + html.slice(to));
  console.log('readers page: table drawn');
}
