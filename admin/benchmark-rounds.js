// The round pickers of the two Benchmark pages (owner, 13 Nov 2026: "it preselected the oldest", "too many chips", "it should be a dropdown", "a date picker, but not chips"):
// a date dropdown of the real rounds, newest first and preselected, and a second small "Side checks" dropdown for the rest. The link stays `?round=<key>`. Guard: test/unit/admin/benchmark/benchmark-rounds.test.js.
import {esc} from '../shared/html.js';

// Why (13 Nov 2026, bp): the data holds no flag for a side check, only the round key. A real round is the plain date of its run (2026-11-13); a check run beside it adds a suffix
// (-sonnet-1, -diag-1, -p3956-main, -full…), so the key's shape is the one place that tells them apart. A string sort put "2026-11-13-sonnet-1" after "2026-11-13" and the page opened on it.
export const isRealRound = key => /^\d{4}-\d{2}-\d{2}$/.test(key);
const newestFirst = (a, b) => b.localeCompare(a);

/** keys → {real, side, current}: real = plain dates, newest first; side = the rest, newest first; current = the asked key if it exists, else the newest real round, else the newest key, else null. */
export function roundChoices(keys, asked) {
  const real = keys.filter(isRealRound).sort(newestFirst), side = keys.filter(key => !isRealRound(key)).sort(newestFirst);
  return {real, side, current: keys.includes(asked) ? asked : real[0] ?? side[0] ?? null};
}

const select = ({label, placeholder, groups, current}) => {
  const open = groups.some(([, items]) => items.some(([key]) => key === current));
  const option = ([key, text]) => `<option value="${esc(key)}"${key === current ? ' selected' : ''}>${esc(text)}</option>`;
  const body = groups.map(([name, items]) => (name ? `<optgroup label="${esc(name)}">${items.map(option).join('')}</optgroup>` : items.map(option).join(''))).join('');
  return `<form method="get" class="round-pick"><label><span class="muted">${esc(label)}</span> <select name="round" aria-label="${esc(label)}" onchange="this.form.submit()">${open ? '' : `<option value="" selected disabled>${esc(placeholder)}</option>`}${body}</select></label><noscript> <button>Open</button></noscript></form>`;
};

/**
 * The two dropdowns. real / side = [[key, text]]; side items group by the date in front of the key. `current` is selected in whichever list holds it.
 * Nothing is listed when there is only one round to see.
 */
export function roundPicker({real, side = [], current}) {
  if (real.length + side.length < 2) return '';
  const byDate = new Map();
  for (const item of side) byDate.set(item[0].slice(0, 10), [...(byDate.get(item[0].slice(0, 10)) || []), item]);
  return `<div class="round-picks">${real.length ? select({label: 'Round', placeholder: 'Pick a round', groups: [['', real]], current}) : ''}${side.length ? select({label: `Side checks (${side.length})`, placeholder: 'Pick a side check', groups: [...byDate], current}) : ''}</div>`;
}

export const ROUND_STYLE = `.round-picks{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;margin:8px 0 14px}.round-pick label{display:flex;align-items:center;gap:8px;font-size:13px}.round-pick select{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:0 10px;height:34px;font:inherit;font-size:13px;max-width:100%}.round-pick select:focus-visible{outline:2px solid var(--amber);outline-offset:1px}`;
