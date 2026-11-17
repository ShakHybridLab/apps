'use strict';
// The three signals read tolerantly (shared/car_extras.js): the next speed limit, the car's warning, the electric motor's share of its power.
// Their decoders, the settings and layouts that carry them, and the way hud.js uses them. node tools/test_car_extras.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ex = require('../shared/car_extras');
const hybridTach = require('../shared/hybrid_tach');
const { formatLimit } = require('../shared/danger');
const fr = require('../shared/fr');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const ROOT = path.join(__dirname, '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const theme = json('apps/shaktheme/app.json'), hud = json('apps/shakhud/app.json');

check('nextLimitOf: the limit when the present one is withdrawn, else the next class\'s; nothing clear is null', () => {
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: 70, nextClassLimitSpeed: 255 }), 70);
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: 255, nextClassLimitSpeed: 50 }), 50);
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: 90, nextClassLimitSpeed: 50 }), 90);
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: { name: 'SPEED_130', value: 3 } }), 130);
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: 255, nextClassLimitSpeed: 0 }), null, 'no sign codes');
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: 7 }), null, 'an enum code is not a speed');
    assert.strictEqual(ex.nextLimitOf({ nextWithdrawalLimitSpeed: 72 }), null, 'a speed is a whole 5');
    assert.strictEqual(ex.nextLimitOf(70), null); assert.strictEqual(ex.nextLimitOf(null), null); assert.strictEqual(ex.nextLimitOf([70]), null); assert.strictEqual(ex.nextLimitOf({}), null);
});
check('alertOf: a plain positive number is a message, 0 is none, the all-ones numbers and a missing field say nothing', () => {
    assert.strictEqual(ex.alertOf({ numberDisplayControlCheckControlMessage: 12 }), true);
    assert.strictEqual(ex.alertOf({ numberDisplayControlCheckControlMessage: 0, displayControlCheckControlMessage: 5 }), false);
    assert.strictEqual(ex.alertOf({ numberDisplayControlCheckControlMessage: 255 }), null);
    assert.strictEqual(ex.alertOf({ numberDisplayControlCheckControlMessage: 65535 }), null);
    assert.strictEqual(ex.alertOf({ numberDisplayControlCheckControlMessage: { value: 3 } }), true);
    assert.strictEqual(ex.alertOf({ numberDisplayControlCheckControlMessage: 'x' }), null);
    assert.strictEqual(ex.alertOf({ displayControlCheckControlMessage: 5 }), null);
    assert.strictEqual(ex.alertOf(null), null); assert.strictEqual(ex.alertOf(7), null);
});
check('powerQuotaOf: -100..100 from the struct or a plain number; 255, 65535, text and anything else is null', () => {
    assert.strictEqual(ex.powerQuotaOf({ quotaImmediateElectricEngineDriveRecuperation: 40 }), 40);
    assert.strictEqual(ex.powerQuotaOf({ quotaImmediateElectricEngineDriveRecuperation: -25 }), -25);
    assert.strictEqual(ex.powerQuotaOf(0), 0); assert.strictEqual(ex.powerQuotaOf(100), 100);
    assert.strictEqual(ex.powerQuotaOf({ quotaImmediateElectricEngineDriveRecuperation: { value: 12 } }), 12);
    [255, 65535, 101, -101, NaN, 'x', null, undefined, {}, { other: 5 }, [1]].forEach((v) => assert.strictEqual(ex.powerQuotaOf(v), null, JSON.stringify(v)));
    assert.strictEqual(ex.powerKw(100), ex.EV_MAX_KW); assert.strictEqual(ex.powerKw(-50), -ex.EV_MAX_KW / 2); assert.strictEqual(ex.powerKw(0), 0);
});

