'use strict';
/**
 * probes.js - signals of the car this app only READS for now (nothing is drawn from them yet): the owner's photos of the Signals page
 * (Nov 15 2026) list them with the names of their fields, but not what the fields hold, and he has no way to read the log. So the last
 * values go to a tab of the app's page (the "Signals" tab), where a photo of the screen is enough, and the first few to the log.
 *
 *   id      what the page shows it as, in `name` (translated by fr.js); `iface` / `field`: the signal, as app.json declares it ("rs" when the
 *           catalog says "get notify", "s" when it says "notify"); the interface is only watched when app.json declares it.
 *
 * Plain Node 8. Written for ShakTheme (MIT, as the rest of shared/).
 */
const Waze = require('./waze');
const Extras = require('./car_extras');
const { limitOf } = require('./speedlimit');

const KOMBI = 'de.bmw.infotainment.KombiIF';
const FAS = 'de.bmw.infotainment.fasus.FASuS';
const LATERAL = 'de.bmw.dass.driverassistanceapplications.DisplayDriverAssistanceLateralCoordinated';
const EFF = 'de.bmw.infotainment.drivingexcitement.Efficiencytainment2';
const SIGN = 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl';
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const VEHICLE2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const CARPLAY = 'de.bmw.infotainment.a4a.carplay.CarPlayManager';

const PROBES = [
    // the three the app itself draws from (kit/runtime/car.js): listed first, to see whether the car sends the rev counter's value at all and what it holds
    { id: 'rpm', iface: CDS, field: 'statusEngineSpeed2', name: 'Engine speed (rev counter)' },
    { id: 'engt', iface: CDS, field: 'statusEngineTemperature', name: 'Engine temperatures (oil, coolant)' },
    { id: 'speed', iface: VEHICLE2, field: 'statusCarSpeed2', name: 'Car speed' },
    { id: 'sign', iface: SIGN, field: 'displaySpeedLimitAndNoPassingRestriction', name: 'Road sign read by the camera' },
    { id: 'next', iface: FAS, field: 'statusNextSpeedLimitRecognition', name: 'Next limit read by the camera' },
    { id: 'fas', iface: FAS, field: 'statusIDriveFAS', name: 'Driver assistance: lane warnings' },
    { id: 'fasx', iface: FAS, field: 'statusIDriveFASExtended', name: 'Driver assistance: steering wheel light' },
    { id: 'wheel', iface: LATERAL, field: 'displaySteeringWheel', name: 'Lane assist: steering wheel symbol' },
    // the stock cluster's own power meter (a percentage of drive and of recuperation): the name is already declared by the Cluster apps installed on the
    // owner's car, so the car accepts it; hud.js draws the hybrid rev bar from it (_relPower) when eDrive Live shares no power
    { id: 'rel', iface: EFF, field: 'statusPowerRelativHybrid', name: 'Power meter: cluster (drive and recuperation, %)' },
    { id: 'pdrive', iface: EFF, field: 'displayPowerDrive', name: 'Power meter: drive and recuperation' },
    { id: 'pdrive2', iface: EFF, field: 'displayPowerDrive2', name: 'Power meter: second reading' },
    { id: 'pdist', iface: KOMBI, field: 'statusDisplayElectricalPowerDistribution', name: 'Electric power: drive and air conditioning' },
    { id: 'erange', iface: KOMBI, field: 'displayRangeElectricVehicle', name: 'Electric range (cluster)' },
    { id: 'cc', iface: KOMBI, field: 'statusActiveCCMessage', name: 'Check control message showing' },
];
// NOT DECLARED in app.json since ShakTheme 0.21.13: the car's app manager refused 0.21.12 ("UPDATE_FAILED", the previous version kept) and
// this was the one signal declared since the last version the owner had installed. Re-add it (with the flags of the car's catalog) only when
// a test install on the car has shown it accepted: until then hud.js does not subscribe (declaredIn) and the map shows as it did before.
// the car's own word for "a route is being guided on the phone (CarPlay)": not in PROBES (those are the signals every app lists and counts), but
// the second line of the Signals tab's first page (PAGES) and the Map tab show it, and hud.js reads it (guidanceOf) to show Waze's map in the
// theme only while a route is on
const GUIDE = { id: 'guide', iface: CARPLAY, field: 'projectedGuidanceActive', name: 'CarPlay guidance active (route)' };
const SHOWN = PROBES.map((p) => p.id);
// the Signals tab's two pages (ids; 'guide' is the one probe above): the engine and the energy first, then the road signs and the assistance
const PAGES = [['rpm', 'engt', 'speed', 'rel', 'pdrive', 'pdrive2', 'pdist', 'erange', 'guide'], ['sign', 'next', 'fas', 'fasx', 'wheel', 'cc']];
const KEEP = 3;               // distinct values kept for each (the page shows the newest first)
const LOG_FIRST = 12;         // distinct values of each that go to the log, then one a minute at most
const LOG_EVERY_MS = 60000;
const STUCK_MS = 8000;        // a native step this long without an end is shown as stuck (they normally take well under a second)
const CLIP = 500;
const RATE_KEEP = 10;          // the arrival times kept for each, to tell how often the car sends it
const RATE_STALE_MS = 10000;   // a signal whose last message is older than this has no rate now

