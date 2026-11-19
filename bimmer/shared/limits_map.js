'use strict';
/**
 * limits_map.js - the speed limit of the road the car is on, from a map (ShakLimites): for cars whose camera reads no signs.
 *
 * The map is made from OpenStreetMap by tools/build_limits.py (on GitHub, .github/workflows/limites.yml): the main roads that carry a
 * limit, cut in tiles of 0.5 degree, one small file each (t_<lat>_<lon>.json: { v, lat, lon, n, b: base64 }), read through the kit's pack
 * only when the car is in it; two tiles are kept in memory. A tile's bytes: for each road, limit (km/h, u8), flags (u8: class 0 motorway,
 * 1 trunk, 2 primary, 3 secondary, 4 tertiary, 5 a street (the last two only where the map was made with them: Ile-de-France); +8 one way), the number of points (u16), then the points (u16 x, u16 y over the tile and
 * a margin around it).
 *
 *   const map = new LimitsMap(db);                 // db: require('./kit/pack').open(dir), or anything with json(name)
 *   map.match(lat, lon, headingDeg or null)        // -> { limit, dist (m), cls, oneway, turn (deg off the heading) } or null
 *
 * match: the road within NEAR_M whose direction fits the car's heading (within TURN_MAX; a one-way road only in its own direction), the
 * nearest first, a degree of turn counting as TURN_COST metres. No heading (the car has not moved yet): the nearest road within
 * NEAR_STILL_M. A wrong limit is worse than none: when two roads of different limits are about as good, nothing is said.
 * Plain JS, Node 8. Written for this fork (MIT). Map data (c) OpenStreetMap contributors, ODbL.
 */
const NEAR_M = 30;            // a road farther than this from the position is not the car's
const NEAR_STILL_M = 15;
const TURN_MAX = 35;          // degrees between the car's heading and the road's direction
const TURN_COST = 0.5;        // metres a degree of turn is worth when two roads compete
const CLOSE_CALL = 8;         // two roads of different limits whose scores are this close: no answer
const GRID = 48;              // each tile is indexed in GRID x GRID cells
const KEEP = 2;               // tiles kept in memory

function angleDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

class LimitsMap {
    constructor(db) {
        this.db = db;
        this.index = null;
        try { const i = db.json('index.json'); if (i && i.v === 1 && i.step > 0 && i.tiles > 0) this.index = i; } catch (e) { /* no map */ }
        this.step = this.index ? this.index.step : 0.5;
        this.margin = this.index ? this.index.margin : 0.05;
        this.tiles = [];          // [{ key, t }] newest last
    }

    /** The map is there (index.json read). */
    ready() { return !!this.index; }

    /** The tile of a position, decoded (null: none there). Segments in metres from the tile's origin: Float32 ax, ay, bx, by; Uint8 limit, flags. */
    _tile(lat, lon) {
        const ilat = Math.floor(lat / this.step), ilon = Math.floor(lon / this.step), key = ilat + '_' + ilon;
        const hit = this.tiles.find((x) => x.key === key);
        if (hit) return hit.t;
        let t = null;
        try { t = this._decode(this.db.json('t_' + key + '.json'), ilat, ilon); } catch (e) { t = null; }
        this.tiles.push({ key, t });
        if (this.tiles.length > KEEP) this.tiles.shift();
        return t;
    }

