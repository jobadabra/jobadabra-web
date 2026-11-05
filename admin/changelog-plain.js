// The What's new entry written WITHOUT the AI (owner, 24 Oct 2026): when the AI cannot draft a version (limit, bad key, outage) the page still gets it, built from the release's commit subjects, grouped by kind,
// marked `plain: true` so the next run that can reach the AI writes it again in plain words (PUT redraft). Same checks as any entry (problems()): a subject with an internal word is left out, never shown.
// Guard: test/unit/admin/changelog/changelog-plain.test.js.
import {FORBIDDEN, problems} from './changelog.js';

const FIXES = /^(fix|fixes|fixed|repair|stop|resolve|correct|prevent|no longer|don't|never)\b/i, FEATURES = /^(add|adds|added|new|let|allow|support|introduce|show|offer|enable|create)\b/i;
// "[50] Fix the paths (#123)" -> "Fix the paths"; a tag like "feat:" or a PR number is noise to a reader.
export const cleanSubject = subject => String(subject).replace(/^\s*(\[[^\]]*\]|\w+(\([^)]*\))?:)\s*/, '').replace(/\s*\(#\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
const sentence = text => { const first = text.charAt(0).toUpperCase() + text.slice(1); return (/[.!?]$/.test(first) ? first : `${first}.`).slice(0, 160); };
const lead = text => text.split(' ').slice(0, 6).join(' ').replace(/[.,;:]+$/, '').slice(0, 60);

// subjects -> an entry {version, date, channel, plain: true, groups} or null when no subject is fit to show. At most 6 per kind, duplicates once.
export function plainEntry({version, date, channel}, subjects) {
  const kinds = {features: [], improvements: [], fixes: []}, seen = new Set();
  for (const raw of subjects) {
    const text = cleanSubject(raw), key = text.toLowerCase();
    if (text.split(' ').length < 3 || seen.has(key) || FORBIDDEN.test(text)) continue;
    seen.add(key);
    const kind = FIXES.test(text) ? 'fixes' : FEATURES.test(text) ? 'features' : 'improvements';
    if (kinds[kind].length < 6) kinds[kind].push({lead: lead(text), text: sentence(text)});
  }
  const groups = Object.entries(kinds).filter(([, items]) => items.length).map(([kind, items]) => ({kind, items}));
  const entry = {version, date, channel, plain: true, groups};
  return groups.length && !problems(entry).length ? entry : null;
}