/** A value on one line ("key=value key=value ..."), long values cut. */
function rawOf(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && !Array.isArray(v)) return Waze.rawOf(v);
    let t = '';
    try { t = JSON.stringify(v); } catch (e) { t = String(v); }
    return String(t === undefined ? '' : t).slice(0, CLIP);
}

/**
 * Whether a route is on, from the value of CarPlayManager.projectedGuidanceActive: true / false, or null when it says nothing clear
 * (nothing read yet, a value this does not know): the owner's car has not shown yet what this value looks like, so a boolean, 0 / 1, a
 * word or a struct holding one of them are all taken.
 */
function guidanceOf(v, depth) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 0 ? false : v === 1 ? true : null;
    if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (!t) return null;
        if (/inactive|not[ _-]?active|false|^0$|^no$|^off$|none|idle|stop/.test(t)) return false;
        if (/active|true|^1$|^yes$|^on$|guid/.test(t)) return true;
        return null;
    }
    if (typeof v === 'object' && !Array.isArray(v) && (depth || 0) < 2) {
        const keys = Object.keys(v);
        const k = keys.length === 1 ? keys[0] : keys.find((x) => /^(value|active|projectedGuidanceActive)$/i.test(x));
        return k === undefined ? null : guidanceOf(v[k], (depth || 0) + 1);
    }
    return null;
}

/**
 * What the app understood of the value `v` of probe `id`, as a short line for the Signals tab ("→ limit 70"), '' when no reader of the app
 * uses that signal (nothing to say) or there is no value, "→ not understood" when its reader answers nothing for it. A tolerant mirror of
 * the readers the themes and the HUD use, so that a photo of the tab says at once whether a value is read the way the app thinks.
 */
