// The Pro lane of Free AI (spec docs/superpowers/specs/2026-10-16-pro-plan.md §3): an install on a Pro account with credit runs in its own lane, immune to the
// global Free AI daily stop and the per-install caps (only the rate limit applies), and each call's cost is taken from the account's credit.
// Credit used up (past the small overdraft): no free fallback, the answer says top-up or own key. Own-key AI never reaches this route. Guard: test/unit/shared/pro-credit.test.js.
import {OVERDRAFT_MICRO, accountOf, planOn, promoOn, spend} from './pro.js';
import {installCredit, spendInstallCredit} from './install-credit.js';

export const PRO_PER_MINUTE = 50;   // the only brake in the Pro lane (owner, 16 Oct 2026)
export const CREDIT_OUT = 'Your AI credit is used up. Add credit, or use your own Claude or ChatGPT key in Settings → Connections → AI (your own key is unlimited).';

// -> null (the Free rules), {blocked: message} (a Pro account's credit gone), {account} (the Pro lane) or {install} (credit from a credit code, shared/install-credit.js).
export async function proLane(env, install) {
  if (!install) return null;   // a founder/friend key (JP1.) has no install: the Free rules
  if (planOn(env)) {
    const account = await accountOf(env, install);
    if (account && account.status === 'active' && account.plan === 'pro') {   // a trial account has the Free rules (or its install credit, below)
      // Pro without AI (the €9 package) never had credit: our AI is not part of it, so no overdraft either; top-up, upgrade or own key.
      const out = account.credit_added_micro <= 0 || account.credit_micro <= -OVERDRAFT_MICRO;
      if (!out) return {account};
      if (!((await installCredit(env, install))?.credit_micro > 0)) return {blocked: CREDIT_OUT};
    }
  }
  // Credit from a credit code (owner, 26 Oct 2026: "AI credit only"): the same lane while it lasts, also while paying is off; used up -> the Free rules again.
  return promoOn(env) && (await installCredit(env, install))?.credit_micro > 0 ? {install} : null;
}

// The call's own cost (micro-USD, the figure ai_calls records) from the credit; nothing for the Free rules.
export const chargeCall = (env, lane, micro, action, now) => (lane?.account ? spend(env, lane.account.id, micro, action || 'other', now)
  : lane?.install ? spendInstallCredit(env, lane.install, micro, action || 'other', now) : null);