// hud.js needs the kit around it (it is only built into dist): its methods are cut out of its source and run on a stand-in
const hudSrc = fs.readFileSync(path.join(ROOT, 'shared', 'hud.js'), 'utf8');
const grab = (name) => { const m = hudSrc.match(new RegExp('\\n    ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}\\n')); assert(m, 'hud.js has no ' + name); return m[0]; };
const isNum = (v) => typeof v === 'number' && isFinite(v);
const names = ['_carNext', '_nextLimitNow', '_carAlertSet', '_alertNow', '_laneSet', '_laneNow', '_carPowerSet', '_carPower', '_relSet', '_relPower', '_estStep', '_estPower', '_hybridTach'];
const EST_SRC = hudSrc.match(/const EST = \{[^}]*\};/); assert(EST_SRC, 'hud.js has no EST');
const VERDICT = require('../shared/hud_themes').VERDICT;
const Cls = new Function('extras', 'hybridTach', 'isNum', 'formatLimit', 'VERDICT', EST_SRC[0] + 'return class {' + names.map(grab).join('') + '}')(ex, hybridTach, isNum, formatLimit, VERDICT);
function mk(set, over) {
    const o = Object.create(Cls.prototype);
    Object.assign(o, { target: 'panel', nextLim: null, carAlert: null, carQuota: null, relPow: null, relAlive: false, lane: null, logs: [], log: { info: (m) => o.logs.push(m) },
        speedLimit: { limit: () => null }, ci: { sharedPower: () => null }, car: { data: () => ({ speed: null }) },
        ctx: { settings: { item: (k) => (set[k] !== undefined ? { key: k } : undefined), get: (k) => set[k] } },
        setting: (k) => (set[k] === undefined ? undefined : set[k]) }, over || {});
    return o;
}