// The car sends these three as STRUCTS of raw numbers (seen on the owner's car, 16 Nov 2026: { actualValueRPMEngineCrankshaft: 0 },
// { speedVehicleCentreOfGravity: 130 } = 2 km/h, { temperatureEngineDrive: 124, ... } = 76 C): the same scales as kit/runtime/car.js SCALE
// (tools/test_probes.js checks they agree). A bare number is taken as already in its unit.
const RAW = {
    rpm: { re: /^actualValueRPMEngineCrankshaft$/i, factor: 0.25, offset: 0, invalid: 65535 },
    speed: { re: /^speedVehicleCentreOfGravity$/i, factor: 0.015625, offset: 0, invalid: 65535 },
    coolant: { re: /^temperatureEngineDrive$/i, factor: 1, offset: -48, invalid: 255 },
    oil: { re: /^temperatureEngineOilDrive$/i, factor: 1, offset: -48, invalid: 255 },
};
/** The reading of `v` for RAW[key] in its unit, whole, when it is within lo..hi; null for a missing field, the invalid number or anything else. */
function unitOf(v, key, lo, hi) {
    const c = RAW[key];
    let n;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const k = Object.keys(v).find((x) => c.re.test(x));
        const raw = k === undefined ? undefined : Extras.scalar(v[k]);
        if (typeof raw !== 'number' || !isFinite(raw) || raw === c.invalid) return null;
        n = raw * c.factor + c.offset;
    } else {
        n = Extras.scalar(v);
        if (typeof n !== 'number' || !isFinite(n) || n === c.invalid) return null;
    }
    return n >= lo && n <= hi ? Math.round(n) : null;
}

function meaningOf(id, v) {
    if (v === null || v === undefined) return '';
    const yn = (b, w) => b === null ? null : w + ': ' + (b ? 'yes' : 'no');
    let t = null;
    switch (id) {
    case 'rpm': {
        // 65535 is the car's "no value": said as such (a rev counter that never moves on the HUD: is it this, or nothing at all?)
        const n = unitOf(v, 'rpm', 0, 9999), k = v && typeof v === 'object' ? Object.keys(v).find((x) => RAW.rpm.re.test(x)) : undefined;
        const raw = k === undefined ? Extras.scalar(v) : Extras.scalar(v[k]);
        t = n !== null ? n + ' rpm' : raw === RAW.rpm.invalid ? 'no value (65535)' : null;
        break;
    }
    case 'speed': { const n = unitOf(v, 'speed', 0, 400); t = n === null ? null : n + ' km/h'; break; }
    case 'engt': {
        const c = unitOf(v, 'coolant', -40, 215), o = unitOf(v, 'oil', -40, 215);
        t = c === null && o === null ? null : (c === null ? '' : 'coolant ' + c + ' C') + (c !== null && o !== null ? ' · ' : '') + (o === null ? '' : 'oil ' + o + ' C');
        break;
    }
    case 'sign': { const n = limitOf(v); t = n === null ? 'no limit read' : 'limit ' + n; break; }
    case 'next': { const n = Extras.nextLimitOf(v); t = n === null ? 'no next limit' : 'next limit ' + n; break; }
    case 'wheel': {
        const l = Extras.laneOf(v);
        t = l.on === null && !l.warn ? null : (l.on === false && !l.warn ? 'wheel off' : 'wheel on' + (l.tone ? ', ' + l.tone : '') + (l.warn ? ', warning' : ''));
        break;
    }
    case 'rel': {
        const r = Extras.relPowerOf(v);
        const pc = (n) => n === null ? '-' : String(Math.round(n));
        t = r === null ? null : r.over ? 'above 100 %: scale to confirm' : 'drive ' + pc(r.drive) + ' % · recup ' + pc(r.recup) + ' %';
        break;
    }
    case 'pdrive': case 'pdrive2': {
        // the scale is NOT known: the owner's car sent 100 at a crawl (2 km/h), which no motor share is, so the number is shown as it is
        const q = Extras.powerQuotaOf(v);
        t = q === null ? null : 'share ' + Math.round(q) + ' (scale to confirm)';
        break;
    }
    case 'erange': {
        // the cluster's electric range, in the unit it is set to (km, or miles on a US setting): 0xFFFE and up is "none"
        const n = typeof v === 'number' ? v : v && typeof v === 'object' ? v.displayRangeElectricVehicle : null;
        t = typeof n === 'number' && isFinite(n) && n >= 0 ? (n >= 4093 ? 'none (' + Math.round(n) + ')' : 'range ' + Math.round(n)) : null;
        break;
    }
    case 'cc': t = yn(Extras.alertOf(v), 'alert'); break;
    case 'guide': t = yn(guidanceOf(v), 'route'); break;
    default: return '';
    }
    return '→ ' + (t === null ? 'not understood' : t);
}

