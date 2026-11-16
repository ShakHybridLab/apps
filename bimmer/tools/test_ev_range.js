'use strict';
// node tools/test_ev_range.js : l'autonomie électrique affichée (shared/hud.js _evRangeNow). La voiture du propriétaire a montré « 93 km » en rouge
// à 9 % de charge (la réserve de la batterie) : un chiffre que la charge ne peut pas donner est écarté et la part de la charge s'affiche à sa place.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// hud.js ne se charge pas ici (ses dépendances « kit/ » ne sont copiées qu'à la construction) : la méthode est compilée depuis le source
const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
const i = src.indexOf('    _evRangeNow() {'), j = src.indexOf('\n    }\n', i);
assert(i > 0 && j > i, '_evRangeNow est introuvable dans hud.js');
const isNum = (x) => typeof x === 'number' && isFinite(x);
const HudApp = new Function('isNum', 'CAR_ERANGE_MS', 'return class { ' + src.slice(i, j + 7) + ' }')(isNum, 10 * 60 * 1000);

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

const warns = [];
function make(opts) {
    const o = Object.assign({ soc: 50, car: null, age: 0, full: 40 }, opts);
    const h = Object.create(HudApp.prototype);
    h.log = { info() {}, warn: (m) => warns.push(m) };
    h._evRangeFull = () => o.full;
    h._raw = (k) => (k === 'hvSoc' ? o.soc : null);
    h.carErange = o.car; h.carErangeAt = Date.now() - o.age;
    return h;
}

check('le chiffre de la voiture est gardé quand la charge le permet', () => {
    assert.strictEqual(make({ soc: 50, car: 22 })._evRangeNow(), 22);
    assert.strictEqual(make({ soc: 100, car: 55 })._evRangeNow(), 55, 'au plein, la voiture peut dépasser la valeur par défaut');
    assert.strictEqual(make({ soc: 9, car: 0 })._evRangeNow(), 0, 'zéro est un vrai chiffre');
    assert.strictEqual(make({ soc: 9, car: 4 })._evRangeNow(), 4);
});

check('93 km à 9 % de charge : écarté, la part de la charge s\'affiche (9 % de 40 km)', () => {
    warns.length = 0;
    const h = make({ soc: 9, car: 93 });
    assert.strictEqual(h._evRangeNow(), 9 * 40 / 100);
    assert.strictEqual(warns.length, 1, 'une ligne au journal');
    h._evRangeNow();
    assert.strictEqual(warns.length, 1, 'une seule fois pour la même valeur');
    assert(/ignored: 93 km at a charge of 9 %/.test(warns[0]), warns[0]);
});

check('plus que deux pleines batteries : écarté même sans la charge', () => {
    const h = make({ soc: null, car: 93 });
    h._raw = () => null;
    assert.strictEqual(h._evRangeNow(), null);
    const g = make({ soc: 50, car: 81 });
    assert.strictEqual(g._evRangeNow(), 50 * 40 / 100);
});

check('sans le chiffre de la voiture (ou trop ancien) : la charge fois l\'autonomie d\'une batterie pleine ; sans rien, null', () => {
    assert.strictEqual(make({ soc: 50, car: null })._evRangeNow(), 20);
    assert.strictEqual(make({ soc: 50, car: 30, age: 11 * 60 * 1000 })._evRangeNow(), 20);
    const h = make({ soc: null, car: null }); h._raw = () => null;
    assert.strictEqual(h._evRangeNow(), null);
});

check('la limite suit le réglage « autonomie d\'une batterie pleine »', () => {
    assert.strictEqual(make({ soc: 9, car: 93, full: 80 })._evRangeNow(), 9 * 80 / 100, '93 > 2 x 9 % de 80 + 10');
    assert.strictEqual(make({ soc: 100, car: 93, full: 80 })._evRangeNow(), 93);
});

console.log(process.exitCode ? 'ev range: FAILED' : 'ev range: all ' + n + ' checks pass');
