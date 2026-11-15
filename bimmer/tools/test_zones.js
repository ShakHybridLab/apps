'use strict';
// node tools/test_zones.js: the colours and motion of the rev and speed bars (shared/hud.js): the zones white / orange / red (the orange only on
// the layouts that keep their "run-up": the M theme, the HUD), the eased change between them, the held peak tick, the start-up sweep, and the
// layouts and fonts behind the scale numbers (the red index under the rev needle, the zoom, the M speed numbers' zone colour).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
// hud.js needs the kit beside it, as in a build: a copy of shared/ with the kit's runtime next to it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hudtest-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

// a HudApp with just the state the zone code reads
function make(over) {
    const S = Object.assign({ redline: 7000, speedZone: 130, units: 'metric' }, over && over.settings);
    const D = Object.assign({ speed: 0, rpm: 800, oil: 90, demo: false }, over && over.data);
    const h = Object.create(HudApp.prototype);
    h.ctx = { settings: { item: (k) => (k in S ? {} : null), get: (k) => S[k] } };
    h.setting = (k) => S[k];
    h.car = { data: () => D };
    h.score = { shiftPoint: () => ({ rpm: over && over.shiftAt || 6800, cold: false }) };
    h.rpmF = null; h.runUp = !(over && over.runUp === false); h.sweepAt = null; h.hybridEv = false; h.hybridCharge = false;
    h.S = S; h.D = D;
    return h;
}
const rev = (h, rpm) => { h.D.rpm = rpm; h.rpmF = rpm; return h._zoneRev(7000); };
const spd = (h, v) => { h.D.speed = v; h._raw = (k) => (k === 'speed' ? v : null); return h._zoneSpeed(); };

check('rev zone: white, orange 700 rpm before the red zone, red from it (redline 7000 on a 7000 scale: red from 6500)', () => {
    const h = make();
    assert.deepStrictEqual([2000, 5700, 5900, 6400, 6600, 7000].map((r) => rev(h, r)), [0, 0, 1, 1, 2, 2]);
});
check('rev zone without the run-up (Sport, M Blade, Navi): white, then red, no orange', () => {
    const h = make({ runUp: false });
    assert.deepStrictEqual([2000, 5900, 6400, 6600, 7000].map((r) => rev(h, r)), [0, 0, 0, 2, 2]);
});
check('rev zone: a lower redline moves both steps; the shift point (a cold engine) makes it red at once', () => {
    const h = make({ settings: { redline: 6000 } });
    assert.deepStrictEqual([4000, 5000, 5400, 6000].map((r) => rev(h, r)), [0, 0, 1, 2]);       // red from the redline (6000), orange from 700 rpm before (5300)
    const c = make({ shiftAt: 3500 });
    assert.strictEqual(rev(c, 3600), 2);
});
check('rev zone: no rpm, no zone', () => {
    const h = make(); h.D.rpm = null; h.rpmF = null;
    assert.strictEqual(h._zoneRev(7000), 0);
});
check('speed zone: orange from 85 % of the setting, red from it, none at 0; no run-up: white then red', () => {
    const h = make();
    assert.deepStrictEqual([50, 110, 111, 129, 130, 200].map((v) => spd(h, v)), [0, 0, 1, 1, 2, 2]);
    h.S.speedZone = 0;
    assert.strictEqual(spd(h, 200), 0);
    const q = make({ runUp: false });
    assert.deepStrictEqual([50, 111, 129, 130].map((v) => spd(q, v)), [0, 0, 0, 2]);
});
check('speed zone: an unknown speed is no zone', () => {
    const h = make(); h._raw = () => null;
    assert.strictEqual(h._zoneSpeed(), 0);
});

