// The website: static pages (public/), POST /api/waitlist, downloads (api/downloads.js: /download/*, /api/hit), the /stats page (admin/stats.js), and "Connect with Notion" for the app (api/notion.js).
// POST /api/waitlist which keeps Pro early-access
// sign-ups in Cloudflare KV (binding WAITLIST). List them: npx wrangler@4 kv key list --binding WAITLIST --remote
// Optional: with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set as secrets, each new sign-up is also sent to Telegram.
import {mediaRange} from './range.js';
import {videoIngest, videoView} from '../../admin/lab-video.js';
import {runData, runFile, runIngest} from '../../shared/agent-runs.js';
import * as sentryAlert from '../../admin/sentry-alert.js';
import * as synthetic from '../../shared/synthetic.js';
import {recordStarts, startIntelCollectors} from '../../shared/intel-start.js';
import {OWN_CRON as TIMERS_OWN_CRON, runTimers} from '../../shared/timers.js';
import {replaysIngest} from '../../admin/applying-replays.js';
import {fidelityIngest} from '../../admin/applying-fidelity.js';
import {verifyIngest} from '../../admin/applying-verify.js';
import {endingsIngest} from '../../admin/applying-resolution.js';
import {ciRowsIngest} from '../../admin/applying-ci-rows.js';
import {view as searchLabView} from '../../admin/search-lab-page.js';
import {ingestRoute as searchLabIngest} from '../../admin/search-lab-store.js';
import {ingestRoute as searchLabDrawIngest} from '../../admin/search-lab-draws.js';
import {realGaps as searchLabRealGaps} from '../../admin/search-lab-real-gaps.js';
import {ingestRoute as sessionChecksIngest} from '../../admin/session-checks.js';
import {discoveryInput} from '../../shared/discovery-candidates.js';
import {meter, newTally, requestLine} from './d1-meter.js';
import {apexRedirect, pageRedirect} from '../../shared/hosts.js';
import {hopIn, hopOut} from '../../shared/admin-hop.js';
import * as linkedin from '../../api/linkedin.js';
import * as linkedinImport from '../../api/linkedin-import.js';
import * as notion from '../../api/notion.js';
import * as downloads from '../../api/downloads.js';
import {stats} from '../../admin/stats.js';
import {daily as telemetryDaily} from '../../shared/telemetry.js';
import {collect as telemetryCollect, evidence as telemetryEvidence} from '../../api/telemetry.js';
import {view as telemetryView} from '../../admin/telemetry.js';
import {guard} from '../../shared/guard.js';
import {view as intelligenceView} from '../../admin/intelligence.js';
import {view as scoutingView} from '../../admin/scoutingadmin.js';
import {view as installsView} from '../../admin/installsimpact.js';
import {ingest as selfHealIngest, view as selfHealView} from '../../admin/selfheal.js';
import {ingest as opsIngest, view as opsView} from '../../admin/ops-overview.js';
import {ingest as schedulesIngest, view as schedulesView} from '../../admin/schedules.js';
import {view as notificationsView} from '../../admin/notifications.js';
import {route as opsNotify} from '../../api/ops-notify.js';
import {alertOwner} from '../../shared/notify-send.js';
import {view as syntheticMonitoringView} from '../../admin/synthetic-monitoring.js';
import {ingest as e2eIntelIngest} from '../../admin/e2e-intel.js';
import {ingest as changelogIngest, list as changelogList} from '../../admin/changelog-store.js';
import {view as e2eIntelView} from '../../admin/e2e-page.js';
import {ingest as integrationIngest} from '../../admin/integration-intel.js';
import {view as integrationView} from '../../admin/integration-page.js';
import {view as gtmReadinessView} from '../../admin/gtm-readiness.js';
import {ingest as gtmIngest} from '../../admin/gtm-intel.js';
import {ingest as buildLogIngest, view as buildLogView} from '../../admin/build-log.js';
import {released as feedbackReleased} from '../../admin/feedback-release.js';
import {brief as feedbackBrief, status as feedbackAiStatus} from '../../admin/feedback-ai.js';
import {ingest as prChecksIngest, view as prChecksView} from '../../admin/pr-checks.js';
import {ingest as agentCodingIngest, view as agentCodingView} from '../../admin/agent-coding.js';
import {agentsView as aiAgentsView, stepsView as aiStepsView, enginesView as aiEnginesView, harnessView as aiHarnessView, runsView as aiRunsView} from '../../admin/ai-views.js';
import {view as monetizationView} from '../../admin/monetization.js';
import {launchRoute} from '../../admin/signups.js';
import {view as emailView} from '../../admin/email.js';
import {switchPress} from '../../admin/email-switches.js';
import {withSwitches} from '../../shared/mail-switches.js';
import * as mailLifecycle from '../../admin/mail-lifecycle.js';
import * as releaseMail from '../../admin/release-mail.js';   // the What's new mail at a stable release (draft from the promotion, sent by the owner)
import {ingest as benchmarkIngest, view as benchmarkView} from '../../admin/benchmark.js';
import {ingest as benchmarkSearchIngest, view as benchmarkSearchView} from '../../admin/benchmark-search.js';
import {ingest as jobCostIngest, spent as jobCostSpent, view as jobCostView} from '../../admin/jobcost.js';
import {digestView, view as realFormFillingView} from '../../admin/real-form-filling.js';
import {view as formLearningView} from '../../admin/form-learning.js';
import {adminPage, inPlace, redirectOld} from '../../admin/admin.js';
import {reportFile as e2eReportFile, view as e2eView} from '../../admin/e2e-report.js';
import {view as applyingView} from '../../admin/applying.js';
import {view as sentryView} from '../../admin/sentry.js';
import {view as testingOverviewView} from '../../admin/testing-overview.js';
import {view as aiPersonaView} from '../../admin/ai-persona.js';
import {view as reportOnlyView} from '../../admin/report-only.js';
import {view as redMainView} from '../../admin/red-main-page.js';
import {route as ciStateRoute} from '../../admin/ci-state.js';
import {view as overviewView} from '../../admin/overview.js';
import {overviewView as sectionOverview} from '../../admin/section-overview.js';
import {view as accessView} from '../../admin/access.js';
import {join, viewer} from '../../shared/auth.js';
import {aliases, evaluateAliases, evaluateVerifiedAliases, pack as aliasPack, pruneLearning} from '../../api/aliases.js';
import {evaluateMeanings} from '../../api/meanings.js';
import {tidy as tidyIntelligence} from '../../shared/intelligence.js';
import {knowledge, tidy as tidyKnowledge} from '../../shared/knowledge.js';
import {playbook} from '../../api/playbook.js';
import {install} from '../../api/install.js';
import {signals} from '../../api/signals.js';
import {feedback} from '../../api/feedback.js';
import {replies as feedbackReplies} from '../../api/feedback-replies.js';
import {view as feedbackView, file as feedbackFile, actRoute as feedbackAct} from '../../admin/feedback.js';
import {purgeFiles as purgeFeedbackFiles} from '../../shared/feedback.js';
import {retryImpact} from '../../shared/feedback-impact.js';
import {pingOverdue} from '../../shared/feedback-overdue.js';
import {reportForm} from '../../shared/report-form.js';
import {view as reportsView} from '../../admin/report-view.js';
import * as recipeLibrary from '../../api/recipes.js';
import * as triageQueue from '../../api/triage.js';
import {freeAi} from '../../shared/free-ai.js';
import {caps as freeAiCaps} from '../../shared/free-ai-caps.js';
import * as mail from '../../shared/mail.js';
import * as mailUnsub from '../../api/mail-unsub.js';
import * as mailHeld from '../../api/mail-held.js';
import * as mailSettings from '../../api/mail-settings.js';
import * as accountEmail from '../../api/account-email.js';
import {status as proStatus} from '../../shared/pro.js';
import * as proSignin from '../../api/pro-signin.js';
import {redeem as promoRedeem} from '../../shared/promo.js';
import {view as promoCodesView} from '../../admin/promo-codes.js';
import {status as trialStatus} from '../../shared/trial.js';
import * as hosted from '../../shared/hosted.js';
import * as hostedState from '../../api/hosted-state.js';
import {tick as hostedTick} from '../../api/hosted-tick.js';
import {test as hostedTest} from '../../api/hosted-test.js';
import {ready, sweep as readySweep} from '../../api/ready.js';
import {tick as readyTick} from '../../api/ready-tick.js';
import {checkout as proCheckout, webhook as proWebhook} from '../../api/pro-pay.js';
import {isReleasesPath, releases} from '../../api/releases.js';
import {brain} from '../../api/brain.js';
import {attribution, purge as purgeNets} from '../../api/attribution.js';
import {log as brainLog, view as brainView} from '../../shared/brainlog.js';
import {index as employerIndex} from '../../api/employers.js';
import {coverage} from '../../api/coverage.js';
import * as pool from '../../api/pool.js';
import * as testMail from '../../admin/test-mail.js';   // test-account-*@ inboxes for the tests (Email Worker + /admin/test-mail)
import {handleReport} from '../../app-core/src/report.js';
import {movesView} from '../../shared/ladder-moves.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_HOUR = 10;  // sign-ups accepted from one address per hour

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

