'use strict';
/**
 * speedlimit.js - the speed limit of the road, for the limit ring of ShakTheme (a ring with the number, white; red while the car is over it).
 *
 * This app knows no position and no map data, so it can't find the limit itself. Whatever can (an app that reads the car's navigation,
 * or the sign the car's camera has read) says so through a file, the same hand-over as the danger zone alert (danger.js):
 *
 *   /dev/shm/cluster-themes/speedlimit-<source>.json   { "t": <ms since 1970, now>, "app": "<source>", "limit": <km/h> }
 *
 * The source rewrites it about once a second (write a temporary file, then rename it, so a reader never sees half of it); the ring shows
 * while one is fresh (under STALE_MS old) and goes when the file stops, is older, or is removed. The newest file wins when several sources
 * write. The limit is always in km/h, whatever the unit shown (the theme converts: mph rounded to 5). Never throws; Node 8.
 *
 * The car's own sign reading is the other source (hud.js feeds it): the cluster's speed-limit sign is driven by the signal
 * dass.driverassistanceapplications.TrafficSignDisplayControl . displaySpeedLimitAndNoPassingRestriction (the camera's reading, shown
 * to the driver). Its field list on the owner's car (Nov 15 2026, a photo of Cluster Centre's signal page) is cut at "displaySpee...", so
 * the speed field is found by its name (decodeSign) and the raw value goes to the log. It stays until the car sends another sign or
 * "no sign" (CAR_TTL_MS at most, as BMW keeps its own icon on the cluster for a while).
 * Written for this fork (MIT).
 */
const fs = require('fs');

const THEMES_DIR = process.env.CLUSTER_THEMES_DIR || '/dev/shm/cluster-themes';
const STALE_MS = 6000;          // a source's file older than this counts as gone
const SCAN_MS = 1000;
const MIN_KMH = 5, MAX_KMH = 200;
const CAR_TTL_MS = 10 * 60 * 1000;   // the car's sign reading counts this long after the last sign it sent

/** An enum or a number as the binding hands it over: { name, value } object, a name, or a number. */
function scalar(x) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        if (x.name !== undefined) return x.name;
        if (x.value !== undefined) return x.value;
    }
    return x;
}

/** A speed in km/h from one value: a number (a whole 5 from 20 to 200: the smaller whole numbers are more likely enum codes) or a name with
 *  the speed in it ("SPEED_LIMIT_50"); null for "no sign" and anything else. */
function limitOf(x) {
    x = scalar(x);
    if (typeof x === 'number') return isFinite(x) && x >= 20 && x <= MAX_KMH && x % 5 === 0 ? x : null;
    if (typeof x === 'string') {
        const m = /(?:^|[^0-9])(\d{1,3})(?:[^0-9]|$)/.exec(x);
        if (m) { const n = Number(m[1]); return n >= MIN_KMH && n <= MAX_KMH && n % 5 === 0 ? n : null; }
    }
    return null;
}

/** The value of TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction: { invalid, found, limit, key }.
 *  found: a speed field (a key starting "displaySpee", not the supplemental sign, the style, the unit or the passing ban) is there;
 *  limit: its speed in km/h, null for "no sign"; invalid: the struct's own invalidFlag is set (the reading is to be ignored). */
function decodeSign(v) {
    const out = { invalid: false, found: false, limit: null, key: null };
    if (!v || typeof v !== 'object') return out;
    const keys = Object.keys(v);
    const inv = keys.find((k) => /^invalidFlag$/i.test(k));
    if (inv !== undefined) { const f = scalar(v[inv]); out.invalid = f === true || f === 1 || (typeof f === 'string' && /^(true|invalid|1)$/i.test(f)); }
    const NOT = /suppl|unit|style|symbol|pass|restrict|remain|invalid|overtak|condition|time|distance|count/i;
    // the field's name was cut on the photo ("displaySpee..."): that one first, else any speed / limit field (a name the photo did not show)
    let key = keys.find((k) => /^displaySpee/i.test(k) && !NOT.test(k));
    if (key === undefined) key = keys.find((k) => /speed|limit|geschw|tempo/i.test(k) && !NOT.test(k));
    if (key === undefined) return out;
    out.found = true; out.key = key; out.limit = limitOf(v[key]);
    return out;
}

class SpeedLimit {
    /** opts: { dir, now }; onChange(limit or null) is called when the limit appears, goes or changes. */
    constructor(opts, log, onChange) {
        opts = opts || {};
        this.dir = opts.dir || THEMES_DIR;
        this.now = opts.now || Date.now;
        this.log = log;
        this.onChange = onChange || (() => {});
        this.timer = null;
        this.cur = null;                 // { limit, app, t } while a limit is known
        this.car = null;                 // { limit, app, t }: the car's own sign reading (feed)
    }

    /** The car's sign reading: a limit in km/h, or null when the car says there is no sign now. */
    feed(limit, app) {
        this.car = limit === null || limit === undefined ? null : { limit: Math.round(limit), app: app || 'car', t: this.now() };
        this.scan();
    }

    start() {
        this.stop();
        // (a timer's error would be an uncaught one: the kit exits on those)
        const scan = () => { try { this.scan(); } catch (e) { if (!this.scanWarned) { this.scanWarned = true; try { this.log.warn('speedlimit: ' + (e && e.message || e)); } catch (x) { /* no log */ } } } };
        this.timer = setInterval(scan, SCAN_MS);
        if (this.timer.unref) this.timer.unref();
        scan();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** The limit now, km/h (a whole number), or null. */
    limit() { return this.cur ? this.cur.limit : null; }

    /** Reads the sources' files once: the newest fresh one is the limit. */
    scan() {
        let best = null;
        try {
            const t = this.now();
            let names = [];
            try { names = fs.readdirSync(this.dir); } catch (e) { names = []; }
            names.forEach((n) => {
                if (!/^speedlimit-[\w.-]+\.json$/.test(n)) return;
                let j = null;
                try { j = JSON.parse(fs.readFileSync(this.dir + '/' + n, 'utf8')); } catch (e) { return; }
                if (!j || typeof j.t !== 'number' || t - j.t >= STALE_MS || j.t - t > STALE_MS) return;
                if (typeof j.limit !== 'number' || !isFinite(j.limit) || j.limit < MIN_KMH || j.limit > MAX_KMH) return;
                if (!best || j.t > best.t) best = { limit: Math.round(j.limit), app: typeof j.app === 'string' ? j.app.slice(0, 30) : n, t: j.t };
            });
        } catch (e) { best = null; }
        const c = this.car;
        if (c && Math.abs(this.now() - c.t) < CAR_TTL_MS && (!best || c.t > best.t)) best = c;
        const before = this.cur ? this.cur.limit : null, after = best ? best.limit : null;
        this.cur = best;
        if (before !== after) {
            if (after !== null && before === null) this.log.info('speed limit ' + after + ' km/h (' + best.app + ')');
            try { this.onChange(after); } catch (e) { this.log.warn('speedlimit: ' + e.message); }
        }
    }
}

module.exports = { SpeedLimit, THEMES_DIR, STALE_MS, CAR_TTL_MS, limitOf, decodeSign };
