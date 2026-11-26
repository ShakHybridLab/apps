'use strict';
/**
 * waze.js - "Show the phone's map inside the theme" (ShakTheme, page.js Map tab).
 *
 * The underlying tool (package id "waze-on-cluster", Store tile renamed "Maps on cluster" around 20 Nov 2026)
 * was never Waze-only: it captures whatever CarPlay or Android Auto is already drawing as the car's own map -
 * Waze, Apple Maps or Google Maps alike - and this file never special-cases one of them; it only reads the
 * tool's own status file and never which phone app is behind it. Kept the file and class named "waze" (the
 * common case, and the paths below) since the tool's own package id didn't change, only its Store tile name.
 *
 * waze-on-cluster always draws the phone's map on cluster-render's single "map" target, the KOMBI slot under
 * BMW's own gauges and map-view readouts (speed, consumption, badge), which still sit over it there; a see-through
 * hole in a theme shows it in that slot. There is no other target to switch to: reading the real waze-on-cluster
 * source (control.cpp, main.cpp, re-read 20 Nov 2026 after the car kept answering "asked for panel" with its own
 * unchanged status) shows its control socket (/dev/shm/waze-on-cluster/ctl.sock) only branches on three commands -
 * "guide" (hide/show BMW's own turn-by-turn box), "cluster" (turn the whole map on/off) and "hud" - never a
 * "start"/"target" switch. An earlier version of this file assumed such
 * a switch existed (a note here once said so, read from an older pass over the source) and chased it for nothing:
 * Server::on_command just logs "unknown or malformed command" for anything else and sends no reply, so what this
 * file took for "the car's answer" was only ever the tool's own unrelated status broadcast.
 *
 * The real way to put the map inside our own window (above BMW's gauges, framed by our theme) is the file
 * map_window.js writes (Waze on cluster 0.9.107+, protocol documented by Cluster Layouts, eroobeeroo): while that
 * file is fresh, the tool draws its one and only map right inside the window named there instead of its own
 * default centre slot. This file only has to say when the map is there to show; map_window.js (driven from
 * shared/hud.js, this.waze.up) does the asking.
 *
 * What this does (and nothing else):
 *  - reads waze-on-cluster's status file (/run/waze-on-cluster/status.json, 0644, rewritten about once a second:
 *    { state: idle|starting|showing|frozen|error|off|unsupported, target, ... }) every second;
 *  - "up" (the map is showing where we put it) is true while wanted (the setting is on and the theme has a map
 *    layout) and the file says "showing", held for a few seconds after a hiccup (a short "frozen", a half-written
 *    file, a late rewrite) so the theme doesn't rebuild its layers for nothing (the owner saw that flicker, 18
 *    Nov 2026); closing it for real (not wanted any more, "off", or "unsupported") is immediate.
 * Never touched: patch.sock (root). Plain Node 8 (the car's 8.16.2).
 */
const fs = require('fs');

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
const POLL_MS = 1000;
const STALE_MS = 10000;          // a status file older than this: the service isn't running
// the map stays "up" this long after the status file last said "showing": a short "frozen" (the phone's stream stalls), a file read half
// written, or a late rewrite no longer closes the theme's window and opens it again a second later (each is a whole rebuild of the theme's
// layers on the cluster: the owner saw the themes flicker). Turning the map off (the setting, "off", unsupported) is at once.
// 10 s since 22 Nov 2026 (owner: "les thèmes buggent des fois, il n'y a plus aucun chiffre"; on the bench every change of the map is a whole new set
// of text sheets, a second or more with no number on the cluster, and Maps on Cluster's stream had been stalling on and off): a stall under 10 s
// leaves the theme as it is, the window black meanwhile
const DOWN_HOLD_MS = 10000;

