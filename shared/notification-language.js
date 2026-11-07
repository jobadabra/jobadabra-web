// Stateless notification formatting keeps each recipient's language separate from operational English copy.
export const NOTIFICATION_LANGUAGES = Object.freeze(['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']);

/** Resolve an explicit recipient locale; missing, system and unsupported choices fall back to English. */
export function notificationLocale(value) {
  const base = typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : '';
  return NOTIFICATION_LANGUAGES.includes(base) ? base : 'en';
}

function template(catalogs, locale, key, variables) {
  const messages = catalogs[locale];
  const value = messages && Object.hasOwn(messages, key) ? messages[key] : undefined;
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const count = Number(variables.count);
  const form = Number.isFinite(count) ? new Intl.PluralRules(locale).select(count) : 'other';
  return Object.hasOwn(value, form) ? value[form] : value.other;
}

/** Format a bundled template once with recipient plural rules; fallback uses English rules and inserted values stay untouched. */
export function notificationText(locale, catalogs, key, variables = {}) {
  const pattern = template(catalogs, notificationLocale(locale), key, variables) ?? template(catalogs, 'en', key, variables);
  if (typeof pattern !== 'string') return String(key);
  return pattern.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) => Object.hasOwn(variables, name) ? String(variables[name]) : placeholder);
}
