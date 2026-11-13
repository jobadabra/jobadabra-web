// Which AI ran OUR job search in a benchmark round (owner, 13 Nov 2026, via the coordinator: "a 'which AI' column on the published rounds ... and a 'before / after the switch' mark on the job-search charts").
// Why (13 Nov 2026, jobadabra-benchmarks #31): from that change ours runs the app's own tiers (small Haiku + main Sonnet through the broker) while rivals are unchanged, so rounds before and after cannot be
// compared. Every row stored before has no value: it ran Haiku only, so no value reads as 'haiku'. Pure; guard: test/unit/admin/benchmark/benchmark-ai.test.js.
export const AIS = {haiku: {short: 'Haiku', label: 'Haiku only', arrow: 'Haiku'}, app: {short: 'App tiers', label: 'the app’s own tiers (Haiku + Sonnet)', arrow: 'app tiers'}};
/** The AI a stored or sent value names: 'app', else 'haiku' (no value, '' or any other word = what every earlier round used). */
export const aiOf = value => (value === 'app' ? 'app' : 'haiku');
/** What a stored column holds: 'app' or 'haiku' when said, '' when not said. */
export const stored = value => (value === 'app' || value === 'haiku' ? value : '');
/** rounds = {key: {ai}} -> where the AI differs from the round before: [{round, index, from, to}], index = the round's place in key order. */
export function changes(rounds) {
  const keys = Object.keys(rounds || {}).sort(), out = [];
  keys.forEach((round, index) => { const from = index ? aiOf(rounds[keys[index - 1]].ai) : null, to = aiOf(rounds[round].ai); if (from && from !== to) out.push({round, index, from, to}); });
  return out;
}
export const changeText = ({round, from, to}) => `AI changed ${round}: ${AIS[from].arrow} → ${AIS[to].arrow}, not comparable`;
