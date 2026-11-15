'use strict';
/**
 * waze.js - "Show Waze map inside the theme" (ShakTheme, page.js Map tab).
 *
 * waze-on-cluster draws the phone's map on cluster-render's "map" target by default: the KOMBI
 * slot UNDER BMW's gauges, so BMW's own map-view readouts (speed, consumption, badge) always sit over it and a
 * see-through hole in a theme shows them too. Nothing can hide that overlay. Its other target, "panel", puts
 * the map inside the panel scene our theme draws on, ABOVE BMW's gauges: our frame is drawn over it with a
 * rounded window, our readouts over that, BMW's overlay under all of it.
 *
 * What this does (and nothing else):
 *  - reads waze-on-cluster's status file (/run/waze-on-cluster/status.json, 0644, rewritten about once a second:
 *    { state: idle|starting|showing|frozen|error|off|unsupported, target, ... }) every second;
 *  - while wanted (the setting is on and the theme has a map layout) and the map isn't on "panel": connects to
 *    its control socket (/dev/shm/waze-on-cluster/ctl.sock, group tm_oap_app), writes {"cmd":"start","target":
 *    "panel"}, and closes again within a second. The socket has one owner: the Waze app holds it while its page
 *    is open and a second connection is told "busy" and closed, so we never hold it and retry every 5 s;
 *  - when no longer wanted, and only if WE moved it, sends "start map" once so Waze is back where it was (the
 *    panel shares its scene with the HUD, so leaving it there would block HUD Widgets and Waze's HUD map).
 * "start" isn't saved by waze-on-cluster (a restart of its service puts it back on "map"); we just send it again.
 * Never sent: "cluster" (would turn the map off), "guide" (saved by the tool). Never touched: patch.sock (root).
 * Facts from the waze-on-cluster 0.9.3 source (main.cpp, control.cpp, map_feed.cpp, the .socket unit), read
 * Nov 7 2026. Plain Node 8 (the car's 8.16.2).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');

const STATUS_PATH = '/run/waze-on-cluster/status.json';

/** The whole status file on one line ("key=value key=value ..."), for the Map tab and the log: this app reads only state and target, and
 *  the owner was asked what else the file holds (a position would let the radar list work). Numbers to 5 decimals, long values cut. */
function rawOf(j) {
    if (!j || typeof j !== 'object') return '';
    const v = (x) => {
        if (typeof x === 'number') return String(Math.round(x * 1e5) / 1e5);
        if (typeof x === 'string') return x.length > 30 ? x.slice(0, 29) + '…' : x;
        let t = '';
        try { t = JSON.stringify(x); } catch (e) { t = String(x); }
        return t.length > 40 ? t.slice(0, 39) + '…' : t;
    };
    return Object.keys(j).slice(0, 24).map((k) => k + '=' + v(j[k])).join(' ').slice(0, 400);
}
const CONTROL_PATH = '/dev/shm/waze-on-cluster/ctl.sock';
const POLL_MS = 1000;
const STALE_MS = 10000;          // a status file older than this: the service isn't running
const RETRY_MS = 5000;           // between two sends (busy, error, or waiting for the status to show the switch)
const LINGER_MS = 800;           // how long we stay connected after the command (its answer, then close)

class Waze {
    /**
     * opts: { status, control, dataDir }; env WAZE_STATUS / WAZE_CTL override the paths (the Mac bench's fake).
     * onChange(): called when "up" (the map is showing inside the theme) or the page's status text changes.
     */
    constructor(opts, log, onChange) {
        opts = opts || {};
        this.statusPath = process.env.WAZE_STATUS || opts.status || STATUS_PATH;
        this.controlPath = process.env.WAZE_CTL || opts.control || CONTROL_PATH;
        this.memo = opts.dataDir ? path.join(opts.dataDir, 'waze.json') : null;
        this.log = log;
        this.onChange = onChange || (() => {});
        this.wanted = false;
        this.st = null;              // the last status read: { state, target } or null (no file / unreadable / stale)
        this.up = false;             // the map is showing on the panel
        this.sending = false;
        this.nextTry = 0;
        this.problem = null;         // 'busy' | an error text, from the last send
        this.moved = false;          // we put it on the panel (so we put it back)
        try { this.moved = JSON.parse(fs.readFileSync(this.memo, 'utf8')).moved === true; } catch (e) { /* first run */ }
        this.lastText = null;
    }

    start() {
        this.timer = setInterval(() => this._poll(), POLL_MS);
        this._poll();
    }

    /** Stop polling; if we moved the map, ask once for it back on "map" (best effort: the process may be exiting). */
    stop() {
        clearInterval(this.timer);
        if (this.moved && this.st && this.st.target === 'panel') this._send('map');
    }

