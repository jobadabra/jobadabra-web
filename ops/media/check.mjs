// The product media's checks (media): fictional data only, the dark theme, the extension really filled the form. Pure where it can
// be; a failed check stops the run, so no picture with a real address or a broken scene reaches the site. Guard: desktop/test/media-check.test.js.

// E-mail addresses on screen must be on reserved test domains (example.com/.org/.net, .example, .test, .invalid): anything else may be real.
const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const RESERVED = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;
export function realEmails(text) {
  return [...new Set([...String(text || '').matchAll(EMAIL)].map(match => match[0]).filter(address => !RESERVED.test(address.split('@')[1])))];
}

// A persona folder may hold only placeholder keys (desktop/demo/secrets.json): a folder with a real token is someone's data, never media.
export function realSecrets(secrets) {
  return Object.entries(secrets || {}).filter(([, value]) => typeof value === 'string' && value.length >= 20 && !/demo|placeholder|example|fake|xxx|0000/i.test(value)).map(([key]) => key);
}

// A persona's screens must not show the default person's words (media.json "forbid"): a leftover means a demo file the persona did not replace.
export const leftWords = (text, words = []) => words.filter(word => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(String(text || '')));

// The fields the extension must have filled on form.html for the clip to show a real fill (the question answers come from the persona).
// Why (12 Nov 2026): no 'privacy': the extension leaves a consent box for the person to tick (the panel lists it as the field left; /how-it-works:
// "Checks and terms: it asks, you tick"), so the check asked for a fill the product never makes and stopped every extension recording.
export const MUST_FILL = ['first_name', 'last_name', 'email', 'resume', 'permit'];
export const missingFills = filled => MUST_FILL.filter(field => !(filled || []).includes(field));

// Every picture is dark (the site is dark-only; the app, the fictional form and the extension's panel all run dark): a mean brightness over this is the light theme or a blank window.
export const DARK_MAX = 0.35;

// -> list of problems (empty = fine) for one recorded piece.
// Capture stalls (round 2, 24 Oct 2026). A still page sends no frames, so a gap alone proves nothing (a first check on gaps after clicks failed a good
// Set up). Each look's hold forces one repaint right after it is logged (screencast.mjs paint); a look with no frame within `within` seconds of its start
// is a stalled capture: the clip would show the page before it. -> [{look, t}]. Pure.
export function captureGaps(log, within = 1) {
  const frames = log.frames.map(frame => frame.t);
  return (log.events || []).filter(event => event.type === 'hold' && event.look)
    .filter(hold => !frames.some(t => t >= hold.t - 0.05 && t <= hold.t + within))
    .map(hold => ({look: hold.look, t: hold.t}));
}

// Every way a capture stalls, one reason each (empty: it did not): too few frames from the first look on (a quiet piece, a still page that changes
// only on a click, needs two), or a look with no frame (captureGaps). One function for the take loop, which records again (media.mjs), and the
// final gate (pieceProblems): run 28 failed at the end on Find's 117 frames in 31.8 s, a stall the loop never looked for. Pure.
export function stallsOf(log, quiet = false) {
  const from = (log.events || []).find(event => event.type === 'hold' && event.look)?.t ?? 0;
  const caught = log.frames.filter(frame => !frame.held);   // a frame held to the last hold's end is no capture (camera.mjs toLastHold)
  const frames = caught.filter(frame => frame.t >= from - 0.05), seconds = Math.max(0, (caught.at(-1)?.t || 0) - from);
  const out = [];
  if (quiet ? frames.length < 2 : frames.length < seconds * 5) out.push(`only ${frames.length} frames in ${seconds.toFixed(1)} s (the capture stalled)`);
  for (const gap of captureGaps(log)) out.push(`no frame at the look ${JSON.stringify(gap.look)} (${gap.t.toFixed(1)} s): the capture stalled`);
  return out;
}

export function pieceProblems({name, source, log, posterBrightness, forbid = [], quiet = false}) {
  const problems = [];
  const left = leftWords(log.text, forbid);
  if (left.length) problems.push(`${name}: the default demo person shows through: ${left.join(', ')}`);
  const emails = realEmails(log.text);
  if (emails.length) problems.push(`${name}: an e-mail address that may be real is on screen: ${emails.join(', ')}`);
  if (posterBrightness > DARK_MAX) problems.push(`${name}: the window is not dark (brightness ${posterBrightness.toFixed(2)})`);
  if (source === 'extension') { const missing = missingFills(log.filled); if (missing.length) problems.push(`${name}: the extension did not fill ${missing.join(', ')}`); }
  for (const stall of stallsOf(log, quiet)) problems.push(`${name}: ${stall}`);
  return problems;
}
