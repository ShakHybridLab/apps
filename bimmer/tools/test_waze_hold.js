'use strict';
// node tools/test_waze_hold.js : la carte Waze dans le thème (shared/waze.js) ne se ferme pas sur un hoquet du fichier d'état de Waze on cluster
// (un « frozen » de 2 s, un fichier lu à moitié écrit, une réécriture en retard) : chaque fermeture puis réouverture reconstruit toutes les couches
// du thème sur le cluster, ce que le propriétaire voyait clignoter (18 nov. 2026). Couper la carte (réglage, « off », « unsupported ») reste immédiat.
// Le seul target réel de l'outil est "map" (re-lu dans sa source le 20 nov. 2026) : plus de cible "panel" à attendre, seul "state" compte.
const assert = require('assert');
const Waze = require('../shared/waze');

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.stack || e)); process.exitCode = 1; } }
function make() {
    let t = 100000, changes = 0;
    const w = new Waze({ status: '/nonexistent/status.json', now: () => t }, null, () => { changes++; });
    w.wanted = true;
    return { w, step: (ms) => { t += ms; }, changes: () => changes };
}
const SHOW = { state: 'showing', target: 'map', keys: 'state,target', raw: '' };
const FROZEN = { state: 'frozen', target: 'map', keys: 'state,target', raw: '' };

check('la carte s\'ouvre tout de suite', () => {
    const { w } = make();
    w._update(SHOW);
    assert.strictEqual(w.up, true);
});
check('un « frozen » ou un fichier illisible de moins de 4 s ne la ferme pas', () => {
    const { w, step, changes } = make();
    w._update(SHOW); const c0 = changes();
    step(1000); w._update(FROZEN); assert.strictEqual(w.up, true);
    step(1000); w._update(null); assert.strictEqual(w.up, true, 'fichier lu à moitié');
    step(1000); w._update(SHOW); assert.strictEqual(w.up, true);
    assert(changes() - c0 <= 3, 'seul le texte de la page change');
});
check('arrêtée plus de 4 s : la carte se ferme', () => {
    const { w, step } = make();
    w._update(SHOW);
    for (let i = 0; i < 3; i++) { step(1000); w._update(FROZEN); }
    assert.strictEqual(w.up, true, 'encore dans les 4 s');
    step(1000); w._update(FROZEN);
    assert.strictEqual(w.up, false);
});
check('couper la carte est immédiat : plus voulue, « off », ou « unsupported »', () => {
    let k = make(); k.w._update(SHOW); k.w.wanted = false; k.w._update(SHOW); assert.strictEqual(k.w.up, false, 'plus voulue');
    k = make(); k.w._update(SHOW); k.step(500); k.w._update({ state: 'off', target: 'map', keys: '', raw: '' }); assert.strictEqual(k.w.up, false, 'off');
    k = make(); k.w._update(SHOW); k.step(500); k.w._update({ state: 'unsupported', target: null, keys: '', raw: '' }); assert.strictEqual(k.w.up, false, 'unsupported');
});
check('jamais ouverte : un état autre que « showing » ne l\'ouvre pas', () => {
    const { w } = make();
    w._update(FROZEN); assert.strictEqual(w.up, false);
    w._update(null); assert.strictEqual(w.up, false);
});
console.log(process.exitCode ? 'waze hold: FAILED' : 'waze hold: all ' + n + ' checks pass');
