// The Pro packages as data (private spec jobadabra-lab:docs/specs/2026-10-16-pro-plan.md, owner 24 Oct 2026: "I agree."): Pro €9 (no AI credit), Pro + AI €19 (€29 list price, €10 credit),
// the €10 upgrade between them and the €5 / €10 / €20 top-ups. One place for what each purchase grants, shows and who may buy it; the checkout, the webhook and /api/pro/status read it.
// Guards: test/unit/shared/pro/pro-packages.test.js, test/unit/shared/pro/pro-stripe.test.js.
// Credit is in micro-credit-euros: €1 of credit = €1 at OUR AI prices = CREDIT_PER_COST × our raw cost (in euros) (owner, 24 Oct 2026: "€10 credit, but it still should worth the same $5").
// Grants follow what people pay (top-up €5 → €5); the meter debits raw micro-USD × CREDIT_PER_COST (shared/pro.js spend). Shown to people as a bar, and as these euro amounts in the offers.
export const CREDIT_PER_COST = 2;
// Our AI cost is billed in USD, the credit is in euros: €1 of credit = €0.50 of REAL cost in euros (owner, 24 Oct 2026: "for every 10e AI credit user is seeing that he gets, our real cost should be half = 5e").
// Rate set by hand: 1 EUR = 1.16 USD, the approximate market rate on 24 Oct 2026 (no live FX call; update it here when it drifts, the guard test shows what a grant costs us).
export const USD_PER_EUR = 1.16;
export const rawToCredit = rawMicroUsd => Math.round(rawMicroUsd / USD_PER_EUR * CREDIT_PER_COST);   // micro-USD of raw cost -> micro-credit-euros
export const CREDIT = {pro: 0, 'pro-ai': 10_000_000, upgrade: 10_000_000, topup5: 5_000_000, topup10: 10_000_000, topup20: 20_000_000};
export const creditEur = kind => CREDIT[kind] / 1_000_000;   // the whole euros a purchase adds: the number every public text names
export const PRO_KINDS = ['pro', 'pro-ai'];   // the purchases that make an account Pro
const offer = (id, name, price, credit, list = null) => ({id, name, price, list, currency: 'EUR', credit, creditEur: creditEur(id)});
// What the app and the pricing page show (VAT included, the price paid); the provider's dashboard holds the matching prices (ids as Worker vars).
export const OFFERS = [offer('pro', 'Pro', '9', false), offer('pro-ai', 'Pro + AI', '19', true, '29'), offer('upgrade', 'Upgrade to Pro + AI', '10', true),
  offer('topup5', 'AI credit', '5', true), offer('topup10', 'AI credit', '10', true), offer('topup20', 'AI credit', '20', true)];

// 'pro-ai' once a Pro + AI or an upgrade is paid (and not refunded), else 'pro'.
export async function packageOf(env, account) {
  const row = await env.STATS.prepare("SELECT 1 AS yes FROM pro_purchases WHERE account = ? AND status = 'paid' AND kind IN ('pro-ai', 'upgrade') LIMIT 1").bind(account.id).first();
  return row ? 'pro-ai' : 'pro';
}

// Why this install's account may not buy `kind` (words for the app), or null. Free installs buy Pro or Pro + AI; Pro accounts buy top-ups, and the upgrade while they have only Pro.
export async function refusal(env, account, kind) {
  const isPro = !!account && account.status === 'active' && account.plan === 'pro';
  if (PRO_KINDS.includes(kind)) return isPro ? 'You already have Pro.' : null;
  if (!isPro) return 'Get Pro first.';
  if (kind === 'upgrade') return await packageOf(env, account) === 'pro' ? null : 'You already have Pro + AI.';
  return null;
}
