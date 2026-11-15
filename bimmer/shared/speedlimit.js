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
 * Written for this fork (MIT).
 */
const fs = require('fs');

const THEMES_DIR = process.env.CLUSTER_THEMES_DIR || '/dev/shm/cluster-themes';
const STALE_MS = 6000;          // a source's file older than this counts as gone
const SCAN_MS = 1000;
const MIN_KMH = 5, MAX_KMH = 200;

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
    }

    start() {
        this.stop();
        this.timer = setInterval(() => this.scan(), SCAN_MS);
        if (this.timer.unref) this.timer.unref();
        this.scan();
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
        const before = this.cur ? this.cur.limit : null, after = best ? best.limit : null;
        this.cur = best;
        if (before !== after) {
            if (after !== null && before === null) this.log.info('speed limit ' + after + ' km/h (' + best.app + ')');
            try { this.onChange(after); } catch (e) { this.log.warn('speedlimit: ' + e.message); }
        }
    }
}

module.exports = { SpeedLimit, THEMES_DIR, STALE_MS };
