'use strict';
/**
 * car_extras.js - readings of three signals the owner's car sends (their values were not seen yet, so every reader is tolerant and
 * answers null for anything it does not clearly understand; the raw values are on the Signals tab and in the log):
 *   nextLimitOf(v)    the next speed limit the camera recognised, from FASuS.statusNextSpeedLimitRecognition (km/h or null)
 *   alertOf(v)        a check control message is showing, from KombiIF.statusActiveCCMessage (true / false / null)
 *   powerQuotaOf(v)   the electric motor's share of its power, from Efficiencytainment2.displayPowerDrive[2]
 *                     (quotaImmediateElectricEngineDriveRecuperation): -100..100, drive positive, recuperation negative, or null
 *   powerKw(q)        that share as kW, on EV_MAX_KW (an estimate: the car does not say the motor's power)
 *   relPowerOf(v)     the stock cluster's own power meter, from Efficiencytainment2.statusPowerRelativHybrid (displayActualValuePowerRelativeDrivingElectric
 *                     and ...Recuperation, in %): { drive, recup, over } (each 0..100 or null), or null when it holds neither
 *   relKw(r)          that meter as kW for the rev bar: drive % of EV_MAX_KW, recuperation % of REL_RECUP_KW (negative)
 *   laneOf(v)         the lane assist's steering wheel, from DisplayDriverAssistanceLateralCoordinated.displaySteeringWheel: { on, tone, warn }
 */
const { limitOf } = require('./speedlimit');

const EV_MAX_KW = 80;            // the electric motor of a 30e: 82 kW (the share is of what the motor can give)
const NEXT_TTL_MS = 20000;       // the next limit is told once (a notifier): it counts this long, then goes
const POWER_TTL_MS = 20000;      // the motor's share is told when it changes: it counts this long
const REL_TTL_MS = 6000;         // the cluster's power meter is re-read every 2 s (hud.js): a reading counts this long
const REL_RECUP_KW = 60;         // 100 % of recuperation = a full green bar (hybrid_tach CHARGE_KW)

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

/**
 * The stock cluster's power meter: { drive, recup, over }. drive / recup: the percentage when it is a number from 0 to 100, else null (a missing
 * field, a negative number, the all-ones numbers 255 and 65535). over: a number above 100 was there, so the scale is not 0..100 and the caller
 * must not draw a bar from it. null when the struct holds neither field as a usable number and nothing above 100.
 */
function relPowerOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    let over = false;
    const pick = (re) => {
        const n = field(v, re);
        if (typeof n !== 'number' || !isFinite(n) || n < 0) return null;
        if (n > 100) { if (n !== 255 && n !== 65535 && n !== 0x7FFF) over = true; return null; }
        return n;
    };
    const drive = pick(/PowerRelative.*Driving/i), recup = pick(/PowerRelative.*Recup/i);
    return drive === null && recup === null && !over ? null : { drive, recup, over };
}

/** The meter as kW for the rev bar: the drive's share of EV_MAX_KW while there is any, else the recuperation's share of REL_RECUP_KW (negative). */
function relKw(r) {
    const d = r && typeof r.drive === 'number' ? r.drive : 0, g = r && typeof r.recup === 'number' ? r.recup : 0;
    return d > 0 ? d * EV_MAX_KW / 100 : g > 0 ? -g * REL_RECUP_KW / 100 : 0;
}

/** A word or a number as "off" (false), "on" (true) or unclear (null): 0 is off, a small positive number on, the all-ones numbers say nothing. */
function onOff(x) {
    x = scalar(x);
    if (typeof x === 'number') return !isFinite(x) ? null : x === 0 ? false : x > 0 && x < 64 ? true : null;
    if (typeof x === 'string') {
        const t = x.trim().toLowerCase();
        if (!t) return null;
        if (/off|none|hid|invalid|not[ _-]?avail|not[ _-]?active|inactive|no[ _-]?disp|no[ _-]?warn|no[ _-]?symbol|idle|^0$|false|^no$/.test(t)) return false;
        return /invalid|snv|undefined/.test(t) ? null : true;
    }
    return typeof x === 'boolean' ? x : null;
}

/**
 * The lane assist's steering wheel (DisplayDriverAssistanceLateralCoordinated.displaySteeringWheel): { on, tone, warn }.
 *   on    steeringWheelDisplay says a wheel is to show (true), not (false), or nothing clear (null)
 *   tone  steeringWheelColor by its name: 'green' | 'yellow' | 'red' | 'grey', null when it is a number or a word this does not know
 *   warn  displayLateralWarning is on (a lane departure warning: the one case the icon is red for)
 */
function laneOf(v) {
    let col = field(v, /^steeringWheelColor$/i, true);
    if (col && typeof col === 'object') col = col.name !== undefined ? col.name : col.value;          // a { name, value } enum: its name tells the colour
    let tone = null;
    if (typeof col === 'string') tone = /green/i.test(col) ? 'green' : /yellow|amber|orange/i.test(col) ? 'yellow' : /red/i.test(col) ? 'red' : /gr[ae]y|white|off/i.test(col) ? 'grey' : null;
    return { on: onOff(field(v, /^steeringWheelDisplay$/i)), tone, warn: onOff(field(v, /^displayLateralWarning$/i)) === true };
}

/** The share as kW (negative while the motor gives back). */
function powerKw(q) { return q * EV_MAX_KW / 100; }

module.exports = { nextLimitOf, alertOf, powerQuotaOf, powerKw, relPowerOf, relKw, laneOf, onOff, scalar, EV_MAX_KW, NEXT_TTL_MS, POWER_TTL_MS, REL_TTL_MS, REL_RECUP_KW };