export async function waitlist(request, env) {
  if (request.method !== 'POST') return json(405, {ok: false, error: 'Use POST'});
  let form;
  try { form = await request.json(); } catch { return json(400, {ok: false, error: 'Send JSON'}); }
  if (form.website) return json(200, {ok: true});  // honeypot field that people never see: a bot
  const email = String(form.email || '').trim().toLowerCase();
  const role = String(form.role || '').trim().slice(0, 200);
  if (email.length > 254 || !EMAIL.test(email)) return json(400, {ok: false, error: 'Enter an email address like you@example.com.'});

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const recent = Number(await env.WAITLIST.get(`rate:${ip}`)) || 0;
  if (recent >= PER_HOUR) return json(429, {ok: false, error: 'Too many sign-ups from here. Try again in an hour.'});
  await env.WAITLIST.put(`rate:${ip}`, String(recent + 1), {expirationTtl: 3600});

  const key = `signup:${email}`;
  if (await env.WAITLIST.get(key)) return json(200, {ok: true, already: true});
  // The Plan screen in the Desktop App says "app"; the website form says nothing. Why (owner, 5 Nov 2026): "app-news" is for the app once its dialog names release mails (shared/mail-lists.js signupKind).
  const source = ['app', 'app-news'].includes(form.source) ? form.source : 'web';
  const entry = {email, role, source, at: new Date().toISOString(), country: request.cf?.country || ''};
  await env.WAITLIST.put(key, JSON.stringify(entry), {metadata: {at: entry.at, role, source}});
  // Why (5 Nov 2026, owner: an alert never carries a name or e-mail address): the address is read on /admin/growth/email, the ping says one came.
  await alertOwner(env, 'pro-waitlist', {text: `✈️ Pro early access sign-up${role ? ` · ${role}` : ''}${source !== 'web' ? ' · from the app' : ''}`, link: 'https://www.jobadabra.top/admin/growth/email?tab=people',
    legacy: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? {token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID} : null}).catch(() => {});
  return json(200, {ok: true});
}

