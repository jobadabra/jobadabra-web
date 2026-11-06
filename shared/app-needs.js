// What the desktop app must be to do something a web page or an e-mail offers: ONE place for "minimum app version for X" (owner, 5 Nov 2026: the "Open in Jobadabra" button of an e-mail went to the website on
// a 0.9.6 app, which had no jobadabra:// scheme; the e-mail went live at merge, the app only with a release). A mail or page that needs a newer app lists the feature here and asks appCan() / appButton().
// The version of an install comes from its daily health report (telemetry.version, kind 'health': the partial index telemetry_health_latest serves it, migration 0065); an unknown version is never guessed (null): the offer stays and the page it leads to copes (website/public/open.js).
// Guard: test/unit/shared/mail/mail-app-version.test.js, test/unit/website/open-app.test.js.
import {SITE} from './mail-frame.js';

/** feature -> the first app version that has it. `open`: the jobadabra:// scheme (jobadabra #3230, first in desktop-v0.9.12). */
export const NEEDS = {open: '0.9.12'};

const parts = version => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? '').trim()); return m ? m.slice(1).map(Number) : null; };

/** true / false: `version` is at least `minimum`; null: `version` is not a number we can read. Numeric, so 0.9.6 < 0.9.12. */
export function versionAtLeast(version, minimum) {
  const have = parts(version), need = parts(minimum);
  if (!have || !need) return null;
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] > need[i];
  return true;
}

/** true / false / null (unknown) for an app of this version and a feature of NEEDS. */
export function appCan(feature, version) {
  if (!NEEDS[feature]) throw new Error(`unknown feature ${feature}`);
  return versionAtLeast(version, NEEDS[feature]);
}

const isOpenLink = url => String(url || '').startsWith(`${SITE}/open`);

/** A button {label, url} or a link {text, url}: an /open link for an app known to be too old becomes "Update Jobadabra" -> the download page. Anything else stays. */
export function appButton(button, version) {
  if (!button || !isOpenLink(button.url) || appCan('open', version) !== false) return button;
  return {...button, ...('text' in button ? {text: 'Update Jobadabra'} : {label: 'Update Jobadabra'}), url: `${SITE}/download`};
}

/**
 * A mail's Open button, with the mail it came from: /open counts the press like any page view (website/public/track.js), and Admin sets it against the mails sent.
 * Why (owner, 6 Nov 2026: "Count presses, anonymous"): the mail's name only, never the person; before adding default mails we must see whether a mail brings anyone back.
 */
export function fromMail(button, template) {
  if (!isOpenLink(button?.url)) return button;
  const url = new URL(button.url);
  url.searchParams.set('utm_source', `mail-${template}`);
  return {...button, url: url.href};
}

/** The newest app version any install of this address last reported, or null (no account, no install, no report, a read error). `addr` = mail.js addrOf(). */
export async function appVersionOf(env, addr) {
  try {
    const rows = (await env.STATS.prepare("SELECT t.version AS version, MAX(t.at) AS at FROM pro_accounts a JOIN pro_devices d ON d.account = a.id JOIN telemetry t ON t.install = d.install AND t.kind = 'health' WHERE a.email_hash = ? GROUP BY d.install").bind(addr).all()).results || [];
    let best = null;
    for (const {version} of rows) if (parts(version) && (!best || versionAtLeast(version, best))) best = version;
    return best;
  } catch { return null; }
}