    /** Whether the theme wants the map on the panel now (the setting, and a layout with a map window). */
    want(on) {
        on = on === true;
        if (on === this.wanted) return;
        this.wanted = on;
        this.nextTry = 0;
        this._sync();
    }

    /** For the page: { text, up, ok } (ok: false when something is wrong). */
    info() {
        const s = this.st;
        if (!s) return { text: 'Waze on Cluster isn\'t running', up: false, ok: false };
        if (s.state === 'unsupported') return { text: 'Waze on Cluster: this car isn\'t supported', up: false, ok: false };
        if (s.state === 'off') return { text: 'Waze map is turned off in the Waze app', up: false, ok: false };
        if (!this.wanted) return { text: 'Off. Waze shows the map in BMW\'s own map view', up: false, ok: true };
        if (s.target !== 'panel') {
            if (this.problem === 'busy') return { text: 'Waze app is open, retrying', up: false, ok: false };
            if (this.problem) return { text: 'Can\'t reach Waze on Cluster (' + this.problem + ')', up: false, ok: false };
            return { text: 'Moving the map into the theme', up: false, ok: true };
        }
        if (s.state === 'showing') return { text: 'Map showing in the theme', up: true, ok: true };
        if (s.state === 'frozen') return { text: 'Map frozen, waiting for the phone', up: false, ok: false };
        if (s.state === 'error') return { text: 'Waze on Cluster reports an error', up: false, ok: false };
        return { text: 'Waiting for the map', up: false, ok: true };
    }

    _poll() {
        fs.stat(this.statusPath, (err, st) => {
            if (err || Date.now() - st.mtime.getTime() > STALE_MS) return this._update(null);
            fs.readFile(this.statusPath, 'utf8', (e, txt) => {
                let s = null;
                try { if (!e) { const j = JSON.parse(txt); s = { state: String(j.state || ''), target: j.target == null ? null : String(j.target), raw: rawOf(j), keys: Object.keys(j).join(',') }; } } catch (x) { s = null; }
                this._update(s);
            });
        });
    }

    _update(s) {
        this.st = s;
        const keys = s ? s.keys : '';
        if (keys !== this.lastKeys) { this.lastKeys = keys; if (s && this.log) this.log.info('Waze on cluster status file: ' + s.raw); }
        if (s && s.target === 'map' && !this.wanted && this.moved) this._setMoved(false);   // it's back
        if (s && s.target === 'panel' && this.problem) this.problem = null;
        const up = !!(this.wanted && s && s.target === 'panel' && s.state === 'showing');
        const text = this.info().text;
        const changed = up !== this.up || text !== this.lastText;
        this.up = up;
        this.lastText = text;
        this._sync();
        if (changed) this.onChange();
    }

    _sync() {
        const s = this.st;
        if (this.sending || Date.now() < this.nextTry || !s) return;
        if (s.state === 'unsupported' || s.state === 'off') return;
        if (this.wanted && s.target !== 'panel') this._send('panel');
        else if (!this.wanted && this.moved && s.target === 'panel') this._send('map');
    }

    _send(target) {
        this.sending = true;
        this.nextTry = Date.now() + RETRY_MS;
        let answer = '', done = false;
        const sock = net.connect(this.controlPath);
        const finish = (problem) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            try { sock.destroy(); } catch (e) { /* closed */ }
            this.sending = false;
            if (/"reason"\s*:\s*"busy"/.test(answer)) problem = 'busy';
            this.problem = problem || null;
            if (!this.problem) {
                this.log.info('waze: asked for the map on "' + target + '"');
                if (target === 'panel') this._setMoved(true);
            } else this.log.info('waze: "start ' + target + '" not sent (' + this.problem + '), retrying in ' + RETRY_MS / 1000 + ' s');
        };
        const t = setTimeout(() => finish(null), LINGER_MS + 1000);
        sock.setEncoding('utf8');
        sock.on('data', (d) => { if (answer.length < 4096) answer += d; });
        sock.on('error', (e) => finish(e.code || e.message));
        sock.on('close', () => finish(null));
        sock.on('connect', () => {
            sock.write(JSON.stringify({ cmd: 'start', target }) + '\n');
            setTimeout(() => { try { sock.end(); } catch (e) { /* closed */ } }, LINGER_MS);
        });
    }

    _setMoved(on) {
        this.moved = on;
        if (!this.memo) return;
        try { fs.writeFileSync(this.memo, JSON.stringify({ moved: on })); } catch (e) { this.log.warn('waze: cannot save ' + this.memo + ' (' + e.message + ')'); }
    }
}

Waze.rawOf = rawOf;
module.exports = Waze;
