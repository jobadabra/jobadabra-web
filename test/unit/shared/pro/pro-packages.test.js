// The Pro packages as data (shared/pro-packages.js): every offer has a credit rule and a provider price var, prices are euros, and the list price sits only on Pro + AI. Fails when an offer is added without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CREDIT, CREDIT_PER_COST, OFFERS, USD_PER_EUR, creditEur, rawToCredit} from '../../../../shared/pro-packages.js';
import {createCheckout} from '../../../../api/payments/stripe.js';

test('every offer: a credit rule, a Stripe price var in the Worker config, euros, and the credit flag matches the credit', async () => {
  const config = readFileSync(new URL('../../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  assert.deepEqual(OFFERS.map(o => o.id), Object.keys(CREDIT), 'one credit rule per offer, same order');
  for (const offer of OFFERS) {
    assert.equal(offer.currency, 'EUR', offer.id);
    assert.equal(offer.credit, CREDIT[offer.id] > 0, `${offer.id}: the flag follows the credit`);
    const env = {STRIPE_SECRET_KEY: 'sk_test_x', PRO_PLAN: 'test'}, seen = [];
    for (const name of Object.keys(await varsOf(config))) env[name] = `price_${name}`;
    const made = await createCheckout(env, {kind: offer.id, install: 'i', successUrl: 'https://x/ok', cancelUrl: 'https://x/no'}, async (url, init) => { seen.push(new URLSearchParams(init.body).get('line_items[0][price]')); return Response.json({url: 'https://c'}); });
    assert.ok(made.url && seen[0], `${offer.id} has a price var declared in wrangler.toml`);
  }
  assert.deepEqual(OFFERS.filter(o => o.list).map(o => [o.id, o.list]), [['pro-ai', '29']], 'the struck-through price belongs to Pro + AI only');
  assert.deepEqual(OFFERS.slice(0, 3).map(o => o.price), ['9', '19', '10']);
});

// The STRIPE_PRICE_* names declared in the Worker config.
const varsOf = async text => Object.fromEntries([...text.matchAll(/^(STRIPE_PRICE_[A-Z0-9_]+)\s*=/gm)].map(m => [m[1], 1]));

test('api/pro-pay.js still names the top-up credits the older app test greps for, and they are the real ones', () => {
  const text = readFileSync(new URL('../../../../api/pro-pay.js', import.meta.url), 'utf8');
  for (const kind of ['topup5', 'topup10', 'topup20']) assert.ok(text.includes(`${kind}: ${String(CREDIT[kind]).replace(/\B(?=(\d{3})+$)/g, '_')}`), kind);
});

// The class rule (owner, 24 Oct 2026): a public text that names a credit amount names one the constants grant, and none still says dollars or "about €5".
const PUBLIC_PAGES = ['pricing.html', 'faq.html', 'terms.html', 'index.html', 'compare.html', 'privacy.html'];
test('every public text that names an AI credit amount names a granted one (€10, or a top-up it adds), never dollars', () => {
  const granted = new Set(Object.keys(CREDIT).filter(kind => CREDIT[kind] > 0).map(creditEur));
  const seen = [];
  for (const page of PUBLIC_PAGES) {
    let html; try { html = readFileSync(new URL(`../../../../web/public/${page}`, import.meta.url), 'utf8'); } catch { continue; }
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replaceAll('€1 of credit buys €1 of our AI', '');   // the rate sentence names €1 on purpose
    for (const m of text.matchAll(/€(\d+) (?:of (?:our )?AI(?: credit)?|in AI credit)|adds? €(\d+)(?: of credit)?/g)) seen.push([page, Number(m[1] || m[2])]);
    assert.doesNotMatch(text, /about €5|\$5 (?:of )?(?:AI )?credit|\$2\.80|\$5\.80|\$11\.80/, `${page}: an old credit amount`);
  }
  assert.ok(seen.length >= 4, 'the pages do name the credit');
  for (const [page, amount] of seen) assert.ok(granted.has(amount), `${page} names €${amount}, which no purchase grants`);
  assert.ok(seen.some(([, amount]) => amount === creditEur('pro-ai')), 'the Pro + AI credit is named');
  assert.equal(CREDIT_PER_COST, 2, 'one rate: €1 of credit = twice our raw cost; changing it changes every grant above (owner, 24 Oct 2026)');
});

test('the offers carry the euro credit the app shows, equal to the grant; a top-up adds what it costs', () => {
  for (const offer of OFFERS) assert.equal(offer.creditEur, CREDIT[offer.id] / 1e6, offer.id);
  assert.deepEqual(OFFERS.filter(o => o.id.startsWith('topup')).map(o => [o.price, o.creditEur]), [['5', 5], ['10', 10], ['20', 20]]);
});

// The owner's rule (24 Oct 2026): for every €10 of credit the user sees, our real cost is €5, in euros. The meter converts our USD cost at USD_PER_EUR.
test('€10 of credit costs us €5 of real AI cost: every grant is paid for by half its face value in euros', () => {
  const eurCostOf = credit => credit / 1e6 / CREDIT_PER_COST;   // what a fully spent credit costs us, in euros
  assert.equal(eurCostOf(CREDIT['pro-ai']), 5);
  const rawMicroUsdForTenEuros = 5 * USD_PER_EUR * 1e6;   // €5 of real cost, billed in USD
  assert.equal(rawToCredit(rawMicroUsdForTenEuros), 10_000_000, '€5 of raw cost (in USD) takes €10 of credit');
  for (const kind of Object.keys(CREDIT).filter(k => CREDIT[k] > 0)) {
    const spentUsd = CREDIT[kind] / CREDIT_PER_COST * USD_PER_EUR;   // micro-USD of raw cost that empties this grant
    assert.ok(Math.abs(rawToCredit(spentUsd) - CREDIT[kind]) <= 1, `${kind}: spending its cost empties it`);
    assert.ok(eurCostOf(CREDIT[kind]) <= creditEur(kind) / 2 + 1e-9, `${kind}: cost is at most half the credit shown`);
  }
});
