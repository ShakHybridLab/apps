'use strict';
/**
 * radar_app.js - ShakRadar : the danger zone alert of ShakTheme fed by the car's own GPS position (GPSData, gps_pos.js) and the list of
 * French danger zones (radar_zones.js). It writes the file danger.js reads:
 *
 *   /dev/shm/cluster-themes/danger-shakradar.json   { "t": <ms>, "app": "ShakRadar", "distance": <metres to the zone>, "limit": <km/h, optional> }
 *
 * once a second while a zone is ahead (within WITHIN_M of its edge, 500 m, or the car inside it), and removes it otherwise. A zone the car is
 * moving away from (its centre farther than it was AWAY_M ago, the car outside it) is not ahead: no alert behind the car, whatever the
 * heading the car may or may not give. No position for POS_STALE_MS: no alert (a tunnel, a car parked, the GPS not answering).
 * The wording stays the law's: a "danger zone" and a distance, nothing says what is there.
 *
 * Everything outside (the clock, the files) goes through `deps`, so tools/test_radar_app.js runs it without a car. Node 8. MIT.
 */
const fs = require('fs');
const path = require('path');
const gps = require('./gps_pos');

const THEMES_DIR = process.env.CLUSTER_THEMES_DIR || '/dev/shm/cluster-themes';
const FILE = 'danger-shakradar.json';
const WITHIN_M = 1000;           // the alert starts this far from a zone's edge (2000 until Nov 19 2026: on a road it came on 4 km before the camera,
                                // on a motorway 6 km, and stayed on so long that nobody looked at it; the zones keep their size)
const POS_STALE_MS = 5000;      // a position older than this is no position
const WRITE_MS = 1000;          // danger.js counts a file older than 3 s as gone
const AWAY_M = 30;              // moved this much farther from the zone's centre (over the last positions): going away from it
const TRAIL = 6;
const MOVE_M = 8;               // the car moved this far: a heading can be read from it                // positions kept to tell coming from going

class RadarApp {
    /** deps: { zones (a RadarZones), now(), dir, log, enabled() } */
    constructor(deps) {
        this.d = deps;
        this.now = deps.now || Date.now;
        this.dir = deps.dir || THEMES_DIR;
        this.file = deps.file || FILE;          // (ShakTheme writes its own file: ShakRadar, if it is still installed, keeps its own)
        this.app = deps.app || 'ShakRadar';
        this.onZone = deps.onZone || null;      // (o | null): the zone handed over in memory too (ShakTheme's own alert, danger.js feed)
        this.pos = null;             // { lat, lon, how, at }
        this.from = null; this.heading = null;      // see position()
        this.ext = null;             // gps.extended() of the last GPSPositionExtendedCAN
        this.raw = { pos: null, ext: null, posN: 0, extN: 0, posAt: 0, extAt: 0 };
        this.trail = [];             // [{ key (zone), centreM, at }]
        this.near = null; this.nearKey = null;      // the nearest the car has been to the centre of the zone it is at (nearKey), metres
        this.zone = null;            // the zone the alert is about now: { edgeM, centreM, inside, limit, lat, lon }, or null
        this.why = 'no position yet';
        this.writing = false; this.writtenAt = 0; this.writeError = null;
        this.timer = null;
    }

    /** A GPSPositionCAN value. */
    position(v) {
        const t = this.now();
        this.raw.pos = v; this.raw.posN++; this.raw.posAt = t;
        // `everyMs` (ShakTheme: 2 s): the car sends a position every second, a zone is 2 km wide: one in two is enough, the others cost nothing
        if (this.d.everyMs && this.pos && t >= this.pos.at && t - this.pos.at < this.d.everyMs) return;
        const p = gps.position(v);
        if (!p) return;
        // the car's heading, from its own movement (two positions MOVE_M apart): it tells the car's road from the other carriageway or a crossing road
        if (!this.from) this.from = p;
        else {
            const dy = (p.lat - this.from.lat) * 110540, dx = (p.lon - this.from.lon) * 111320 * Math.cos(p.lat * Math.PI / 180);
            if (dx * dx + dy * dy >= MOVE_M * MOVE_M) { this.heading = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; this.from = p; }
        }
        this.pos = { lat: p.lat, lon: p.lon, how: p.how, at: t };
    }

