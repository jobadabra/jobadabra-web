// The measured credit explanation shared by checkout and Pro mail, using the same application estimate as the app.
import {applicationsFor} from '../desktop/renderer/credit-buys.js';
import {mailText} from './mail-copy.js';
import {CREDIT} from './pro-packages.js';

/** Explain only credit this purchase grants; Pro alone and unknown kinds make no credit claim. */
export function purchaseCreditWords(kind, locale = 'en') {
  const micro = Object.hasOwn(CREDIT, kind) ? CREDIT[kind] : 0;
  if (!micro) return '';
  const amount = micro / 1e6, count = applicationsFor(amount);
  return mailText(locale, 'creditDescription', {amount, suffix: count > 0 ? mailText(locale, 'creditApprox', {count}) : ''});
}
