// Emails use HTTPS; only these fixed destinations can be passed to the desktop app.
const view = new URLSearchParams(location.search).get('view') === 'sessions' ? 'sessions' : 'jobs';
const link = document.getElementById('open-app');
link.href = `jobadabra://${view}`;
location.href = link.href;
