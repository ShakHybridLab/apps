'use strict';
// node tools/test_map_stall.js : quand le flux de la carte du téléphone cale (Maps on Cluster dit "frozen"), la fenêtre de la carte se ferme
// tout de suite, sans refaire le thème : la carte de BMW, dessous, ne se voit plus (le propriétaire, 23 nov. 2026, thème M : « des fois il
// change de carte »). Elle se rouvre quand le flux revient.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const H = require(path.join(tmp, 'shared', 'hud.js'));
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };
const h = Object.create(H.prototype);
h.log = { info() {}, warn() {} };
h.waze = { up: true, st: { state: 'showing' } };
h._wazeMapOn = () => true;
h.setting = (k) => (k === 'mapUp' ? true : undefined);
const sent = [];
const w = { id: 'backdrop', type: 'mdash', x: 0, y: 0, hole: [705, 168, 510, 366], holeWhen: 'mapUp', holeInset: 0 };
h.widgets = new Map([['backdrop', { w, ref: 1, c: { uniform: (r, n, v) => sent.push([n, v]) } }]]);
check('le flux montre : la fenêtre est ouverte', () => { assert(h._hole(w)[2] > 0); });
check('le flux cale : fermée tout de suite, par les uniformes seulement', () => {
    h.holeShut = false; h.waze.st = { state: 'frozen' };
    h._holeLive();
    assert.deepStrictEqual(sent.pop(), ['u_hole', [0, 0, 0, 0]]);
});
check('le flux revient : rouverte', () => {
    h.waze.st = { state: 'showing' };
    h._holeLive();
    const last = sent.pop();
    assert(last[0] === 'u_hole' && last[1][2] === 510);
});
console.log(bad ? bad + ' échec(s)' : 'carte calée : tout passe');
process.exit(bad ? 1 : 0);
