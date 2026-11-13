// The round pickers of the two Benchmark pages (owner, 13 Nov 2026: "it preselected the oldest", "too many chips", "it should be a dropdown", "a date picker, but not chips"):
// a dropdown of the full rounds by date and time, newest first and preselected, and a second small "Test runs by sessions" dropdown for the rest. The link stays `?round=<key>`. Guard: test/unit/admin/benchmark/benchmark-rounds.test.js.
import {esc} from '../shared/html.js';

// Why (13 Nov 2026, owner: "I don't understand why I don't see the latest round in this dropdown", then "Full rounds by date + time (Recommended)"): what a round IS comes from its data, never from its key.
// The key's shape decided before (#612: a plain date = real round), so a second full round on one day, which must take a suffix so it never overwrites the public one, landed among the test runs
// (2026-11-13-evening, 262 relevant jobs, was one of 34 "side checks"). A full round has a rival's rows (a tool that is not ours) for the widest set of people any round has; every other round is a test run.
// Measured on the 42 rounds stored on 13 Nov 2026: 10 full ones (10 people, 2 to 5 tools), 32 test runs (ours alone, 1 to 10 people): no round is in doubt.
/** A round's view -> whether it is a full round: some tool that is not ours, and as many people as the widest round. */
export const isFullRound = (view, widest) => (view?.tools || []).some(tool => !tool.ours) && (view?.personas || []).length >= widest;
const timeOf = (key, view) => view?.at || key;
const newestFirst = rounds => (a, b) => timeOf(b, rounds[b]).localeCompare(timeOf(a, rounds[a])) || b.localeCompare(a);
/** The time a round is listed by: its newest row's time, as "2026-11-13 17:16 UTC"; a snapshot built before rounds carried it falls back to the key. */
export const clockOf = (key, view) => (view?.at ? `${view.at.slice(0, 10)} ${view.at.slice(11, 16)} UTC` : key);

/** rounds = {key: view} -> {real, side, current}: real = full rounds, side = test runs, both newest first by their own time; current = the asked key if it exists, else the newest full round, else the newest key, else null. */
export function roundChoices(rounds = {}, asked) {
  const keys = Object.keys(rounds), widest = Math.max(0, ...keys.map(key => (rounds[key]?.personas || []).length));
  const order = newestFirst(rounds), real = keys.filter(key => isFullRound(rounds[key], widest)).sort(order), side = keys.filter(key => !real.includes(key)).sort(order);
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
  return `<div class="round-picks">${real.length ? select({label: 'Round', placeholder: 'Pick a round', groups: [['', real]], current}) : ''}${side.length ? select({label: `Test runs by sessions (${side.length})`, placeholder: 'Pick a test run', groups: [...byDate], current}) : ''}</div>`;
}

export const ROUND_STYLE = `.round-picks{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;margin:8px 0 14px}.round-pick label{display:flex;align-items:center;gap:8px;font-size:13px}.round-pick select{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:0 10px;height:34px;font:inherit;font-size:13px;max-width:100%}.round-pick select:focus-visible{outline:2px solid var(--amber);outline-offset:1px}`;
