'use strict';
/**
 * car_extras.js - readings of three signals the owner's car sends (their values were not seen yet, so every reader is tolerant and
 * answers null for anything it does not clearly understand; the raw values are on the Signals tab and in the log):
 *   nextLimitOf(v)    the next speed limit the camera recognised, from FASuS.statusNextSpeedLimitRecognition (km/h or null)
 *   alertOf(v)        a check control message is showing, from KombiIF.statusActiveCCMessage (true / false / null)
 *   powerQuotaOf(v)   the electric motor's share of its power, from Efficiencytainment2.displayPowerDrive[2]
 *                     (quotaImmediateElectricEngineDriveRecuperation): -100..100, drive positive, recuperation negative, or null
 *   powerKw(q)        that share as kW, on EV_MAX_KW (an estimate: the car does not say the motor's power)
 */
const { limitOf } = require('./speedlimit');

const EV_MAX_KW = 80;            // the electric motor of a 30e: 82 kW (the share is of what the motor can give)
const NEXT_TTL_MS = 20000;       // the next limit is told once (a notifier): it counts this long, then goes
const POWER_TTL_MS = 20000;      // the motor's share is told when it changes: it counts this long

function scalar(x) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        if (x.value !== undefined) return x.value;
        if (x.name !== undefined) return x.name;
    }
    return x;
}

/** The value of the first key of struct `v` that `re` matches, as it is (`raw`) or through scalar(); undefined when there is none. */
function field(v, re, raw) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const k = Object.keys(v).find((x) => re.test(x));
    return k === undefined ? undefined : raw ? v[k] : scalar(v[k]);
}

/** The next limit in km/h: the limit when the present one is withdrawn, else the next class's; null when neither is a whole 5 from 20 to 200. */
function nextLimitOf(v) {
    const a = limitOf(field(v, /^nextWithdrawalLimitSpeed$/i, true)), b = limitOf(field(v, /^nextClassLimitSpeed$/i, true));      // limitOf reads { name, value } itself
    return a !== null ? a : b;
}

/** A check control message is showing: its number is a plain positive one (0 is none; the all-ones numbers are "invalid"). null when the struct has no number. */
function alertOf(v) {
    const n = field(v, /^numberDisplayControlCheckControlMessage$/i);
    if (typeof n !== 'number' || !isFinite(n)) return null;
    if (n === 0) return false;
    return n > 0 && n < 255 ? true : null;
}

/** The motor's share, -100..100 (a plain number is taken too); null for anything else, so 255, 65535 and an offset coding are never a power. */
function powerQuotaOf(v) {
    let n = scalar(v);
    if (n && typeof n === 'object') n = field(n, /quota/i);
    return typeof n === 'number' && isFinite(n) && n >= -100 && n <= 100 ? n : null;
}

/** The share as kW (negative while the motor gives back). */
function powerKw(q) { return q * EV_MAX_KW / 100; }

module.exports = { nextLimitOf, alertOf, powerQuotaOf, powerKw, EV_MAX_KW, NEXT_TTL_MS, POWER_TTL_MS };
