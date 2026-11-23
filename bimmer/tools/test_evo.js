'use strict';
// Le thème Shak (layout evo.json, tools/gen_evo.py, shaders.js evo et shiftpills) : la mise en page, les zones de la voiture, les polices,
// le logo, le budget du shader, les réglages.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const visible = require('../shared/visible');
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };
const L = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', 'evo.json'), 'utf8'));
const by = (i) => L.widgets.find((w) => w.id === i);
const font = (n) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'fonts', n + '.json'), 'utf8'));

check('la mise en page : thème evo, nom Shak, les vues restent à côté de la carte, le fond porte ses deux bandes tendues, sa visière et ses barres', () => {
    assert.strictEqual(L.theme, 'evo'); assert.strictEqual(L.name, 'Shak'); assert.strictEqual(L.viewsWithMap, true);
    const b = by('backdrop');
    assert.strictEqual(b.type, 'evo');
    ['revPath', 'spdPath', 'visor'].forEach((k) => assert(Array.isArray(b[k]) && b[k].length === 7, k));
    // « en forme d'arc mais tendu » (le propriétaire, 23 nov. 2026) : une longue partie droite au milieu, des épaules arrondies
    assert(b.revPath[1] >= 250 && b.spdPath[1] >= 250, 'la partie droite des bandes');
    assert(b.revPath[0] < b.spdPath[0] - 300, 'le régime en haut, la vitesse en bas');
    const bars = by('bars');
    assert(bars && bars.type === 'evobars', 'les barres du bas ont leur couche');
    ['barF', 'barB', 'barO', 'barC'].forEach((k) => assert(Array.isArray(bars[k]) && bars[k].length === 3, k));
    assert(b.holeWhen === 'mapUp' && b.mapPlace === true && b.hole.length === 4, 'la carte dans l\'hexagone');
    const ids = L.widgets.map((w) => w.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'des identifiants en double');
});
check('le logo SHAK en haut au milieu, toujours là ; pas d\'écriture « competition evo » ni de lettrage M', () => {
    const g = by('logo');
    assert(g.type === 'emblem' && g.name === 'shak' && g.keepWithMap === true);
    assert(Math.abs(g.x + g.w / 2 - 960) <= 2 && g.y <= 4);
    assert(!L.widgets.some((w) => /competition|evo/i.test(String(w.text || ''))));
    assert(!L.widgets.some((w) => w.type === 'emblem' && w.setting));
});
check('le shiftlight en pastilles sous le logo, au-dessus de l\'arc du régime', () => {
    const s = by('shiftlight');
    assert(s.style === 'pills' && s.toggle === 'stockShiftLight');
    assert(s.y >= by('logo').y + by('logo').h && s.y + s.h <= by('backdrop').revPath[0] - 10);
});
check('sans carte : la vitesse et le rapport dans l\'hexagone, à gauche le grand panneau de limitation et l\'alerte radar ; avec la carte : la vitesse et le rapport à gauche', () => {
    assert(by('speed').toggle === '!mapUp' && by('gear').toggle === '!mapUp');
    assert(by('mspeed').toggle === 'mapUp' && by('mgear').toggle === 'mapUp' && by('mspeed').x < 520 && by('mgear').x < 520);
    const r = by('lim_ring');
    assert(r.limitBy && r.w >= 140 && r.x < 520 && r.toggle === '!mapUp', 'le grand panneau');
    assert(by('al_card') && by('al_card').x < 520, 'l\'alerte à gauche');
    assert(font('sign_xl') && font('sign_xl3'), 'la police du grand panneau');
});
check('en bas : essence à gauche, huile et refroidissement au milieu, batterie à droite', () => {
    const b = Object.assign({}, by('bars'), { barB: by('bars_r').barB });
    assert(b.barF[0] < 600 && b.barO[0] > 620 && b.barC[0] + b.barC[2] < visible.GEAR_P[0] && b.barB[0] > visible.GEAR_P[2]);
    assert(by('oil').text === '{{oil}}' && by('cool').text === '{{coolant}}' && by('ev_pct').text === '{{hvSoc}}' && by('range').text === '{{rangeTotal}}');
});
check('les zones de la voiture : rien sous le capot, sur le voyant de ceinture ni sur la lettre du rapport (hors le fond)', () => {
    const w = visible.check(L.widgets.filter((x) => x.id !== 'backdrop' && x.id !== 'bars'), 'panel');
    // no layer touches the hole over BMW's gear letter (gear_window.js would cut it and black out the strip under y 660)
    const gw = require('../shared/gear_window').pick('auto', 'evo');
    L.widgets.filter((x) => x.id !== 'backdrop').forEach((x) => assert(!(x.x < gw.x + gw.w && gw.x < x.x + x.w && x.y < gw.y + gw.h && gw.y < x.y + x.h), x.id + ' touche le trou de la lettre du rapport'));      // (the two full-width effect layers are see-through there)
    assert.strictEqual(w.length, 0, w.join(' ; '));
});
check('les polices : chaque texte fixe a ses glyphes, chaque police existe', () => {
    L.widgets.filter((w) => w.type === 'text').forEach((w) => {
        const f = font(w.font);
        String(w.text).replace(/\{\{[^}]*\}\}/g, '').split('').forEach((c) => assert(c === ' ' || f.glyphs[c], w.id + ' : « ' + c + ' » manque dans ' + w.font));
    });
});
check('les shaders : evo et shiftpills sous le budget de la voiture', () => {
    const sh = require('../shared/shaders'), sb = require('./shader_budget');
    const l = sb.layer(sh.evo, 1920, 720);
    assert(l.tokens <= 8748 && l.level === 'ok', l.text);
    assert(sb.layer(sh.shiftpills, 540, 28).level === 'ok');
    assert(sb.layer(sh.evobars, 1920, 56).level === 'ok');
});
check('les réglages : Shak est caché des listes de thèmes tant qu\'il n\'est pas fini (le propriétaire, 23 nov. 2026), son image est prête', () => {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8'));
    ['hudLayout', 'inHybrid', 'inSport', 'inEco'].forEach((k) => {
        const s = app.settings.find((x) => x.key === k);
        assert(!s.options.some((o) => o[0] === 'evo'), k);
    });
    assert(fs.existsSync(path.join(root, 'apps', 'shaktheme', 'hud', 'previews', 'evo.json')), 'l\'image du thème');
});
console.log(bad ? bad + ' échec(s)' : 'thème Shak : tout passe');
process.exit(bad ? 1 : 0);
