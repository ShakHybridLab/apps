'use strict';
// ShakHUD: the app ships what it needs, its M Style layout stays inside what the windshield shows, clear of BMW's own speed and of
// the turn-signal arrows, and the rev counter's colours follow the hybrid state. Run: node tools/test_shakhud.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const visible = require('../shared/visible');
const shaders = require('../shared/shaders');

const root = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e.stack || e.message)); process.exitCode = 1; } }

const app = read('apps/shakhud/app.json');
const L = read('apps/shakhud/hud/layouts/mstyle.json');

check('the app is complete: every shared file exists, ids are its own, the layout and its picture ship', () => {
    app.shared.forEach((f) => assert(fs.existsSync(path.join(root, 'shared', f)), 'shared/' + f + ' missing'));
    assert.strictEqual(app.id, 'shakhud'); assert.strictEqual(app.title, 'ShakHUD');
    const ids = ['idrive_hud_widgets', 'shaktheme', 'ridetube_cluster'].map((a) => read('apps/' + a + '/app.json'));
    ids.forEach((o) => { assert.notStrictEqual(o.id, app.id); assert.notStrictEqual(o.loggingId, app.loggingId, 'same loggingId as ' + o.id); });
    assert.strictEqual(app.config.target, 'hud');
    ['hybridRev', 'hudLayout', 'redline', 'units'].forEach((k) => assert(app.settings.some((s) => s.key === k), 'setting ' + k));
    ['hudLayout', 'inHybrid', 'inSport', 'inEco'].forEach((k) => {
        const s = app.settings.find((x) => x.key === k);
        assert.deepStrictEqual(s.options.map((o) => o[0]), ['off', 'mstyle'], k);
        assert(s.options.some((o) => o[0] === s.default), k + ' default');
    });
    assert(fs.existsSync(path.join(root, 'apps/shakhud/hud/previews/mstyle.json')), 'no picture for the page');
    assert(fs.existsSync(path.join(root, 'apps/shakhud/hud/fonts/small.json')) && fs.existsSync(path.join(root, 'apps/shakhud/icon.png')));
    assert(!app.config.dme, 'no engine-unit (DME) reads: nothing here shows boost');
});

check('the layout: inside the windshield window, clear of BMW\'s speed, no warning from the engine\'s own check', () => {
    assert.strictEqual(L.schemaVersion, 2);
    assert.deepStrictEqual(visible.check(L.widgets, 'hud'), []);
    const bar = L.widgets.find((w) => w.type === 'mstyle');
    assert(bar && bar.hybridTach === true && bar.chgOnBar === true && bar.pts.length === 3);
    // the bar's own points (the layer is a bounding box; the drawn bar is what matters for BMW's speed)
    bar.pts.forEach((p) => assert(p[0] - bar.bar / 2 >= visible.HUD_WINDOW.x && p[1] - bar.bar / 2 >= visible.HUD_WINDOW.y, 'bar point ' + p));
    const B = visible.HUD_BMW;
    L.widgets.forEach((w) => assert(!(w.x < B[2] && w.x + w.w > B[0] && w.y < B[3] && w.y + w.h > B[1]), w.id + ' over BMW\'s speed'));
});

check('the top middle stays clear for the turn-signal arrows (Cluster Info draws them at x 349..451, y 146..170): no number there but between them', () => {
    const arrows = [[349, 146, 379, 170], [421, 146, 451, 170]];
    L.widgets.filter((w) => w.type === 'text').forEach((w) => arrows.forEach((a) => {
        assert(!(w.x < a[2] && w.x + w.w > a[0] && w.y < a[3] && w.y + w.h > a[1]), w.id + ' over an arrow');
    }));
});

check('the labels sit under the bar\'s ticks: 0, 2, 4, 6 (rpmMax 7000), none past the window\'s right edge', () => {
    const bar = L.widgets.find((w) => w.type === 'mstyle');
    assert.strictEqual(bar.rpmMax, 7000);
    ['rev0', 'rev2', 'rev4', 'rev6'].forEach((id, i) => {
        const w = L.widgets.find((x) => x.id === id);
        assert(w && w.text === String(i * 2), id);
        assert(w.x + w.w <= visible.HUD_WINDOW.x + visible.HUD_WINDOW.w, id + ' past the right edge');
    });
    assert(L.widgets.some((w) => w.text === '{{tachUnit}}') && L.widgets.some((w) => w.text === '{{chargeNote}}'));
});

check('the shader: one bent bar, ticks and the hybrid colour, and the engine wires every uniform it declares', () => {
    const fs_ = shaders.mstyle;
    assert(fs_ && /uniform vec4 u_hy;/.test(fs_) && /for \(int i = 0; i < 9; i\+\+\)/.test(fs_));
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    const decl = (fs_.match(/^uniform \w+ (u_\w+);/gm) || []).map((l) => l.replace(/^uniform \w+ /, '').replace(';', ''));
    const a = hud.indexOf("w.type === 'mstyle') {"), b = hud.indexOf("w.type === 'lights') {", a);
    const upd = hud.indexOf("} else if (w.type === 'mstyle') {", hud.indexOf('_update'));
    const wired = hud.slice(a, b) + hud.slice(upd, upd + 1200);
    decl.forEach((u) => assert(wired.indexOf("'" + u + "'") >= 0, u + ' is never set'));
    assert(/mstyle: \['pts', 'bar'\]/.test(fs.readFileSync(path.join(root, 'shared', 'layouts.js'), 'utf8')));
});

check('the hybrid rev counter on the HUD follows the "hybridRev" setting, the cluster\'s "sportPower"', () => {
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(/settings\.item\('hybridRev'\)/.test(hud) && /settings\.item\('sportPower'\)/.test(hud));
});

console.log('shakhud: ' + n + ' checks passed');
