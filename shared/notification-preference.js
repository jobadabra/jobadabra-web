// Cache only the authenticated desktop's resolved delivery language for messages sent while its app is off.
import {NOTIFICATION_LANGUAGES, notificationLocale} from './notification-language.js';

/** Refresh a known account's derived language cache; callers authenticate the account, and invalid values never write. */
export async function cacheNotificationLanguage(env, account, language) {
  if (!NOTIFICATION_LANGUAGES.includes(language)) throw new TypeError('unsupported notification language');
  await env.STATS.prepare('UPDATE pro_accounts SET notification_language = ? WHERE id = ?').bind(language, account).run();
}

/** Resolve the last acknowledged recipient cache; unavailable cache/schema keeps existing English delivery working during rollout. */
export async function recipientNotificationLanguage(env, addressHash) {
  // Why (7 Nov 2026): language metadata must not block an otherwise permitted message before the additive migration reaches every deployment.
  const account = await env.STATS?.prepare('SELECT notification_language FROM pro_accounts WHERE email_hash = ?').bind(addressHash).first().catch(() => null);
  return notificationLocale(account?.notification_language);
}
