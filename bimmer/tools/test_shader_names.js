'use strict';
// node tools/test_shader_names.js : aucun dessin (shared/shaders.js) ni aucun envoi d'uniforme (shared/hud.js) n'utilise un nom que cluster-render
// garde pour ses matrices (PROTOCOL.md : u_mvp, u_mv, u_m, u_v, u_p, u_normal). Sur la voiture, RAMSES refuse alors tout l'effet
// (« effect did not compile », photo du 21 nov. 2026 : les vues BC sans leurs dessins) alors que le banc l'affiche.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const RESERVED = ['u_mvp', 'u_mv', 'u_m', 'u_v', 'u_p', 'u_normal'];
const shaders = require('../shared/shaders');
const bad = [];
Object.keys(shaders).forEach((k) => {
    if (typeof shaders[k] !== 'string') return;
    RESERVED.forEach((n) => { if (new RegExp('\\b' + n + '\\b').test(shaders[k])) bad.push(k + ' : ' + n); });
});
['hud.js', 'shaders.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'shared', f), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    RESERVED.forEach((n) => { if (new RegExp("['\"]" + n + "['\"]").test(src)) bad.push(f + " envoie '" + n + "'"); });
});
assert(!bad.length, 'noms gardés par cluster-render : ' + bad.join(' ; '));
console.log('shader names: ' + Object.keys(shaders).filter((k) => typeof shaders[k] === 'string').length + ' dessins, aucun nom réservé');

// Demi-précision (le GPU de la voiture, 22 nov. 2026) : un carré au-delà de 65504 déborde. Le compte-tours de ShakHUD calculait dot(ab, ab) sur
// sa partie droite (environ 385 px, 148225) : infini, la partie droite disparaissait et la barre s'arrêtait à 2. Ses calculs de longueur se font
// maintenant en unités de 64 px, et il prend la haute précision là où le GPU l'a.
{
    const L = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shakhud', 'hud', 'layouts', 'mstyle.json'), 'utf8'));
    const w = L.widgets.find((x) => x.type === 'mstyle');
    const F16 = 65504, sq = (v, k) => (v[0] / k) * (v[0] / k) + (v[1] / k) * (v[1] / k);
    const ab = [w.pts[2][0] - w.pts[1][0], w.pts[2][1] - w.pts[1][1]];
    assert(sq(ab, 1) > F16, 'la partie droite devrait dépasser la demi-précision sans mise à l\'échelle (test à revoir)');
    assert(sq(ab, 64) < F16 && sq([w.w, w.h], 64) < F16, 'même en unités de 64 px, ça déborde');
    const m = shaders.mstyle.replace(/\/\/[^\n]*/g, '');
    assert(/vec2 ab = \(b - a\) \/ 64\.0, ap = \(p - a\) \/ 64\.0;/.test(m), 'seg() du compte-tours sans mise à l\'échelle');
    assert(!/length\((b - a|c - b)\)|normalize\((b - a|c - b)\)/.test(m), 'une longueur en pixels bruts reste dans mstyle');
    assert(/GL_FRAGMENT_PRECISION_HIGH/.test(shaders.mstyle), 'mstyle sans haute précision');
    console.log('shader names: le compte-tours de ShakHUD ne déborde pas en demi-précision');
}
