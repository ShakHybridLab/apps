'use strict';
/**
 * survive.js - an error nobody caught must not close the app.
 *
 * The kit (kit/runtime/mgu.js) logs an uncaught exception and exits with code 1. On the car an unexpected exit makes
 * CorruptAppsHandler wipe the app's data (the settings), and a second one uninstalls the app: one slip in a timer or in a socket
 * callback, on a value the car sends once a month, and the theme is gone from the car. These apps only draw: after such an error
 * the next timer tick starts from the car's data again, so staying up is the safer side.
 *
 *   const survive = require('./survive');
 *   survive.install(ctx.log);        // first thing in start(ctx)
 *
 * The error is written to the app's log (whole for the first ones, then one line every QUIET_MS with the count: an error that
 * repeats at the gauges' rate must not fill the log) and counted: state() gives { n, last, at } for a page to show, since the
 * owner reads the screen, not the log. Installed once per process (a second call returns the same state).
 *
 * Only where the kit's listener is (the car): on a desk (the bench, the tests: kit/tools/hu-stub.js stands in for the kit) nothing
 * listens, and Node's own way (the stack, then exit) is what shows a mistake there; install(log, { always: true }) takes over anyway.
 * Node 8. MIT.
 */
const WHOLE = 5;              // the first errors are logged with their stack
const QUIET_MS = 10000;       // then one line at most this often

function install(log, opts) {
    opts = opts || {};
    const proc = opts.proc || process;
    if (proc.__shakSurvive) return proc.__shakSurvive;
    const st = { n: 0, last: '', at: 0, shownAt: 0, hidden: 0, on: false };
    if (!opts.always && proc.listenerCount('uncaughtException') === 0) return st;      // a desk: Node's own way stays
    const onError = (e) => {
        const now = Date.now();
        st.n++; st.at = now;
        try { st.last = String(e && e.message || e).slice(0, 160); } catch (x) { st.last = 'error'; }
        try {
            if (st.n <= WHOLE) log.error('uncaught (the app keeps running): ' + (e && e.stack || e));
            else if (now - st.shownAt >= QUIET_MS) {
                log.error('uncaught (the app keeps running), ' + st.n + ' so far' + (st.hidden ? ', ' + st.hidden + ' not shown' : '') + ': ' + st.last);
                st.hidden = 0;
            } else { st.hidden++; return; }
            st.shownAt = now;
        } catch (x) { /* the log itself failed: nothing more to do, and nothing to throw */ }
    };
    // the kit's own listener exits: ours takes its place (a listener left beside it would still exit)
    proc.removeAllListeners('uncaughtException');
    proc.on('uncaughtException', onError);
    st.onError = onError; st.on = true;
    proc.__shakSurvive = st;
    return st;
}

/** { n, last, at } of the errors survived so far in this process, or null when install() was never called. */
function state(proc) {
    const st = (proc || process).__shakSurvive;
    return st ? { n: st.n, last: st.last, at: st.at } : null;
}

module.exports = { install, state, WHOLE, QUIET_MS };