class Waze {
    /**
     * opts: { status }; env WAZE_STATUS overrides the path (the Mac bench's fake).
     * onChange(): called when "up" (the map is showing inside the theme) or the page's status text changes.
     */
    constructor(opts, log, onChange) {
        opts = opts || {};
        this.statusPath = process.env.WAZE_STATUS || opts.status || STATUS_PATH;
        this.log = log;
        this.onChange = onChange || (() => {});
        this.wanted = false;
        this.st = null;              // the last status read: { state, target } or null (no file / unreadable / stale)
        this.up = false;             // the map is showing where we want it (map_window.js), from the tool's own status
        this.lastText = null;
        this.now = opts.now || Date.now;
        this.showAt = 0;             // when the status file last said "showing"
    }

    start() {
        this.timer = setInterval(() => this._poll(), POLL_MS);
        this._poll();
    }

    stop() {
        clearInterval(this.timer);
    }

    /** Whether the theme wants the map in its window now (the setting, and a layout with a map window). */
    want(on) {
        on = on === true;
        if (on === this.wanted) return;
        this.wanted = on;
        this._update(this.st);
    }

    /** For the page: { text, up, ok } (ok: false when something is wrong). */
    info() {
        const s = this.st;
        if (!s) return { text: 'Maps on Cluster isn\'t running', up: false, ok: false };
        if (s.state === 'unsupported') return { text: 'Maps on Cluster: this car isn\'t supported', up: false, ok: false };
        if (s.state === 'off') return { text: 'The phone\'s map is turned off', up: false, ok: false };
        if (!this.wanted) return { text: 'Off. The phone\'s map shows in BMW\'s own map view', up: false, ok: true };
        if (s.state === 'showing') return { text: 'Map showing in the theme', up: true, ok: true };
        if (s.state === 'frozen') return { text: 'Map frozen, waiting for the phone', up: false, ok: false };
        if (s.state === 'error') return { text: 'Maps on Cluster reports an error', up: false, ok: false };
        return { text: 'Waiting for the map', up: false, ok: true };
    }

    /** _update from a file callback: an error there would be an uncaught one (the kit exits on those), so it is caught and said once. */
    _safeUpdate(s) {
        try { this._update(s); } catch (e) {
            if (!this.pollWarned) { this.pollWarned = true; if (this.log) this.log.warn('waze: status not handled (' + (e && e.message || e) + ')'); }
        }
    }

    _poll() {
        if (this.polling) return;            // the last read has not come back (a slow disk): no second one on top of it
        this.polling = true;
        fs.stat(this.statusPath, (err, st) => {
            if (err || this.now() - st.mtime.getTime() > STALE_MS) { this.polling = false; return this._safeUpdate(null); }
            fs.readFile(this.statusPath, 'utf8', (e, txt) => {
                this.polling = false;
                let s = null;
                try { if (!e) { const j = JSON.parse(txt); s = { state: String(j.state || ''), target: j.target == null ? null : String(j.target), raw: rawOf(j), detail: (typeof j.page === 'string' ? j.page : '').slice(0, 300), keys: Object.keys(j).join(',') }; } } catch (x) { s = null; }
                this._safeUpdate(s);
            });
        });
    }

    _update(s) {
        const was = this.st ? this.st.state : null, now = s ? s.state : null;
        if (now !== was) { this.stateAt = this.now(); this.stateWas = was; }   // (a gap of the theme notes how long ago the map changed state)
        this.st = s;
        const keys = s ? s.keys : '';
        if (keys !== this.lastKeys) { this.lastKeys = keys; if (s && this.log) this.log.info('Waze on cluster status file: ' + s.raw); }
        const showing = !!(this.wanted && s && s.state === 'showing');
        if (showing) this.showAt = this.now();
        // gone for good at once: not wanted any more, or the tool says the map is off / unsupported
        const gone = !this.wanted || (s && (s.state === 'off' || s.state === 'unsupported'));
        const held = this.now() - this.showAt;        // (a clock set back must not hold the window open for as long as it went back)
        const up = showing || (this.up && !gone && held >= 0 && held < DOWN_HOLD_MS);
        const text = this.info().text;
        const changed = up !== this.up || text !== this.lastText;
        this.up = up;
        this.lastText = text;
        if (changed) this.onChange();
    }
}

Waze.rawOf = rawOf;
module.exports = Waze;
module.exports.DOWN_HOLD_MS = DOWN_HOLD_MS;