check('the eased zone: no jump (a first read is the target), a smooth climb through orange, back down, settles exactly', () => {
    const h = make();
    assert.strictEqual(h._ease('a', 0, 1000), 0);
    let t = 1000, prev = 0, sawMid = false;
    for (let i = 0; i < 40; i++) {
        t += 50;
        const v = h._ease('a', 2, t);
        assert(v >= prev - 1e-9 && v <= 2, 'monotonic and bounded: ' + v);
        if (v > 0.8 && v < 1.2) sawMid = true;
        prev = v;
    }
    assert(sawMid, 'it passes orange on its way to red');
    assert.strictEqual(prev, 2, 'it settles on the target');
    for (let i = 0; i < 40; i++) { t += 50; prev = h._ease('a', 0, t); }
    assert.strictEqual(prev, 0);
    const first = h._ease('b', 1.5, t);
    assert.strictEqual(first, 1.5, 'the first read of a key is the target: a rebuilt layout does not fade in from nothing');
    assert(Math.abs(h._ease('c', 2, 0) - 2) < 1e-9);
});
check('the eased zone: a stalled clock or a long gap does not overshoot', () => {
    const h = make();
    h._ease('a', 0, 1000);
    const v = h._ease('a', 2, 1000 + 60000);
    assert(v > 1.9 && v <= 2, String(v));
    assert.strictEqual(h._ease('a', 0, 1000), v > 0 ? h._ease('a', 0, 1000) : 0);          // an earlier timestamp never runs it backwards past the target
});
check('zone colours: white, orange, red, in between a mix', () => {
    const h = make();
    const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    assert(near(h._zoneRgb(0), [0.97, 0.98, 1.0]));
    assert(near(h._zoneRgb(1), [1.0, 0.68, 0.1]));
    assert(near(h._zoneRgb(2), [1.0, 0.18, 0.24]));
    const m = h._zoneRgb(0.5);
    assert(Math.abs(m[0] - 0.985) < 1e-9 && m.every((v) => v >= 0 && v <= 1));
    h._zoneRgb(-1); h._zoneRgb(3); h._zoneRgb(2.0000001);                                  // out of range: no throw
});

check('held peak: nothing while the rpm climbs, held after it drops, then it eases down onto the rpm and goes', () => {
    const h = make(), x = {};
    let t = 0;
    for (let v = 0.2; v <= 0.9; v += 0.1) { t += 50; assert.strictEqual(h._peakRev(x, v, t, false), 0, 'climbing'); }
    t += 50;
    assert.strictEqual(h._peakRev(x, 0.4, t, false), 0.9, 'just after the drop');
    t += 1000;
    assert.strictEqual(h._peakRev(x, 0.4, t, false), 0.9, 'still held');
    let last = 0.9;
    for (let i = 0; i < 30; i++) { t += 50; const p = h._peakRev(x, 0.4, t, false); if (p) { assert(p <= last + 1e-9, 'falls'); last = p; } }
    assert.strictEqual(h._peakRev(x, 0.4, t + 50, false), 0, 'gone');
});
check('held peak: not drawn when it is within 0.03 of the value; "off" (the hybrid power, the sweep) clears it', () => {
    const h = make(), x = {};
    h._peakRev(x, 0.8, 0, false);
    assert.strictEqual(h._peakRev(x, 0.78, 50, false), 0);
    assert.strictEqual(h._peakRev(x, 0.5, 100, false), 0.8);
    assert.strictEqual(h._peakRev(x, 0.5, 150, true), 0);
    assert.strictEqual(x.pk, null);
    assert.strictEqual(h._peakRev(x, 0.5, 200, false), 0, 'starts again from the value');
});

