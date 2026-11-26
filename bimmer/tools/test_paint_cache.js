'use strict';
// node tools/test_paint_cache.js : les images gardées des icônes et des textes (0.24.3 : un thème refait repeignait chaque icône et chaque texte,
// l'aiguille s'arrêtait un instant à chaque changement de vue ou de carte). Une image gardée doit être, octet pour octet, celle d'une peinture
// neuve, pour chaque icône et pour les textes de chaque thème ; la mémoire gardée reste bornée.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcache-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
fs.symlinkSync(path.join(root, 'apps', 'shaktheme', 'hud'), path.join(tmp, 'shared', 'hud'));
let bad = 0;
const realWarn = console.warn; console.warn = () => {}; console.error = () => {};      // (des textes d'essai sans glyphe dans certaines polices : sans importance ici)
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const icons = require(path.join(tmp, 'shared', 'icons.js'));
check('icônes : gardée = neuve, pour chaque icône, trois tailles, deux couleurs ; la deuxième demande rend la même image', () => {
    let n = 0;
    for (const name of Object.keys(icons.ICONS)) for (const [w, h] of [[24, 30], [74, 74], [40, 28]]) for (const col of [[255, 255, 255, 255], [255, 40, 60, 200]]) {
        const a = icons.paintIcon(name, w, h, col), b = icons.paintIcon(name, w, h, col);
        assert.strictEqual(a, b, name + ' : la même image rendue');
        assert(a.equals(icons.paintIconNew(name, w, h, col)), name + ' ' + w + 'x' + h);
        n++;
    }
    assert(n > 60, n + ' images');
    assert(icons.paintIcon('pas_une_icone', 10, 10, [1, 2, 3, 4]).equals(Buffer.alloc(400)), 'une icône inconnue : vide');
});
check('icônes : une autre couleur ou une autre taille n\'est jamais confondue', () => {
    const name = Object.keys(icons.ICONS)[0];
    const a = icons.paintIcon(name, 30, 30, [255, 0, 0, 255]), b = icons.paintIcon(name, 30, 30, [0, 255, 0, 255]), c = icons.paintIcon(name, 31, 30, [255, 0, 0, 255]);
    assert(!a.equals(b)); assert.notStrictEqual(a.length, c.length);
});
const text = require(path.join(tmp, 'shared', 'hud_text.js'));
check('textes : gardé = neuf pour les textes de chaque thème (police, alignement, couleurs, dégradé, halo, décalage)', () => {
    let n = 0;
    for (const t of ['sport', 'm', 'mblade', 'navi', 'evo', 'circuit']) {
        const L = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', t + '.json'), 'utf8'));
        L.widgets.filter((w) => w.type === 'text' && w.font).slice(0, 60).forEach((w, i) => {
            const s = ['88', '188', '7', 'D3', '12:34', '-20', '2.4'][i % 7];
            for (const o of [{ font: w.font, color: [255, 255, 255, 255], align: w.align, spacing: w.spacing },
                { font: w.font, color: [255, 80, 0, 255], color2: [0, 80, 255, 255], align: w.align, x: 3, offsetY: 2, glow: i % 2 ? 0.6 : 0 }]) {
                const a = text.drawText(w.w, w.h, s, o), b = text.drawText(w.w, w.h, s, Object.assign({}, o));
                assert.strictEqual(a, b, 'la même image rendue');
                assert(a.equals(text.drawTextNew(w.w, w.h, s, o)), t + ' ' + w.id);
                n++;
            }
        });
    }
    assert(n > 300, n + ' textes');
});
check('textes : chaque réglage qui change l\'image change la clé', () => {
    const base = { font: 'c_val', color: [255, 255, 255, 255], align: 'right' };
    const ref = text.drawText(120, 40, '123', base);
    for (const o of [{ align: 'left' }, { color: [255, 0, 0, 255] }, { x: 5 }, { offsetY: 3 }, { spacing: 2 }, { color2: [0, 0, 255, 255] }, { glow: 0.5 }, { font: 'c_time' }]) {
        const v = text.drawText(120, 40, '123', Object.assign({}, base, o));
        assert(v.equals(text.drawTextNew(120, 40, '123', Object.assign({}, base, o))), JSON.stringify(o));
        assert(!v.equals(ref), 'différent de la base : ' + JSON.stringify(o));
    }
    assert(!text.drawText(120, 40, '124', base).equals(ref)); assert.notStrictEqual(text.drawText(121, 40, '123', base).length, ref.length);
});
check('la mémoire gardée reste bornée (des milliers de textes différents)', () => {
    for (let i = 0; i < 6000; i++) text.drawText(240, 72, String(i), { font: 'c_speed', color: [255, 255, 255, 255], align: 'right' });
    for (let i = 0; i < 3000; i++) icons.paintIcon(Object.keys(icons.ICONS)[i % 5], 40 + (i % 200), 40, [i % 256, 0, 0, 255]);
    const t = text.cacheStats(), ic = icons.cacheStats();
    assert(t.bytes <= 4 * 1048576 && t.entries <= 700, 'textes : ' + JSON.stringify(t));
    assert(ic.bytes <= 3 * 1048576 && ic.entries <= 400, 'icônes : ' + JSON.stringify(ic));
    assert(t.entries > 20 && ic.entries > 20, 'et il en reste de gardés');
});
console.log(bad ? bad + ' échec(s)' : 'images gardées : tout passe');
process.exit(bad ? 1 : 0);
