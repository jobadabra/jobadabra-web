// AI credit held by an install (owner, 26 Oct 2026: credit promo codes give "AI credit only", the plan stays Free): the balance, adding a code's euros, and spending
// one AI call from it. The ledger rows go to pro_credit (append-only, as accounts), under 'install:' + the install's digest, never the raw id.
// Served by the credit lane (shared/pro-ai.js proLane) while it lasts; then the Free rules apply again. Guard: test/unit/shared/promo-credit.test.js.
import {digestOf} from './guard.js';
import {rawToCredit} from './pro-packages.js';

const ledgerKey = async install => `install:${(await digestOf(install)).slice(0, 16)}`;

// -> {credit_micro, credit_added_micro} or null (never had any).
export async function installCredit(env, install) {
  if (!env.STATS || !install) return null;
  return (await env.STATS.prepare('SELECT credit_micro, credit_added_micro FROM install_credit WHERE install = ?').bind(install).first().catch(() => null)) || null;
}

// A credit code's euros (micro-credit-euros), with its ledger row.
export async function addInstallCredit(env, install, micro, reason, ref, now = new Date()) {
  if (!(micro > 0)) throw new Error('credit must be positive');
  const at = now.toISOString();
  await env.STATS.prepare(`INSERT INTO install_credit (install, credit_micro, credit_added_micro, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(install) DO UPDATE SET credit_micro = MAX(0, credit_micro) + excluded.credit_micro, credit_added_micro = credit_added_micro + excluded.credit_added_micro, updated_at = excluded.updated_at`)
    .bind(install, micro, micro, at).run();
  await env.STATS.prepare('INSERT INTO pro_credit (account, delta_micro, reason, ref, at) VALUES (?, ?, ?, ?, ?)').bind(await ledgerKey(install), micro, reason, ref || null, at).run();
}

// One AI call's raw cost (micro-USD) at our price list, as shared/pro.js spend does for an account. May dip just below 0: the next call takes the Free rules.
export async function spendInstallCredit(env, install, rawMicro, ref, now = new Date()) {
  const micro = rawToCredit(rawMicro);
  if (!(micro > 0)) return;
  await env.STATS.prepare('UPDATE install_credit SET credit_micro = credit_micro - ?, updated_at = ? WHERE install = ?').bind(micro, now.toISOString(), install).run();
  await env.STATS.prepare('INSERT INTO pro_credit (account, delta_micro, reason, ref, at) VALUES (?, ?, ?, ?, ?)').bind(await ledgerKey(install), -micro, 'ai_call', ref || null, now.toISOString()).run();
}
