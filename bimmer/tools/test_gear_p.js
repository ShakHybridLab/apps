'use strict';
// BMW écrit sa propre lettre de rapport (« P », « D »…) en bas à droite du cluster, par-dessus tout ce qui s'y trouve (shared/visible.js GEAR_P,
// estimée sur les photos du 15 novembre 2026). Aucun texte, icône ou emblème des quatre thèmes ne doit s'y trouver, et les barres dessinées
// par les shaders (Navi : barR) doivent finir avant.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const visible = require('../shared/visible');

const Z = visible.GEAR_P;
assert(Array.isArray(Z) && Z.length === 4, 'visible.GEAR_P manque');
const dir = path.join(__dirname, '..', 'apps', 'shaktheme', 'hud', 'layouts');
const hits = [];
let n = 0;
['sport', 'm', 'mblade', 'navi'].forEach((name) => {
    const L = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
    L.widgets.forEach((w) => {
        if (typeof w.x !== 'number' || w.w > 1500 || !/^(text|icon|emblem|badge|atext)$/.test(w.type)) return;
        n++;
        if (w.x < Z[2] && w.x + w.w > Z[0] && w.y < Z[3] && w.y + w.h > Z[1]) hits.push(name + ': ' + w.id);
    });
    const bg = L.widgets.find((w) => w.barR);
    if (bg) assert(bg.barR[0] + bg.barR[2] <= Z[0] - 10 || bg.barR[0] >= Z[2] + 10, name + ': la barre de batterie (' + bg.barR + ') passe sous la lettre de rapport de BMW');
});
assert.deepStrictEqual(hits, [], 'dans la zone de la lettre de rapport de BMW : ' + hits.join(', '));
// la vérification de mise en page le signale aussi
assert(visible.check([{ id: 'x', x: 1400, y: 680, w: 20, h: 20 }], 'panel').some((m) => /gear letter/.test(m)), 'visible.check ne signale pas la zone');
assert.strictEqual(visible.check([{ id: 'x', x: 1500, y: 680, w: 20, h: 20 }], 'panel').filter((m) => /gear letter/.test(m)).length, 0);
console.log('gear letter: ' + n + ' textes, icônes et emblèmes vérifiés, aucun dans la zone de la lettre de rapport de BMW');
