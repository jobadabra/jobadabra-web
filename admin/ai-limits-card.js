// "Where each subscription stands" on the AI cost page (owner, 4 Nov 2026: "80% used on Claude, (resets at x time)... 50% used on Codex (reset at x)"): one ring per window the providers report, from the broker's /health.
// Words, chips and a ring; times in Zurich. The 90% tick on the Claude week is where the broker stops starting Claude calls (workers/ai-broker/lib/budget.mjs); Codex runs to 100%. Guard: test/admin/ai-limits-card.test.js.
import {esc} from '../shared/html.js';

const C = 2 * Math.PI * 60;   // ring circumference at r=60
const WARN = 70, BAD = 90;   // Why (4 Nov 2026, owner-approved sketch): amber from 70%, red from 90%; 8 Nov 2026: red is also where the broker stops using Claude (owner: "Claude up to 90%"), 70% stopped being a stop line
const WHERE = 'Europe/Zurich';

/** Page CSS for the card; the page's own dark tokens stay, the rest are local. */
export const LIMITS_CSS = `.rings{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:12px}.ring{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.ring svg{width:130px;height:130px}.ring .num{font:700 30px/1 system-ui,sans-serif;fill:var(--text);font-variant-numeric:tabular-nums}.ring .sub{font-size:12px;fill:var(--muted)}
.ring .who{font-weight:600}.ring .when{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}.chip{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid currentColor}
.chip::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}.chip.good{color:#3fcf82}.chip.warn{color:#f0b429}.chip.bad{color:#ff6b6b}.chip.off{color:var(--muted)}`;

const TONES = {good: '#3fcf82', warn: '#f0b429', bad: '#ff6b6b', off: '#8d949c'};
const COLOURS = {codex: '#7c93ff', claude: '#f2994a', free: '#9aa2bd'};

/** -> 'good' | 'warn' | 'bad' for a used percentage. */
export const toneOf = pct => (pct >= BAD ? 'bad' : pct >= WARN ? 'warn' : 'good');
const WORDS = {good: 'Plenty left', warn: 'Getting full', bad: 'Nearly used up', off: ''};

/** "Wed 11 Nov, 09:41" in Zurich time from epoch ms. */
export function zurich(ms) {
  const part = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: WHERE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${part.weekday} ${part.day} ${part.month}, ${part.hour}:${part.minute}`;
}

/** "in 6 d 9 h", "in 3 h 20 min", "in 20 min", "now" from a span in ms. */
export function inWords(span) {
  const min = Math.max(0, Math.round(span / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `in ${min} min`;
  if (min < 1440) return `in ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const total = Math.round(min / 60), days = Math.floor(total / 24), hours = total % 24;   // rounded once in hours so "24 h" never prints
  return `in ${days} d${hours ? ` ${hours} h` : ''}`;
}

/** One ring. `pct` null: no reading (the ring is empty and says so). `tick`: a marker at that percent. */
function ring({key, who, label, pct, tone, resets, now, note, tick, sub, word}) {
  const used = pct === null ? 0 : Math.min(100, Math.max(0, pct)), colour = COLOURS[key];
  const marker = tick ? `<line x1="70" y1="5" x2="70" y2="19" stroke="#e9ecf8" stroke-width="2" opacity=".6" transform="rotate(${(tick * 3.6).toFixed(1)} 70 70)"/>` : '';
  const chip = pct === null ? `<span class="chip off">${esc(word || 'No reading yet')}</span>` : `<span class="chip ${tone}">${esc(word || WORDS[tone])}</span>`;
  return `<div class="ring"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(`${label}, ${pct === null ? 'no reading' : `${Math.round(used)} percent used`}`)}">
<circle cx="70" cy="70" r="56" fill="none" stroke="#262c47" stroke-width="13"/>
<circle cx="70" cy="70" r="56" fill="none" stroke="${tone === 'warn' || tone === 'bad' ? TONES[tone] : colour}" stroke-width="13" stroke-linecap="${used > 0 ? 'round' : 'butt'}" stroke-dasharray="${(used / 100 * C * 56 / 60).toFixed(1)} 400" transform="rotate(-90 70 70)"/>${marker}
<text x="70" y="75" text-anchor="middle" class="num">${pct === null ? '–' : `${Math.round(used)}%`}</text><text x="70" y="93" text-anchor="middle" class="sub">${esc(sub)}</text></svg>
<span class="who" style="color:${colour}">${esc(who)}</span>${chip}
<span class="when">${resets ? `Resets ${esc(zurich(resets))} (${esc(inWords(resets - now))})` : '&nbsp;'}</span><small class="muted">${esc(note)}</small></div>`;
}

