'use strict';
/**
 * limits_app.js - ShakLimites: the speed limit of the road from the map (limits_map.js) and the car's GPS position (gps_pos.js), handed to
 * ShakTheme's limit ring the way speedlimit.js reads it:
 *
 *   /dev/shm/cluster-themes/speedlimit-shaklimites.json   { "t": <ms>, "app": "ShakLimites", "limit": <km/h> }
 *
 * once a second while a limit is known. A limit is said only when it is sure enough: the same limit found on SAME_N positions in a row
 * (a junction, a bridge over another road, a parallel road give one odd reading); it goes after GONE_N positions without any road, and
 * another limit takes its place once it is confirmed the same way.
 * The heading comes from the car's own movement (two positions MOVE_M apart); standing still, the last limit stays while the car stays
 * within STAY_M of where it was found. No position for POS_STALE_MS: nothing.
 * Everything outside goes through `deps` ({ map, now, dir, log }), so tools/test_limits.js runs it without a car. Node 8. MIT.
 */
const fs = require('fs');
const path = require('path');
const gps = require('./gps_pos');
const { bearing } = require('./limits_map');

const THEMES_DIR = process.env.CLUSTER_THEMES_DIR || '/dev/shm/cluster-themes';
const FILE = 'speedlimit-shaklimites.json';
const WRITE_MS = 1000;
const POS_STALE_MS = 5000;
const SAME_N = 2;            // positions in a row with the same limit before it is said
const GONE_N = 4;            // positions in a row without a road before the limit goes
const MOVE_M = 6;            // the car moved this far: a heading can be read from it
const STAY_M = 15;
const EVERY_MS = 900;        // one position a second is plenty

class LimitsApp {
    constructor(deps) {
        this.d = deps;
        this.now = deps.now || Date.now;
        this.dir = deps.dir || THEMES_DIR;
        this.pos = null;            // { lat, lon, at }
        this.from = null;           // the position the heading is counted from
        this.heading = null;
        this.raw = { pos: null, n: 0 };
        this.cand = null;           // { limit, n }
        this.limit = null;          // the limit found on the map now
        this.guess = false;         // the limit written is the fallback (no road with a limit here), not one from the map
        this.at = null;             // where it was last found
        this.gone = 0;
        this.last = null;           // the last match (for the screen)
        this.why = 'no position yet';
        this.writing = false; this.writeError = null;
        this.timer = null;
    }

    /** A GPSPositionCAN value. */
    position(v) {
        const t = this.now();
        this.raw.pos = v; this.raw.n++;
        if (this.pos && t >= this.pos.at && t - this.pos.at < EVERY_MS) return;
        const p = gps.position(v);
        if (!p) { this.why = 'position not understood'; return; }
        this.pos = { lat: p.lat, lon: p.lon, at: t };
        if (!this.from) this.from = this.pos;
        else {
            const b = bearing(this.from.lat, this.from.lon, p.lat, p.lon);
            if (b.m >= MOVE_M) { this.heading = b.deg; this.from = this.pos; }
        }
        this._step();
    }

    _step() {
        const map = this.d.map, p = this.pos;
        if (!map || !map.ready()) { this.why = 'no map'; return; }
        const m = map.match(p.lat, p.lon, this.heading);
        this.last = m;
        if (!m) {
            // standing where the limit was found: it stays (a car stopped at a light has no heading worth the name, and its position drifts)
            if (this.limit !== null && this.at && bearing(this.at.lat, this.at.lon, p.lat, p.lon).m <= STAY_M) { this.why = 'standing'; return; }
            this.cand = null;
            if (++this.gone >= GONE_N) { this.limit = null; this.why = 'no road with a limit here'; }
            return;
        }
        this.gone = 0;
        if (m.limit === this.limit) { this.at = p; this.cand = null; this.why = 'on the road'; return; }
        this.cand = this.cand && this.cand.limit === m.limit ? { limit: m.limit, n: this.cand.n + 1 } : { limit: m.limit, n: 1 };
        if (this.cand.n >= SAME_N) { this.limit = m.limit; this.at = p; this.cand = null; this.why = 'on the road'; }
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { if (this.d.log) this.d.log.warn('limits: ' + (e && e.message || e)); } }, WRITE_MS);
        if (this.timer.unref) this.timer.unref();
    }

    stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } this._clear(); }

    tick() {
        const t = this.now();
        if (this.pos && (t - this.pos.at > POS_STALE_MS || t < this.pos.at)) { this.limit = null; this.cand = null; this.why = 'position too old'; }
        // No road with a limit under a fresh position: mostly a street the map does not carry, so the owner asked for the town limit (deps.fallback,
        // km/h) instead of an empty ring. It is a guess and the file says so ("guess": true).
        const fb = this.limit === null && this.why === 'no road with a limit here' && this.d.fallback ? this.d.fallback() : null;
        const said = this.limit !== null ? this.limit : fb > 0 ? Math.round(fb) : null;
        this.guess = this.limit === null && said !== null;
        this.said = said;
        if (said === null) { this._clear(); return; }
        try {
            // the folder, then the second one when the first is another app's and closed (radar_app.js says why); shared/speedlimit.js reads both
            const body = JSON.stringify(this.guess ? { t, app: 'ShakLimites', limit: said, guess: true } : { t, app: 'ShakLimites', limit: said });
            let err = null;
            for (const d of [this.dir, this.dir + '.shak']) {
                try {
                    try { fs.mkdirSync(d, 0o777); } catch (e) { /* there */ }
                    try { fs.chmodSync(d, 0o777); } catch (e) { /* not ours: another app made it */ }
                    const g = path.join(d, FILE);
                    fs.writeFileSync(g + '.tmp', body, { mode: 0o644 });
                    fs.renameSync(g + '.tmp', g);
                    err = null; break;
                } catch (e) { if (!err) err = e; }
            }
            if (err) throw err;
            this.writing = true; this.writeError = null;
        } catch (e) { this.writeError = String(e && e.code || e); }
    }

    _clear() {
        if (!this.writing) return;
        this.writing = false;
        try { fs.unlinkSync(path.join(this.dir, FILE)); } catch (e) { /* gone */ }
        try { fs.unlinkSync(path.join(this.dir + '.shak', FILE)); } catch (e) { /* gone */ }
    }

    state() {
        const t = this.now();
        return { pos: this.pos ? { lat: this.pos.lat, lon: this.pos.lon, age: t - this.pos.at } : null, heading: this.heading, raw: this.raw, last: this.last,
            cand: this.cand, limit: this.limit, said: this.said === undefined ? null : this.said, guess: this.guess, why: this.why, writing: this.writing, writeError: this.writeError };
    }
}

module.exports = { LimitsApp, FILE, SAME_N, GONE_N };
