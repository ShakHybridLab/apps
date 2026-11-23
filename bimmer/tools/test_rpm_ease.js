'use strict';
// node tools/test_rpm_ease.js : le compte-tours glisse comme une aiguille (shared/hud.js _smoothRpm). Le propriétaire, 23 nov. 2026 : « une
// accélération franche, il monte d'un coup à 5000 tours, c'est pas fluide » : sur l'hybride le moteur démarre en pleine accélération, et sa
// première lecture s'affichait d'un coup. Maintenant il part de 0 et monte en douceur ; à l'arrêt du moteur il redescend à 0.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpmease-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };

function hud(rpmAt) {
    const h = Object.create(HudApp.prototype);
    let now = 0;
    h.car = { data: () => ({ rpm: rpmAt(now), demo: false }) };
    h._testRpm = () => null;
    h.rpmF = null; h.rpmShown = null; h.lastTickT = 0;
    return { h, step(ms) { now += ms; h._smoothRpm(now); return h.rpmF; } };
}

check('le moteur démarre à 5000 tr/min : la barre part de 0 et monte en douceur, sans saut', () => {
    const { step } = hud((t) => (t < 100 ? null : 5000));
    step(20); step(20); step(20); step(20);              // moteur arrêté : rien
    let prev = 0, maxJump = 0, v;
    for (let i = 0; i < 40; i++) { v = step(20); if (i === 0) assert(v < 1000, 'premier pas ' + v); maxJump = Math.max(maxJump, v - prev); prev = v; }
    assert(maxJump < 900, 'un pas de ' + Math.round(maxJump) + ' tr/min en 20 ms');
    assert(v > 4900, 'arrivé à ' + Math.round(v) + ' après 0,8 s');
});
check('montée franche de 1500 à 5000 en cours de route : en douceur aussi', () => {
    const { step } = hud((t) => (t < 200 ? 1500 : 5000));
    for (let i = 0; i < 10; i++) step(20);
    let prev = step(20), maxJump = 0;
    for (let i = 0; i < 30; i++) { const v = step(20); maxJump = Math.max(maxJump, v - prev); prev = v; }
    assert(maxJump < 700, 'un pas de ' + Math.round(maxJump));
});
check('le moteur s\'arrête : la barre redescend à 0 puis s\'efface (plus de lecture)', () => {
    const { step } = hud((t) => (t < 400 ? 3000 : null));
    for (let i = 0; i < 20; i++) step(20);
    const first = step(20);
    assert(first > 2000, 'pas de chute d\'un coup : ' + first);
    let v = first;
    for (let i = 0; i < 60 && v !== null; i++) v = step(20);
    assert.strictEqual(v, null);
});
console.log(bad ? bad + ' échec(s)' : 'compte-tours fluide : tout passe');
process.exit(bad ? 1 : 0);