    /** A GPSPositionExtendedCAN value. */
    extended(v) {
        const t = this.now();
        this.raw.ext = v; this.raw.extN++; this.raw.extAt = t;
        this.ext = gps.extended(v);
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { if (this.d.log) this.d.log.warn('radar: ' + (e && e.message || e)); } }, WRITE_MS);
        if (this.timer.unref) this.timer.unref();
    }

    stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } this._clear(); }

    /** The zone to warn about now, or null, with the reason in this.why. */
    _ahead(t) {
        if (this.d.enabled && this.d.enabled() === false) { this.why = 'turned off'; return null; }
        if (!this.pos) { this.why = this.raw.posN ? 'position not understood' : 'no position yet'; return null; }
        if (t - this.pos.at > POS_STALE_MS || t < this.pos.at) { this.why = 'position too old'; return null; }
        const z = this.d.zones ? this.d.zones.nearest(this.pos.lat, this.pos.lon, WITHIN_M, this.heading) : null;
        if (!z) { this.trail = []; this.near = null; this.nearKey = null; this.why = 'no zone within ' + (WITHIN_M / 1000) + ' km'; return null; }
        const key = z.lat.toFixed(2) + ',' + z.lon.toFixed(2);
        if (this.trail.length && this.trail[this.trail.length - 1].key !== key) this.trail = [];
        this.trail.push({ key, centreM: z.centreM, at: t });
        if (this.trail.length > TRAIL) this.trail.shift();
        const first = this.trail[0];
        // going away: farther than the nearest the car has been to this zone, by AWAY_M. (Until Nov 19 2026 only the last TRAIL seconds counted:
        // in slow traffic the car never made AWAY_M in that time, and the owner watched the metres go up on a zone he was leaving.)
        if (this.near === null || this.nearKey !== key || z.centreM < this.near) { this.near = z.centreM; this.nearKey = key; }
        if (!z.inside && (z.centreM - this.near > AWAY_M || (this.trail.length >= 3 && z.centreM - first.centreM > AWAY_M))) { this.why = 'zone behind'; return null; }
        this.why = z.inside ? 'in a zone' : 'zone ahead';
        return z;
    }

    tick() {
        const t = this.now();
        this.zone = this._ahead(t);
        if (!this.zone) { this._clear(); return; }
        const o = { t, app: this.app, distance: Math.max(0, Math.round(this.zone.edgeM)) };
        if (this.zone.limit) o.limit = this.zone.limit;
        if (this.onZone) { try { this.onZone(o); } catch (e) { /* the theme's own matter */ } }
        this._write(o);
    }

    _write(o) {
        try {
            // the folder is shared by several apps, each its own user on the car: made open to all (the umask would leave it the maker's alone, and
            // the others got EACCES: the owner's car, 22 Nov 2026); chmod works only for its maker, so it is tried every time and may fail
            // when the folder is another app's and closed, the file goes to a second folder ("<folder>.shak") that only these apps make, so it
            // is always open; shared/danger.js reads both
            let err = null;
            for (const d of [this.dir, this.dir + '.shak']) {
                try {
                    try { fs.mkdirSync(d, 0o777); } catch (e) { /* already there */ }
                    try { fs.chmodSync(d, 0o777); } catch (e) { /* not ours */ }
                    const g = path.join(d, this.file);
                    fs.writeFileSync(g + '.tmp', JSON.stringify(o), { mode: 0o644 });
                    fs.renameSync(g + '.tmp', g);
                    err = null; break;
                } catch (e) { if (!err) err = e; }
            }
            if (err) throw err;
            this.writing = true; this.writtenAt = o.t; this.writeError = null;
        } catch (e) { this.writeError = String(e && e.code || e); }
    }

    _clear() {
        if (this.onZone) { try { this.onZone(null); } catch (e) { /* the theme's own matter */ } }
        if (!this.writing) return;
        this.writing = false;
        try { fs.unlinkSync(path.join(this.dir, this.file)); } catch (e) { /* gone */ }
        try { fs.unlinkSync(path.join(this.dir + '.shak', this.file)); } catch (e) { /* gone */ }
    }

    /** What the screen shows. */
    state() {
        const t = this.now();
        return {
            pos: this.pos ? { lat: this.pos.lat, lon: this.pos.lon, how: this.pos.how, age: t - this.pos.at } : null,
            ext: this.ext, raw: this.raw, zone: this.zone, why: this.why, writing: this.writing, writeError: this.writeError,
        };
    }
}

module.exports = { RadarApp, FILE, WITHIN_M, POS_STALE_MS, AWAY_M };
