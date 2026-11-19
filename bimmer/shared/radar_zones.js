'use strict';
/**
 * radar_zones.js - finds the danger zone nearest to a position, from the list data/radars_fr_zones.json
 * (made by tools/make_radar_zones.py out of the Ministry of the Interior's list of fixed speed cameras: zones, not cameras).
 *
 * A zone is a circle around a centre rounded to 0.01 degree: 2 km, or 4 km for a motorway zone (limit of 110 or more).
 * nearest(lat, lon) says how far the position is from the zone's EDGE (negative inside it), which is what a "danger zone
 * in 450 m" alert counts down to zero. It knows nothing about the direction of travel or the road: a zone on a road
 * running beside yours counts as well.
 *
 * Used by ShakRadar (shared/radar_app.js): the car's GPS position (GPSData, shared/gps_pos.js) goes in, the nearest zone feeds the
 * danger zone alert of ShakTheme (shared/danger.js) through its file.
 * Plain JS, no dependencies; Node 8. Written for this fork (MIT). The data is under the Licence Ouverte 2.0 (data/README.md).
 */
const fs = require('fs');

const M_PER_DEG_LAT = 110574;       // metres in a degree of latitude near France (it varies by a few tenths of a percent)
const M_PER_DEG_LON_EQ = 111320;    // metres in a degree of longitude at the equator; times cos(latitude)

const TURN_MAX = 50;      // degrees between the car's heading and the zone's road

class RadarZones {
    /** doc: the parsed list ({ cell, radius, radiusWide, zones: [[lat x100, lon x100, limit, wide], ...] }). */
    constructor(doc) {
        this.cell = doc.cell || 0.01;
        this.radius = doc.radius || 2000;
        this.radiusWide = doc.radiusWide || 4000;
        this.radiusTown = doc.radiusTown || 300;
        this.version = doc.version || '';
        this.zones = (doc.zones || []).filter((z) => Array.isArray(z) && z.length >= 4 && z.slice(0, 2).every(Number.isFinite))
            // (the newer list also has the direction of the zone's road, -1 unknown, and flags: 1 a one-way road, 2 in town)
            .map((z) => ({ lat: z[0] * this.cell, lon: z[1] * this.cell, limit: z[2] > 0 ? z[2] : null, wide: !!z[3],
                dir: Number.isFinite(z[4]) && z[4] >= 0 ? z[4] : null, oneway: !!(z[5] & 1), town: !!(z[5] & 2) }));
        this.buckets = {};          // one per whole degree, so a lookup only looks at the 3x3 around the position
        this.zones.forEach((z) => { const k = this._key(z.lat, z.lon); (this.buckets[k] = this.buckets[k] || []).push(z); });
    }

    static load(file) { return new RadarZones(JSON.parse(fs.readFileSync(file, 'utf8'))); }

    _key(lat, lon) { return Math.floor(lat) + ',' + Math.floor(lon); }

    /** The distance in metres from (lat, lon) to a zone's centre. */
    _dist(lat, lon, z) {
        const dy = (z.lat - lat) * M_PER_DEG_LAT;
        const dx = (z.lon - lon) * M_PER_DEG_LON_EQ * Math.cos((lat + z.lat) / 2 * Math.PI / 180);
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * The zone whose edge is nearest to the position, if it is within `within` metres of the edge (default 2000; inside a
     * zone always counts): { edgeM (negative inside), centreM, inside, limit (km/h or null), wide, lat, lon (of the centre) },
     * or null (nothing near, or not a position).
     * A zone in town is 300 m around (radiusTown) and counts from that far only. `heading` (degrees from north, the car's; null: unknown): a zone
     * whose road goes another way (more than TURN_MAX off; a one-way road: the other carriageway too) is not the car's and is left out, unless the
     * car is inside it with no direction to tell by.
     */
    nearest(lat, lon, within, heading) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        const w = within === undefined ? 2000 : within;
        const known = typeof heading === 'number' && isFinite(heading);
        const la = Math.floor(lat), lo = Math.floor(lon);
        let best = null;
        for (let a = -1; a <= 1; a++) {
            for (let b = -1; b <= 1; b++) {
                const list = this.buckets[(la + a) + ',' + (lo + b)];
                if (!list) continue;
                for (let i = 0; i < list.length; i++) {
                    const z = list[i], c = this._dist(lat, lon, z), edge = c - (z.wide ? this.radiusWide : z.town ? this.radiusTown : this.radius);
                    if (known && z.dir !== null) {
                        let turn = Math.abs(heading - z.dir) % 360;
                        if (turn > 180) turn = 360 - turn;
                        if (!z.oneway) turn = Math.min(turn, 180 - turn);
                        if (turn > TURN_MAX) continue;
                    }
                    if (edge <= (z.town ? Math.min(w, this.radiusTown) : w) && (!best || edge < best.edgeM)) best = { edgeM: edge, centreM: c, inside: edge <= 0, limit: z.limit, wide: z.wide, town: z.town, lat: z.lat, lon: z.lon };
                }
            }
        }
        return best;
    }
}

module.exports = { RadarZones };