check('next limit: shown while fresh and different from the present limit; goes after NEXT_TTL_MS, with the setting off, or off the cluster', () => {
    const o = mk({ limitRing: true, nextLimit: true, units: 'kmh' });
    o._carNext({ nextWithdrawalLimitSpeed: 70 });
    assert.strictEqual(o._nextLimitNow(Date.now()).text, '70');
    assert.strictEqual(o._nextLimitNow(Date.now() + ex.NEXT_TTL_MS + 5), null, 'stale');
    o.speedLimit = { limit: () => 70 }; assert.strictEqual(o._nextLimitNow(Date.now()), null, 'it is the present limit');
    o.speedLimit = { limit: () => 50 }; assert.strictEqual(o._nextLimitNow(Date.now()).text, '70');
    o._carNext({ nextWithdrawalLimitSpeed: 255 }); assert.strictEqual(o.nextLim, null); assert.strictEqual(o._nextLimitNow(Date.now()), null);
    const off = mk({ limitRing: true, nextLimit: false, units: 'kmh' }); off._carNext({ nextClassLimitSpeed: 90 }); assert.strictEqual(off._nextLimitNow(Date.now()), null);
    const ring = mk({ limitRing: false, nextLimit: true, units: 'kmh' }); ring._carNext({ nextClassLimitSpeed: 90 }); assert.strictEqual(ring._nextLimitNow(Date.now()), null);
    const hudT = mk({ limitRing: true, nextLimit: true, units: 'kmh' }, { target: 'hud' }); hudT._carNext({ nextClassLimitSpeed: 90 }); assert.strictEqual(hudT._nextLimitNow(Date.now()), null);
    const us = mk({ limitRing: true, nextLimit: true, units: 'us' }); us._carNext({ nextClassLimitSpeed: 80 }); assert.strictEqual(us._nextLimitNow(Date.now()).text, '50');
});
check('car alert: only with the setting on (off by default) and a message showing; a reading it does not understand changes nothing', () => {
    const on = mk({ carAlert: true }), off = mk({ carAlert: false }), none = mk({});
    [on, off, none].forEach((o) => o._carAlertSet({ numberDisplayControlCheckControlMessage: 12 }));
    assert.strictEqual(!!on._alertNow(), true); assert.strictEqual(!!off._alertNow(), false); assert.strictEqual(!!none._alertNow(), false);
    on._carAlertSet({ numberDisplayControlCheckControlMessage: 65535 }); assert.strictEqual(!!on._alertNow(), true, 'unclear: the last stays');
    on._carAlertSet({ numberDisplayControlCheckControlMessage: 0 }); assert.strictEqual(!!on._alertNow(), false, 'gone');
    assert.strictEqual(!!mk({ carAlert: true }, { target: 'hud', carAlert: true })._alertNow(), false, 'not on the HUD');
});
check('laneOf: the wheel symbol is on, off or unclear; the colour by its name; a lane departure warning is the one red', () => {
    assert.deepStrictEqual(ex.laneOf({ steeringWheelDisplay: 1, steeringWheelColor: 'GREEN', displayLateralWarning: 0 }), { on: true, tone: 'green', warn: false });
    assert.deepStrictEqual(ex.laneOf({ steeringWheelDisplay: { name: 'ON', value: 1 }, steeringWheelColor: { name: 'YELLOW', value: 2 } }), { on: true, tone: 'yellow', warn: false });
    assert.strictEqual(ex.laneOf({ steeringWheelDisplay: 0 }).on, false); assert.strictEqual(ex.laneOf({ steeringWheelDisplay: 'NO_SYMBOL' }).on, false); assert.strictEqual(ex.laneOf({ steeringWheelDisplay: 'OFF' }).on, false);
    assert.strictEqual(ex.laneOf({ steeringWheelDisplay: 255 }).on, null); assert.strictEqual(ex.laneOf({ steeringWheelDisplay: 65535 }).on, null);
    assert.strictEqual(ex.laneOf({ displayLateralWarning: 'LEFT' }).warn, true); assert.strictEqual(ex.laneOf({ displayLateralWarning: 'NO_WARNING' }).warn, false); assert.strictEqual(ex.laneOf({ displayLateralWarning: 255 }).warn, false);
    assert.strictEqual(ex.laneOf({ steeringWheelColor: 7 }).tone, null, 'a number is no colour');
    [null, undefined, 3, 'x', [1], {}].forEach((v) => assert.deepStrictEqual(ex.laneOf(v), { on: null, tone: null, warn: false }, JSON.stringify(v)));
});
check('lane icon: only with the setting on (off by default), on the cluster, with the symbol on; the car\'s colour, red only for a warning; a reading it does not understand changes nothing', () => {
    const feed = (o, v) => o._laneSet(v);
    const on = mk({ carLane: true }), off = mk({ carLane: false }), none = mk({});
    [on, off, none].forEach((o) => feed(o, { steeringWheelDisplay: 1, steeringWheelColor: 'GREEN' }));
    assert.strictEqual(on._laneNow(), VERDICT['SPOT ON']); assert.strictEqual(off._laneNow(), null); assert.strictEqual(none._laneNow(), null);
    feed(on, { steeringWheelDisplay: 65535 }); assert.strictEqual(on._laneNow(), VERDICT['SPOT ON'], 'unclear: the last stays');
    feed(on, { steeringWheelDisplay: 1, steeringWheelColor: 'GREY' }); assert.strictEqual(on._laneNow(), 'dim');
    feed(on, { steeringWheelDisplay: 1, steeringWheelColor: 'YELLOW' }); assert.strictEqual(on._laneNow(), VERDICT.EARLY);
    feed(on, { steeringWheelDisplay: 1, steeringWheelColor: 'GREEN', displayLateralWarning: 'RIGHT' }); assert.strictEqual(on._laneNow(), 'hot', 'a warning is red');
    feed(on, { steeringWheelDisplay: 0, displayLateralWarning: 0 }); assert.strictEqual(on._laneNow(), null, 'symbol off');
    feed(on, null); feed(on, 7); assert.strictEqual(on._laneNow(), null);
    const hudo = mk({ carLane: true }, { target: 'hud' }); feed(hudo, { steeringWheelDisplay: 1, steeringWheelColor: 'GREEN' }); assert.strictEqual(hudo._laneNow(), null, 'not on the HUD');
});
check('hybrid rev counter: without eDrive Live the car\'s motor share gives the blue power (setting carPower, off by default); an rpm that never comes counts as the engine at rest', () => {
    const w = { hybridTach: true };
    const base = { sportPower: true, carPower: true };
    const o = mk(base); o._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 50 });
    let st = o._hybridTach(w, 0); assert.strictEqual(st.ev, true); assert.strictEqual(st.kw, 40);
    st = o._hybridTach(w, null); assert.strictEqual(st.ev, true, 'rpm unknown: the engine at rest');
    st = o._hybridTach(w, 2500); assert.strictEqual(st.ev, false, 'the engine runs: the rpm shows alone'); assert.strictEqual(st.engineOff, false);
    o._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: -50 }); st = o._hybridTach(w, 0);
    assert.strictEqual(st.ev, false); assert(st.chg > 0, 'recuperation: the green charge');
    assert.strictEqual(mk({ sportPower: true, carPower: false }, {})._hybridTach(w, 0).ev, false, 'setting off');
    const off = mk({ sportPower: true, carPower: false }); off._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 50 }); assert.strictEqual(off._hybridTach(w, 0).ev, false);
    const stale = mk(base); stale._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 50 }); stale.carQuota.at -= ex.POWER_TTL_MS + 10;
    assert.strictEqual(stale._hybridTach(w, 0).ev, false, 'stale'); assert.strictEqual(stale._hybridTach(w, null).ev, false, 'stale and no rpm: nothing hybrid');
    const shared = mk(base, { ci: { sharedPower: () => ({ kw: -20, old: false }) } }); shared._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 50 });
    assert.strictEqual(shared._hybridTach(w, 0).kw, -20, 'eDrive Live\'s power wins');
    assert.strictEqual(shared._hybridTach(w, null).engineOff, false, 'with eDrive Live an unknown rpm is still not "engine off"');
    assert.strictEqual(mk(base)._hybridTach(w, 0).kw, null, 'nothing read: no power');
    const hudOn = mk({ hybridRev: true, carPower: true }, { target: 'hud' }); hudOn._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 30 });
    assert.strictEqual(hudOn._hybridTach(w, 0).ev, true, 'the HUD too (setting hybridRev)');
    o._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 255 }); o._carPowerSet('x'); assert.strictEqual(o.carQuota.q, -50, 'unclear readings change nothing');
});
check('cluster power meter: relPowerOf reads drive and recuperation in %, and drops 255, 65535, negatives; a number over 100 is an unknown scale', () => {
    const D = 'displayActualValuePowerRelativeDrivingElectric', R = 'displayActualValuePowerRelativeRecuperation';
    assert.deepStrictEqual(ex.relPowerOf({ [D]: 20, [R]: 0 }), { drive: 20, recup: 0, over: false });
    assert.deepStrictEqual(ex.relPowerOf({ [R]: 35 }), { drive: null, recup: 35, over: false });
    assert.strictEqual(ex.relPowerOf({ [D]: 255, [R]: 65535 }), null, 'the all-ones numbers say nothing');
    assert.strictEqual(ex.relPowerOf({ [D]: -4 }), null); assert.strictEqual(ex.relPowerOf(7), null); assert.strictEqual(ex.relPowerOf(null), null); assert.strictEqual(ex.relPowerOf([1]), null);
    assert.strictEqual(ex.relPowerOf({ [D]: 'x' }), null);
    assert.deepStrictEqual(ex.relPowerOf({ [D]: 150 }), { drive: null, recup: null, over: true }, 'a scale over 100 is flagged, never drawn');
    assert.deepStrictEqual(ex.relPowerOf({ [D]: { value: 40 }, [R]: { name: 0 } }), { drive: 40, recup: 0, over: false }, 'struct values are read through scalar');
    assert.strictEqual(ex.relKw({ drive: 50, recup: 0 }), 40); assert.strictEqual(ex.relKw({ drive: 0, recup: 50 }), -30); assert.strictEqual(ex.relKw({ drive: null, recup: 100 }), -60);
    assert.strictEqual(ex.relKw({ drive: 100, recup: 0 }), ex.EV_MAX_KW); assert.strictEqual(ex.relKw({ drive: 0, recup: 0 }), 0); assert.strictEqual(ex.relKw(null), 0);
});
check('hybrid rev counter: the stock cluster\'s power meter (setting relPower, on) draws the bar ahead of the car\'s share and the estimate, once it has read above 0; eDrive Live still wins', () => {
    const w = { hybridTach: true }, D = 'displayActualValuePowerRelativeDrivingElectric', R = 'displayActualValuePowerRelativeRecuperation';
    const o = mk({ sportPower: true, relPower: true });
    assert.strictEqual(o._relPower(), null, 'nothing read yet');
    o._relSet({ [D]: 0, [R]: 0 }); assert.strictEqual(o._relPower(), null, 'only ever 0: not trusted (the estimate draws)');
    o._relSet({ [D]: 50, [R]: 0 }); assert.strictEqual(o._relPower().kw, 40);
    let st = o._hybridTach(w, 0); assert.strictEqual(st.ev, true); assert.strictEqual(st.kw, 40);
    st = o._hybridTach(w, null); assert.strictEqual(st.ev, true, 'rpm unknown: the engine at rest, as with the car\'s share');
    st = o._hybridTach(w, 2500); assert.strictEqual(st.ev, false); assert.strictEqual(st.engineOff, false);
    o._relSet({ [D]: 0, [R]: 40 }); st = o._hybridTach(w, 0); assert.strictEqual(st.kw, -24); assert(st.chg > 0.3 && st.chg < 0.5, 'recuperation: the green charge, ' + st.chg);
    o._relSet({ [D]: 0, [R]: 0 }); assert.strictEqual(o._relPower().kw, 0, 'alive and at 0: the bar sits at 0, it does not fall back');
    o._relSet({ [D]: 255 }); o._relSet('x'); assert.strictEqual(o.relPow.recup, 0, 'unclear readings change nothing');
    // stale: after REL_TTL_MS the estimate takes over again (the meter is re-read every 2 s while the car answers)
    o.relPow.at -= ex.REL_TTL_MS + 10; assert.strictEqual(o._relPower(), null, 'stale');
    // an unknown scale is never drawn, and does not stay alive on its own
    const big = mk({ sportPower: true, relPower: true }); big._relSet({ [D]: 300 }); assert.strictEqual(big._relPower(), null); assert.strictEqual(big.relAlive, false);
    big._relSet({ [D]: 20 }); assert.strictEqual(big._relPower().kw, 16, 'a good reading after an odd one is taken');
    big._relSet({ [D]: 300 }); assert.strictEqual(big._relPower(), null, 'then an odd one again: not drawn');
    // priority: eDrive Live (real kW) > the cluster's meter > the car's share > the estimate
    const base = { sportPower: true, carPower: true, relPower: true };
    const all = mk(base, { ci: { sharedPower: () => ({ kw: -20, old: false }) } }); all._relSet({ [D]: 50 }); all._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 25 });
    assert.strictEqual(all._hybridTach(w, 0).kw, -20, 'eDrive Live wins');
    const noShare = mk(base); noShare._relSet({ [D]: 50 }); noShare._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 25 });
    assert.strictEqual(noShare._hybridTach(w, 0).kw, 40, 'the cluster\'s meter before the car\'s share');
    noShare.relPow.at -= ex.REL_TTL_MS + 10; assert.strictEqual(noShare._hybridTach(w, 0).kw, 20, 'meter stale: the share');
    // setting off, and the HUD target (setting hybridRev)
    const off = mk({ sportPower: true, relPower: false }); off._relSet({ [D]: 50 }); assert.strictEqual(off._relPower(), null); assert.strictEqual(off._hybridTach(w, 0).kw, null, 'setting off, no estimate speed: nothing');
    const hudOn = mk({ hybridRev: true, relPower: true }, { target: 'hud' }); hudOn._relSet({ [D]: 25 }); assert.strictEqual(hudOn._hybridTach(w, 0).kw, 20, 'the HUD too (setting hybridRev)');
    assert.strictEqual(hudOn._hybridTach({ hybridTach: false }, 0).kw, null, 'a layer that does not ask for it');
});
// the estimated electric power (setting estPower): the rev bar rises in electric with no data from the car; every tick is 25 ms
function drive(o, kmh, ms, from) {
    // speed ramps / holds for ms milliseconds; returns the hybrid state at the end (the engine at rest: rpm 0)
    let t = (o.t0 = o.t0 || 1000000), v0 = from === undefined ? (o.estV === null || o.estV === undefined ? kmh : o.estV * 3.6) : from, last;
    const n = Math.round(ms / 25);
    for (let i = 1; i <= n; i++) {
        t += 25; o.t0 = t;
        const v = v0 + (kmh - v0) * i / n;
        o.car = { data: () => ({ speed: v }) };
        o._estStep(t);
        last = o._hybridTach({ hybridTach: true }, 0);
    }
    return last;
}
check('estimated electric power: standing = nothing, accelerating = the blue bar rises, cruising = a little, slowing = the green charge', () => {
    const o = mk({ sportPower: true, estPower: true });
    let st = drive(o, 0, 500, 0); assert.strictEqual(st.engineOff, true); assert.strictEqual(st.ev, true); assert.strictEqual(st.kw, 0, 'standing: zero');
    st = drive(o, 50, 5000, 0);                                   // 0 -> 50 km/h in 5 s (2.8 m/s2)
    assert.strictEqual(st.ev, true); assert(st.kw > 5, 'accelerating hard: the bar is up (' + st.kw + ' kW)');
    let peak = 0; const o2 = mk({ sportPower: true, estPower: true }); drive(o2, 0, 300, 0);
    for (let k = 0; k < 40; k++) { const s2 = drive(o2, 50, 125, k === 0 ? 0 : undefined); peak = Math.max(peak, s2.kw); }
    assert(peak > 15 && peak <= 80, 'the peak while accelerating is a motor figure: ' + peak);
    const c = mk({ sportPower: true, estPower: true }); drive(c, 100, 1000, 100);
    st = drive(c, 100, 3000, 100); assert(st.kw > 14 && st.kw < 26, 'cruising at 100 km/h: about 20 kW (' + st.kw + ')');
    st = drive(c, 60, 4000, 100);                                  // 100 -> 60 km/h in 4 s
    assert(st.chg > 0 && st.ev === false, 'slowing down: the green charge (' + JSON.stringify(st) + ')');
    const coast = mk({ sportPower: true, estPower: true }); drive(coast, 50, 1000, 50);
    st = drive(coast, 49, 1000, 50); assert(st.ev === true && st.chg === 0, 'coasting is not charging');
});
check('estimated electric power: only with the setting on, a speed, the engine at rest; the real power wins over it', () => {
    const w = { hybridTach: true };
    const offO = mk({ sportPower: true, estPower: false }); assert.strictEqual(drive(offO, 80, 2000, 40).kw, null, 'setting off: nothing');
    const none = mk({ sportPower: true }); assert.strictEqual(drive(none, 80, 1000, 40).kw, null, 'setting unknown (not in this app): nothing');
    const o = mk({ sportPower: true, estPower: true }); drive(o, 80, 2000, 40);
    assert.strictEqual(o._hybridTach(w, 2500).ev, false, 'the engine runs: the rpm shows alone'); assert.strictEqual(o._hybridTach(w, 2500).engineOff, false);
    assert.strictEqual(o._hybridTach(w, null).ev, true, 'an rpm that never comes: the engine at rest');
    const nosp = mk({ sportPower: true, estPower: true }); nosp.car = { data: () => ({ speed: null }) }; nosp._estStep(1);
    assert.strictEqual(nosp._hybridTach(w, 0).kw, null, 'no speed: nothing (the rpm alone)'); assert.strictEqual(nosp._hybridTach(w, null).ev, false);
    const wild = mk({ sportPower: true, estPower: true }); wild.car = { data: () => ({ speed: 900 }) }; wild._estStep(1); assert.strictEqual(wild._estPower(), null, 'an absurd speed is no speed');
    const shared = mk({ sportPower: true, estPower: true }, { ci: { sharedPower: () => ({ kw: -20, old: false }) } }); drive(shared, 80, 1000, 80);
    assert.strictEqual(shared._hybridTach(w, 0).kw, -20, 'eDrive Live\'s power wins');
    const own = mk({ sportPower: true, estPower: true, carPower: true }); drive(own, 80, 1000, 80); own._carPowerSet({ quotaImmediateElectricEngineDriveRecuperation: 50 });
    assert.strictEqual(own._hybridTach(w, 0).kw, 40, 'the car\'s own share (setting carPower) wins over the estimate');
    const hudT = mk({ hybridRev: true, estPower: true }, { target: 'hud' }); assert(drive(hudT, 90, 2000, 40).kw > 5, 'the HUD too (setting hybridRev)');
    const noFlow = mk({ sportPower: false, estPower: true }); assert.strictEqual(drive(noFlow, 90, 1000, 40).kw, null, 'with the hybrid rev counter off: nothing');
    // never above the motor, never below the most it can recover
    const hard = mk({ sportPower: true, estPower: true }); let hi = -1e9, lo = 1e9; drive(hard, 0, 100, 0);
    for (let k = 0; k < 40; k++) { const s2 = drive(hard, 200, 25, k === 0 ? 0 : undefined); hi = Math.max(hi, s2.kw === null ? -1e9 : s2.kw); }
    assert(hi <= 80, 'capped at the motor\'s 80 kW: ' + hi);
    drive(hard, 200, 500, 200); for (let k = 0; k < 40; k++) { const s2 = drive(hard, 0, 25, k === 0 ? 200 : undefined); lo = Math.min(lo, s2.kw === null ? 1e9 : s2.kw); }
    assert(lo >= -60, 'recovery capped at 60 kW: ' + lo);
});
check('estimated electric power: the setting exists in both apps (on by default, French), and hud.js runs the step every tick', () => {
    [theme, require('../apps/shakhud/app.json')].forEach((a) => {
        const it = a.settings.find((x) => x.key === 'estPower');
        assert(it && it.type === 'bool' && it.default === true && /estimée/.test(it.label), a.id + ': the setting');
    });
    assert(/this\._estStep\(now\);/.test(hudSrc), '_estStep is not called in _tick');
});
// simulated drives through the real methods (the car sends the speed every sampleMs, held between two readings): is the estimate a plausible motor?
function cycle(profile, secs, sampleMs) {
    const o = mk({ sportPower: true, estPower: true }); let held = profile(0), next = 0; const out = [];
    for (let t = 0; t <= secs * 1000; t += 25) {
        if (t >= next) { held = profile(t / 1000); next = t + sampleMs; }
        o.car = { data: () => ({ speed: held }) }; o._estStep(1000000 + t);
        out.push({ t, v: profile(t / 1000), kw: o._hybridTach({ hybridTach: true }, 0).kw });
    }
    return out;
}
function energy(r) {   // kWh per 100 km, drive and recuperation apart
    let up = 0, down = 0, km = 0;
    for (let i = 1; i < r.length; i++) { const kw = r[i].kw || 0; if (kw > 0) up += kw * 0.025 / 3600; else down += kw * 0.025 / 3600; km += r[i].v / 3.6 * 0.025 / 1000; }
    return { up: up / km * 100, down: down / km * 100, net: (up + down) / km * 100 };
}
check('estimated electric power on simulated drives: a plausible consumption (town, 80, 130 km/h), recuperation in town, quick and steady for any speed rate', () => {
    const A = 1.2 * 3.6, D = 1.0 * 3.6, tUp = 50 / A, tDn = 50 / D, cyc = tUp + 20 + tDn + 5;
    const town = (t) => { const x = t % cyc; if (x < tUp) return A * x; if (x < tUp + 20) return 50; if (x < tUp + 20 + tDn) return 50 - D * (x - tUp - 20); return 0; };
    [100, 200].forEach((ms) => {
        const e = energy(cycle(town, cyc * 6, ms));
        assert(e.net > 12 && e.net < 21, 'town: ' + e.net.toFixed(1) + ' kWh/100 km (speed every ' + ms + ' ms)');
        assert(e.down < -3 && e.down > -10, 'town: some recuperation, not all of it: ' + e.down.toFixed(1));
        const r80 = energy(cycle(() => 80, 40, ms)).net; assert(r80 > 13 && r80 < 17, '80 km/h: ' + r80.toFixed(1));
        const r130 = energy(cycle(() => 130, 40, ms)).net; assert(r130 > 25 && r130 < 31, '130 km/h: ' + r130.toFixed(1));
        const acc = (t) => (t < 5 ? 50 : t < 10 ? 50 + 3.6 * (t - 5) : 68), r = cycle(acc, 12, ms);
        const base = r.filter((x) => x.t >= 4500 && x.t < 5000).map((x) => x.kw).reduce((a, b) => a + b) / 20;
        const fin = r.filter((x) => x.t >= 8000 && x.t < 9500).map((x) => x.kw), f = fin.reduce((a, b) => a + b) / fin.length;
        const half = r.find((x) => x.t >= 5000 && x.kw >= base + (f - base) / 2);
        assert(half && half.t - 5000 < 800, 'the bar is half way within 0.8 s of the acceleration (' + (half && half.t - 5000) + ' ms, speed every ' + ms + ' ms)');
        const seg = r.filter((x) => x.t >= 6500 && x.t < 9500).map((x) => x.kw); let hf = 0;
        for (let i = 20; i < seg.length - 20; i++) { const m = seg.slice(i - 20, i + 21).reduce((a, b) => a + b) / 41; hf += (seg[i] - m) * (seg[i] - m); }
        assert(Math.sqrt(hf / (seg.length - 40)) < 2, 'the bar does not tremble while accelerating steadily (speed every ' + ms + ' ms)');
        const cr = cycle(() => 50, 6, ms).filter((x) => x.t > 3000).map((x) => x.kw); assert(Math.max.apply(null, cr) - Math.min.apply(null, cr) < 0.01, 'a steady speed gives a steady bar');
    });
});
check('hud.js wires the lane assist symbol, the setting exists (off, French) and the signal is declared optional', () => {
    assert(/p\.id === 'wheel'\) this\._guard\('lane', \(\) => this\._laneSet\(v\)\)/.test(hudSrc), 'not wired');
    assert(/w\.laneBy\) \{ const ln = this\._laneNow\(\)/.test(hudSrc), 'the flag is not used');
    const it = theme.settings.find((x) => x.key === 'carLane');
    assert(it && it.type === 'bool' && it.default === false && /[éèàç ]/.test(it.label), 'setting');
    assert(!hud.settings.find((x) => x.key === 'carLane'), 'ShakHUD has no lane icon');
    const l = theme.signals['de.bmw.dass.driverassistanceapplications.DisplayDriverAssistanceLateralCoordinated'];
    assert(l && l.displaySteeringWheel === 's' && typeof l._optional === 'string');
    ['sport', 'm', 'mblade', 'navi'].forEach((n) => {
        const L = json('apps/shaktheme/hud/layouts/' + n + '.json'), w = L.widgets.find((x) => x.id === 'lim_lane');
        assert(w && w.icon === 'wheel' && w.laneBy === true && w.toggle === '!mapUp' && !w.alertBy, n + ': lane widget');
        assert(w.x >= 0 && w.x + w.w <= 1920 && w.y >= 0 && w.y + w.h <= 660, n + ': lane icon is not clear of the screen');
    });
});
check('hud.js wires the three readings and the live icon path takes the two new flags', () => {
    assert(/p\.id === 'next'\) this\._guard\('nextLimit'/.test(hudSrc) && /p\.id === 'cc'\) this\._guard\('carAlert'/.test(hudSrc) && /p\.id === 'pdrive' \|\| p\.id === 'pdrive2'\) this\._guard\('carPower'/.test(hudSrc));
    assert(/p\.id === 'rel'\) this\._guard\('relPower'/.test(hudSrc) && /p\.id === 'rel'\) group\.\$pollMs = 2000/.test(hudSrc), 'the cluster\'s meter is not wired or not polled');
    assert(/w\.evShareBy \|\| w\.nextBy \|\| w\.alertBy \|\| w\.laneBy \|\| w\.readyBy/.test(hudSrc), 'the icons would always show');
    assert(/case 'nextLimit':/.test(hudSrc));
    assert(/_hybridTach\(w, rpm\) \{[\s\S]*?_relPower\(\)[\s\S]*?_carPower\(\)/.test(hudSrc), '_hybridTach does not use the car\'s own power');
});
check('settings: nextLimit on, carAlert off, carPower off in ShakTheme, carPower off in ShakHUD, all in French', () => {
    const get = (a, k) => a.settings.find((x) => x.key === k);
    assert(get(theme, 'nextLimit').default === true && get(theme, 'carAlert').default === false && get(theme, 'carPower').default === false);
    assert(get(hud, 'carPower').default === false && !get(hud, 'carAlert') && !get(hud, 'nextLimit'));
    ['nextLimit', 'carAlert', 'carPower'].forEach((k) => { assert.strictEqual(get(theme, k).type, 'bool'); assert(/[éèàç ]/.test(get(theme, k).label) && !/^Show /.test(get(theme, k).label), k + ': label not French'); });
});
check('the power meter signals are declared by both apps (optional: a wrong name must not stop the installation), the new file ships with both', () => {
    [theme, hud].forEach((a, i) => {
        const e = a.signals['de.bmw.infotainment.drivingexcitement.Efficiencytainment2'];
        assert(e && e.displayPowerDrive === 's' && e.displayPowerDrive2 === 's' && typeof e._optional === 'string', ['ShakTheme', 'ShakHUD'][i] + ': Efficiencytainment2');
        assert(a.shared.indexOf('car_extras.js') >= 0 || JSON.stringify(a).indexOf('"car_extras.js"') >= 0, 'car_extras.js is not shipped');
    });
});
check('the four themes carry the next limit ring, its number and the warning triangle, hidden with the Waze map, and the warn icon exists', () => {
    const { ICONS } = require('../shared/icons');
    assert(ICONS.warn, 'no warn icon');
    ['sport', 'm', 'mblade', 'navi'].forEach((n) => {
        const L = json('apps/shaktheme/hud/layouts/' + n + '.json'), by = (i) => L.widgets.find((w) => w.id === i);
        const r = by('lim_nxt_ring'), t = by('lim_nxt_num'), a = by('lim_alert');
        assert(r && t && a, n + ': widgets missing');
        assert(r.icon === 'ring' && r.nextBy === true && r.toggle === '!mapUp', n + ': next ring');
        assert(t.text === '{{nextLimit}}' && t.nextBy === true && t.toggle === '!mapUp', n + ': next number');
        assert(a.icon === 'warn' && a.alertBy === true && a.toggle === '!mapUp', n + ': alert');
        // on the screen, clear of the cluster's black strip at the bottom (the gear window drops what bites into it)
        [r, t, a].forEach((w) => assert(w.x >= 0 && w.x + w.w <= 1920 && w.y >= 0 && w.y + w.h <= 660, n + ': ' + w.id + ' is not clear of the screen'));
    });
});
check('the new words are in French', () => {
    assert.strictEqual(fr.tr('Show the map only with a route'), 'Carte seulement avec un itinéraire');
});
console.log(failed ? failed + ' FAILED' : 'car_extras: all checks pass');
process.exit(failed ? 1 : 0);
