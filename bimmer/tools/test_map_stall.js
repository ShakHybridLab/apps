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
const w = { id: 'backdrop', type: 'mdash', x: 0, y: 0, hole: [705, 168, 510, 366], holeWhen: 'mapUp', holeInset: 0, plate: [711, 540, 498, 70, 896] };
const last = (n) => { for (let i = sent.length - 1; i >= 0; i--) if (sent[i][0] === n) return sent[i]; return null; };
h.widgets = new Map([['backdrop', { w, ref: 1, c: { uniform: (r, n, v) => sent.push([n, v]) } }]]);
check('le flux montre : la fenêtre est ouverte', () => { assert(h._hole(w)[2] > 0); });
check('le flux cale : fermée tout de suite, par les uniformes seulement', () => {
    h.holeShut = false; h.waze.st = { state: 'frozen' };
    h._holeLive();
    assert.deepStrictEqual(last('u_hole'), ['u_hole', [0, 0, 0, 0]]);
    assert.deepStrictEqual(last('u_plate'), ['u_plate', [0, 0, 0, 0]], 'la plaque part avec la fenêtre');
});
check('le flux revient : rouverte', () => {
    h.waze.st = { state: 'showing' };
    sent.length = 0;
    h._holeLive();
    assert(last('u_hole') && last('u_hole')[1][2] === 510);
    assert.deepStrictEqual(last('u_plate'), ['u_plate', [711, 540, 498, 70]], 'la plaque revient avec la fenêtre (avant 0.23.0 : seulement au thème refait)');
    assert.deepStrictEqual(last('u_split'), ['u_split', [896]]);
});
check('le fichier d\'état illisible un instant (lu pendant sa réécriture) : la fenêtre reste ouverte', () => {
    h.waze.st = null; h.waze.showAt = Date.now() - 900;
    assert.strictEqual(h._mapStalled(), false);
});
check('le fichier d\'état illisible plus de 2,5 s : la fenêtre se ferme', () => {
    h.waze.st = null; h.waze.showAt = Date.now() - 3000;
    assert.strictEqual(h._mapStalled(), true);
});
check('« frozen » dit par l\'outil : fermée tout de suite, même juste après « showing »', () => {
    h.waze.st = { state: 'frozen' }; h.waze.showAt = Date.now() - 100;
    assert.strictEqual(h._mapStalled(), true);
});
console.log(bad ? bad + ' échec(s)' : 'carte calée : tout passe');
process.exit(bad ? 1 : 0);
