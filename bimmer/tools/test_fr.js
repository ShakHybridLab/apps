'use strict';
// Le français : la table de fr.js, les accents des polices de la page, les réglages des appli en français.   node tools/test_fr.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fr = require('../shared/fr');
let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

check('les textes de la page se traduisent (exact, avec nombre, avec nom)', () => {
    assert.strictEqual(fr.tr('Settings'), 'Réglages');
    assert.strictEqual(fr.tr('Turn the cluster theme off so M Blade shows?'), 'Éteindre le thème du cluster pour afficher M Blade ?');
    assert.strictEqual(fr.tr('2 warnings on'), '2 alerte(s)');
    assert.strictEqual(fr.tr('1500 rpm before'), '1500 tr/min avant');
    assert.strictEqual(fr.tr('12.5'), '12.5');                       // un nombre ne change pas
    assert.strictEqual(fr.tr('M Blade'), 'M Blade');                 // un nom de BMW non plus
});

check('les polices de la page ont les lettres accentuées à toutes leurs tailles', () => {
    ['label', 'bold'].forEach((fam) => {
        const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'runtime', 'fonts', fam + '.json'), 'utf8'));
        d.sizes.forEach((s) => {
            'éèêëàâçîïôùûÉÈÀÊ'.split('').forEach((c) => assert(s.glyphs[String(c.codePointAt(0))], fam + ' ' + s.size + ' ' + c));
            assert.strictEqual(s.atlasW, 1024);
        });
    });
});

check('chaque texte traduit ne contient que des lettres que la police a', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'runtime', 'fonts', 'label.json'), 'utf8'));
    const g = d.sizes[0].glyphs;
    Object.keys(fr.EXACT).forEach((k) => {
        for (const c of fr.EXACT[k]) if (!g[String(c.codePointAt(0))]) throw new Error('"' + c + '" manque dans "' + fr.EXACT[k] + '"');
    });
});

check('ShakTheme, ShakHUD et RideTube cluster : français, km/h, °C, 24 h par défaut', () => {
    ['shaktheme', 'shakhud', 'ridetube_cluster'].forEach((id) => {
        const a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', id, 'app.json'), 'utf8'));
        assert.strictEqual(a.config.lang, 'fr', id);
        assert(!/ the | of | with /.test(a.description), id + ' : la description est en français');
        const u = a.settings.find((s) => s.key === 'units'), c = a.settings.find((s) => s.key === 'clock');
        if (u) assert.strictEqual(u.default, 'metric', id);
        if (c) assert.strictEqual(c.default, '24h', id);
        if (id !== 'ridetube_cluster') assert(a.shared.indexOf('fr.js') >= 0, id + ' : fr.js dans shared');
    });
});
console.log('fr: ' + n + ' checks passed');
