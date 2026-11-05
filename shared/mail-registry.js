// Who owns each e-mail, and the owner's stop per mail (owner, 5 Nov 2026: "each users sets his own emails"; spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md).
// Three owners: Account (needed to use the product), Yours (the person's own mail about their search: the person decides, the owner has an emergency stop), Jobadabra's (our own news).
// Design: one stored rule per mail the owner pressed (mail_rule). send() asks ruleRefusal() before it claims room. Locked mails never wait for a rule.
// What a failed read means (the lesson of #442): a MISSING table means nothing was pressed; any other error keeps this isolate's last good answer, and with none holds every unlocked mail,
// so a hiccup may send less, never more than the owner chose. A failed read is never cached. Guard: test/unit/shared/mail/mail-registry.test.js.

/** The three owners, in the order Admin shows them. */
export const OWNERS = [
  {id: 'account', name: 'Account', says: 'Needed to use the product: they go when the person asks for them.'},
  {id: 'yours', name: 'Yours', says: "The person's own mail about their search. They decide; the stop here is for a broken mail."},
  {id: 'jobadabra', name: "Jobadabra's", says: 'Our own news. You decide; the person ticks it.'},
];

/** Every template of shared/mail-templates.js, with its owner. `locked`: no stop, because the person asked for it (a test fails if a template is missing here). */
export const MAILS = [
  {id: 'account-code', owner: 'account', name: 'Sign-in code', when: 'the person asks to sign in', locked: true},
  {id: 'welcome', owner: 'account', name: 'Confirm your address', when: 'the person gives an address', locked: true},
  {id: 'confirm-resend', owner: 'account', name: 'Confirm link, again', when: 'the person asks for it again', locked: true},
  {id: 'feedback-update', owner: 'account', name: 'About your feedback', when: 'a report the person sent changes'},
  {id: 'always-on-test', owner: 'account', name: 'Always on test', when: 'the person presses Test'},
  {id: 'message', owner: 'yours', name: 'Messages from the app', when: 'the app or their GitHub sends one: matches, interviews, a finished job'},
  {id: 'digest', owner: 'yours', name: 'New matches from our servers', when: 'a search on our servers finds new jobs, at most once every 4 hours'},
  {id: 'always-on-paused', owner: 'yours', name: 'Always on paused', when: 'searches on our servers pause'},
  {id: 'release', owner: 'jobadabra', name: "What's new", when: 'you press send on a release'},
  {id: 'pro-launch', owner: 'jobadabra', name: 'Pro is out', when: 'you press send'},
  {id: 'trial-left', owner: 'jobadabra', name: 'Trial reminder', when: 'a trial is near its end; also needs TRIAL_REMINDERS'},
  {id: 'trial-ending', owner: 'jobadabra', name: 'Trial ends', when: 'a trial ends; also needs TRIAL_REMINDERS'},
];
const BY_ID = new Map(MAILS.map(mail => [mail.id, mail]));
export const mailOf = id => BY_ID.get(id) || null;

const TTL = 5000;   // as the switches: a press in another Worker copy reaches this one within ~5 s
const EMPTY = {off: {}, at: {}, held: false};
const HELD = {off: {}, at: {}, held: true};
let slot = null;   // {read, value}: the last good answer of this isolate (one slot, not per binding: see shared/mail-switches.js)

/** Forgets the cached answer (a press, and tests). */
export const resetRuleCache = () => { slot = null; };
const missingTable = error => /no such table/i.test(String(error?.message || error));

/** The owner's stops: {off: {id: true}, at: {id: iso}, held}. `held`: the read failed with no good answer, so every unlocked mail waits. */
export async function storedRules(env, {fresh = false, now = Date.now()} = {}) {
  if (!env.STATS) return EMPTY;
  if (slot && !fresh && now - slot.read < TTL) return slot.value;
  let rows;
  try { rows = (await env.STATS.prepare('SELECT id, enabled, at FROM mail_rule').all()).results || []; } catch (error) {
    if (missingTable(error)) { slot = {read: now, value: EMPTY}; return EMPTY; }
    return slot?.value || HELD;   // not cached: the next call tries again
  }
  const value = {off: {}, at: {}, held: false};
  for (const row of rows) if (BY_ID.has(row.id) && !BY_ID.get(row.id).locked) { if (!Number(row.enabled)) value.off[row.id] = true; value.at[row.id] = row.at; }
  slot = {read: now, value};
  return value;
}

/** Why the owner's rule holds this template back: 'rule_off' (stopped), 'rule_held' (the rules could not be read), or '' to go on. Never throws. */
export async function ruleRefusal(env, id) {
  const mail = mailOf(id);
  if (!mail || mail.locked) return '';
  const rules = await storedRules(env);
  return rules.held ? 'rule_held' : rules.off[id] ? 'rule_off' : '';
}

/** Stores a press; false for an unknown or locked mail. Throws if the table cannot be written (the caller says so). */
export async function setRule(env, id, on, now = new Date()) {
  const mail = mailOf(id);
  if (!mail || mail.locked) return false;
  await env.STATS.prepare('INSERT INTO mail_rule (id, enabled, at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, at = excluded.at').bind(id, on ? 1 : 0, now.toISOString()).run();
  resetRuleCache();
  return true;
}

/** What Admin shows: each mail with its owner, whether it goes, when it was pressed, and whether the rules could not be read. */
export async function ruleRows(env) {
  const {off, at, held} = await storedRules(env, {fresh: true});
  return MAILS.map(mail => ({...mail, on: mail.locked || (!held && !off[mail.id]), held: held && !mail.locked, at: at[mail.id] || ''}));
}