// Form-structure reports from every Jobadabra app (desktop/lib/reports.js; app-core/src/report.js checks them): a failure that
// recurs is queued for the private repo's triage (api/triage.js). Secrets GITHUB_TOKEN (the product brain's dispatch) and
// REPORT_TOKEN (the owner's app, trusted); GITHUB_REPO in wrangler.toml.
export async function dispatch(env, inputs, workflow, fetcher = fetch) {
  // Recurring failures and problems are queued for the private repo's triage to pull (api/triage.js); other workflows (the
  // product brain's) are still started on GitHub.
  if (triageQueue.queued(workflow)) return triageQueue.queue(env, inputs, workflow);
  const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', body: JSON.stringify({ref: 'main', inputs}),
    headers: {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jobadabra-web',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'}});
  if (response.status !== 204) throw new Error(`GitHub dispatch failed: ${response.status}`);
}

// The learning judges (canary recipes, aliases, meanings) run daily with the cron, and also when fill data arrives, at most once an hour per
// worker instance (in memory: no KV write). 9 Oct 2026: a second, hourly cron broke the deploy (the account's cron triggers are all used).
export const JUDGE_EVERY_MS = 60 * 60 * 1000;
let judgedAt = 0;
export function judgeSoon(env, ctx, now = Date.now()) {
  if (!env.STATS || now - judgedAt < JUDGE_EVERY_MS) return false;
  judgedAt = now;
  ctx?.waitUntil?.(judgeLearning(env.STATS).catch(error => console.error(`learning judges: ${error.message}`)));
  return true;
}
export const _resetJudge = () => { judgedAt = 0; };   // tests
export async function judgeLearning(db, now = new Date()) {
  const [recipes, meanings, aliases] = await Promise.all([recipeLibrary.evaluateCanary(db, now), evaluateMeanings(db, now), evaluateAliases(db, now)]);
  const actions = {recipes, meanings, aliases};
  if (recipes.length || meanings.length || aliases.length) console.log(`learning: ${JSON.stringify(actions)}`);
  return actions;
}

// Every request runs against a metered database (worker/d1-meter.js): its rows read and written, its route and its caller go to Workers Logs as one JSON line.
async function metered(request, env, ctx) {
  const tally = newTally();
  // Why (5 Nov 2026, owner: real switches): the pressed MAIL/MARKETING_MAIL/TRIAL_REMINDERS/MAIL_LAUNCH states lie over the wrangler.toml values for this request (shared/mail-switches.js); the one small read is metered like the rest.
  const withMeter = await withSwitches(env.STATS ? {...env, STATS: meter(env.STATS, tally)} : env);
  let status = 500;
  try { const response = await route(request, withMeter, ctx); status = response.status; return response; } finally { const line = requestLine(request, status, tally); if (line) console.log(line); }
}

