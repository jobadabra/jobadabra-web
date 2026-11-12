// Every owner Telegram message the Workers send, as one pure card builder each (shared/tg-card.js, the shape of the Central scout alert; owner, 10 Nov 2026: "how I should like to see all the others,
// in terms of readability"). A sender passes raw facts (never escaped, never a name or an e-mail address) and hands the payload's `text` to alertOwner with html: true.
// Why (10 Nov 2026): ~14 Worker files each built their own string (plain, HTML, emoji by taste); one file means a new alert cannot be a wall of text, and one test loops every builder
// through checkCard (test/unit/shared/owner-cards.test.js). The link is inside the card, so senders pass no `link` to alertOwner.
// Job: report health
import {card, esc, plural} from './tg-card.js';

const SITE = 'https://www.jobadabra.top';
const site = (path, base = SITE) => `${base}${path}`;
const clock = iso => String(iso || '').slice(11, 16);

/** A Sentry issue that is new, came back, or is spiking. `fix` is the fixer's {text} or null; `version` the release or ''. */
export function sentryCard(item, kind, {version = '', fix = null} = {}) {
  const crash = item.level === 'fatal';
  const word = ({new: ['New error', 'New crash'], regressed: ['Error came back', 'Crash came back'], spike: ['Error spike', 'Crash spike']}[kind] || ['Issue', 'Crash'])[crash ? 1 : 0];
  return card({level: crash ? 'red' : 'orange', headline: `${word}: ${String(item.title).slice(0, 90)}`,
    why: item.culprit ? [{icon: '📍', text: String(item.culprit).slice(0, 110)}] : [], whyTitle: '',
    facts: [`👥 ${plural(Number(item.userCount) || 0, 'user')} · 🔁 ${plural(Number(item.count) || 0, 'event')}${version ? ` · v${version}` : ''}`, `🕐 First seen ${String(item.firstSeen || '').slice(0, 16).replace('T', ' ')} UTC · ${item.shortId}`],
    // The one link is the thing to act on: the fixer's pull request when it has one, else the issue.
    verdict: fix ? {ok: true, text: `Fixer: ${fix.text}`} : null, link: fix?.url ? {text: 'Open the fixer\'s pull request', url: fix.url} : {text: `Open ${item.shortId} in Sentry`, url: item.permalink}});
}

/** The one summary when more Sentry issues came than the hourly limit allows. */
export const sentryMoreCard = (held, base = SITE) => card({level: 'grey', headline: `${plural(held, 'more Sentry issue')} this hour`, verdict: {text: 'New, back or spiking: the list is on the Sentry page.'}, link: {text: 'Open Sentry', url: site('/admin/testing/sentry', base)}});

/** Probe changes not told yet: rows = [{label, state: 'down'|'up', redSince, streak, reason}]. */
export function probeCard(rows, base = SITE) {
  const down = rows.filter(row => row.state === 'down').length;
  const headline = rows.length === 1 ? `${rows[0].label} is ${down ? 'down' : 'back up'}` : `${plural(rows.length, 'probe')} changed: ${down} down, ${rows.length - down} back up`;
  return card({level: down ? 'red' : 'green', headline, why: rows.map(row => ({icon: row.state === 'down' ? '🔴' : '🟢', text: row.state === 'down' ? `${row.label}: ${plural(row.streak, 'red')} in a row since ${clock(row.redSince)} UTC` : `${row.label}: was down since ${clock(row.redSince)} UTC`})), whyTitle: 'Probes',
    verdict: down ? {ok: false, text: String(rows.find(row => row.state === 'down').reason || 'No reason given.').slice(0, 120)} : {ok: true, text: 'All probes answer.'}, link: {text: 'Open the testing overview', url: site('/admin/testing/overview', base)}});
}

