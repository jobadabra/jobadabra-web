// The Lab Job Search page's shared bits (owner, 18 Oct 2026): the three time names every tab uses, the tone colours, the median, and the coloured lead tiles Real installs draws.
// The per-candidate cards, health bar, sparklines and stats strip belonged to the old 6-recording replay and went with it (owner, 10 Nov 2026: "retire it"). Guard: test/unit/admin/search/search-lab-real.test.js.
// One name for each time, used on every screen of the Lab (owner, 18 Oct 2026: "Time to first job" is the number he watches).
export const TIME_NAMES = {first_s: 'Time to first job', tenth_s: 'Time to 10th job', fit_s: 'Time to first 70+ job'};
export const TONE_COLOR = {good: '#4cc38a', bad: '#ff6b6b', wait: '#f0b44c', info: '#5aa9ff', mute: '#6b7480'};
export const median = list => { const sorted = list.filter(value => value != null).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };

export const VISUALS_CSS = `.lv-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px}
.lv-tile{border-top:3px solid var(--tone)}.lv-tile b{display:block;font-size:30px;margin:4px 0;color:var(--tone)}
.lv-lead span{display:block}.lv-lead b{font-size:44px}.lv-leads{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}`;
