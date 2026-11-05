// AI-credit promo codes (owner, 26 Oct 2026): a code of kind 'credit' adds its euros of AI credit to the Pro install that redeems it (Pro only, owner 27 Oct 2026; shared/promo.js), once per install per code, up to
// its people cap and end date; different credit codes stack. The plan stays as it was (owner's yes, 26 Oct 2026: "AI credit only"). The credit is the install's
// (shared/install-credit.js), so no e-mail or account is needed. Redeemed through POST /api/pro/redeem (shared/promo.js). Guard: test/unit/shared/promo-credit.test.js.
import {addInstallCredit} from './install-credit.js';

export const KINDS = ['pro', 'credit'];
export const MAX_CREDIT_EUR = 100;   // one code's euros per install; the admin form refuses more
export const creditMicro = code => Math.round(Number(code.credit_eur) * 1_000_000);
const changed = result => (result?.meta?.changes ?? result?.changes ?? 0) > 0;

// -> {ok: true, credit: euros} | {ok: true, already: true, credit: euros} | {ok: false, error: 'used_up'}. The code is already checked live (not revoked, not past its end).
export async function redeemCredit(env, install, code, now = new Date()) {
  const credit = Number(code.credit_eur);
  const made = await env.STATS.prepare('INSERT OR IGNORE INTO pro_promo_credit_uses (code, install, at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM pro_promo_credit_uses WHERE code = ?) < ?')
    .bind(code.id, install, now.toISOString(), code.id, code.cap).run();
  if (!changed(made)) {
    const mine = await env.STATS.prepare('SELECT 1 AS n FROM pro_promo_credit_uses WHERE code = ? AND install = ?').bind(code.id, install).first();
    return mine ? {ok: true, already: true, credit} : {ok: false, error: 'used_up'};
  }
  await addInstallCredit(env, install, creditMicro(code), 'promo', code.id, now);
  return {ok: true, credit};
}
