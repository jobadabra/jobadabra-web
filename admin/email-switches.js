// The Switches card of /admin/growth/email as real toggles (owner, 5 Nov 2026: "let's make these switches look better" and "be actual switches that I can turn on or off").
// Each row is a form: a button with role="switch" posts to /admin/growth/email/switch (owner only, same origin). Turning one ON asks once on the page itself (no browser dialog, no script): the
// first press comes back with a confirm row, the second stores it. Turning one off is one press. State lives in shared/mail-switches.js. Guard: test/unit/admin/email-switches.test.js.
import {isOwner} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {NAMES, SWITCHES, setSwitch} from '../shared/mail-switches.js';

const PAGE = '/admin/growth/email';

export const SWITCH_STYLE = `.sw-list{display:grid;gap:2px;margin:8px 0 12px}.sw-row{display:grid;grid-template-columns:auto 2.2em minmax(0,1fr);gap:6px 12px;align-items:center;padding:10px 0;border-top:1px solid #2c3340}.sw-row:first-child{border-top:0}
.sw-row form{display:contents}.sw-name{font-weight:600;font-size:14px;overflow-wrap:anywhere}.sw-says{display:block;font-weight:400;font-size:13px;color:#9aa4b2}.sw-state{font-size:13px;font-weight:600;white-space:nowrap}.sw-state.on{color:#4cc38a}.sw-state.off{color:#ff7b70}
.sw{position:relative;width:46px;height:26px;padding:0;border-radius:99px;border:1px solid #3a4352;background:#2a313c;cursor:pointer;transition:background .15s}.sw::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#e6e9ee;transition:transform .15s}
.sw[aria-checked=true]{background:#1f7a52;border-color:#4cc38a}.sw[aria-checked=true]::after{transform:translateX(20px)}.sw:focus-visible{outline:2px solid #f5b54a;outline-offset:3px}@media(prefers-reduced-motion:reduce){.sw,.sw::after{transition:none}}
.sw-ask{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 12px;border:1px solid #f5b54a;border-radius:8px;background:#2a2417;font-size:13px}.sw-ask button{font:inherit;font-size:13px;color:#f5b54a;background:#1b2027;border:1px solid #f5b54a;border-radius:6px;padding:4px 12px;cursor:pointer}.sw-ask a{color:#9aa4b2}`;

const note = row => row.held ? ' · the stored state could not be read, so it is held off' : row.pressed ? ` · pressed ${row.at.slice(0, 16).replace('T', ' ')} UTC${(row.on ? 'on' : 'off') === row.deployed ? '' : ` (the deploy says ${row.deployed})`}` : ' · as deployed';

/** The card. `rows` = switchRows(); `confirm` = the name waiting for its second press; `facts` = the muted line under the list (already escaped). */
export function switchesCard(rows, confirm, facts) {
  const list = rows.map(row => {
    const asking = confirm === row.name && !row.on;
    const form = (state, extra = '') => `<form method="post" action="${PAGE}/switch"><input type="hidden" name="name" value="${esc(row.name)}"><input type="hidden" name="state" value="${state}">${extra}`;
    return `<div class="sw-row">${form(row.on ? 'off' : 'on')}<button class="sw" type="submit" role="switch" aria-checked="${row.on}" aria-label="${esc(row.name)}"></button>
<span class="sw-state ${row.on ? 'on' : 'off'}">${row.on ? 'On' : 'Off'}</span>
<span class="sw-name">${esc(row.name)}<span class="sw-says">${esc(row.says)}${esc(note(row))}</span></span></form>
${asking ? `<div class="sw-ask" role="alert">${form('on', '<input type="hidden" name="confirmed" value="1">')}<span>Turn <b>${esc(row.name)}</b> on? ${esc(row.says)} can then leave.</span><button type="submit">Yes, turn it on</button><a href="${PAGE}#switches">Cancel</a></form></div>` : ''}</div>`;
  }).join('');
  return `<section class="card" id="switches" style="margin-bottom:16px"><h2>Switches</h2><div class="sw-list">${list}</div><span class="muted">${facts}</span></section>`;
}

// POST /admin/growth/email/switch: name, state ('on' | 'off'), confirmed ('1', on only). -> a 303 back to the card.
export async function switchPress(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return new Response('Not found', {status: 404});
  const form = await request.formData().catch(() => new FormData());
  const name = String(form.get('name') || ''), on = form.get('state') === 'on';
  if (!NAMES.includes(name) || !['on', 'off'].includes(String(form.get('state')))) return new Response('Unknown switch.', {status: 400});
  const ask = on && SWITCHES.find(one => one.name === name).ask && form.get('confirmed') !== '1';
  if (!ask) try { await setSwitch(env, name, on); } catch (error) { return new Response(`Not saved: ${error.message}. If the mail_switch table is missing, migration 0137 has not run.`, {status: 503, headers: {'Cache-Control': 'no-store'}}); }
  return new Response(null, {status: 303, headers: {Location: `${PAGE}${ask ? `?confirm=${name}` : ''}#switches`, 'Cache-Control': 'no-store'}});
}