async function route(request, env, ctx) {
  const alias = apexRedirect(request);   // jobpilotto.top -> www.jobpilotto.top (shared/hosts.js)
  if (alias) return alias;
  const page = pageRedirect(request);   // a page over http, on an old host (www.jobpilotto.top, workers.dev) or as .html -> https://www.jobadabra.top/<page>; API paths are served as before
  if (page) return page;
  const hop = await hopOut(request, env);   // an /admin page view on an old host -> the same page on www.jobadabra.top, sign-in carried (shared/admin-hop.js)
  if (hop) return hop;
  request = inPlace(request);   // a script calling an old admin address with its key is answered as at the new one; a browser is redirected below (admin/admin.js)
  const {pathname} = new URL(request.url);
  if (pathname === '/admin/hop') return hopIn(request, env);
  if (pathname.startsWith('/download/')) return downloads.download(request, env, ctx);
  if (pathname === '/install') return install(request, env, ctx, downloads.record);
  if (pathname === '/api/hit') return downloads.hit(request, env);
  if (isReleasesPath(pathname)) return releases(request, env, ctx);   // the app's update check (api/releases.js)
  if (pathname === '/admin/mail/launch') return launchRoute(request, env);   // the Pro-launch mail, by hand (admin/signups.js)
  if (pathname === '/admin/mail/release') return releaseMail.releaseRoute(request, env);   // review/edit/send the release draft (admin/release-mail.js)
  if (pathname === '/release-mail/draft') return releaseMail.ingest(request, env);   // the stable promotion drafts a version (Bearer SELFHEAL_PUBLISH_KEY)
  if (pathname === '/admin/test-mail') return testMail.view(request, env);   // Bearer only (admin/test-mail.js)
  // The owner's admin pages (admin/admin.js): one menu on all, the same key; never in public/, or they would be served to anyone.
  const admin = {'/admin': overviewView, '/admin/growth/website': stats, '/admin/growth/app': telemetryView, '/admin/growth/insights': intelligenceView, '/admin/job-search/scouting': scoutingView, '/admin/job-search/installs': installsView,
    '/admin/agents/overview': opsView, '/admin/operations/scheduled': schedulesView, '/admin/operations/notifications': notificationsView, '/admin/testing/synthetic-monitoring': syntheticMonitoringView, '/admin/form-filling/overview': sectionOverview('/admin/form-filling/overview', 'Form filling overview'), '/admin/growth/overview': sectionOverview('/admin/growth/overview', 'Growth overview'), '/admin/agents/build-log': buildLogView, '/admin/testing/pr-checks': prChecksView, '/admin/agents/agent-coding': agentCodingView, '/admin/testing/e2e': e2eIntelView, '/admin/testing/integrations': integrationView, '/admin/testing/gtm-readiness': gtmReadinessView, '/admin/testing/bug-loop': selfHealView, '/admin/testing/red-main': redMainView, '/admin/ai/agents': aiAgentsView, '/admin/ai/steps': aiStepsView, '/admin/ai/engines': aiEnginesView, '/admin/ai/harness': aiHarnessView, '/admin/ai/runs': aiRunsView, '/admin/ai/costs': jobCostView, '/admin/growth/monetization': monetizationView, '/admin/growth/email': emailView, '/admin/growth/email/switch': switchPress, '/admin/growth/promo-codes': promoCodesView, '/admin/form-filling/real-users': realFormFillingView, '/admin/form-filling/learning': formLearningView, '/admin/feedback/inbox': feedbackView,
    '/admin/agents/access': accessView, '/admin/form-filling/lab': applyingView, '/admin/job-search/lab': searchLabView, '/admin/form-filling/benchmark': benchmarkView, '/admin/job-search/benchmark': benchmarkSearchView, '/admin/growth/brain': brainView, '/admin/testing/sentry': sentryView, '/admin/testing/overview': testingOverviewView, '/admin/testing/ai-persona': aiPersonaView, '/admin/testing/report-only': reportOnlyView, '/admin/form-filling/reports': reportsView}[pathname];   // access: the super admin's only (admin/access.js)
  // A run's HTML report (the link on GitHub's Summary page) and its files (a signed address, no cookie needed), under the E2E page; the old /admin/e2e/… addresses
  // stay answered in place, not redirected: years of Summary pages print them and the report's service worker carries no cookie (admin/e2e-report.js).
  if (pathname === '/admin/e2e' || pathname.startsWith('/admin/e2e/run/') || pathname.startsWith('/admin/operations/e2e/run/')) return e2eView(request, env);
  if (pathname.startsWith('/admin/e2e/report/') || pathname.startsWith('/admin/operations/e2e/report/')) return e2eReportFile(request, env);
  if (pathname === '/admin/join') return join(request, env);   // an invite link
  if (pathname === '/admin/form-filling/real-users/digest.json' || pathname === '/admin/form-filling/real-users/digest.md') return digestView(request, env);
  if (admin) {
    const who = await viewer(request, env);
    return adminPage(await admin(request, env), pathname, who || undefined);
  }
  const moved = await redirectOld(request, env);   // the old page addresses listed in admin/admin.js
  if (moved) return moved;
  if (pathname === '/report/fill-failure') return handleReport(request, env, dispatch);
  if (pathname === '/report/telemetry') return telemetryCollect(request, env);
  if (pathname === '/applying/verify' && request.method === 'PUT') return verifyIngest(request, env);   // "Confirmed offline" verdicts (Bearer REPLAYS_PUBLISH_KEY, admin/applying-verify.js)
  if (pathname === '/applying/fidelity' && request.method === 'PUT') return fidelityIngest(request, env);   // a prototype's replay-vs-live records (Bearer REPLAYS_PUBLISH_KEY, admin/applying-fidelity.js)
  if (pathname === '/applying/ci-rows' && request.method === 'PUT') return ciRowsIngest(request, env);   // a CI recording run's rows, main only (Bearer REPLAYS_PUBLISH_KEY, admin/applying-ci-rows.js)
  if (pathname === '/search-lab/draws' && request.method === 'PUT') return searchLabDrawIngest(request, env);   // the daily CI draw, main only (Bearer REPLAYS_PUBLISH_KEY, admin/search-lab-draws.js)
  if (pathname === '/search-lab/real-gaps' && request.method === 'GET') return searchLabRealGaps(request, env);   // the search robot's real-installs alarm, k >= 3 (Bearer REPLAYS_PUBLISH_KEY, admin/search-lab-real-gaps.js)
  if (pathname === '/search-lab/session-checks' && request.method === 'PUT') return sessionChecksIngest(request, env);   // a session's local search check (Bearer SESSION_CHECKS_KEY, admin/session-checks.js)
  if (pathname === '/search-lab/rows' && request.method === 'PUT') return searchLabIngest(request, env);   // a replayed search per candidate, main only (Bearer REPLAYS_PUBLISH_KEY, admin/search-lab-store.js)
  if (pathname === '/applying/discovery-input' && request.method === 'GET') return discoveryInput(request, env);   // the daily discovery batch's input (Bearer REPLAYS_PUBLISH_KEY, shared/discovery-candidates.js)
  if (pathname === '/applying/endings' && request.method === 'PUT') return endingsIngest(request, env);
  if (pathname === '/applying/video' && request.method === 'PUT') return videoIngest(request, env);   // CI's pool run: one fill video per row (Bearer REPLAYS_PUBLISH_KEY, admin/lab-video.js)
  if (pathname === '/admin/form-filling/lab/video' && request.method === 'GET') return videoView(request, env);   // the owner streams it (admin/lab-video.js)
  if (pathname === '/agent/run' && request.method === 'PUT') return runIngest(request, env);   // CI's AI persona job: a run's record, video and screenshots (Bearer REPLAYS_PUBLISH_KEY, shared/agent-runs.js)
  if (pathname === '/admin/ai-persona/data' && request.method === 'GET') return runData(request, env);   // the owner reads the run list and a run's record (shared/agent-runs.js)
  if (pathname === '/admin/ai-persona/file' && request.method === 'GET') return runFile(request, env);   // the owner streams a run's video or screenshot (shared/agent-runs.js)
  if (pathname === '/applying/replays' && request.method === 'PUT') return replaysIngest(request, env);   // CI on main's recorded replays (Bearer REPLAYS_PUBLISH_KEY, admin/applying-replays.js)
  if (pathname === '/e2e/data' && (request.method === 'PUT' || request.method === 'GET')) return e2eIntelIngest(request, env);   // CI publishes finished e2e runs and their red suites (Bearer SELFHEAL_PUBLISH_KEY, admin/e2e-intel.js)
  if (pathname === '/gtm/data' && (request.method === 'PUT' || request.method === 'GET')) return gtmIngest(request, env);   // CI publishes the GTM readiness snapshot (Bearer SELFHEAL_PUBLISH_KEY, admin/gtm-intel.js)
  if (pathname === '/integration/data' && (request.method === 'PUT' || request.method === 'GET')) return integrationIngest(request, env);   // CI publishes the integration tests' snapshot (Bearer SELFHEAL_PUBLISH_KEY, admin/integration-intel.js)
  if (pathname === '/changelog/data' && (request.method === 'PUT' || request.method === 'GET')) return changelogIngest(request, env);   // CI publishes each new version's What's new entry (Bearer SELFHEAL_PUBLISH_KEY, admin/changelog-store.js)
  if (pathname === '/changelog.json' && request.method === 'GET') return changelogList(request, env);   // the What's new page's versions (falls back to public/changelog.json)
  if (pathname === '/ops/notify') return opsNotify(request, env);   // the notification switchboard: every owner alert asks here first (api/ops-notify.js, Bearer SELFHEAL_PUBLISH_KEY); public lists it with the senders' PR
  if (pathname === '/ops/data' && request.method === 'PUT' && new URL(request.url).searchParams.get('kind') === 'schedules') return schedulesIngest(request, env);   // CI publishes the scheduled jobs (admin/schedules.js; the same listed route, so no public list change)
  if (pathname === '/ops/data' && (request.method === 'PUT' || request.method === 'GET')) return opsIngest(request, env);   // CI publishes merged PRs (Bearer SELFHEAL_PUBLISH_KEY, admin/ops-overview.js)
  if (pathname === '/digest/data' && (request.method === 'PUT' || request.method === 'GET')) return buildLogIngest(request, env);   // CI publishes the day's build digest (Bearer SELFHEAL_PUBLISH_KEY, admin/build-log.js)
  if (pathname === '/agent-coding/data' && request.method === 'PUT') return agentCodingIngest(request, env);   // the push-gate and CI days (Bearer SELFHEAL_PUBLISH_KEY, admin/agent-coding.js)
  if (pathname === '/pr-checks/data' && request.method === 'PUT') return prChecksIngest(request, env);   // the monthly PR-check scorecard (Bearer SELFHEAL_PUBLISH_KEY, admin/pr-checks.js)
  if (pathname === '/benchmark/data' && request.method === 'PUT') return benchmarkIngest(request, env);   // the bake-off's scored runs (Bearer SELFHEAL_PUBLISH_KEY, admin/benchmark.js)
  if (pathname === '/benchmark-search/data' && request.method === 'PUT') return benchmarkSearchIngest(request, env);   // search-bench's scored runs (Bearer SELFHEAL_PUBLISH_KEY, admin/benchmark-search.js)
  if (pathname.startsWith('/ci-state/')) return ciStateRoute(request, env, pathname.slice(10));   // CI's small stores: noise register, verdict audit, red main (Bearer SELFHEAL_PUBLISH_KEY; red-main readable by anyone, admin/ci-state.js)
  if (pathname === '/self-heal/data' && request.method === 'PUT') return selfHealIngest(request, env);   // CI publishes the loop's numbers (Bearer SELFHEAL_PUBLISH_KEY)
  if (pathname === '/ai-cost/data' && request.method === 'GET') return jobCostSpent(request, env);   // a day's reported spend for CI's budget guard (same key)
  if (pathname === '/ai-cost/data' && request.method === 'PUT') return jobCostIngest(request, env);   // each scheduled job reports its AI cost (Bearer AI_COST_PUBLISH_KEY)
  if (pathname === '/api/index') return employerIndex(request, env);
  if (pathname === '/api/synthetic/last') return synthetic.lastRoute(request, env);   // when the newest probe round ran, only that (shared/synthetic.js; the bot Worker's heartbeat)
  if (pathname === '/api/coverage' && request.method === 'GET') return coverage(env);   // the website's public numbers (counts only, api/coverage.js)
  if (pathname === '/api/recipes') return recipeLibrary.recipes(request, env);
  if (pathname === '/api/recipes/lookup') return recipeLibrary.lookup(request, env);
  if (pathname === '/api/recipes/targets') return recipeLibrary.targets(request, env);
  if (pathname === '/api/guard') return guard(request, env);
  if (pathname === '/api/knowledge') return knowledge(request, env);
  if (pathname === '/api/packs/aliases') return aliasPack(request, env);
  if (pathname === '/api/aliases') return aliases(request, env);
  if (pathname === '/api/playbook') return playbook(request, env);
  if (pathname === '/api/install-token') return recipeLibrary.installToken(request, env);
  if (pathname === '/api/ladder-moves') return movesView(request, env);   // the owner: the ladder's learned moves per source (shared/ladder-moves.js)
  if (pathname === '/api/controls') { judgeSoon(env, ctx); return recipeLibrary.controls(request, env); }   // fill data in: the judges may act on it
  if (pathname === '/api/triage') return triageQueue.triage(request, env);
  if (pathname === '/api/contribute') return pool.contribute(request, env);
  if (pathname === '/api/contributions') return pool.aggregate(request, env);
  if (pathname === '/api/signals') return signals(request, env);
  if (pathname === '/api/feedback') return feedback(request, env, fetch, new Date(), ctx);
  if (pathname === '/api/feedback/released') return feedbackReleased(request, env);   // CI's release workflows: tells the reporters whose fix the build includes (Bearer SELFHEAL_PUBLISH_KEY, admin/feedback-release.js)
  if (pathname === '/api/feedback/replies' || pathname === '/api/feedback/replies/seen') return feedbackReplies(request, env);   // the app reads the owner's answer to its own feedback (api/feedback-replies.js)
  if (pathname === '/api/feedback/brief') return feedbackBrief(request, env);   // the Send to AI run reads what it may about one feedback (GitHub run token, admin/feedback-ai.js)
  if (pathname === '/api/feedback/ai-status') return feedbackAiStatus(request, env);   // ...and reports its steps
  if (pathname === '/admin/growth/feedback/act') return feedbackAct(request, env, new Date(), {dispatch});   // one action on one feedback, the owner only (shared/feedback-actions.js)
  if (pathname === '/admin/growth/feedback/file') return feedbackFile(request, env);   // a feedback's screenshot or logs, the owner only (admin/feedback.js)
  if (pathname === '/api/report-form' || pathname.startsWith('/api/report-form/')) return reportForm(request, env, pathname);   // "Report this form": an encrypted recording from an install (shared/report-form.js)
  if (pathname === '/api/attribution') return attribution(request, env);   // a downloaded app's first start: its channel
  if (pathname === '/api/ai/caps') return freeAiCaps(request, env);   // where this install stands with our AI: credit, or the Free line it is past (shared/free-ai-caps.js)
  if (pathname.startsWith('/api/ai/')) return freeAi(request, env, new Date(), ctx);
  if (pathname === '/email-settings') return mailSettings.settings(request, env);   // the signed e-mail settings page (api/mail-settings.js)
  if (pathname === '/unsubscribe') return mailUnsub.unsubscribe(request, env);   // one-click unsubscribe from a mail list (api/mail-unsub.js)
  if (pathname === '/confirm') return accountEmail.confirm(request, env);   // confirm an e-mail address (api/account-email.js)
  if (pathname === '/api/account/email/resend') return accountEmail.resend(request, env);   // the confirm link again (api/account-email.js)
  if (pathname === '/api/account/email') return accountEmail.address(request, env, new Date(), fetch, ctx);   // the person's address and marketing opt-in (api/account-email.js)
  if (pathname === '/api/notify/email') return accountEmail.notify(request, env);   // a Telegram-style message by e-mail (api/account-email.js)
  if (pathname === '/api/trial/status') return trialStatus(request, env);   // the free trial, one answer for the app and Always on (shared/trial.js)
  if (pathname === '/api/hosted/schedule') return hosted.schedule(request, env);   // hosted Always on: the install's schedule (shared/hosted.js; 404 while HOSTED_ALWAYS_ON is off)
  if (pathname === '/api/hosted/result') return hosted.result(request, env);   // a container's one result post (run token)
  if (pathname === '/api/hosted/state') return hostedState.state(request, env);   // the container's state, encrypted in R2 (api/hosted-state.js)
  if (pathname === '/api/hosted/config') return hostedState.config(request, env);   // profile and search the app pushes (no CV); the container reads
  if (pathname === '/api/hosted/export' || pathname === '/api/hosted/data') return hostedState.own(request, env);   // download and delete my hosted data
  if (pathname.startsWith('/api/ready/')) return ready(request, env);   // Ready to send, phase 1: the owner's night batch and morning rows (api/ready.js; 404 while READY_TO_SEND is off)
  if (pathname === '/api/hosted/test') return hostedTest(request, env);   // the Test button on our servers' card: one real run now, steps in words (api/hosted-test.js)
  if (pathname === '/api/hosted/inbox') return hosted.inbox(request, env);   // the matches that arrived while the app was closed
  if (pathname === '/api/pro/checkout') return proCheckout(request, env);   // a one-time payment for Pro or a top-up (api/pro-pay.js)
  if (pathname === '/api/pro/webhook') return proWebhook(request, env);   // the payment provider's signed events
  if (pathname === '/api/pro/redeem') return promoRedeem(request, env);   // a promo code gives Pro (shared/promo.js)
  if (pathname === '/api/pro/signin/start') return proSignin.start(request, env);   // "I have Pro": a 6-digit code by e-mail (api/pro-signin.js)
  if (pathname === '/api/pro/signin/verify') return proSignin.verify(request, env);   // the code adds this install to the Pro account
  if (pathname === '/api/pro/status') return proStatus(request, env);   // the Pro plan: plan and AI credit for the app (shared/pro.js)
  if (pathname === '/api/brain/telegram') return brain(request, env, dispatch);
  if (pathname === '/api/brain/log') return brainLog(request, env);   // tools/product_brain.py, the scripts' key
  if (pathname === '/telemetry/version') return telemetryEvidence(request, env);
  if (pathname === '/api/waitlist') return waitlist(request, env);
  if (pathname === '/api/notion/start') return notion.start(request, env);
  if (pathname === notion.CALLBACK) return notion.callback(request, env);
  if (pathname === '/api/notion/token') return notion.collect(request, env);
  if (pathname === '/api/linkedin/start') return linkedin.start(request, env);
  if (pathname === linkedin.CALLBACK) return linkedin.callback(request, env);
  if (pathname === '/api/linkedin/token') return linkedin.collect(request, env);
  if (pathname === '/api/linkedin-import/start') return linkedinImport.start(request, env);   // import your own profile (api/linkedin-import.js)
  if (pathname === linkedinImport.CALLBACK) return linkedinImport.callback(request, env);
  if (pathname === '/api/linkedin-import/revoke') return linkedinImport.revoke(request, env);
  if (/^\/(old\/)?(media|images\/app)\//.test(pathname)) return mediaRange(request, env);   // videos need 206 for Safari (worker/range.js)
  return env.ASSETS.fetch(request);
}

const SENTRY_CRON = '*/5 * * * *';   // wrangler.toml [triggers]

export default {
  fetch: metered,
  email: (message, env) => testMail.receive(message, env),   // Cloudflare Email Routing -> this Worker (dashboard route, admin/test-mail.js)
  queue: (batch, env) => mailUnsub.consume(batch, env),   // Email Sending bounce/complaint events (Queues subscription, api/mail-unsub.js)
  // Daily (wrangler.toml [triggers]): app reports older than 90 days dropped; the top problems go to GitHub triage.
  async scheduled(event, rawEnv, ctx) {
    // Why (1 Nov 2026, owner: "Timers to site Worker, delete bot"): the old bot Worker's on-time starts (shared/timers.js, dormant until TIMERS=on). The 47 cron is its own trigger and is awaited, so a refused start fails the cron in Cloudflare's history; it never falls through to the daily jobs.
    if (event.cron === TIMERS_OWN_CRON) return runTimers(event, rawEnv, {dispatch}).then(() => {});   // starts the e2e run and nothing else: no mail, so no switch read (test/unit/shared/timers.test.js)
    const env = await withSwitches(rawEnv);   // the pressed mail switches, like a request (shared/mail-switches.js)
    if (event.cron === SENTRY_CRON) {   // every 5 minutes: only the Sentry alerts (admin/sentry-alert.js); the daily jobs below run once a day
      ctx.waitUntil(hostedTick(env).then(done => { if (done.enqueued || Object.keys(done.paused).length) console.log(`hosted tick: ${JSON.stringify(done)}`); }).catch(error => console.error(`hosted tick: ${error.message}`)));   // hosted Always on: due schedules to the Queue (api/hosted-tick.js; nothing while HOSTED_ALWAYS_ON is off)
      ctx.waitUntil(readyTick(env).then(done => { if (done.started || done.finished) console.log(`ready tick: ${JSON.stringify(done)}`); }).catch(error => console.error(`ready tick: ${error.message}`)));   // Ready to send: due nights to the Queue, over-time nights finished (api/ready-tick.js; nothing while READY_TO_SEND is off)
      ctx.waitUntil(readySweep(env).catch(error => console.error(`ready sweep: ${error.message}`)));   // Ready to send: a batch older than a day loses its data (api/ready.js)
      ctx.waitUntil(sentryAlert.check(env).catch(error => console.error(`sentry alert: ${error.message}`)));
      ctx.waitUntil(runTimers(event, env, {dispatch}).catch(error => console.error(`timers: ${error.message}`)));   // the bot Worker's starts that fall on this tick (shared/timers.js; nothing while TIMERS is off)
      ctx.waitUntil(synthetic.tick(env, new Date(event.scheduledTime || Date.now())).then(done => { if (done.ran) console.log(`synthetic round: ${JSON.stringify(done)}`); }).catch(error => console.error(`synthetic round: ${error.message}`)));   // every 15 min (shared/synthetic.js; report only)
      // Why (31 Oct 2026, owner "Start it from the Worker"; the integrations collector joined 1 Nov 2026): GitHub's hourly schedules ran every ~4.5 h or not at all; this trigger fires on time, one tick an hour per collector (INTEL_COLLECTORS, shared/intel-start.js). All 5 account cron triggers are used.
      ctx.waitUntil(startIntelCollectors(env, new Date(event.scheduledTime || Date.now()), dispatch).then(async results => { await recordStarts(env.STATS, results, new Date(event.scheduledTime || Date.now())); for (const {workflow, error} of results) { if (error) console.error(`${workflow.replace('.yml', '')} start failed: ${error}; GitHub's own schedule is the backup`); else console.log(`scheduled ${workflow} cron=*/5`); } }));
      // Why (5 Nov 2026, Gitar on #439): the promise is a reply within 24 hours, so the owner is warned within the hour; the daily block below would warn up to a day late. One tick an hour (minute 10); the once-per-report flag stops a double ping.
      const tickAt = new Date(event.scheduledTime || Date.now());
      if (tickAt.getUTCMinutes() === 10) ctx.waitUntil(pingOverdue(env, tickAt).catch(error => console.error(`feedback overdue ping: ${error.message}`)));   // a report 24 h old with no reply: the owner is told once (shared/feedback-overdue.js)
      return;
    }
    ctx.waitUntil(sentryAlert.purge(env).catch(error => console.error(`sentry alert purge: ${error.message}`)));
    ctx.waitUntil(retryImpact(env).catch(error => { console.error(`feedback impact retry: ${error.message}`); throw error; }));   // feedback the AI could not rate yet (shared/feedback-impact.js); rethrown so an outage makes this invocation fail, not only a log line (Gitar on #339)
    ctx.waitUntil(purgeFeedbackFiles(env).catch(error => console.error(`feedback files purge: ${error.message}`)));   // screenshots and logs older than 90 days (shared/feedback.js)
    ctx.waitUntil(synthetic.purge(env).catch(error => console.error(`synthetic purge: ${error.message}`)));
    // The day's totals first (kept for good), then the 90-day purge of raw rows.
    ctx.waitUntil(pool.rollup(env).catch(error => console.error(`pool rollup: ${error.message}`)).then(() => pool.purge(env)).catch(error => console.error(`pool purge: ${error.message}`)));
    ctx.waitUntil((env.STATS ? recipeLibrary.evaluateCanary(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`recipes: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`recipe canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? Promise.all([recipeLibrary.evaluateVerified(env.STATS), evaluateVerifiedAliases(env.STATS)]).then(done => done.flat()) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`rolled back: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`verified watch: ${error.message}`)));
    ctx.waitUntil(purgeNets(env).catch(error => console.error(`download nets purge: ${error.message}`)));
    ctx.waitUntil(telemetryDaily(env).catch(error => console.error(`telemetry cleanup: ${error.message}`)));
    ctx.waitUntil((env.STATS ? evaluateMeanings(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`meanings: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`meanings canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? evaluateAliases(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`aliases: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`alias canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? pruneLearning(env.STATS) : Promise.resolve({})).then(removed => console.log(`learning pruned: ${JSON.stringify(removed)}`)).catch(error => console.log(`learning not pruned: ${error.message}`)));   // aliases.js pruneLearning
    ctx.waitUntil((env.STATS ? tidyIntelligence(env.STATS) : Promise.resolve({dropped: 0})).catch(error => console.error(`intelligence tidy: ${error.message}`)));
    ctx.waitUntil(mailHeld.sendDigests(env).catch(error => console.error(`mail digests: ${error.message}`)));   // the daily or weekly digest (api/mail-held.js)
    ctx.waitUntil(mail.purge(env).catch(error => console.error(`mail log purge: ${error.message}`)));
    ctx.waitUntil(mailLifecycle.run(env).catch(error => console.error(`mail lifecycle: ${error.message}`)));   // trial reminders, Always on paused (admin/mail-lifecycle.js)
    ctx.waitUntil(testMail.purge(env).catch(error => console.error(`test mail purge: ${error.message}`)));
    ctx.waitUntil((env.STATS ? tidyKnowledge(env.STATS) : Promise.resolve({dropped: 0})).catch(error => console.error(`knowledge tidy: ${error.message}`)));
  },
};
