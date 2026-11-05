// The four mail switches and who owns their state (owner, 5 Nov 2026: "be actual switches that I can turn on or off").
// Design: a switch has one stored state per name (mail_switch, written only by the owner's press in Admin → E-mail). withSwitches() lays those states over the Worker env at the start of each request and
// job, so every existing check (`env.MARKETING_MAIL !== 'on'` and the rest) reads the pressed state with no change. A pressed state beats the wrangler.toml value until it is pressed back.
// What a failed read means (review of this change): a MISSING table (the migration only warns in CI) leaves the deployed values, since nobody has pressed anything. Any other read error keeps the last good
// answer this isolate had, and with none holds every switch OFF: a hiccup may send less, never more than the owner pressed. A failed read is never cached. Guard: test/unit/shared/mail/mail-switches.test.js.

/** The switches, in the order Admin shows them. `ask`: pressing it on needs a second confirmation, because it lets mail leave. */
export const SWITCHES = [
  {name: 'MAIL', says: 'Any mail at all', ask: true},
  {name: 'MARKETING_MAIL', says: 'Release news and the Pro launch offer', ask: true},
  {name: 'TRIAL_REMINDERS', says: 'Trial reminders (off since 17 Oct 2026)', ask: true},
  {name: 'MAIL_LAUNCH', says: 'The Pro launch send button', ask: true},
];
export const NAMES = SWITCHES.map(one => one.name);

const TTL = 5000;   // Why (5 Nov 2026): a press in another Worker copy reaches this one within ~5 s, and a busy minute costs one small read per copy, not one per request
const EMPTY = {states: {}, at: {}, held: false};
const HELD = {states: Object.fromEntries(NAMES.map(name => [name, 'off'])), at: {}, held: true};
// One slot per isolate, not per binding: a press goes through a metered copy of env.STATS, so a cache keyed by the binding object would never be cleared by it (review of this change).
let slot = null;   // {read, value}: the last good answer

/** Forgets the cached answer (a press, and tests). */
export const resetSwitchCache = () => { slot = null; };

const missingTable = error => /no such table/i.test(String(error?.message || error));

/** The pressed states: {states: {NAME: 'on' | 'off'}, at: {NAME: iso}, held}. `held`: the read failed and every switch is held off. */
export async function storedSwitches(env, {fresh = false, now = Date.now()} = {}) {
  if (!env.STATS) return EMPTY;
  if (slot && !fresh && now - slot.read < TTL) return slot.value;
  let rows;
  try { rows = (await env.STATS.prepare('SELECT name, state, at FROM mail_switch').all()).results || []; } catch (error) {
    if (missingTable(error)) { slot = {read: now, value: EMPTY}; return EMPTY; }
    return slot?.value || HELD;   // not cached: the next call tries again
  }
  const value = {states: {}, at: {}, held: false};
  for (const row of rows) if (NAMES.includes(row.name) && (row.state === 'on' || row.state === 'off')) { value.states[row.name] = row.state; value.at[row.name] = row.at; }
  slot = {read: now, value};
  return value;
}

/** `env` with the owner's pressed states laid over the deployed values; DEPLOYED_SWITCHES keeps what wrangler.toml said, for the card. */
export async function withSwitches(env) {
  const {states} = await storedSwitches(env);
  return Object.keys(states).length ? {...env, ...states, DEPLOYED_SWITCHES: Object.fromEntries(NAMES.map(name => [name, env.DEPLOYED_SWITCHES?.[name] ?? env[name]]))} : env;
}

/** Stores a press; false for a name that is not a switch. Throws if the table cannot be written (the caller says so). */
export async function setSwitch(env, name, on, now = new Date()) {
  if (!NAMES.includes(name)) return false;
  await env.STATS.prepare('INSERT OR REPLACE INTO mail_switch (name, state, at) VALUES (?, ?, ?)').bind(name, on ? 'on' : 'off', now.toISOString()).run();
  resetSwitchCache();
  return true;
}

/** What Admin shows: each switch with its effective state, whether the owner pressed it (and when), what the deploy says, and whether the stored state could not be read. */
export async function switchRows(env) {
  const {states, at, held} = await storedSwitches(env, {fresh: true});
  return SWITCHES.map(one => {
    const deployed = env.DEPLOYED_SWITCHES?.[one.name] ?? env[one.name];
    return {...one, on: (states[one.name] ?? deployed) === 'on', pressed: !!states[one.name] && !held, held, at: at[one.name] || '', deployed: deployed === 'on' ? 'on' : 'off'};
  });
}