/** The night search check dropped: counts only, no persona, job or employer name. */
export function nightCard(verdict) {
  const why = [];
  if (verdict.reasons.includes('local')) why.push({icon: '📉', text: `Relevant local jobs ${verdict.local} against a usual ${Math.round(verdict.usual * 10) / 10}`});
  if (verdict.reasons.includes('employer-sites')) why.push({icon: '⏱', text: `Employer sites out of time in ${verdict.out}`});
  return card({level: 'orange', headline: `Night search: ${verdict.measured} of ${verdict.total} personas measured`, bar: {done: verdict.measured, total: verdict.total, doneWord: 'measured', restWord: 'missing'}, why,
    verdict: {ok: false, text: verdict.reasons.includes('measured') ? `It needs at least ${verdict.need} measured: the night run needs a look.` : 'The night run needs a look.'}, link: {text: 'Open the night search', url: site('/admin/job-search/lab?tab=night')}});
}
/**
 * Sources that brought no right job on the night just uploaded (owner, 11 Nov 2026, asked via AskUserQuestion: "Morning message: a source at 0 (Recommended)"): one row per source, counts only.
 * `lines` = [{label, readers, total, run}]: run is the night in a row at 0 (admin/search-source-zero.js zeroNow).
 */
export function sourceZeroCard(lines) {
  const one = lines.length === 1;
  return card({level: 'orange', headline: one ? `Night search: ${lines[0].label} brought no right job` : `Night search: ${lines.length} sources brought no right job`,
    why: lines.map(line => ({icon: '🔻', text: `${line.label}: 0 right jobs for ${line.readers === line.total ? `all ${line.total}` : `the ${line.readers} who read it of ${line.total}`} people, night ${line.run} in a row`})), whyTitle: '',
    verdict: {ok: false, text: 'A source that brings nothing is lost: its last run needs a look.'}, link: {text: 'Open the finish line', url: site('/admin/job-search/lab?tab=finish')}});
}
export const nightMissingCard = () => card({level: 'red', headline: 'Night search: no result last night', verdict: {ok: false, text: 'No night was filed by 06:30 UTC.'}, link: {text: 'Open the night search', url: site('/admin/job-search/lab?tab=night')}});

/** The employer list: 'copy-failed' {day}, 'publish-refused' {why}, 'kinds-dropped' {withKinds, previousKinds}. */
export function employerCard(kind, facts = {}) {
  if (kind === 'copy-failed') return card({level: 'red', headline: 'Employer list: the day\'s copy was not saved', why: [{icon: '🗂', text: `The copy of ${facts.day} could not be saved`}], verdict: {ok: false, text: 'The publish went through, but this day has no way back.'}});
  if (kind === 'publish-refused') return card({level: 'orange', headline: 'Employer list: a publish was refused', why: [{icon: '🛑', text: String(facts.why || 'a guard stopped it').slice(0, 120)}], verdict: {ok: true, text: 'The list stays as it was. Look at the central scout\'s last run.'}});
  return card({level: 'orange', headline: 'Employer list: most employer kinds were lost', bar: {done: facts.withKinds, total: facts.previousKinds, doneWord: 'feeds kept their kind', restWord: 'lost it'},
    verdict: {ok: false, text: 'It went through. If the scout did not mean it, restore the day before (index copies).'}});
}

/** Free AI spend: 'day' {usd, stop}, 'month' {usd, stop}, 'neurons' {used, allowance}. */
export function freeAiCard(kind, facts) {
  const link = {text: 'Open the AI costs', url: site('/admin/ai/costs')};
  if (kind === 'neurons') return card({level: 'orange', headline: `Free AI used 80% of today's allowance`, bar: {done: facts.used, total: facts.allowance, doneWord: 'neurons used', restWord: 'left'}, verdict: {ok: false, text: 'It stops at 100% until 00:00 UTC.'}, link});
  const stop = Number(facts.stop), usd = Math.round(Number(facts.usd) * 100) / 100;
  return card({level: 'orange', headline: `Free AI spend ${kind === 'day' ? 'today' : 'this month'}: $${usd}`, bar: stop ? {done: Math.min(usd, stop), total: stop, doneWord: 'USD spent', restWord: 'USD left'} : null,
    verdict: {ok: false, text: `It stops at $${facts.stop}.`}, link});
}

