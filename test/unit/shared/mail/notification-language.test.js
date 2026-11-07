// Explicit per-message locales preserve English defaults, concurrent rendering and raw interpolation values.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {notificationLocale, notificationText} from '../../../../shared/notification-language.js';

test('supported locale normalization resolves regional forms with an English fallback', () => {
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) assert.equal(notificationLocale(locale), locale);
  assert.equal(notificationLocale('RU-ru'), 'ru');
  for (const value of [undefined, null, {}, 'system', 'zz', '']) assert.equal(notificationLocale(value), 'en');
});

test('independent locale arguments never leak across concurrent renders or change raw values', async () => {
  const catalogs = {en: {saved: 'Saved {name}'}, de: {saved: 'Gespeichert {name}'}, ru: {saved: 'Сохранено {name}'}};
  const name = 'Fictional <b>Keychain</b> {name}';
  const rendered = await Promise.all(['ru', 'de', 'en', 'ru'].map(async locale => notificationText(locale, catalogs, 'saved', {name})));
  assert.deepEqual(rendered, [`Сохранено ${name}`, `Gespeichert ${name}`, `Saved ${name}`, `Сохранено ${name}`]);
  assert.equal(notificationText('fr', catalogs, 'saved', {name}), `Saved ${name}`);
  assert.equal(notificationText('ru', catalogs, 'unknown'), 'unknown');
});

test('plural maps use recipient language categories and interpolate once', () => {
  const catalogs = {en: {items: {one: '{count} item', other: '{count} items'}},
    ru: {items: {one: '{count} один', few: '{count} несколько', many: '{count} много', other: '{count} прочие'}},
    ro: {items: {one: '{count} unu', few: '{count} câteva', other: '{count} multe'}}};
  for (const [count, suffix] of [[1, 'один'], [2, 'несколько'], [5, 'много'], [21, 'один']]) assert.equal(notificationText('ru', catalogs, 'items', {count}), `${count} ${suffix}`);
  for (const [count, suffix] of [[0, 'câteva'], [1, 'unu'], [19, 'câteva'], [20, 'multe']]) assert.equal(notificationText('ro', catalogs, 'items', {count}), `${count} ${suffix}`);
  assert.equal(notificationText('fr', catalogs, 'items', {count: 2}), '2 items');
});