/** Whether the app's spec (ctx.spec) declares probe `p`'s signal: a signal that is not declared is never subscribed to, and shows "Not read in this version". */
function declaredIn(spec, p) {
    return !!(spec && spec.signals && spec.signals[p.iface] && spec.signals[p.iface][p.field]);
}

class Probes {
    constructor(log) { this.log = log; this.by = {}; }
    /** A new reading of probe `id` (any value; null / undefined count as nothing, an empty object shows as "(empty)"). */
    feed(id, v, now) {
        if (v === null || v === undefined) return false;
        now = now || Date.now();
        const raw = rawOf(v) || '(empty)';
        const p = this.by[id] || (this.by[id] = { at: 0, n: 0, vals: [], logs: 0, logAt: 0, last: null });
        p.at = now; p.n++; p.last = v;
        p.ts = p.ts || []; p.ts.push(now); if (p.ts.length > RATE_KEEP) p.ts.shift();
        if (p.vals[0] === raw) return false;
        p.vals.unshift(raw);
        if (p.vals.length > KEEP) p.vals.length = KEEP;
        if (this.log && (p.logs < LOG_FIRST || now - p.logAt >= LOG_EVERY_MS) && now - p.logAt >= 500) {
            p.logs++; p.logAt = now;
            this.log.info('signal ' + id + ': ' + raw.slice(0, 300));
        }
        return true;
    }
    /** { at, n, vals } of probe `id`, or null when it has not been heard. */
    get(id) { return this.by[id] || null; }
    /** Messages per second over the last few arrivals of probe `id` (the car sends the rev counter often, a temperature rarely); null before two messages or when the last one is old. */
    rate(id, now) {
        const p = this.by[id];
        if (!p || !p.ts || p.ts.length < 2) return null;
        const t = p.ts, span = t[t.length - 1] - t[0];
        if ((now || Date.now()) - t[t.length - 1] > RATE_STALE_MS) return null;
        return span > 0 ? (t.length - 1) * 1000 / span : null;
    }
    /** How many have been heard at least once. */
    heard() { return SHOWN.filter((id) => this.by[id] && this.by[id].n > 0).length; }
}

/** Why a probe has not been heard, in a few words, from its interface's subscription (kit/runtime/signals.js watch(), kept in car.subs):
 *  not made yet, refused, the car's provider not answering, or fine and silent. */
function stateOf(sub, field, iface, busy) {
    if (!sub) {
        // not subscribed yet: while the native step running now has lasted a while, say which one it is (they go one at a time, one that never
        // answers holds back every interface behind it)
        if (busy && busy.ms >= STUCK_MS) {
            const s = Math.round(busy.ms / 1000);
            if (iface && iface.split('.').pop() === busy.iface) {
                return busy.step === 'open' ? 'Stuck while opening (' + s + ' s)'
                    : busy.step === 'availability' ? 'Stuck while waiting for the car (' + s + ' s)' : 'Stuck while subscribing to ' + busy.step + ' (' + s + ' s)';
            }
            return 'Waiting: ' + busy.iface + ' is stuck (' + s + ' s)';
        }
        return 'Subscribing';
    }
    if (sub.error) return 'Error: ' + String(sub.error).slice(0, 70);
    if (sub.failed && sub.failed[field]) return 'Refused: ' + sub.failed[field];
    if (sub.getFailed && sub.getFailed[field]) return 'Read refused: ' + sub.getFailed[field];
    if (!sub.available) return 'The car does not answer';
    return 'Subscribed, nothing received';
}

module.exports = { PROBES, GUIDE, PAGES, Probes, rawOf, guidanceOf, meaningOf, declaredIn, SHOWN, stateOf };
