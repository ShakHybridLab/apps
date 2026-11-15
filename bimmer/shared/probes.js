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

const KOMBI = 'de.bmw.infotainment.KombiIF';
const KOMBI2 = 'de.bmw.infotainment.KombiInterface_2';
const FAS = 'de.bmw.infotainment.fasus.FASuS';
const LATERAL = 'de.bmw.dass.driverassistanceapplications.DisplayDriverAssistanceLateralCoordinated';
const EFF = 'de.bmw.infotainment.drivingexcitement.Efficiencytainment2';
const SIGN = 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl';

const PROBES = [
    { id: 'sign', iface: SIGN, field: 'displaySpeedLimitAndNoPassingRestriction', name: 'Road sign read by the camera' },
    { id: 'next', iface: FAS, field: 'statusNextSpeedLimitRecognition', name: 'Next limit read by the camera' },
    { id: 'fas', iface: FAS, field: 'statusIDriveFAS', name: 'Driver assistance: lane warnings' },
    { id: 'fasx', iface: FAS, field: 'statusIDriveFASExtended', name: 'Driver assistance: steering wheel light' },
    { id: 'wheel', iface: LATERAL, field: 'displaySteeringWheel', name: 'Lane assist: steering wheel symbol' },
    { id: 'pdrive', iface: EFF, field: 'displayPowerDrive', name: 'Power meter: drive and recuperation' },
    { id: 'pdrive2', iface: EFF, field: 'displayPowerDrive2', name: 'Power meter: second reading' },
    { id: 'pdist', iface: KOMBI, field: 'statusDisplayElectricalPowerDistribution', name: 'Electric power: drive and air conditioning' },
    { id: 'cc', iface: KOMBI, field: 'statusActiveCCMessage', name: 'Check control message showing' },
    { id: 'cbs', iface: KOMBI2, field: 'cbsDataServiceList', name: 'Services due' },
    { id: 'ccrisk', iface: KOMBI2, field: 'ccListRiskClass', name: 'Check control risk class' },
];
const SHOWN = PROBES.map((p) => p.id);
const KEEP = 3;               // distinct values kept for each (the page shows the newest first)
const LOG_FIRST = 12;         // distinct values of each that go to the log, then one a minute at most
const LOG_EVERY_MS = 60000;
const CLIP = 500;

/** A value on one line ("key=value key=value ..."), long values cut. */
function rawOf(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && !Array.isArray(v)) return Waze.rawOf(v);
    let t = '';
    try { t = JSON.stringify(v); } catch (e) { t = String(v); }
    return String(t === undefined ? '' : t).slice(0, CLIP);
}

class Probes {
    constructor(log) { this.log = log; this.by = {}; }
    /** A new reading of probe `id` (any value; null / undefined count as nothing, an empty object shows as "(empty)"). */
    feed(id, v, now) {
        if (v === null || v === undefined) return false;
        now = now || Date.now();
        const raw = rawOf(v) || '(empty)';
        const p = this.by[id] || (this.by[id] = { at: 0, n: 0, vals: [], logs: 0, logAt: 0 });
        p.at = now; p.n++;
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
    /** How many have been heard at least once. */
    heard() { return SHOWN.filter((id) => this.by[id] && this.by[id].n > 0).length; }
}

/** Why a probe has not been heard, in a few words, from its interface's subscription (kit/runtime/signals.js watch(), kept in car.subs):
 *  not made yet, refused, the car's provider not answering, or fine and silent. */
function stateOf(sub, field) {
    if (!sub) return 'Subscribing';
    if (sub.error) return 'Error: ' + String(sub.error).slice(0, 70);
    if (sub.failed && sub.failed[field]) return 'Refused: ' + sub.failed[field];
    if (sub.getFailed && sub.getFailed[field]) return 'Read refused: ' + sub.getFailed[field];
    if (!sub.available) return 'The car does not answer';
    return 'Subscribed, nothing received';
}

module.exports = { PROBES, Probes, rawOf, SHOWN, stateOf };