/** The rings for a /health answer (`limits` from shared/ai-broker.js subscriptionOf, `fallback` the Free AI day). `nowMs` is epoch ms. -> [{key, who, pct (0..100 rounded once, or null), word?, ...}] */
export function windows(limits, fallback, nowMs = Date.now()) {
  // Why (4 Nov 2026): the last reading is kept until the next call; a window whose reset is missing or past is stale and shows no number rather than an old one (Codex's "never read" is resetsAt 0).
  const live = at => Number.isFinite(at) && at * 1000 > nowMs;
  const clamp = n => Math.min(100, Math.max(0, Math.round(n)));   // rounded once: the chip, the number and the verdict all read this value
  // The provider's own word beats our percent (a review finding, 5 Nov 2026): 'allowed_warning' is amber, anything else but 'allowed' is a limit hit, whatever the number says.
  const provider = status => (!status || status === 'allowed' ? null : status === 'allowed_warning' ? {tone: 'warn', word: 'Provider warns'} : {tone: 'bad', word: 'Limit reached'});
  const claudeWin = (w, who, sub, note, tick) => {
    const ok = w && live(w.resetsAt), state = w?.status ? provider(w.status) : provider(limits?.claude?.status);   // the window's own word wins, 'allowed' included (Gitar on #376)
    return {key: 'claude', who, label: who, sub, pct: ok ? clamp(w.utilization * 100) : null, resets: ok ? w.resetsAt * 1000 : 0, note: ok ? note : 'Read again at the next Claude call', state: ok ? state : null, ...(tick ? {tick} : {})};
  };
  const codex = limits?.codex, codexOk = codex && live(codex.resetsAt);
  const free = fallback && Number.isFinite(fallback.freeAi) && Number.isFinite(fallback.freeAiCap) ? fallback : null, freeOn = free && free.freeAiCap > 0;
  const nextUtc = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate() + 1);
  return [
    {key: 'codex', who: 'Codex', label: 'Codex week', sub: 'of the week', pct: codexOk ? clamp(codex.usedPercent) : null, resets: codexOk ? codex.resetsAt * 1000 : 0, note: codexOk ? 'Every job may use it to 100%' : 'Read at the next Codex call'},
    claudeWin(limits?.claude?.sevenDay, 'Claude, week', '7-day window', 'Tick at 90%: no job starts a Claude call past it', 90),
    claudeWin(limits?.claude?.fiveHour, 'Claude, 5 hours', '5-hour window', 'The provider\u2019s own 5-hour window'),
    {key: 'free', who: 'Free AI, today', label: 'Free AI today', sub: free ? `$${free.freeAi.toFixed(2)} of $${free.freeAiCap.toFixed(2)}` : 'no reading', pct: freeOn ? clamp(free.freeAi / free.freeAiCap * 100) : null, resets: freeOn ? nextUtc : 0, note: freeOn ? 'The last stop: a daily dollar cap' : free ? 'Off: its daily cap is 0' : 'Not read', word: free && !freeOn ? 'Off' : ''},
  ];
}

/** The card: a verdict chip and one ring per window (null limits: the broker could not be read). */
export function limitsCard(limits, fallback, nowMs = Date.now()) {
  if (!limits) return '<section class="card" id="ai-limits"><p class="muted" style="margin:0">Where each subscription stands: data unavailable</p></section>';
  const rings = windows(limits, fallback, nowMs).map(w => {
    const tone = w.pct === null ? 'off' : (w.state && (w.state.tone === 'bad' || toneOf(w.pct) === 'good') ? w.state.tone : toneOf(w.pct));
    return {...w, tone, word: w.state?.word || w.word};
  });
  const known = rings.filter(w => w.pct !== null), top = [...known].sort((a, b) => b.pct - a.pct)[0];
  const rank = w => ({bad: 2, warn: 1, good: 0}[w.tone] ?? -1) * 1000 + (w.state ? 100 : 0) + (w.pct ?? 0);   // the most severe ring speaks: red before amber, a provider word before a bare percent (Gitar on #376)
  const worst = known.slice().sort((x, y) => rank(y) - rank(x))[0];
  const verdict = !worst ? ['off', 'No limit read yet'] : worst.tone === 'good' ? ['good', 'Nothing near a limit'] : [worst.tone, worst.state ? `${worst.who}: ${worst.state.word.toLowerCase()}` : `${worst.who} at ${worst.pct}%`];
  return `<section class="card" id="ai-limits"><h2>🎯 Where each subscription stands</h2><small class="muted">The broker tries Codex first, then Claude, then Free AI. Each ring is one window the provider itself reports. Times are Zurich.</small>
<p style="margin:10px 0 0"><span class="chip ${verdict[0]}">${esc(verdict[1])}</span> <small class="muted">${top ? `Highest: ${esc(top.who)} at ${top.pct}%. ` : ''}Codex runs to 100% of its week, Claude to 90% of its week.</small></p>
<div class="rings">${rings.map(w => ring({...w, now: nowMs})).join('\n')}</div></section>`;
}