    _decode(doc, ilat, ilon) {
        if (!doc || doc.v !== 1 || typeof doc.b !== 'string') return null;
        const b = Buffer.from(doc.b, 'base64');
        const span = this.step + 2 * this.margin, lat0 = ilat * this.step - this.margin, lon0 = ilon * this.step - this.margin;
        const ky = 110540, kx = 111320 * Math.cos((lat0 + span / 2) * Math.PI / 180);
        const W = span * kx, H = span * ky;
        let n = 0;
        for (let o = 0; o + 4 <= b.length;) { const k = b.readUInt16LE(o + 2); if (k < 2 || o + 4 + k * 4 > b.length) break; n += k - 1; o += 4 + k * 4; }
        const seg = new Float32Array(n * 4), lim = new Uint8Array(n), flg = new Uint8Array(n);
        const cells = [];
        let i = 0;
        for (let o = 0; o + 4 <= b.length;) {
            const limit = b[o], flags = b[o + 1], k = b.readUInt16LE(o + 2);
            if (k < 2 || o + 4 + k * 4 > b.length) break;
            let px = b.readUInt16LE(o + 4) / 65535 * W, py = b.readUInt16LE(o + 6) / 65535 * H;
            for (let j = 1; j < k; j++) {
                const x = b.readUInt16LE(o + 4 + j * 4) / 65535 * W, y = b.readUInt16LE(o + 6 + j * 4) / 65535 * H;
                seg[i * 4] = px; seg[i * 4 + 1] = py; seg[i * 4 + 2] = x; seg[i * 4 + 3] = y; lim[i] = limit; flg[i] = flags;
                // every cell the segment's box touches (grown by the search radius)
                const c0 = Math.max(0, Math.floor((Math.min(px, x) - NEAR_M) / W * GRID)), c1 = Math.min(GRID - 1, Math.floor((Math.max(px, x) + NEAR_M) / W * GRID));
                const r0 = Math.max(0, Math.floor((Math.min(py, y) - NEAR_M) / H * GRID)), r1 = Math.min(GRID - 1, Math.floor((Math.max(py, y) + NEAR_M) / H * GRID));
                for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (cells[r * GRID + c] || (cells[r * GRID + c] = [])).push(i);
                px = x; py = y; i++;
            }
            o += 4 + k * 4;
        }
        return { lat0, lon0, kx, ky, W, H, seg, lim, flg, cells, n };
    }

    /** The road the car is on: { limit, dist, cls, oneway, turn } or null. heading: degrees from north, clockwise; null when unknown. */
    match(lat, lon, heading) {
        if (!this.index || typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return null;
        const t = this._tile(lat, lon);
        if (!t) return null;
        const x = (lon - t.lon0) * t.kx, y = (lat - t.lat0) * t.ky;
        const list = t.cells[Math.min(GRID - 1, Math.max(0, Math.floor(y / t.H * GRID))) * GRID + Math.min(GRID - 1, Math.max(0, Math.floor(x / t.W * GRID)))];
        if (!list) return null;
        const known = typeof heading === 'number' && isFinite(heading), near = known ? NEAR_M : NEAR_STILL_M;
        let best = null, second = null;
        for (let q = 0; q < list.length; q++) {
            const i = list[q], ax = t.seg[i * 4], ay = t.seg[i * 4 + 1], dx = t.seg[i * 4 + 2] - ax, dy = t.seg[i * 4 + 3] - ay;
            const d2 = dx * dx + dy * dy, u = d2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / d2)) : 0;
            const dist = Math.sqrt((x - ax - u * dx) * (x - ax - u * dx) + (y - ay - u * dy) * (y - ay - u * dy));
            if (dist > near) continue;
            let turn = 0;
            const oneway = (t.flg[i] & 8) !== 0;
            if (known) {
                const dir = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;          // north = +y
                turn = angleDiff(heading, dir);
                if (!oneway) turn = Math.min(turn, 180 - turn);
                if (turn > TURN_MAX) continue;
            }
            const c = { limit: t.lim[i], dist, cls: t.flg[i] & 7, oneway, turn, score: dist + turn * TURN_COST };
            if (!best || c.score < best.score) { if (best && best.limit !== c.limit) second = best; best = c; }
            else if (c.limit !== best.limit && (!second || c.score < second.score)) second = c;
        }
        if (!best) return null;
        if (second && second.score - best.score < CLOSE_CALL) return null;      // two roads, two limits, no telling which
        return best;
    }
}

/** The heading from one position to the next, degrees from north clockwise, and the distance in metres. */
function bearing(lat1, lon1, lat2, lon2) {
    const dy = (lat2 - lat1) * 110540, dx = (lon2 - lon1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return { deg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, m: Math.sqrt(dx * dx + dy * dy) };
}

module.exports = { LimitsMap, bearing, angleDiff, NEAR_M, TURN_MAX };
