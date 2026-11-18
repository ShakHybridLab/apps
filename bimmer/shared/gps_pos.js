'use strict';
/**
 * gps_pos.js - the car's GPS position from GPSData.GPSPositionCAN (and the rest from GPSPositionExtendedCAN), read without knowing yet how
 * the car writes them: the owner read the two names in the car's catalogue (17 Nov 2026), not their members nor their units.
 *
 *   position(v)  -> { lat, lon, how, keys } or null    how: the scaling that was found ("degrees", "1e-7 degree", ...)
 *   extended(v)  -> { heading, altitude, quality, speed, raw } (each null when not found; raw: every number of the struct, by name)
 *
 * The latitude and the longitude are found by their member names (anything with "lat" / "lon" or "lng", not "lateral" nor
 * "longitudinal"), at most two levels deep, an enum or a { value } taken as its value. Their scaling is found by trying the ways a CAN
 * position is written (degrees, millionths or ten-millionths of a degree, milliarcseconds, a full turn over 2^31 or 2^32, radians, with or
 * without an offset of 90 / 180 degrees) and keeping the first that puts the car in France: the danger zones (radar_zones.js) are French
 * and the car is the owner's, in France. Abroad, or a scaling none of these is: null, and the raw numbers stay on the screen to find it.
 * Plain JS, Node 8. Written for this fork (MIT).
 */

// metropolitan France with its islands (Corsica), and the overseas zones of the list (La Réunion, the Antilles, Guyane, Mayotte)
const AREAS = [[41.0, 51.6, -5.8, 10.0], [-21.6, -20.7, 55.0, 56.0], [14.2, 18.2, -63.3, -60.6], [1.8, 6.0, -55.0, -51.0], [-13.2, -12.4, 44.8, 45.4]];
const SCALES = [
    { how: 'degrees', f: 1 },
    { how: '1e-6 degree', f: 1e-6 },
    { how: '1e-7 degree', f: 1e-7 },
    { how: '1e-5 degree', f: 1e-5 },
    { how: 'milliarcsecond', f: 1 / 3600000 },
    { how: '1/1000 minute', f: 1 / 60000 },
    { how: 'turn / 2^31', f: 180 / 2147483648 },
    { how: 'turn / 2^32', f: 360 / 4294967296 },
    { how: 'radians', f: 180 / Math.PI },
];
// the same with an unsigned raw value that starts at -90 / -180 degrees
const OFFSETS = [false, true];
const INVALID = [0x7FFFFFFF, -0x80000000, 0xFFFFFFFF, 0x80000000, 0xFFFF, 0x7FFF];

function scalar(x) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        if (x.value !== undefined) return x.value;
        if (x.name !== undefined) return x.name;
    }
    return x;
}

/** Every number of a struct, at most two levels deep, as { "name" or "outer.name": number } (numbers given as text count). */
function numbers(v, prefix, depth, out) {
    out = out || {};
    if (!v || typeof v !== 'object' || Array.isArray(v) || (depth || 0) > 2) return out;
    Object.keys(v).forEach((k) => {
        const x = scalar(v[k]), name = (prefix ? prefix + '.' : '') + k;
        const n = typeof x === 'number' ? x : typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : null;
        if (n !== null && isFinite(n)) out[name] = n;
        else if (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) && v[k].value === undefined) numbers(v[k], name, (depth || 0) + 1, out);
    });
    return out;
}

const LAT = /lat/i, LAT_NOT = /lateral|later|plat|relat|translat|calculat|regulat|accumulat|simulat|stimulat/i;
const LON = /lon|lng/i, LON_NOT = /longitudinal|along|long(?!itude)|belong/i;
function pick(nums, re, not) {
    const k = Object.keys(nums).find((x) => re.test(x.split('.').pop()) && !not.test(x.split('.').pop()));
    return k === undefined ? null : { key: k, raw: nums[k] };
}

function inArea(lat, lon) { return AREAS.some((a) => lat >= a[0] && lat <= a[1] && lon >= a[2] && lon <= a[3]); }

/** The position in degrees, or null (no latitude / longitude member, a "no value" number, or no known scaling that lands in France). */
function position(v) {
    if (v === null || v === undefined) return null;
    const nums = numbers(v);
    const la = pick(nums, LAT, LAT_NOT), lo = pick(nums, LON, LON_NOT);
    if (!la || !lo) return null;
    if (INVALID.indexOf(la.raw) >= 0 || INVALID.indexOf(lo.raw) >= 0) return null;
    if (la.raw === 0 && lo.raw === 0) return null;
    for (const s of SCALES) {
        for (const off of OFFSETS) {
            const lat = la.raw * s.f - (off ? 90 : 0), lon = lo.raw * s.f - (off ? 180 : 0);
            if (inArea(lat, lon)) return { lat, lon, how: s.how + (off ? ' from -90 / -180' : ''), keys: [la.key, lo.key] };
        }
    }
    return null;
}

/** The rest, as far as the names tell: heading (0..360 degrees when it reads so, or hundredths of a degree), altitude, quality and speed as given. */
function extended(v) {
    const nums = numbers(v);
    const find = (re) => { const k = Object.keys(nums).find((x) => re.test(x.split('.').pop())); return k === undefined ? null : nums[k]; };
    let heading = find(/head|course|bearing|direction|richtung|azimuth|cap/i);
    if (heading !== null) heading = heading >= 0 && heading <= 360 ? heading : heading > 360 && heading <= 36000 ? heading / 100 : null;
    return {
        heading,
        altitude: find(/alt|height|hoehe|höhe/i),
        quality: find(/qual|fix|accur|dop|sat|valid|state|status/i),
        speed: find(/speed|veloc|geschw/i),
        raw: nums,
    };
}

module.exports = { position, extended, numbers, inArea, SCALES };
