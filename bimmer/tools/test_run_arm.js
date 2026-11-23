'use strict';
// node tools/test_run_arm.js : le chrono 0-100 ne part qu'après un départ arrêté (shared/runs.js, réglage runArmRpm). Le propriétaire, 23 nov. 2026 :
// « le chrono seulement après un launch control : gros freinage et 1500 tr/min minimum à l'arrêt ».
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Runs = require('../shared/runs');
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };
const mk = () => new Runs(fs.mkdtempSync(path.join(os.tmpdir(), 'runs-')), { info() {}, warn() {} });
check('feu rouge : à l\'arrêt au ralenti puis départ, pas de chrono', () => {
    const r = mk();
    for (let t = 0; t <= 2000; t += 100) r.update(0, t, 'metric', 800, 1500);
    r.update(5, 2100, 'metric', 1800, 1500);
    assert.notStrictEqual(r.state, 'run');
});
check('départ arrêté : frein + 2000 tr/min, puis départ, le chrono part et s\'arrête à 100', () => {
    const r = mk();
    for (let t = 0; t <= 1000; t += 100) r.update(0, t, 'metric', 2000, 1500);
    assert.strictEqual(r.state, 'armed');
    r.update(3, 1100, 'metric', 3000, 1500);
    assert.strictEqual(r.state, 'run');
    r.update(101, 6100, 'metric', 5000, 1500);
    assert.strictEqual(r.state, 'done');
});
check('le pied lâché à l\'arrêt : plus armé', () => {
    const r = mk();
    for (let t = 0; t <= 1000; t += 100) r.update(0, t, 'metric', 2000, 1500);
    r.update(0, 1100, 'metric', 900, 1500);
    assert.strictEqual(r.state, 'idle');
});
check('réglage à 0 : comme avant, chaque départ arrêté', () => {
    const r = mk();
    for (let t = 0; t <= 1000; t += 100) r.update(0, t, 'metric', 800, 0);
    r.update(3, 1100, 'metric', 900, 0);
    assert.strictEqual(r.state, 'run');
});
console.log(bad ? bad + ' échec(s)' : 'chrono au départ arrêté : tout passe');
process.exit(bad ? 1 : 0);
