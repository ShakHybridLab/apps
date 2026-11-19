'use strict';
// node tools/test_rpm_alt.js : la seconde source du compte-tours (kit/runtime/car.js feedRpmAlt, hud.js rpm2).
const assert = require('assert'), fs = require('fs'), path = require('path');
let n = 0, bad = 0;
function check(name, fn) { n++; try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const CDS = 'de.bmw.infotainment.vehicle.CDS';
function rig() {
    const Car = require('../kit/runtime/car');
    const seen = {};
    const ctx = { log: { info() {}, warn() {} }, spec: { config: {} }, settings: { get: () => 'off' },
        signals: { watch: (iface, v, handlers) => { seen[iface] = handlers; return Promise.resolve({ iface, available: true }); } } };
    const car = new Car(ctx, ['rpm', 'speed'], {});
    return { car, cds: (raw) => seen[CDS].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: raw }) };
}
check('la voiture du propriétaire : la première source dit 0 quatre fois par seconde, la seconde dit 900 : le compte-tours montre 900 et ne retombe pas', () => {
    const R = rig();
    R.cds(0); assert.strictEqual(R.car.data().rpm, 0);
    R.car.feedRpmAlt(900); assert.strictEqual(R.car.data().rpm, 900);
    for (let i = 0; i < 8; i++) R.cds(0);
    assert.strictEqual(R.car.data().rpm, 900, 'un 0 de la première source a écrasé la seconde');
    R.car.feedRpmAlt(2400); R.cds(0); assert.strictEqual(R.car.data().rpm, 2400);
    R.car.feedRpmAlt(0); R.cds(0); assert.strictEqual(R.car.data().rpm, 0, 'moteur arrêté : les deux disent 0');
});
check('une voiture dont la première source marche : elle gagne, la seconde ne la remplace pas', () => {
    const R = rig();
    R.cds(8000); assert.strictEqual(R.car.data().rpm, 2000);
    R.car.feedRpmAlt(900); assert.strictEqual(R.car.data().rpm, 2000);
    R.cds(12000); assert.strictEqual(R.car.data().rpm, 3000);
    // et si elle se met à marcher après coup, elle reprend la main
    const S = rig();
    S.cds(0); S.car.feedRpmAlt(900); S.cds(4000); assert.strictEqual(S.car.data().rpm, 1000);
    S.car.feedRpmAlt(950); assert.strictEqual(S.car.data().rpm, 1000);
});
check('valeurs hors d\'un moteur (65535, négatif, pas un nombre) : ignorées', () => {
    const R = rig();
    R.cds(0);
    [65535, -5, NaN, '900', null, 20000].forEach((v) => R.car.feedRpmAlt(v));
    assert.strictEqual(R.car.data().rpm, 0);
});
check('hud.js lit le membre rpm et le donne à la voiture ; les deux applis déclarent le signal', () => {
    const hud = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    assert(/p\.id === 'rpm2'\) group\.\$pollMs = RPM_POLL_MS/.test(hud) && /feedRpmAlt\(n\)/.test(hud) && /function rpmAltOf/.test(hud));
    ['shakhud', 'shaktheme'].forEach((a) => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', a, 'app.json'), 'utf8'));
        assert.strictEqual(spec.signals['de.bmw.infotainment.displaydataserver.DisplayDataServer'].functionalLibraryData, 'rs', a);
    });
});
console.log(bad ? 'rpm alt: FAILED' : 'rpm alt: all ' + n + ' checks pass');
process.exit(bad ? 1 : 0);