/**
 * The person's words cut so that their ESCAPED text (what Telegram counts: "<" is 4 characters) is at most `max`; never inside a surrogate pair. -> {text, cut}.
 * Why (10 Nov 2026, code review of web#509): the sender cut at 3000 raw characters and the card at 1500, and a text heavy in < & > grew past the message limit and lost its whole body; one
 * measure, the escaped length, decides what is shown and whether "Full text" is told.
 */
export function fitWords(text, max = 3000) {
  const all = String(text ?? '');
  if (esc(all).length <= max) return {text: all, cut: false};
  let used = 0, end = 0;
  for (const char of all) {
    used += esc(char).length;
    if (used > max - 1) break;
    end += char.length;
  }
  return {text: `${all.slice(0, end).trimEnd()}…`, cut: true};
}

/** A feedback: facts = {version, platform, screen, install, text (already fitted by fitWords), attachments: ['Screenshot', ...], ref}. The person's words are a folded quote. */
export const feedbackCard = facts => card({level: 'grey', headline: `New feedback · v${facts.version} · ${facts.platform}`, body: facts.text, bodyMax: Infinity,
  facts: [`📍 ${facts.screen ? `${facts.screen} · ` : ''}install ${String(facts.install).slice(0, 8)}`, ...(facts.attachments?.length ? [`📎 ${facts.attachments.join(' · ')}`] : [])], link: {text: 'Open in the inbox', url: site(`/admin/feedback/inbox#${facts.ref}`)}});

/** A form was reported: {cause, requests, who, time}. */
export const formReportedCard = facts => card({level: 'orange', headline: `A form was reported: ${facts.cause}`, facts: [`📍 ${plural(Number(facts.requests) || 0, 'page response')} · install ${String(facts.who).slice(0, 8)} · ${facts.time} UTC`], link: {text: 'Open the reports', url: site('/admin/form-filling/reports')}});
export const formsMoreCard = () => card({level: 'grey', headline: 'More forms were reported today', verdict: {text: 'No more messages until tomorrow.'}, link: {text: 'Open the reports', url: site('/admin/form-filling/reports')}});
/** A report nobody fetched for `days` days: {days, day, cause, requests}, or {count, days} (summary). The fetch is by hand on the owner's Mac, so the card names the command. */
export const reportWaitingCard = facts => card({level: 'orange', headline: facts.count ? `${plural(facts.count, 'reported form')} have waited ${facts.days} days or more` : `A reported form has waited ${facts.days} days`,
  facts: facts.count ? [] : [`📍 ${facts.cause} · ${plural(Number(facts.requests) || 0, 'page response')} · sent ${facts.day}`], verdict: {text: 'Fetch on the Mac: node desktop/e2e/reports-fetch.mjs, then the offline replay.'},
  link: {text: 'Open the reports', url: site('/admin/form-filling/reports')}});

/** An account gave or changed its e-mail: {changed, install, total}. The address itself is on the Admin page. */
export const emailCard = facts => card({level: 'green', headline: `${facts.changed ? 'User e-mail changed' : 'New user e-mail'} · install ${String(facts.install).slice(0, 8)}`, facts: facts.total ? [`📧 ${plural(facts.total, 'install')} ${facts.total === 1 ? 'has' : 'have'} an e-mail`] : [], link: {text: 'Open the people list', url: site('/admin/growth/email?tab=people')}});

