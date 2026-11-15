'use strict';
// node tools/test_pixel_memory.js : la mémoire de pixels et les couches des quatre thèmes de ShakTheme (Sport, M, M Blade, Navi), avec la
// carte Waze fermée et ouverte, rangées par le moteur lui-même (shared/hud.js, _plan).
// Pourquoi : cluster-render n'a que 16 Mio de pixels pour toutes les applications ensemble (chaque image compte deux fois) ; sur la voiture
// il en reste ~10 Mio pour nous. Les thèmes d'avant en voulaient 8 à 11 Mio : des widgets étaient refusés (jauges, textes manquants).
// Chaque texte/icône porte maintenant une feuille ("sheet", tools/pack_sheets.py) et une connexion ("conn") ; ce test garde la mémoire
// sous 6,5 Mio (de la marge pour les atlas de glyphes et les autres applications), au plus 8 couches par connexion (CompositorLimits).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hudmem-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));

const MAX_MIB = 6.5, PER_CONN = 8, MAX_LAYERS = 20;
const IMAGE = { text: true, scale: true, stripe: true, badge: true, gridlabels: true, icon: true, emblem: true, swatchimg: true };
let bad = 0, n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { bad++; console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

// ce qui est à l'écran dans un état de la carte : "mapUp" suit la carte, "powerShut" / "powerOpen" aussi (la puissance cède la place à la carte) ;
// les autres réglages sont tous « allumés » (le pire cas : ce qui s'ouvre et se ferme à la demande compte)
function shownIn(widgets, map) {
    const on = (t) => {
        const not = t.charAt(0) === '!', k = not ? t.slice(1) : t;
        const v = k === 'mapUp' || k === 'powerOpen' ? map : k === 'powerShut' ? !map : true;
        return not ? !v : v;
    };
    return widgets.filter((w) => !(w.toggle && !on(w.toggle)));
}

['sport', 'm', 'mblade', 'navi'].forEach((name) => {
    const L = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', name + '.json'), 'utf8'));
    const h = Object.create(HudApp.prototype);
    check(name + ': chaque texte et icône a sa feuille ("sheet") : sans cela le moteur rangerait par taille et la mémoire redeviendrait celle d\'avant', () => {
        const loose = L.widgets.filter((w) => IMAGE[w.type] && w.own !== true && !(typeof w.sheet === 'string' && w.sheet));
        assert.strictEqual(loose.length, 0, loose.slice(0, 5).map((w) => w.id).join(', ') + ' sans feuille');
    });
    [false, true].forEach((map) => {
        check(name + ' (' + (map ? 'avec' : 'sans') + ' la carte) : mémoire de pixels, couches par connexion', () => {
            const plan = h._plan(shownIn(L.widgets, map), Infinity, Infinity);
            let px = 0; const per = [];
            plan.forEach((e) => {
                per[e.conn] = (per[e.conn] || 0) + 1;
                if (e.kind === 'sheet') px += e.w * e.h * 8; else if (IMAGE[e.w.type]) px += e.w.w * e.w.h * 8;
            });
            const mib = px / 1048576;
            assert(mib <= MAX_MIB, 'la mémoire de pixels est de ' + mib.toFixed(2) + ' Mio (au plus ' + MAX_MIB + ')');
            per.forEach((k, c) => assert((k || 0) <= PER_CONN, 'la connexion ' + (c + 1) + ' a ' + k + ' couches (au plus ' + PER_CONN + ')'));
            assert(plan.length <= MAX_LAYERS, plan.length + ' couches en tout (au plus ' + MAX_LAYERS + ')');
            // une feuille ne mélange pas deux textes qui se recouvrent (la feuille écrase) : c'est le moteur qui le dit, pas la mise en page
            plan.filter((e) => e.kind === 'sheet').forEach((s) => s.members.forEach((a, i) => s.members.slice(i + 1).forEach((b) => {
                assert(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), 'la feuille ' + s.key + ' mêle ' + a.id + ' et ' + b.id + ', qui se recouvrent');
            })));
        });
    });
});

console.log(bad ? bad + ' FAILED' : 'pixel memory: ' + n + ' checks pass');
fs.rmSync && fs.rmSync(tmp, { recursive: true, force: true });
