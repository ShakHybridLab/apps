'use strict';
// node tools/test_ink_overlap.js : dans chaque thème de ShakTheme et dans chaque état réel (carte ou non, chaque vue, Sport ou non, l'alerte de zone
// avant / dedans, avec ou sans limite, le flux d'énergie partagé ou non), aucun texte ni aucune icône n'en touche un autre. On compare l'encre : la
// largeur réelle de la valeur la plus large (polices du thème, alignement), pas la boîte, souvent plus large que ce qu'elle porte.
// Le propriétaire, 26 nov. 2026 : « je veux que rien ne se chevauche, tout propre comme d'origine ».
const assert = require('assert'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const fonts = {};
const font = (n) => fonts[n] || (fonts[n] = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'shaktheme', 'hud', 'fonts', n + '.json'), 'utf8')));
// la valeur la plus large de chaque jeton (comme tools/test_text_fit.js) et ce que les autres écrivent au plus large
const WORST = {
    ambient: '+38', boost: '1.85', boostPos: '1.85', boostPeak: '1.85', coolant: '118', oil: '148', dangerDist: '990', dangerLimit: '130', evRange: '88', evShare: '100',
    gFwd: '1.25 BRK', gSide: '1.25 R', gBest: '1.25', hvSoc: '100', limit: '130', nextLimit: '130', rangeTotal: '888', range: '888', speed: '248', time: '23:59',
    tyreP: '2.8', tyreT: '58', gear: 'M8', gearBig: '8', gearProg: 'M', stage: 'M', gearnum: '8', gearInD: '8', launch: '10.0', launchUnit: 's', avgSpeed: '188',
    evPower: '88', evRecup: '88', powerKw: '-88', fuelPct: '100', modeShort: 'SPORT IND.', ampmLc: 'pm', ampm: 'PM', evShareUnit: '%', chargeNote: 'CHARGE',
    'u:temp': '°C', 'u:pressure': 'bar', 'u:speedLc': 'km/h', 'u:speed': 'KM/H', 'u:distLc': 'km', 'u:dist': 'KM', 'u:boost': 'BAR', dangerUnit: 'km',
    badge: 'BMW X3 xDrive30e', tachUnit: 'tr/min x 1000', launchReady: 'Launch Control Ready', torque: '488', 'u:torque': 'Nm', spd: '320', ms: '330', tc: '150', rpm: '6500',
};
function inkX(w) {
    // la largeur de l'encre du texte au plus large ; null quand un de ses jetons est inconnu ici (la boîte entière compte alors)
    if (w.type !== 'text') return null;
    let unknown = false;
    const t = String(w.text || '').replace(/\{\{([^}]+)\}\}/g, (m, k) => { const v = WORST[k] !== undefined ? WORST[k] : WORST[k.split(':')[0]]; if (v === undefined) unknown = true; return v || ''; });
    if (unknown || /^\{\{(setup|pc|mode|modeName|verdict|lastGears|coldNote|warm|runLabel|run|runBest|runState)/.test(w.text)) return null;
    const f = font(w.nearFont || w.font), g = w.grow || [0, 0, 0, 0];
    const cs = t.split(''), wd = cs.reduce((a, ch, i) => a + (f.glyphs[ch] || f.glyphs[' '] || { advance: 0 }).advance + (i < cs.length - 1 ? (w.spacing || 0) : 0), 0);
    const x0 = w.x + g[0], ww = w.w - g[0] - g[2];
    const fz = w.nearFont ? font(w.nearFont) : f;          // (the zoomed number: as wide as it grows)
    const left = w.align === 'right' ? x0 + ww - wd : w.align === 'center' ? x0 + (ww - wd) / 2 : x0;
    return { x: Math.round(left), w: Math.max(1, Math.round(wd)), y: w.y + 3, h: Math.max(1, w.h - 6), fz };
}
const box = (w) => inkX(w) || { x: w.x + 2, y: w.y + 2, w: Math.max(1, w.w - 4), h: Math.max(1, w.h - 4) };
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// un panneau porte son chiffre ; la carte de l'alerte porte ses mots (ils sont faits pour) ; le repère « prêt au départ » prend la place d'un texte qui
// s'efface pour lui ("readyHides")
const pairOk = (a, b) => {
    const r = (x, y) => /ring$/.test(x.id) && y.id === x.id.replace(/ring$/, 'num');
    if (r(a, b) || r(b, a)) return true;
    if (/^m?al_/.test(a.id) && /^m?al_/.test(b.id)) return true;
    if ((a.readyBy && b.readyHides) || (b.readyBy && a.readyHides)) return true;
    return false;
};
function states(L) {
    const views = Array.from(new Set(L.widgets.map((w) => (w.toggle || '').match(/viewSel=(\w+)/)).filter(Boolean).map((m) => m[1])));
    const out = [];
    [false, true].forEach((map) => [null].concat(views).forEach((view) => [false, true].forEach((sport) => ['off', 'aheadL', 'aheadN', 'in'].forEach((dz) => [false, true].forEach((power) => {
        out.push({ map, view, sport, dz, power });
    })))));
    return out;
}
function on(w, s, L) {
    if (!w.toggle) return true;
    return w.toggle.split('&').every((part) => {
        const not = part[0] === '!', k = not ? part.slice(1) : part;
        let v;
        if (k === 'mapUp') v = s.map;
        else if (k.indexOf('viewSel=') === 0) v = (s.map && !L.viewsWithMap) ? k.slice(8) === 'none' : (s.view || 'none') === k.slice(8);
        else if (k === 'driveSport') v = s.sport;
        else if (k === 'danger') v = s.dz !== 'off';
        else if (k === 'dangerLimit') v = s.dz === 'aheadL' || s.dz === 'in';
        else if (k === 'dangerNoLimit') v = s.dz === 'aheadN';
        else if (k === 'dangerInside') v = s.dz === 'in';
        else if (k === 'dangerAhead') v = s.dz === 'aheadL' || s.dz === 'aheadN';
        else if (k === 'power') v = s.power;
        else if (k === 'powerOpen') v = s.power && s.map;
        else if (k === 'powerShut') v = s.power && !s.map;
        else if (k === 'boostShown') v = !s.power;
        else v = true;                  // (a setting: the worst case, on)
        return not ? !v : v;
    });
}
let bad = 0;
['sport', 'm', 'mblade', 'navi', 'evo', 'circuit'].forEach((name) => {
    const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'shaktheme', 'hud', 'layouts', name + '.json'), 'utf8'));
    const seen = new Set(), found = [];
    states(L).forEach((s) => {
        const ws = L.widgets.filter((w) => (w.type === 'text' || w.type === 'icon') && on(w, s, L));
        for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
            const a = ws[i], b = ws[j];
            if (pairOk(a, b) || !hit(box(a), box(b))) continue;
            const k = a.id + ' / ' + b.id;
            if (seen.has(k)) continue;
            seen.add(k); found.push(k + ' (carte ' + s.map + ', vue ' + (s.view || 'aucune') + ', sport ' + s.sport + ', alerte ' + s.dz + ', puissance ' + s.power + ')');
        }
    });
    if (found.length) { bad++; console.log('FAIL ' + name + ' : ' + found.length + ' chevauchement(s)\n  ' + found.join('\n  ')); }
});
console.log(bad ? bad + ' thème(s) avec des chevauchements' : 'chevauchements : aucun, dans les six thèmes et tous leurs états');
process.exit(bad ? 1 : 0);
