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
const names = ['_carNext', '_nextLimitNow', '_carAlertSet', '_alertNow', '_carPowerSet', '_carPower', '_hybridTach'];
const Cls = new Function('extras', 'hybridTach', 'isNum', 'formatLimit', 'return class {' + names.map(grab).join('') + '}')(ex, hybridTach, isNum, formatLimit);
function mk(set, over) {
    const o = Object.create(Cls.prototype);
    Object.assign(o, { target: 'panel', nextLim: null, carAlert: null, carQuota: null, logs: [], log: { info: (m) => o.logs.push(m) },
        speedLimit: { limit: () => null }, ci: { sharedPower: () => null },
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
check('hud.js wires the three readings and the live icon path takes the two new flags', () => {
    assert(/p\.id === 'next'\) this\._guard\('nextLimit'/.test(hudSrc) && /p\.id === 'cc'\) this\._guard\('carAlert'/.test(hudSrc) && /p\.id === 'pdrive' \|\| p\.id === 'pdrive2'\) this\._guard\('carPower'/.test(hudSrc));
    assert(/w\.evShareBy \|\| w\.nextBy \|\| w\.alertBy \|\| w\.readyBy/.test(hudSrc), 'the icons would always show');
    assert(/case 'nextLimit':/.test(hudSrc));
    assert(/_hybridTach\(w, rpm\) \{[\s\S]*?_carPower\(\)/.test(hudSrc), '_hybridTach does not use the car\'s own power');
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
