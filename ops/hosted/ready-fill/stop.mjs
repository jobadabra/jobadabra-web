// What the Ready to send container does when Cloudflare stops it (sleepAfter, a deploy): stop taking calls, close the night's browser, exit 0.
// Why (5 Nov 2026, hr, after staging try 6 of Always on): the container's process is PID 1, and Linux does not deliver a signal with its default action to PID 1.
// Node installs no SIGTERM handler, so the stop was ignored and a 4 GiB container stayed up after its 3 hours. The grace period bounds a browser that will not close.
// A stop during a running night loses that night (no result posted); the next tick finishes it (api/ready-tick.js), as it does for any night that never posts.
export function onStop(proc, server, closeNight, {graceMs = 10000, log = () => {}} = {}) {
  let stopping = false;
  proc.on('SIGTERM', () => {
    if (stopping) return;
    stopping = true;
    log('stopping');
    setTimeout(() => { log('stop grace ended'); proc.exit(0); }, graceMs).unref();
    try {
      server.close();
      server.closeAllConnections?.();   // idle keep-alive HTTP calls; the live view's WebSockets left the server on upgrade, so closeNight closes those
    } catch { /* the process ends anyway */ }
    Promise.resolve().then(closeNight).catch(() => {}).finally(() => proc.exit(0));
  });
}
