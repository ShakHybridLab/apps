'use strict';
// node tools/test_text_fit.js : chaque texte des thèmes (ShakTheme : Sport, M, M Blade, Navi ; ShakHUD : M Style) tient dans sa boîte avec la
// valeur la plus large qu'il peut prendre sur cette voiture. shared/hud_text.js coupe ce qui dépasse : sur le banc, la distance de l'alerte de
// zone de danger « 850 m » se lisait « 350 m » (boîte de 78 px pour 87), le turbo « -0.35 » perdait son signe (18 nov. 2026).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// la valeur la plus large de chaque jeton (km/h, °C, bar ; X3 30e : réservoir de 50 l, autonomie électrique sous 100 km, 8 rapports)
const WORST = {
    ambient: ['-18', '+38'], boost: ['1.85'], boostPos: ['1.85'], coolant: ['118', '-8'], oil: ['148', '-8'], dangerDist: ['990', '1.9'], dangerLimit: ['130'],
    evRange: ['88'], evShare: ['100'], gFwd: ['1.25'], gSide: ['1.25'], hvSoc: ['100'], limit: ['130'], nextLimit: ['130'], rangeTotal: ['888'],
    speed: ['248'], time: ['23:59'], tyreP: ['2.8'], tyreT: ['-8', '58'], gear: ['M8', 'D8', 'S8'], stage: ['M'],
};
let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

function fontsOf(app) {
    const cache = {};
    return (name) => cache[name] || (cache[name] = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'fonts', name + '.json'), 'utf8')));
}
function width(font, t, sp) {
    const cs = String(t).split('');
    return cs.reduce((w, c, i) => w + (font.glyphs[c] || font.glyphs[' '] || { advance: 0 }).advance + (i < cs.length - 1 ? (sp || 0) : 0), 0);
}
[['shaktheme', ['sport', 'm', 'mblade', 'navi']], ['shakhud', ['mstyle']]].forEach(([app, names]) => {
    const font = fontsOf(app);
    names.forEach((name) => check(app + ' ' + name + ' : la valeur la plus large de chaque texte tient dans sa boîte', () => {
        const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'layouts', name + '.json'), 'utf8'));
        const bad = [];
        L.widgets.filter((w) => w.type === 'text' && /^\{\{[^}]+\}\}$/.test(w.text || '')).forEach((w) => {
            const tok = w.text.slice(2, -2).split(':')[0];
            (WORST[tok] || []).forEach((v) => { const need = width(font(w.font), v, w.spacing); if (need > w.w) bad.push(w.id + ' "' + v + '" ' + need + ' px > ' + w.w); });
        });
        assert.deepStrictEqual(bad, []);
    }));
});
console.log(process.exitCode ? 'text fit: FAILED' : 'text fit: all ' + n + ' checks pass');
