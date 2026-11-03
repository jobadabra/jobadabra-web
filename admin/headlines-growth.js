// Headline numbers of the Growth pages, Insights and Product Brain included (admin/headlines.js; drawn by admin/section-overview.js on /admin/growth/overview). Why (owner, 2 Nov 2026, "Intelligence is very thin"): the Intelligence group was spread out and its pages moved here.
// The weekly series come from the same gatherer as the /admin Overview (admin/overview.js report(): one way to count each number); Signups and Monetization read their own pages' collectors.
// Most of these numbers are activity, so their status is "none"; a count of a bad thing (problem reports) turns amber when it rose against last week.
import {report} from './overview.js';
import {collect as signups} from './signups.js';
import {collect as money} from './monetization-data.js';
import {collect as promo, stateOf} from './promo-codes.js';

const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const memo = new WeakMap();
// One gatherer run per request: the loaders of a section run together with the same database and `now`.
const cardsOf = (env, now) => { const hit = memo.get(env.STATS); if (hit?.now === now) return hit.cards;
  const cards = report(env.STATS, now).then(data => data.cards); memo.set(env.STATS, {now, cards}); return cards; };

// A card's series -> a tile: this week's value, the week before, and the bars.
function seriesTile(series, {label = series.label[0].toUpperCase() + series.label.slice(1), status} = {}) {
  const known = series.values.filter(v => v != null), format = series.format || (v => String(Math.round(v)));
  const last = series.values.at(-1), before = series.values.at(-2), better = series.higherIsBetter !== false;
  const worse = last != null && before != null && (better ? last < before : last > before);
  return {label, value: last == null ? (known.length ? '0' : 'No data') : format(last), sub: before == null ? 'this week' : `this week · last week ${format(before)}`,
    status: status || (!better && worse ? 'warn' : 'none'), series: series.values, format, higherIsBetter: better};
}
export const fromCards = key => async (env, now) => {
  if (!env.STATS) return [{label: key, value: '–', sub: 'no database', status: 'none'}];
  return ((await cardsOf(env, now))[key] || []).slice(0, 4).map(series => seriesTile(series));
};

async function signupsTiles(env, now) {
  if (!env.STATS) return [{label: 'Trial accounts', value: '–', sub: 'no database', status: 'none'}];
  const data = await signups(env, now);
  return [{label: 'Trial accounts', value: num(data.trial), sub: `${num(data.confirmed)} confirmed · ${num(data.unconfirmed)} not yet`, status: 'none'},
    {label: 'Converted to Pro', value: num(data.converted), sub: 'trial accounts that paid', status: 'none'}];
}

async function promoTiles(env, now) {
  if (!env.STATS) return [{label: 'Promo uses', value: '–', sub: 'no database', status: 'none'}];
  const data = await promo(env, now), used = data.codes.reduce((sum, code) => sum + code.used, 0);
  return [{label: 'Promo uses', value: num(used), sub: `${num(data.codes.filter(code => stateOf(code, code.used, data.now).text === 'Active').length)} active codes`, status: 'none'}];
}

// Monetization: the page's own verdict colour (green/yellow/red/grey from admin/monetization-data.js colourOf) on trial-to-Pro conversion, and the profit when sales exist.
async function monetizationTiles(env, now) {
  if (!env.STATS) return [{label: 'Trials that bought Pro', value: '–', sub: 'no database', status: 'none'}];
  const data = await money(env, '30d', now), {funnel, conversion} = data;
  const status = {green: 'good', yellow: 'warn', red: 'bad'}[conversion.colour] || 'none';
  return [{label: 'Trials that bought Pro', value: conversion.colour === 'grey' ? 'Too few' : `${Math.round(100 * conversion.ofTrials)}%`, sub: `${num(funnel.pro)} Pro of ${num(funnel.trials)} trials, 30 days · ${conversion.note}`, status, few: conversion.colour === 'grey'},
    data.money ? {label: 'Profit, 30 days', value: `$${data.money.profit.toFixed(0)}`, sub: `$${data.money.revenue.toFixed(0)} revenue · $${data.money.aiCost.toFixed(0)} AI`, status: data.money.profit >= 0 ? 'good' : 'bad'}
      : {label: 'Profit, 30 days', value: 'No data', sub: 'no sale yet', status: 'none'}];
}

export const GROWTH = {'/admin/growth/website': fromCards('/admin/growth/website'), '/admin/growth/app': fromCards('/admin/growth/app'), '/admin/growth/email': signupsTiles, '/admin/growth/promo-codes': promoTiles, '/admin/growth/monetization': monetizationTiles, '/admin/growth/insights': fromCards('/admin/growth/insights'), '/admin/growth/brain': fromCards('/admin/growth/brain')};
