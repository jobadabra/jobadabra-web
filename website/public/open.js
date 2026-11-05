// Emails use HTTPS; only these fixed destinations can be passed to the desktop app.
// Why (5 Nov 2026, owner): an app without the jobadabra:// scheme ignores the link and the page just sat there. If the browser neither lost focus nor hid the page within 2 s, nothing opened: say so.
const view = new URLSearchParams(location.search).get('view') === 'sessions' ? 'sessions' : 'jobs';
const link = document.getElementById('open-app');
const fallback = document.getElementById('open-fallback');
let handedOver = false;
const away = () => { handedOver = true; };
window.addEventListener('blur', away);
window.addEventListener('pagehide', away);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away(); });
link.href = `jobadabra://${view}`;
location.href = link.href;
setTimeout(() => { if (!handedOver) fallback.hidden = false; }, 2000);
