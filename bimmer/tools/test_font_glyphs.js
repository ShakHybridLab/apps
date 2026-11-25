'use strict';
// node tools/test_font_glyphs.js : chaque caractère écrit en dur dans un texte d'un thème (hors {{jetons}}) existe dans la police de ce texte.
// Un caractère absent est dessiné comme une espace : avant 0.23.0, « bar · °C » des vues pneus de M Blade et Navi montrait « bar   °C »
// (la police m_tiny n'a pas « · »). Les valeurs aussi : la distance de l'alerte de ShakHUD, « 1.2 km », s'écrivait « 1 2 » (0.6.59).
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let bad = 0, n = 0;
// the characters each value (shared/hud.js _token) can write, beside its digits; a value not listed is not checked (words, units)
const DIG = '0123456789', NUM = DIG + '-', DEC = NUM + '.';
const VALUE = { ambient: NUM, avgSpeed: NUM, coolant: NUM, oil: NUM, evPower: NUM, evRecup: NUM, evRange: NUM, evShare: NUM, fuelPct: NUM,
    hvSoc: NUM, rangeTotal: NUM, powerKw: NUM, speed: NUM, dangerLimit: DIG, limit: DIG, nextLimit: DIG, spd: DIG, ms: DIG, tc: NUM,   // (a limit or a scale number is never "--": blank or a fixed number)
    boost: DEC, boostPeak: DEC, boostPos: DEC, launch: DEC, tyreP: DEC, tyreMin: DEC, dangerDist: DEC, time: NUM + ':' };
['shaktheme', 'shakhud'].forEach((app) => {
    const dir = path.join(root, 'apps', app, 'hud');
    fs.readdirSync(path.join(dir, 'layouts')).filter((f) => f.endsWith('.json')).forEach((f) => {
        const L = JSON.parse(fs.readFileSync(path.join(dir, 'layouts', f), 'utf8'));
        L.widgets.filter((w) => w.type === 'text' && typeof w.text === 'string' && w.font).forEach((w) => {
            n++;
            const lit = w.text.replace(/\{\{[^}]*\}\}/g, '');
            let font;
            try { font = JSON.parse(fs.readFileSync(path.join(dir, 'fonts', w.font + '.json'), 'utf8')); } catch (e) { bad++; console.log('FAIL ' + app + '/' + f + ' ' + w.id + ' : police ' + w.font + ' introuvable'); return; }
            // what a value can write: its characters (a value missing is "--")
            const vals = (w.text.match(/\{\{([^}]+)\}\}/g) || []).map((m) => VALUE[m.slice(2, -2).split(':')[0]] || '').join('');
            const miss = Array.from(new Set((lit + vals).split(''))).filter((c) => !font.glyphs[c]);
            if (miss.length) { bad++; console.log('FAIL ' + app + '/' + f + ' ' + w.id + ' : ' + JSON.stringify(miss) + ' absent(s) de ' + w.font); }
        });
    });
});
assert(n > 100, 'textes vus : ' + n);
console.log(bad ? bad + ' échec(s)' : 'caractères des textes : tout passe (' + n + ' textes)');
process.exit(bad ? 1 : 0);
