'use strict';
// Le thème Circuit (layout circuit.json, tools/gen_circuit.py, shaders.js circuit et cstack), d'après la photo du propriétaire (26 nov. 2026) :
// la mise en page, les zones de la voiture, la fenêtre de la carte, les vues BC dans le panneau, l'hybride, les polices, le budget, les réglages.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const visible = require('../shared/visible');
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };
const L = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', 'circuit.json'), 'utf8'));
const by = (i) => L.widgets.find((w) => w.id === i);
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const IMG = { text: true, icon: true };
// ce qui est à l'écran : la carte (mapUp), la vue, la voiture en Sport, l'alerte (avant la zone / dedans) ; le reste allumé (le pire cas)
function shown(map, view, sport, inside) {
    const one = (t) => {
        const not = t[0] === '!', k = not ? t.slice(1) : t;
        const v = k === 'mapUp' ? map : k === 'driveSport' ? sport : k.indexOf('viewSel=') === 0 ? (map ? false : k.slice(8) === view)
            : k === 'dangerInside' ? inside : k === 'dangerAhead' ? !inside : true;
        return not ? !v : v;
    };
    return L.widgets.filter((w) => !(w.toggle && !w.toggle.split('&').every(one)));
}

check('la mise en page : thème circuit, nom Circuit, le fond porte le cadran, la fenêtre de la carte et la place de la carte', () => {
    assert.strictEqual(L.theme, 'circuit'); assert.strictEqual(L.name, 'Circuit');
    const b = by('backdrop');
    assert.strictEqual(b.type, 'circuit'); assert.deepStrictEqual(b.center, [962, 365]);
    assert(b.holeWhen === 'mapUp' && b.mapPlace === true && b.hole.length === 4 && b.hybridTach === true && b.chgOnBar === true);
    const ids = L.widgets.map((w) => w.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'des identifiants en double');
});
check('le cadran comme la photo : 0 en bas, 3 à gauche, 6 en haut, 7 en haut à droite, sur un cercle de 330 px ; effet loupe sur chaque chiffre', () => {
    const c = by('backdrop').center;
    const at = (k) => { const w = by('n' + k), g = w.grow || [0, 0, 0, 0]; return [w.x + g[0] + (w.w - g[0] - g[2]) / 2, w.y + g[1] + (w.h - g[1] - g[3]) / 2]; };
    assert(Math.abs(at(0)[0] - c[0]) <= 1 && at(0)[1] > c[1] + 300, '0 en bas');
    assert(Math.abs(at(6)[0] - c[0]) <= 1 && at(6)[1] < c[1] - 300, '6 en haut');
    assert(Math.abs(at(3)[1] - c[1]) <= 2 && at(3)[0] < c[0] - 300, '3 à gauche');
    assert(at(7)[0] > c[0] + 100 && at(7)[1] < c[1] - 250, '7 en haut à droite');
    for (let k = 0; k < 8; k++) { const w = by('n' + k); assert(w.near && w.near[0] === 'rpm' && w.near[1] === k && w.nearFont === 'c_num_z' && w.zoomAlways && w.zoomColor === false, 'n' + k); }
});
check('à gauche la vitesse sur la case de la limitation ; le rapport dans le moyeu, sa lettre et les trois lignes à côté', () => {
    assert(by('speed').text === '{{speed}}' && by('speed').x + by('speed').w <= 480 && by('speed_unit').x >= 480);
    // (26 nov., 02:01 : « en dessous de la vitesse, c'était la boîte de vitesses ») : la case montre la boîte, la limitation en panneau rond à côté
    assert(by('box_gear').text === '{{gear}}' && by('box_gear').y > by('speed').y);
    assert(by('lim_num').text === '{{limit}}' && by('lim_ring').icon === 'ring' && by('lim_num').limitBy && by('lim_nxt_num').nextBy && by('lim_ring').x > by('box_gear').x + by('box_gear').w);
    assert(by('gear').text === '{{gearBig}}' && by('gear_prog').text === '{{gearProg}}' && by('gear').color === 'gearC' && by('gear_prog').color === 'prog');
    assert(by('mode1').text === '{{modeShort}}' && !by('mode2') && by('ev_share').text === '{{evShare}}', 'le mode et la part électrique sous le rapport');
});
check('les autonomies sous les jauges de côté (le propriétaire, 26 nov. 2026) : l\'essence à gauche, la batterie (km et %) à droite, rouges en réserve', () => {
    const f = by('fuel_range'), e = by('ev_range'), p = by('ev_pct');
    assert(f.text === '{{range}}' && f.lowWhen === 'fuel' && f.x + f.w <= 300 && f.y >= 640, 'essence');
    assert(e.text === '{{evRange}}' && e.lowWhen === 'battery' && e.x >= 1600 && e.y >= 640, 'batterie km');
    assert(by('mev_range').x < 560 && by('mev_range').y >= 640, 'avec la carte, sous sa pile à côté de l\'essence');
    assert(p.text === '{{hvSoc}}' && by('ev_pct_unit').text === '%', 'batterie %');
    // (26 nov., 02:21 : « le logo huile à la place d'écrire huile, à la place de TRIP ; TRIP ne sert à rien ») : l'huile et l'eau avec leurs icônes
    assert(!by('trip') && !by('range') && !by('mtrip') && by('oil').text === '{{oil}}' && by('oil_icon').icon && by('cool').text === '{{coolant}}' && by('moil') && by('mcool'));
});
check('le panneau de droite : l\'heure et la température dessus, le trajet et l\'autonomie dessous, rien sur ses deux lignes (y 187 et 530)', () => {
    ['time', 'outside', 'run_time'].forEach((i) => assert(by(i).y + by(i).h <= 182, i));       // (sans la carte)
    ['oil', 'cool', 'oil_icon', 'cool_icon'].forEach((i) => assert(by(i).y >= 535 && by(i).y + by(i).h <= 600, i));
});
check('avec la carte (26 nov., 02:26, d\'après une vidéo) : le cadran glisse à droite presque à sa taille, la batterie rejoint l\'essence, la carte entre eux ; rien dans la fenêtre', () => {
    const b = by('backdrop'), h = b.hole, H = { x: h[0], y: h[1], w: h[2], h: h[3] }, A = b.alt.set;
    assert(b.alt.when === 'mapUp' && A.mapMode === 1 && A.dscale >= 0.8 && A.center[0] > 1500, 'le cadran à droite, à 0,8 au moins de sa taille');
    assert(H.x + H.w < A.center[0] - 388 * A.dscale + 20 && H.y > 66 && H.y + H.h < 614 && H.x > 560, 'la carte entre les deux lignes, à gauche du cadran');
    shown(true, null, false, false).filter((w) => IMG[w.type] && !/danger/.test(w.toggle || '')).forEach((w) => assert(!hit(w, H), w.id + ' dans la fenêtre de la carte'));
    for (let k = 0; k < 8; k++) { assert(by('n' + k).toggle === '!mapUp' && by('mn' + k).toggle === 'mapUp' && by('mn' + k).nearFont === 'c_num_z' && by('mn' + k).x > H.x + H.w, 'mn' + k); }
    ['gear', 'speed', 'box_gear', 'lim_num', 'time', 'oil', 'mode1', 'ev_range', 'batt_icon'].forEach((i) => assert(by(i).toggle === '!mapUp' && by('m' + i) && by('m' + i).toggle === 'mapUp', i));
    ['mspeed', 'mtime', 'moil', 'mcool', 'mev_range', 'mev_pct', 'mbatt_icon'].forEach((i) => assert(by(i).x + by(i).w <= H.x, i + ' à gauche de la carte'));
    assert(!L.viewsWithMap, 'avec la carte, pas de vue');
});
check('les vues BC : dans le style du thème (piles de barres, légendes grises), dans le panneau, sans chevauchement', () => {
    const P = { x: 1150, y: 197, w: 496, h: 326 };
    const views = [['gauges', false], ['electric', false], ['tyres', false], ['drive', true], ['drive', false]];
    views.forEach(([v, sp]) => {
        const ws = shown(false, v, sp, false).filter((w) => /^xb_c/.test(w.id));
        assert(ws.length >= 5, v + ' : ' + ws.length + ' widgets');
        ws.forEach((w) => assert(w.x >= P.x && w.y >= P.y && w.x + w.w <= P.x + P.w && w.y + w.h <= P.y + P.h, w.id + ' hors du panneau'));
        assert(ws.some((w) => w.type === 'cstack'), v + ' : ses piles de barres');
        const t = ws.filter((w) => IMG[w.type]);
        t.forEach((a, i) => t.slice(i + 1).forEach((b) => assert(!hit(a, b), a.id + ' / ' + b.id)));
        // (rien d'une vue ne reprend une autre mise en page : pas de vcard, sring, nline, mpanel, evbars)
        assert(!ws.some((w) => /^(vcard|sring|nline|mpanel|evbars|mblades)$/.test(w.type)), v + ' : le BC d\'un autre thème');
    });
});
check('aucun texte n\'en recouvre un autre, dans chaque état (carte, vue, alerte)', () => {
    [false, true].forEach((map) => [null, 'gauges', 'electric', 'tyres', 'drive'].forEach((v) => [false, true].forEach((inside) => {
        const t = shown(map, v, v === 'drive', inside).filter((w) => IMG[w.type] && !(w.toggle && /danger/.test(w.toggle)));
        const sign = (a, b) => /^m?lim(_nxt)?_ring$/.test(a.id) && b.id === a.id.replace('ring', 'num');      // (un panneau porte son chiffre)
        t.forEach((a, i) => t.slice(i + 1).forEach((b) => assert(!hit(a, b) || sign(a, b) || sign(b, a), a.id + ' / ' + b.id + ' (carte ' + map + ', vue ' + v + ')')));
    })));
});
check('l\'alerte radar en haut à gauche, au-dessus de la vitesse, sans toucher le cadran', () => {
    const a = by('al_card'), m = by('mal_card');
    assert(a && a.x + a.w < 560 && a.y + a.h < by('speed').y && /!mapUp/.test(a.toggle), 'au-dessus de la vitesse');
    assert(m && /&mapUp/.test(m.toggle), 'avec la carte : sa propre place');
});
check('les zones de la voiture : rien sous le capot, sur le voyant de ceinture ni sur la lettre du rapport (hors le fond)', () => {
    const w = visible.check(L.widgets.filter((x) => x.id !== 'backdrop' && x.type !== 'cstack'), 'panel');
    const gw = require('../shared/gear_window').pick('auto', 'circuit');
    L.widgets.filter((x) => x.id !== 'backdrop').forEach((x) => assert(!hit(x, gw), x.id + ' touche le trou de la lettre du rapport'));
    assert.strictEqual(w.length, 0, w.join(' ; '));
});
check('les shaders : circuit et cstack bien sous le budget de la voiture, sans nom réservé', () => {
    const sh = require('../shared/shaders'), sb = require('./shader_budget');
    const l = sb.layer(sh.circuit, 1920, 720);
    assert(l.tokens <= 6000 && l.level === 'ok', l.text);
    assert(sb.layer(sh.cstack, 496, 326).level === 'ok');
    ['circuit', 'cstack'].forEach((k) => assert(!/\bu_(mvp|mv|m|v|p|normal)\b/.test(sh[k]), k + ' : nom réservé'));
});
check('les réglages : Circuit dans les quatre listes de thèmes', () => {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8'));
    ['hudLayout', 'inHybrid', 'inSport', 'inEco'].forEach((k) => {
        const s = app.settings.find((x) => x.key === k);
        assert(s.options.some((o) => o[0] === 'circuit' && o[1] === 'Circuit'), k);
    });
});
console.log(bad ? bad + ' échec(s)' : 'thème Circuit : tout passe');
process.exit(bad ? 1 : 0);
