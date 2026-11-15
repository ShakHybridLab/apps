'use strict';
// « Laisser libre la bande du bas de BMW » : le thème s'arrête à y 646 (l'appli d'origine, "Bottom strip : the car's own", où BMW ne
// dessine plus ses cases noires), une bande noire couvre le bord des cadrans de BMW, les lignes que la bande de BMW redit disparaissent,
// et les fonds ne creusent plus de fenêtre autour de la case. node tools/test_strip_clear.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const bs = require('../shared/bottom_strip');
const shaders = require('../shared/shaders');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
const app = (n) => JSON.parse(fs.readFileSync(path.join(root, 'apps', n, 'app.json'), 'utf8'));
const fake = (on, target) => ({ target: target || 'panel', ctx: { settings: { item: (k) => (k === 'stripClear' ? {} : null) } }, setting: () => on });

check('la limite est y 646 et la compression 646 / 720 (662 laissait les cases noires)', () => {
    assert.strictEqual(bs.TOP, 646);
    assert.strictEqual(HudApp.prototype._stripSy.call(Object.assign(fake(true), { _stripOn: HudApp.prototype._stripOn })), 646 / 720);
    assert.strictEqual(HudApp.prototype._stripSy.call(Object.assign(fake(false), { _stripOn: HudApp.prototype._stripOn })), 1);
    assert.strictEqual(HudApp.prototype._stripOn.call(fake(true, 'hud')), false, 'le HUD n\'a pas de bande');
});

check('la compression raccourcit le RECTANGLE de chaque couche (y et h), sans échelle sy : le KOMBI garde ses cases noires tant qu\'un rectangle atteint sa bande (eroobeeroo coupe les siens à la ligne)', () => {
    const sets = [];
    const c = { set: (ref, o) => sets.push([ref, o]) };
    const mk = (st) => ({ placed: [{ c, ref: 1, x: 0, y: 0, w: 1920, h: 720 }, { c, ref: 2, x: 830, y: 630, w: 450, h: 69 }, { c, ref: 3, x: 0, y: 646, w: 1196, h: 16, fixed: true }],
        _offset: () => ({ x: 0, y: 0 }), _scale: () => 1, _stripSy: () => st, _placedBox: HudApp.prototype._placedBox });
    const on = mk(646 / 720);
    HudApp.prototype._place.call(on);
    const by = {}; sets.forEach(([r, o]) => { by[r] = o; });
    assert.deepStrictEqual([by[1].y, by[1].h], [0, 646], 'le fond plein panneau finit à 646');
    assert.deepStrictEqual([by[2].y, by[2].h], [565, 62], 'une couche du bas est raccourcie et remontée');
    assert.deepStrictEqual(by[3], { x: 0, y: 646 }, 'la bande noire ne bouge pas');
    sets.forEach(([r, o]) => { assert(o.sy === undefined && o.sx === undefined, 'la couche ' + r + ' est mise à l\'échelle (sy) au lieu d\'avoir un rectangle plus court'); });
    sets.forEach(([r, o]) => { if (r !== 3) assert(o.y + o.h <= 646, 'la couche ' + r + ' dépasse 646 : ' + (o.y + o.h)); });
    // l'option éteinte : les rectangles reviennent à leur taille
    sets.length = 0; on._stripSy = () => 1;
    HudApp.prototype._place.call(on);
    const back = {}; sets.forEach(([r, o]) => { back[r] = o; });
    assert.deepStrictEqual([back[1].y, back[1].h, back[2].y, back[2].h], [0, 720, 630, 69], 'les rectangles ne reviennent pas');
});

check('la bande noire : trois couches pleines de y 646 à 662, 658 devant le mode de conduite et le rapport (x 1196..1424)', () => {
    const b = bs.band();
    assert.strictEqual(b.length, 3);
    b.forEach((w) => { assert.strictEqual(w.type, 'fill'); assert.strictEqual(w.y, 646); assert(w.fixed); assert.deepStrictEqual(w.color, [0, 0, 0, 255]); });
    assert.deepStrictEqual(b.map((w) => [w.x, w.x + w.w, w.y + w.h]), [[0, 1196, 662], [1196, 1424, 658], [1424, 1920, 662]]);
});

check('les lignes que la bande de BMW redit sont retirées (heure, portées, extérieur, mode), pas les autres (huile, liquide, badge)', () => {
    ['time', 'ampm', 'range', 'range_icon', 'range_unit', 'outside', 'outside_unit', 'ev_range', 'ev_icon', 'ev_range_unit', 'drive_mode', 'o_time', 'o_range', 'o_drive_mode', 'fuel_icon', 'batt_icon']
        .forEach((id) => assert(bs.duplicates(id), id));
    ['oil', 'cool', 'coolant', 'oil_unit', 'ice_icon', 'ev_share', 'badge', 'boost', 'power', 'ev_pct', 'sport', 'backdrop', 'strip_band0', 'ready_text'].forEach((id) => assert(!bs.duplicates(id), id));
});

check('les fonds Sport et Navi : u_slotOff éteint la fenêtre autour de la case ; sans lui, un fondu noir sans marche ni liseré', () => {
    ['sdash', 'navi'].forEach((t) => {
        const src = String(shaders[t]);
        assert(/uniform float u_slotOff;/.test(src), t + ' : pas d\'u_slotOff');
        assert(/u_slotOff > 0\.5 \? 1\.0/.test(src), t + ' : slot() ne s\'éteint pas');
        // le fondu part de 0 (la case de BMW est noire) : pas de plancher d'ombre (l'ancien mix(0.45, 1.0, ...) dessinait un rectangle), pas de liseré clair
        assert(/float slotOf\(float d, float fall\) \{ return clamp\(d \+ 0\.5, 0\.0, 1\.0\) \* smoothstep\(0\.0, fall, d\); \}/.test(src), t + ' : slotOf() ne fond pas depuis le noir');
        assert(!/mix\(0\.45, 1\.0/.test(src), t + ' : il reste un plancher d\'ombre');
        assert(/vec3 slotRim\(vec2 p\) \{\s*return vec3\(0\.0\);\s*\}/.test(src), t + ' : il reste un liseré autour de la case');
    });
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert.strictEqual((hud.match(/'u_slotOff'/g) || []).length, 2, 'hud.js doit donner u_slotOff à sdash et à navi');
});

check('le réglage reconstruit le thème (la bande noire et les doublons ne se posent pas à la volée)', () => {
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    const line = hud.split('\n').find((l) => /^const PLACE_KEYS/.test(l));
    assert(line && line.indexOf('stripClear') < 0, line);
});

check('les deux applis livrent bottom_strip.js', () => {
    ['shaktheme', 'shakhud'].forEach((n) => assert(app(n).shared.indexOf('bottom_strip.js') >= 0, n));
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(failed + ' en échec'); process.exit(1); }
console.log('tout est bon');