/** Feedback with no reply for 24 h: one ref, or a count (summary). */
export const overdueCard = facts => (facts.count ? card({level: 'orange', headline: `${plural(facts.count, 'feedback')} with no reply for 24 h`, link: {text: 'Open the inbox', url: site('/admin/feedback/inbox')}})
  : card({level: 'orange', headline: `Feedback ${facts.ref} has had no reply for 24 h`, facts: [`📍 from v${facts.version}`], link: {text: 'Open it', url: site(`/admin/feedback/inbox#${facts.ref}`)}}));

/** The feedback impact job could not suggest: {kind, failed, last}. */
export const impactDownCard = facts => card({level: 'orange', headline: `AI skipped (${facts.kind}): ${plural(facts.failed, 'feedback')} not rated`, why: [{icon: '🤖', text: String(facts.last || 'no answer').slice(0, 110)}], whyTitle: 'Last answer',
  verdict: {ok: true, text: 'You can still rate them by hand.'}, link: {text: 'Open the inbox', url: site('/admin/feedback/inbox')}});

/** A Pro early-access sign-up: {role, fromApp}. */
export const waitlistCard = facts => card({level: 'green', headline: `Pro early access sign-up${facts.role ? ` · ${facts.role}` : ''}`, facts: [facts.fromApp ? '📍 From the app' : '📍 From the website'], link: {text: 'Open the people list', url: site('/admin/growth/email?tab=people')}});

/** The "What's new" mail draft: {version, headline}. */
export const releaseMailCard = facts => card({level: 'green', headline: `What's new mail for ${facts.version} is ready`, body: facts.headline, verdict: {text: 'Open it, check the content, then ship it.'}, link: {text: 'Open the draft', url: site(`/admin/growth/email?release=${facts.version}`)}});

/** The daily Build Log: {day, count, groups: [{emoji, title, lead, more}], open}. One message, top 3 goals + N more. */
export const digestCard = facts => card({level: facts.count ? 'green' : 'grey', headline: facts.count ? `Build log ${facts.day}: about ${plural(facts.count, 'PR')} merged` : `Build log ${facts.day}: nothing merged`,
  why: facts.groups.map(group => ({icon: group.emoji, text: `${group.title}: ${group.lead}${group.more > 0 ? ` +${group.more}` : ''}`})), whyTitle: facts.groups.length ? 'What we achieved' : '',
  verdict: facts.open ? {text: `Still open: ${facts.open}`} : null, link: {text: 'Open the Build log', url: site('/admin/agents/build-log')}});

/** The Admin "Test" button of a channel. */
export const testCard = name => card({level: 'grey', headline: `Test from Admin → Notifications (${name})`, verdict: {ok: true, text: 'If you read this, the channel works.'}});

// The shared scheduled-job alert (shared/job-alert.js; owner, 12 Nov 2026: "One shared alert"). `facts` = {name, repo, url} (the run's link; '' draws no link).
const jobFacts = facts => [`📦 ${facts.repo}`];
export const jobRedCard = facts => card({level: 'red', headline: `${facts.name} failed`, facts: jobFacts(facts), verdict: {ok: false, text: 'One message per red streak; the next one is when it works again.'},
  link: facts.url ? {text: 'Open the run', url: facts.url} : {text: 'Open Scheduled', url: site('/admin/operations/scheduled')}});
export const jobGreenCard = facts => card({level: 'green', headline: `${facts.name} works again`, facts: jobFacts(facts), verdict: {ok: true, text: 'The last run passed.'},
  link: facts.url ? {text: 'Open the run', url: facts.url} : {text: 'Open Scheduled', url: site('/admin/operations/scheduled')}});
export const jobNotStartedCard = facts => card({level: 'orange', headline: `Could not start ${facts.name}`, facts: jobFacts(facts), why: [{icon: '🚫', text: facts.why}], whyTitle: '',
  verdict: {ok: false, text: 'The Worker\'s start was refused; this job did not run on time. Once a day per job.'}, link: {text: 'Open Scheduled', url: site('/admin/operations/scheduled')}});