check('start-up sweep: 0 before it starts and after it ends, 1 at the top, smooth', () => {
    const h = make({ data: { speed: 0 } });
    assert.strictEqual(h._sweepF(5000), 0);
    h.sweepAt = 10000;
    assert.strictEqual(h._sweepF(9000), 0, 'waiting for the layers');
    assert.strictEqual(h.sweepAt, 10000, 'and still pending');
    assert.strictEqual(h._sweepF(10000), 0);
    assert(Math.abs(h._sweepF(10800) - 1) < 1e-9, 'the top, halfway');
    const up = [100, 200, 400, 600, 800].map((d) => h._sweepF(10000 + d));
    up.reduce((a, b) => { assert(b > a, 'rising'); return b; }, -1);
    const down = [800, 1000, 1200, 1400, 1599].map((d) => h._sweepF(10000 + d));
    down.reduce((a, b) => { assert(b < a, 'falling'); return b; }, 2);
    assert.strictEqual(h._sweepF(10000 + 1601), 0);
    assert.strictEqual(h.sweepAt, null, 'it ended');
});
check('start-up sweep: bars see the larger of the real value and the sweep, readouts and the shift keep the real one', () => {
    const h = make();
    h._raw = (k) => (k === 'rpm' ? 3000 : k === 'speed' ? 0 : null);
    assert.strictEqual(h._barRaw('rpm'), 3000);
    h.sweepAt = 0;
    const now = Date.now; Date.now = () => 800;
    try {
        assert.strictEqual(h._barRaw('rpm'), 7000);
        assert.strictEqual(h._barRaw('speed'), 330);
        assert.strictEqual(h._barRaw('fuel'), h._raw('fuel'));
        assert.strictEqual(h._raw('rpm'), 3000, 'the car\'s own value is untouched');
        Date.now = () => 100;
        const v = h._barRaw('rpm');
        assert(v > 3000 && v < 3100 || v === 3000, 'the real value still wins while the sweep is low: ' + v);
        Date.now = () => 1700;
        assert.strictEqual(h._barRaw('rpm'), 3000, 'back on the real value at the end, no jump');
    } finally { Date.now = now; }
});
check('start-up sweep: it stops at once when the car moves (not on the demo)', () => {
    const h = make({ data: { speed: 40 } });
    h.sweepAt = 0;
    assert.strictEqual(h._sweepF(800), 0);
    assert.strictEqual(h.sweepAt, null);
    const d = make({ data: { speed: 40, demo: true } });
    d.sweepAt = 0;
    assert(d._sweepF(800) > 0.99);
    const u = make({ data: { speed: null } });
    u.sweepAt = 0;
    assert(u._sweepF(800) > 0.99, 'an unknown speed does not stop it');
});
check('the sweep zones follow it: red at the top', () => {
    const h = make();
    h._raw = (k) => (k === 'speed' ? 0 : k === 'rpm' ? 800 : null);
    h.rpmF = 800;
    h.sweepAt = 0;
    const now = Date.now; Date.now = () => 800;
    try {
        assert.strictEqual(h._zoneRev(7000), 2);
        assert.strictEqual(h._zoneSpeed(), 2);
        assert.strictEqual(h._zoneOf('speed', 0), 2);
    } finally { Date.now = now; }
});
check('scale numbers: the label the needle has REACHED lights (140 km/h: the 120, not the 150), among the labels the layout has', () => {
    const h = make();
    const at = (rpm, speed) => { h._raw = (k) => (k === 'rpm' ? rpm : k === 'speed' ? speed : null); };
    h.nearLabels = { rpm: [0, 1, 2, 3, 4, 5, 6, 7], speed: [0, 1, 2, 3, 4, 5, 6, 7, 8], mspeed: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
    at(4400, 60);
    assert.strictEqual(h._nearMark('rpm'), 4);
    assert.strictEqual(h._nearMark('speed'), 2, '60 km/h on 0 30 60 ...: the third label');
    at(5990, 140);
    assert.strictEqual(h._nearMark('rpm'), 5, '5990 rpm: the 5, not the 6');
    assert.strictEqual(h._nearMark('speed'), 4, '140 km/h: the 120, not the 150');
    assert.strictEqual(h._nearMark('mspeed'), 4);
    at(6000, 150);
    assert.strictEqual(h._nearMark('rpm'), 6);
    assert.strictEqual(h._nearMark('speed'), 5, 'the label lights as the needle gets to it');
    at(6700, 149.9);
    assert.strictEqual(h._nearMark('rpm'), 6, '6700 rpm: still the 6');
    assert.strictEqual(h._nearMark('speed'), 4);
    at(800, 0);
    assert.strictEqual(h._nearMark('rpm'), 0);
    assert.strictEqual(h._nearMark('speed'), 0);
    h._raw = () => null;
    assert.strictEqual(h._nearMark('rpm'), null);
    assert.strictEqual(h._nearMark('speed'), null);
    // the M theme only has the even labels: the last one reached, no gaps
    h.nearLabels.rpm = [0, 2, 4, 6];
    at(5990, 0);
    assert.strictEqual(h._nearMark('rpm'), 4);
    at(6100, 0);
    assert.strictEqual(h._nearMark('rpm'), 6);
    at(3999, 0);
    assert.strictEqual(h._nearMark('rpm'), 2);
    // before the first label of a scale
    h.nearLabels.rpm = [1, 2];
    at(500, 0);
    assert.strictEqual(h._nearMark('rpm'), null);
    // no label set (a layout not built): the thousand under the needle
    h.nearLabels = null;
    at(4400, 0);
    assert.strictEqual(h._nearMark('rpm'), 4);
});
check('scale numbers: while the bar shows the battery\'s power, the needle is in tens of kW; the hybrid has no zone', () => {
    const h = make();
    h.nearLabels = { rpm: [0, 1, 2, 3, 4, 5, 6, 7] };
    h._raw = (k) => (k === 'rpm' ? 0 : k === 'speed' ? 50 : null);
    h.hybridEv = true; h.hybridPow = { kw: 35, chg: false };
    assert.strictEqual(h._nearMark('rpm'), 3, '35 kW: the 3');
    h.hybridPow = { kw: 62, chg: true };
    assert.strictEqual(h._nearMark('rpm'), 6, 'charging, 62 kW: the 6');
    assert.strictEqual(h._zoneOf('rpm', 7000), 0);
    h.hybridEv = false; h.hybridPow = null;
    h._raw = (k) => (k === 'rpm' ? 4400 : null);
    assert.strictEqual(h._nearMark('rpm'), 4, 'the engine again: the rpm');
});

check('no orange anywhere in the fade on the layouts without the run-up: their shaders and their numbers go white to red', () => {
    const sh = fs.readFileSync(path.join(root, 'shared', 'shaders.js'), 'utf8');
    const part = (a, b) => sh.slice(sh.indexOf('const ' + a + ' = `'), b ? sh.indexOf('const ' + b + ' = `') : undefined);
    const sdash = part('SDASH', 'MBLADE'), mblade = part('MBLADE', 'NAVI'), navi = part('NAVI', 'ATEXT'), mt = part('MTACH', 'FACETS');
    assert(!/vec3\(1\.0, 0\.68, 0\.1\)/.test(mt), 'M: no orange in the zone colour');
    assert(!/ZONE_AMBER|AMBER_Z/.test(sdash + mblade), 'Sport / M Blade: no orange in the zone colour');
    assert(!/u_zone[^;]*vec3\(1\.0, 0\.6/.test(navi) && !/vec3\(1\.0, 0\.6[0-9]*, 0\.(08|1)\)/.test(navi), 'Navi: no orange');
    assert(/!this\.runUp \? mixc\(base, hot, lv \/ 2\)/.test(fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8')), 'hud.js: the numbers go straight to red without the run-up');
});

check('tyre pressure colours: yellow under the setting, red 0.4 bar under it, none at 0 or without a reading; compared as shown', () => {
    const h = make({ settings: { tyreLow: 2.0 } });
    const at = (bar, set) => { h.S.tyreLow = set === undefined ? 2.0 : set; h._tyre = () => bar; return h._tyreRole('FL', 'fg'); };
    assert.strictEqual(at(2.3), 'fg');
    assert.strictEqual(at(2.0), 'fg', 'at the limit: fine');
    assert.strictEqual(at(1.96), 'fg', '1.96 shows as 2.0');
    assert.deepStrictEqual(at(1.9), [255, 194, 26, 255]);
    assert.deepStrictEqual(at(1.6), [255, 194, 26, 255], '1.6 is the red limit, still yellow');
    assert.strictEqual(at(1.5), 'hot');
    assert.strictEqual(at(0.4), 'hot');
    assert.strictEqual(at(1.5, 0), 'fg', '0 = never');
    assert.strictEqual(at(null), 'fg', 'no reading');
    assert.deepStrictEqual(at(2.2, 2.4), [255, 194, 26, 255]);
    assert.strictEqual(at(1.9, 2.4), 'hot');
    const noItem = make(); noItem.ctx.settings.item = () => null; noItem._tyre = () => 1.0;
    assert.strictEqual(noItem._tyreRole('FL', 'fg'), 'fg', 'an app without the setting (the HUD)');
});
check('the redline marks (yellow dashes, then a solid red line) are on every cluster theme, the same yellow, and Navi gets its uniforms', () => {
    const sh = fs.readFileSync(path.join(root, 'shared', 'shaders.js'), 'utf8');
    const part = (a, b) => sh.slice(sh.indexOf('const ' + a + ' = `'), b ? sh.indexOf('const ' + b + ' = `') : undefined);
    const yellow = /1\.0, 0\.85, 0\.1[,)]/;
    ['MTACH', 'SDASH', 'MBLADE', 'NAVI'].forEach((n) => {
        const src = part(n, { MTACH: 'FACETS', SDASH: 'MBLADE', MBLADE: 'NAVI', NAVI: 'ATEXT' }[n]);
        assert(yellow.test(src) && /u_orange/.test(src) && /u_redFrom/.test(src), n + ': yellow dashes from u_orange, red from u_redFrom');
    });
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    const navi = hud.slice(hud.indexOf("w.type === 'navi'", hud.indexOf("w.type === 'navi'") + 20));
    assert(/'u_redFrom', \[marks\[0\]\]/.test(navi) && /'u_orange', \[marks\[1\]\]/.test(navi), 'hud.js sends Navi the redline marks (none while the bar shows the hybrid power)');
});

// ---- the layouts and the fonts
const lay = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', id + '.json'), 'utf8'));
const font = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'fonts', id + '.json'), 'utf8'));
check('only the HUD keeps the orange run-up; the four cluster themes\' bars go white then red', () => {
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => assert.strictEqual(lay(id).runUp, false, id));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'hud', 'layouts', 'mstyle.json'), 'utf8')).runUp, undefined);
});
check('every zoomed scale number has its middle step, between the normal and the zoomed font, and room (grow) already in its box', () => {
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => {
        const zoomed = lay(id).widgets.filter((w) => w.nearFont);
        assert(zoomed.length >= 8, id + ': ' + zoomed.length + ' scale numbers');
        zoomed.forEach((w) => {
            assert(w.nearMid && w.near && w.font, id + ' ' + w.id);
            const a = font(w.font).cellHeight, b = font(w.nearMid).cellHeight, c = font(w.nearFont).cellHeight;
            assert(a <= b && b <= c && a < c, id + ' ' + w.id + ': ' + [a, b, c]);
            const g = w.grow || [0, 0, 0, 0];
            assert(w.h - g[1] - g[3] >= a - 2 && w.h >= c, id + ' ' + w.id + ' box ' + w.h + ' for ' + c);
        });
    });
});
check('the rev numbers of Sport, M and M Blade carry the red index; Navi\'s sit on the bar and only grow', () => {
    ['sport', 'm', 'mblade'].forEach((id) => {
        const r = lay(id).widgets.filter((w) => w.near && w.near[0] === 'rpm');
        assert(r.length >= 8, id);
        r.forEach((w) => assert(w.zoomColor !== false && w.rpmMax === 7000, id + ' ' + w.id));
    });
    const r = lay('navi').widgets.filter((w) => w.near && w.near[0] === 'rpm');
    assert(r.length >= 8);
    r.forEach((w) => assert.strictEqual(w.zoomColor, false, w.id));
});
check('the M theme: the middle numbers (gear, speed) stay white, the zoom numbers are yellow, the bars red; the others\' zoom numbers are red', () => {
    const m = lay('m');
    assert.strictEqual(m.zoneRed, false);
    ['sport', 'mblade', 'navi'].forEach((id) => assert.strictEqual(lay(id).zoneRed, undefined, id));
    ['speed', 'mspeed', 'gear', 'mgear'].forEach((id) => {
        const w = m.widgets.find((x) => x.id === id);
        assert(w && !w.zoneBy && !w.hotWhen && !w.coldWhen && w.color === 'fg', id + ' stays white');
    });
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => assert(!lay(id).widgets.some((w) => w.zoneBy), id + ': no zoneBy'));
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(/this\.zoneRed \? color\(this\.theme, 'hot'\) : VERDICT\.EARLY/.test(hud), 'hud.js: the red index becomes yellow without zoneRed');
    assert(/pw \? \(pw\.chg \? HY_GREEN : HY_BLUE\) : hot/.test(hud), 'hud.js: the label under the needle is blue / green with the hybrid power');
    const sh = fs.readFileSync(path.join(root, 'shared', 'shaders.js'), 'utf8');
    const mtach = sh.slice(sh.indexOf('const MTACH = `'), sh.indexOf('const FACETS = `'));
    assert(/vec3 zc = mix\(vec3\(1\.0\), u_red, clamp\(u_zone \* 0\.5, 0\.0, 1\.0\)\)/.test(mtach) && !/0\.76, 0\.1/.test(mtach), 'the M rev blade: white to red');
});
check('the start-up sweep has its setting in both apps and the page lists it', () => {
    ['shaktheme', 'shakhud'].forEach((app) => {
        const spec = JSON.parse(fs.readFileSync(path.join(root, 'apps', app, 'app.json'), 'utf8'));
        const s = spec.settings.find((x) => x.key === 'startupSweep');
        assert(s && s.type === 'bool' && s.default === true, app);
        assert(/startupSweep/.test(fs.readFileSync(path.join(root, 'apps', app, 'main.js'), 'utf8')), app + ' main.js');
    });
});

check('the M theme\'s four pressure numbers carry their corner, the setting exists and repaints live', () => {
    const m = lay('m');
    ['FL', 'FR', 'RL', 'RR'].forEach((c) => {
        const w = m.widgets.find((x) => x.id === 'tp_' + c);
        assert(w && w.tyreBy === c && w.text === '{{tyreP:' + c + '}}', c);
        assert(!m.widgets.find((x) => x.id === 'tt_' + c).tyreBy, 'the temperature keeps its colour');
    });
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8'));
    const t = spec.settings.find((x) => x.key === 'tyreLow');
    assert(t && t.type === 'number' && t.unit === 'bar' && t.default === 2 && t.steps.includes(0) && t.steps.includes(2), 'tyreLow');
    assert(/tyreLow/.test(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'main.js'), 'utf8')), 'main.js lists it');
    assert(/LIVE_KEYS = \[[^\]]*'tyreLow'/.test(fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8')), 'a change repaints, no rebuild');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test_zones: ' + n + ' checks' + (process.exitCode ? ' (some failed)' : ' ok'));
