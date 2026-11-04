// Checkout and existing Pro mail use the same measured credit estimate as the app; tests never contact Stripe or send mail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCheckout} from '../../../api/payments/stripe.js';
import {compose} from '../../../shared/mail.js';
import {CREDIT, OFFERS} from '../../../shared/pro-packages.js';
import {buysWords} from '../../../desktop/renderer/credit-buys.js';

test('every checkout with credit explains the amount and its measured approximate use', async () => {
  for (const [kind, micro] of Object.entries(CREDIT)) {
    let body;
    const variable = {pro: 'PRO', 'pro-ai': 'PRO_AI', upgrade: 'UPGRADE', topup5: 'TOPUP5', topup10: 'TOPUP10', topup20: 'TOPUP20'}[kind];
    const env = {STRIPE_SECRET_KEY: 'sk_test_fake', [`STRIPE_PRICE_${variable}`]: `price_${kind}`};
    const result = await createCheckout(env, {kind, install: 'fixture', successUrl: 'https://example.test/ok', cancelUrl: 'https://example.test/cancel'}, async (_url, init) => {
      body = new URLSearchParams(init.body);
      return Response.json({url: 'https://checkout.stripe.test/fixture'});
    });
    assert.ok(result.url);
    const words = body.get('custom_text[submit][message]');
    if (micro > 0) {
      assert.ok(words?.includes(`€${micro / 1e6} of AI credit`), kind);
      assert.ok(words.includes(buysWords(micro / 1e6)), kind);
      assert.match(words, /letter.*CV.*form answers/);
      assert.match(words, /varies/);
    } else assert.equal(words, null, 'Pro alone grants no AI credit');
    assert.equal(body.get('line_items[0][price]'), `price_${kind}`, 'the existing price ID is preserved');
    assert.equal(body.get('consent_collection[terms_of_service]'), 'required');
  }
});

test('the existing launch email names the included credit and its shared estimate in text and HTML', () => {
  const mail = compose('pro-launch', {pro: OFFERS[0].price, proAi: OFFERS[1].price, pricingUrl: 'https://example.test/pricing'});
  for (const text of [mail.text, mail.html]) {
    assert.ok(text.includes(`€${CREDIT['pro-ai'] / 1e6} of AI credit`));
    assert.ok(text.includes(buysWords(CREDIT['pro-ai'] / 1e6)));
  }
});

test('address-confirmation welcome email makes no claim to grant AI credit', () => {
  const mail = compose('welcome', {confirmUrl: 'https://example.test/confirm'});
  assert.doesNotMatch(mail.text, /AI credit|applications/);
});

test('the admin launch preview uses the current package prices', async () => {
  const {SAMPLES} = await import('../../../admin/email-preview.js');
  assert.equal(SAMPLES['pro-launch'].pro, OFFERS[0].price);
  assert.equal(SAMPLES['pro-launch'].proAi, OFFERS[1].price);
});
