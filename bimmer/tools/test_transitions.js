'use strict';
// node tools/test_transitions.js : les transitions (le propriétaire, 26 nov. 2026 : « quand Waze s'affiche ou que j'appuie sur BC, que ça ne se
// déplace pas sec : une animation très propre, très fluide, dans tous les thèmes » ; « le démarrage du thème est sec »).
// Ce qui change s'efface, le thème est refait, le nouveau apparaît ; la fenêtre de la carte s'ouvre depuis son milieu ; le cadran de Circuit glisse.
// Jamais un fond plein écran ne s'efface pendant un changement : le compteur de BMW se verrait dessous.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trans-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const H = require(path.join(tmp, 'shared', 'hud.js'));
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const mk = () => {
    const h = Object.create(H.prototype);
    h.alpha = new Map(); h.fades = new Map(); h.geoAnim = null; h.size = [1920, 720];
    h.log = { info() {}, warn() {} };
    return h;
};
const client = () => { const c = { sets: [], set(ref, o) { c.sets.push([ref, o.opacity]); }, has() { return true; } }; return c; };

check('un fondu va d\'une opacité à l\'autre en douceur, et s\'arrête juste à la cible', () => {
    const h = mk(), c = client();
    h._fadeTo('0:5', c, 5, 0, 100, 0);
    const t0 = h.fades.get('0:5').t0;
    h._fadeStep(t0 + 50);
    const mid = h.alpha.get('0:5');
    assert(mid > 0.2 && mid < 0.8, 'à mi-chemin : ' + mid);
    h._fadeStep(t0 + 100);
    assert.strictEqual(h.alpha.get('0:5'), 0); assert(!h.fades.size, 'terminé');
    assert(c.sets.every(([r, o]) => r === 5 && o >= 0 && o <= 1));
});
check('un fondu qui attend (delay) garde son opacité de départ jusque-là', () => {
    const h = mk(), c = client();
    h.alpha.set('1:2', 0);
    h._fadeTo('1:2', c, 2, 1, 100, 300);
    h._fadeStep(Date.now() + 100);
    assert.strictEqual(h.alpha.get('1:2'), 0);
});
check('une couche refusée ou retirée en cours de fondu : le fondu s\'arrête sans rien envoyer', () => {
    const h = mk(), c = client();
    c.has = () => false;
    h._fadeTo('0:9', c, 9, 0, 100, 0);
    h._fadeStep(Date.now() + 50);
    assert(!h.fades.size && !c.sets.length);
});
check('nouvelles couches : à 0 au premier affichage (toutes, fond compris : il apparaît sur le compteur de BMW) ; pendant un changement, seulement les petites', () => {
    const h = mk();
    h.showFade = true; assert.strictEqual(h._newAlpha(true), 0); assert.strictEqual(h._newAlpha(false), 0);
    h.showFade = false; h.fadeNew = true; assert.strictEqual(h._newAlpha(true), undefined, 'un fond ne disparaît jamais pendant un changement'); assert.strictEqual(h._newAlpha(false), 0);
    h.fadeNew = false; assert.strictEqual(h._newAlpha(false), undefined, 'hors transition : opaque');
});
check('_rebuildSoft : n\'efface que les couches qui suivent ce changement, jamais un fond ; refait le thème après FADE_OUT_MS', (done) => {
    const h = mk(), c = client();
    let rebuilt = 0;
    h.started = true; h.client = { ready: true }; h.activeName = 'circuit'; h._layoutName = () => 'circuit';
    h.ctx = { settings: { item: () => null, get: () => undefined } };
    h._rebuild = () => { rebuilt++; };
    h._guard = (w, fn) => fn();
    h.live = new Map([
        ['0:1', { c, ref: 1, full: true, dyn: '' }],                     // le fond
        ['0:2', { c, ref: 2, full: false, dyn: '!mapUp !mapUp' }],        // les textes sans carte
        ['0:3', { c, ref: 3, full: false, dyn: 'viewSel=gauges' }],       // une vue
        ['0:4', { c, ref: 4, full: true, dyn: 'mapUp' }],                 // un grand fond qui suit la carte : jamais effacé
    ]);
    h._rebuildSoft('map');
    assert.deepStrictEqual(Array.from(h.fades.keys()), ['0:2']);
    assert.strictEqual(rebuilt, 0, 'pas encore : les textes s\'effacent d\'abord');
    h._rebuildSoft('map');
    assert.strictEqual(h.fades.size, 1, 'un seul en route');
    clearTimeout(h.softT); h.softT = null;
});
check('_rebuildSoft : un autre thème, rien à l\'écran, ou pas encore démarré : reconstruction directe', () => {
    const h = mk(); let rebuilt = 0;
    h._rebuild = () => { rebuilt++; };
    h.started = true; h.client = { ready: true }; h.activeName = 'm'; h._layoutName = () => 'sport'; h.live = new Map([['0:1', {}]]);
    h.ctx = { settings: { item: () => null } };
    h._rebuildSoft('map'); assert.strictEqual(rebuilt, 1);
    h._layoutName = () => 'm'; h.live = new Map(); h._rebuildSoft('map'); assert.strictEqual(rebuilt, 2);
});
check('la fenêtre de la carte s\'ouvre depuis son milieu, se referme dans son milieu ; sans animation : celle du thème tel qu\'il est construit', () => {
    const h = mk();
    h._mapStalled = () => false;
    const w = { x: 0, y: 0, hole: [580, 80, 720, 520], holeWhen: 'mapUp', holeInset: 0 };
    h.mapShown = true;
    assert.deepStrictEqual(h._hole(w), [580, 80, 720, 520]);
    h.geoAnim = { t0: Date.now(), dur: 400, open: true };
    assert.deepStrictEqual(h._hole(w), [0, 0, 0, 0], 'fermée au départ');
    h.geoAnim.t0 = Date.now() - 50;
    const a = h._hole(w);
    assert(a[2] > 0 && a[2] < 120 && Math.abs(a[0] + a[2] / 2 - 940) < 1 && Math.abs(a[1] + a[3] / 2 - 340) < 1, 'petite, au milieu : ' + a);
    h.geoAnim.t0 = Date.now() - 200;
    const b = h._hole(w);
    assert(b[2] > 200 && b[2] < 720, 'à mi-chemin : ' + b);
    h.geoAnim = { t0: Date.now() - 1000, dur: 400, open: true };
    assert.deepStrictEqual(h._hole(w), [580, 80, 720, 520]); assert.strictEqual(h.geoAnim, null);
    h.mapShown = false; h.geoAnim = { t0: Date.now(), dur: 250, open: false };
    assert(h._hole(w)[2] > 600, 'la fermeture part de la fenêtre entière');
    h.geoAnim = null; assert.deepStrictEqual(h._hole(w), [0, 0, 0, 0]);
});
check('le cadran de Circuit glisse du milieu à droite (et revient), à la taille de la photo puis 0,82', () => {
    const h = mk();
    const base = { center: [962, 365], alt: { when: 'mapUp', set: { center: [1630, 396], dscale: 0.82, mapMode: 1, box: [300, 284] } } };
    const w = Object.assign({}, base, base.alt.set, { altOf: base });
    assert.deepStrictEqual(h._circuitGeo(w, Date.now()), [1630, 396, 0.82, 1, 300, 284]);
    h.geoAnim = { t0: Date.now() - 200, dur: 400, open: true };
    const g = h._circuitGeo(w, Date.now());
    assert(g[0] > 1100 && g[0] < 1500 && g[2] < 1 && g[2] > 0.82 && g[3] > 0.2 && g[3] < 0.8, 'à mi-chemin : ' + g);
    assert.strictEqual(h._circuitGeo({ center: [1, 1] }, Date.now()), null, 'un fond sans deux faces');
});
check('le démarrage : le balayage de l\'aiguille part plus tôt, le thème apparaît en fondu', () => {
    const src = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    const m = src.match(/const SWEEP_WAIT_MS = (\d+);/);
    assert(m && Number(m[1]) <= 700, 'attente du balayage : ' + (m && m[1]));
    assert(/this\.showFade = name !== 'off' && \(!wasName \|\| wasName === 'off'\) && this\.started === true;/.test(src));
});
console.log(bad ? bad + ' échec(s)' : 'transitions : tout passe');
process.exit(bad ? 1 : 0);
