'use strict';
/**
 * map_window.js - tells Waze on cluster where a theme's map window is, so the map is drawn right in that window
 * (its size and its place) instead of in the cluster's fixed centre slot (x 416..1504, y 120..600), from which
 * the window would only cut a piece. Written for ShakTheme (MIT, as the rest of shared/).
 *
 * The protocol is Waze on cluster's (0.9.107 and later, as Cluster Layouts documents it): the file
 * /dev/shm/cluster-info/map_window.txt, one line "panel <x> <y> <w> <h>", rewritten while the window is wanted and
 * removed as soon as it isn't; Waze on cluster takes it while it is fresh (written in the last 3 s) and goes back to its
 * own place when it is gone or stale. An older Waze on cluster ignores the file: the map then stays in the centre slot.
 * Untested on a car. Plain Node 8 (the car's 8.16.2).
 */
const fs = require('fs');
const path = require('path');

const FILE = 'map_window.txt';

class MapWindow {
    /** log: { info, warn }; opts.dir overrides the shared folder (env CLUSTER_INFO_DIR, the bench's). */
    constructor(log, opts) {
        opts = opts || {};
        this.log = log;
        this.dir = opts.dir || process.env.CLUSTER_INFO_DIR || '/dev/shm/cluster-info';
        this.file = path.join(this.dir, FILE);
        this.holding = false;
        this.last = '';
        this.warned = false;
    }

    /** The line for a window { x, y, w, h } (panel px, whole numbers), or null when it isn't one. */
    static line(r) {
        if (!r || ![r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && isFinite(v))) return null;
        if (r.w < 64 || r.h < 64) return null;
        return 'panel ' + [r.x, r.y, r.w, r.h].map((v) => Math.round(v)).join(' ') + '\n';
    }

    /** Hold the window r (rewritten at each call: call it at least every 2 s), or let go with null. */
    set(r) {
        const line = MapWindow.line(r);
        if (!line) return this.release();
        try {
            try { fs.mkdirSync(this.dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            try { fs.chmodSync(this.dir, 0o1777); } catch (e) { /* not ours: fine, as long as it can be written */ }
            const tmp = this.file + '.' + process.pid + '.tmp';
            fs.writeFileSync(tmp, line, { mode: 0o644 });
            fs.renameSync(tmp, this.file);
            if (line !== this.last) this.log.info('map window: ' + line.trim() + ' (Waze on cluster 0.9.107+ draws the map there)');
            this.holding = true; this.last = line; this.warned = false;
        } catch (e) {
            if (!this.warned) { this.warned = true; this.log.info('map window: ' + (e && e.message || e)); }
        }
    }

    /** Give the window back: Waze on cluster returns to its own place. */
    release() {
        if (!this.holding) return;
        this.holding = false; this.last = '';
        try { fs.unlinkSync(this.file); } catch (e) { /* already gone */ }
        this.log.info('map window: given back (Waze on cluster to its own place)');
    }
}

module.exports = { MapWindow, FILE };
