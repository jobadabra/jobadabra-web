// The site's one-card result page (mail confirm, unsubscribe, email settings, the Notion and LinkedIn sign-in returns): a centred card in the app's look,
// the same as the app's Google sign-in page (public repo src/sources/google_page.py: logo, amber glow, two sparks), light or dark by the browser's setting.
// Self-contained (no outside loads). Guard: test/unit/shared/card-page.test.js (every page builder goes through it).
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="56" height="56" role="img" aria-label="Jobadabra">
<rect width="200" height="200" fill="#f5c542"/>
<path d="M52 96 L36 150 Q100 198 164 150 L148 96 Z" fill="#15171c"/>
<ellipse cx="100" cy="84" rx="94" ry="19" fill="#15171c"/>
<ellipse cx="100" cy="82" rx="56" ry="6.5" fill="#f5c542"/>
<path d="M100 4 Q107 33 133 38 Q107 43 103 66 Q102 76 100 84 Q98 76 97 66 Q93 43 67 38 Q93 33 100 4" fill="#15171c"/>
<path d="M110 90 L110 124 Q110 154 87 150 Q75 148 77 138" fill="none" stroke="#f5c542" stroke-width="21" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const CSS = `
:root{--bg:#eef3f7;--card:#fff;--ink:#0f1b2d;--muted:#4c5d72;--line:#d3dde7;--ok:#0e7c7b;--bad:#b42318;--glow:rgb(255 178 36/.35);--spark:#a3470f;--accent:#d0612b;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b1016;--card:#121a23;--ink:#e8ecf0;--muted:#93a1b0;--line:#223040;--ok:#4fd1c5;--bad:#ff8f84;--glow:rgb(255 178 36/.22);--spark:#ffb224;--accent:#e07a45;--on-accent:#140a04;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
main{position:relative;width:min(100%,400px);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px 28px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 0 90px var(--glow)}
main>svg{border-radius:14px}
h1{margin:0;font-size:22px;line-height:1.25}
h1.ok{color:var(--ok)}h1.bad{color:var(--bad)}
p{margin:0;color:var(--muted);font-size:14px}
a{color:var(--accent)}
form{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%}
form.fields{align-items:stretch;text-align:left}
form.fields p{color:var(--ink)}
small{color:var(--muted);font-size:13px}
select{font:inherit;font-size:14px;margin-top:4px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);width:100%}
button{font:inherit;font-weight:600;padding:10px 20px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);cursor:pointer}
button:disabled{opacity:.5;cursor:default}
form.fields button{align-self:center}
.spark{position:fixed;color:var(--spark);font-size:18px;animation:tw 3.2s ease-in-out infinite;pointer-events:none}
@keyframes tw{50%{opacity:.2;transform:scale(.7)}}
@media (prefers-reduced-motion:reduce){.spark{animation:none}}
`;

const esc = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// -> the HTML. `body` is trusted HTML built by the caller; `tone` colours the title ('ok' | 'bad' | '').
export function cardHtml({title, body = '', tone = ''}) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${esc(title)} · Jobadabra</title><style>${CSS}</style></head><body>`
    + '<span class="spark" style="top:12%;left:14%" aria-hidden="true">✦</span><span class="spark" style="bottom:16%;right:12%;animation-delay:1.2s" aria-hidden="true">✦</span>'
    + `<main>${LOGO}<h1${tone ? ` class="${tone}"` : ''}>${esc(title)}</h1>${body}</main></body></html>`;
}

export const cardPage = ({status = 200, ...page}) => new Response(cardHtml(page), {status, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
