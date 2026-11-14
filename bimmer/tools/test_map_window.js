'use strict';
// map_window.js: the file that tells Waze on cluster (0.9.107+) where a theme's map window is, and the wiring around it (hud.js,
// the apps' file lists, the M Blade layout that asks for it). Run: node tools/test_map_window.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MapWindow, FILE } = require('../shared/map_window');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapwin-'));
const logs = [];
const log = { info: (m) => logs.push(m), warn: (m) => logs.push(m) };
let bad = 0;
function check(what, fn) { try { fn(); } catch (e) { bad++; console.log('FAIL ' + what + ': ' + e.message); } }

check('the line is "panel x y w h" in whole numbers, or null for anything that is not a window', () => {
    assert.strictEqual(MapWindow.line({ x: 117, y: 167, w: 556, h: 422 }), 'panel 117 167 556 422\n');
    assert.strictEqual(MapWindow.line({ x: 117.4, y: 166.6, w: 555.5, h: 422 }), 'panel 117 167 556 422\n');
    [null, undefined, {}, { x: 0, y: 0, w: 10, h: 400 }, { x: 0, y: 0, w: 400, h: 10 }, { x: NaN, y: 0, w: 400, h: 400 }, { x: '1', y: 0, w: 400, h: 400 }]
        .forEach((r) => assert.strictEqual(MapWindow.line(r), null, JSON.stringify(r)));
});
check('set writes the file (0644, one line), rewrites it on every call, release removes it', () => {
    const mw = new MapWindow(log, { dir });
    const f = path.join(dir, FILE);
    mw.set({ x: 117, y: 167, w: 556, h: 422 });
    assert.strictEqual(fs.readFileSync(f, 'utf8'), 'panel 117 167 556 422\n');
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o644);
    const t0 = fs.statSync(f).mtimeMs;
    const until = Date.now() + 30; while (Date.now() < until) { /* let the clock move */ }
    mw.set({ x: 117, y: 167, w: 556, h: 422 });
    assert(fs.statSync(f).mtimeMs >= t0, 'not rewritten');
    assert(mw.holding);
    mw.set({ x: 100, y: 150, w: 500, h: 400 });
    assert.strictEqual(fs.readFileSync(f, 'utf8'), 'panel 100 150 500 400\n');
    mw.set(null);
    assert(!fs.existsSync(f) && !mw.holding, 'still there after letting go');
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'a temp file is left behind');
});
check('a window that is not one lets go; letting go twice is harmless; an unwritable folder only warns', () => {
    const mw = new MapWindow(log, { dir });
    mw.set({ x: 1, y: 1, w: 400, h: 300 });
    mw.set({ x: 1, y: 1, w: 3, h: 3 });
    assert(!fs.existsSync(path.join(dir, FILE)));
    mw.release(); mw.release();
    const blocked = path.join(dir, 'file-not-folder');
    fs.writeFileSync(blocked, 'x');
    const bad2 = new MapWindow(log, { dir: path.join(blocked, 'sub') });
    bad2.set({ x: 1, y: 1, w: 400, h: 300 });          // must not throw
    assert(!bad2.holding);
});
check('hud.js holds the window only while the layout asks for it and its map shows, and gives it back when it stops', () => {
    const hud = fs.readFileSync(path.join(ROOT, 'shared/hud.js'), 'utf8');
    ['require(\'./map_window\')', 'this.mapWin.set(place ? this.windowRect : null)', 'w.mapPlace === true', 'this.mapWin.release()'].forEach((s) => assert(hud.includes(s), 'hud.js: ' + s));
    assert(/const place = shows && this\.mapPlace[\s\S]{0,300}this\.waze\.up === true/.test(hud), 'must wait for Waze to be up in the theme');
});
check('both apps that bundle hud.js list map_window.js (or the bundle would crash on the require)', () => {
    ['apps/shaktheme/app.json', 'apps/idrive_hud_widgets/app.json'].forEach((f) => {
        const a = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
        const list = JSON.stringify(a);
        assert(list.includes('"map_window.js"'), f + ' lacks map_window.js');
    });
});
check('M Blade asks for it, with a narrow window like the photo\'s and clear of the hood; Sport and M keep the central window untouched', () => {
    const L = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/shaktheme/hud/layouts/' + n + '.json'), 'utf8'));
    const b = L('mblade').widgets.find((w) => w.hole);
    assert(b.mapPlace === true && b.holeWhen === 'mapUp');
    const w = { x: b.hole[0] + b.holeInset, y: b.hole[1] + b.holeInset, w: b.hole[2] - 2 * b.holeInset, h: b.hole[3] - 2 * b.holeInset };
    assert(w.w >= 440 && w.w <= 620 && w.h >= 380 && w.h <= 460, 'window ' + w.w + 'x' + w.h + ' is not a narrow map window (about 480-560 x 422)');
    ['sport', 'm'].forEach((n) => {
        const p = path.join(ROOT, 'apps/shaktheme/hud/layouts/' + n + '.json');
        if (!fs.existsSync(p)) return;
        assert(!L(n).widgets.some((x) => x.mapPlace), n + ' must not move the map');
    });
});
fs.rmSync ? fs.rmSync(dir, { recursive: true, force: true }) : null;
console.log(bad ? bad + ' FAILED' : 'map_window: all checks pass');
process.exit(bad ? 1 : 0);
