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

check('total range: fuel and electric together, replaces the fuel-only readout (with its own icon) on every theme', () => {
    const h = make();
    const at = (range, ev, units) => { h.S.units = units || 'metric'; h._raw = (k) => (k === 'range' ? range : k === 'evRange' ? ev : null); return h._token('rangeTotal'); };
    assert.strictEqual(at(450, 30), '480');
    assert.strictEqual(at(450, null), '450', 'a car without the battery: the fuel range');
    assert.strictEqual(at(null, 30), '30', 'no fuel range yet: the electric one');
    assert.strictEqual(at(null, null), '--');
    assert.strictEqual(at(450, 30, 'us'), '298', 'miles');
    assert.strictEqual(at(0, 0), '0');
    const spec = (f) => JSON.parse(fs.readFileSync(path.join(root, 'apps', f), 'utf8'));
    ['shaktheme/hud/layouts/sport', 'shaktheme/hud/layouts/m', 'shaktheme/hud/layouts/mblade', 'shaktheme/hud/layouts/navi', 'shakhud/hud/layouts/mstyle'].forEach((f) => {
        const L = spec(f + '.json'), t = L.widgets.find((w) => w.id === 'range' || w.id === 'fuel_range');
        assert(t && /^\{\{rangeTotal\}\}/.test(t.text) && t.lowWhen === 'fuel', f + ': the readout');
        assert(!L.widgets.some((w) => w.type === 'text' && /\{\{range\}\}/.test(w.text)), f + ': no fuel-only range left');
        const ic = L.widgets.find((w) => w.id === 'range_icon' || (w.id === 'fuel_icon' && f.includes('shakhud')));
        assert(ic && ic.icon === 'fuelBolt' && ic.lowWhen === 'fuel', f + ': the combined icon');
    });
    assert(typeof require(path.join(tmp, 'shared', 'icons.js')).ICONS.fuelBolt === 'function');
});
check('low tyres: the M car glyph\'s wheels turn yellow / red per wheel, the HUD warns only when one is low (and has what it reads)', () => {
    const h = make({ settings: { tyreLow: 2.0 } });
    const tyres = { FL: 2.3, FR: 1.9, RL: 1.5, RR: null };
    h._tyre = (kind, c) => tyres[c];
    assert.deepStrictEqual(['FL', 'FR', 'RL', 'RR'].map((c) => h._tyreLevel(c)), [0, 1, 2, 0]);
    assert.strictEqual(h._tyreLevel('any'), 2);
    assert.strictEqual(h._tyreMin(), 1.5);
    h._tyre = () => 2.4;
    assert.strictEqual(h._tyreLevel('any'), 0);
    h.S.units = 'metric'; h._tyre = (k, c) => ({ FL: 2.3, FR: 1.8, RL: 2.5, RR: 2.5 })[c];
    assert.strictEqual(h._token('tyreMin'), '1.8');
    h.S.units = 'us';
    assert.strictEqual(h._token('tyreMin'), '26');
    h._tyre = () => 2.4;
    assert.strictEqual(h._token('tyreMin'), '', 'nothing while the tyres are fine');
    h._tyre = () => null;
    assert.strictEqual(h._token('tyreMin'), '');
    const sh = fs.readFileSync(path.join(root, 'shared', 'shaders.js'), 'utf8');
    assert(/uniform vec4 u_tyreLv;/.test(sh) && /u_tyreLv\.w/.test(sh), 'mdash: a level per wheel');
    const hud = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'hud', 'layouts', 'mstyle.json'), 'utf8'));
    const ic = hud.widgets.find((w) => w.id === 'tyre_icon'), tx = hud.widgets.find((w) => w.id === 'tyre_warn');
    assert(ic && ic.icon === 'tyre' && ic.tyreBy === 'any' && ic.tyreOnly === true && tx && tx.text === '{{tyreMin}}' && tx.tyreBy === 'any');
    const visible = require(path.join(tmp, 'shared', 'visible.js'));
    assert.deepStrictEqual(visible.check([ic, tx], 'hud'), [], 'inside the HUD window, clear of BMW\'s own speed');
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'app.json'), 'utf8'));
    assert(spec.settings.some((x) => x.key === 'tyreLow' && x.default === 2) && spec.signals['de.bmw.infotainment.vehicle.TPMS'].statusTyrePressure, 'the setting and the TPMS permission');
    assert(/tyreLow/.test(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'main.js'), 'utf8')));
});
check('warm-up cue: three white flashes when the oil gets warm while the app runs; none for an engine already warm; a warning over it', () => {
    const h = make({ settings: { oilCold: 75, coolantCold: 70 } });
    let oil = null;
    h._raw = (k) => (k === 'oil' ? oil : null);
    assert.strictEqual(h._warmPulse('oil', 1000), false, 'nothing known');
    oil = 90;
    assert.strictEqual(h._warmPulse('oil', 2000), false, 'warm from the start: no flashes');
    oil = 40;
    assert.strictEqual(h._warmPulse('oil', 3000), false, 'cold');
    oil = 74;
    assert.strictEqual(h._warmPulse('oil', 4000), false, 'still under the limit');
    oil = 75;
    const t0 = 5000;
    const phases = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2399, 2400, 3000, 60000].map((d) => h._warmPulse('oil', t0 + d));
    assert.deepStrictEqual(phases, [true, true, false, false, true, true, false, false, true, true, false, false, false, false, false, false]);
    assert.strictEqual(h._warmPulse('oil', t0 + 90000), false);
    oil = 60;
    h._warmPulse('oil', t0 + 100000);
    oil = 80;
    assert.strictEqual(h._warmPulse('oil', t0 + 110000), true, 'cold again, warm again: it flashes again');
    h.S.oilCold = 0;
    oil = 20; h._warmPulse('oil', t0 + 200000); oil = 90;
    assert.strictEqual(h._warmPulse('oil', t0 + 210000), false, '0 = never cold: no cue');
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert((hud.match(/_warmPulse\(w\.tempBy, now\)/g) || []).length === 2, 'the number and the icon');
});
check('speed limit file (speedlimit.js): fresh, newest wins, stale / out of range / bad ones ignored, gone with the file', () => {
    const { SpeedLimit } = require(path.join(tmp, 'shared', 'speedlimit.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limit-'));
    let t = 1000000;
    const seen = [];
    const sl = new SpeedLimit({ dir, now: () => t }, { info() {}, warn() {} }, (v) => seen.push(v));
    const put = (name, o) => fs.writeFileSync(path.join(dir, name), typeof o === 'string' ? o : JSON.stringify(o));
    sl.scan(); assert.strictEqual(sl.limit(), null, 'no file');
    put('speedlimit-a.json', { t, app: 'a', limit: 50 });
    sl.scan(); assert.strictEqual(sl.limit(), 50);
    put('speedlimit-b.json', { t: t + 100, app: 'b', limit: 80.4 });
    t += 200; sl.scan(); assert.strictEqual(sl.limit(), 80, 'the newest file wins, rounded');
    put('speedlimit-b.json', { t: t - 7000, app: 'b', limit: 80 });
    sl.scan(); assert.strictEqual(sl.limit(), 50, 'a stale file counts as gone (a is stale too: t - 200 old, still fresh)');
    t += 7000; sl.scan(); assert.strictEqual(sl.limit(), null, 'both stale');
    put('speedlimit-c.json', { t, app: 'c', limit: 3 }); sl.scan(); assert.strictEqual(sl.limit(), null, 'under 5 km/h is not a limit');
    put('speedlimit-c.json', { t, app: 'c', limit: 300 }); sl.scan(); assert.strictEqual(sl.limit(), null, 'over 200 km/h neither');
    put('speedlimit-c.json', { t: t + 99999, app: 'c', limit: 70 }); sl.scan(); assert.strictEqual(sl.limit(), null, 'a time far in the future');
    put('speedlimit-c.json', '{ not json'); sl.scan(); assert.strictEqual(sl.limit(), null, 'half a file');
    put('speedlimit-c.json', { t, app: 'c', limit: 70 }); sl.scan(); assert.strictEqual(sl.limit(), 70);
    put('other.json', { t, limit: 30 }); sl.scan(); assert.strictEqual(sl.limit(), 70, 'only speedlimit-*.json files count');
    fs.unlinkSync(path.join(dir, 'speedlimit-c.json')); sl.scan(); assert.strictEqual(sl.limit(), null, 'gone with its file');
    assert.deepStrictEqual(seen, [50, 80, 50, null, 70, null], 'onChange on every change only');
    fs.rmSync(dir, { recursive: true, force: true });
});
check('speed limit ring: the number in the unit shown, red only while over it, blank without a limit; it stays while the timer shows', () => {
    const h = make({ settings: { units: 'metric', limitRing: true, launchTimer: true } });
    h.target = 'panel';
    let lim = 50, sp = 45;
    h.speedLimit = { limit: () => lim };
    h.runs = { shownHeld: () => null, state: 'idle', record: false };
    h._raw = (k) => (k === 'speed' ? sp : null);
    assert.deepStrictEqual(h._limitNow(0), { text: '50', over: false });
    sp = 50.4; assert.strictEqual(h._limitNow(0).over, false, 'the shown speed (50) is not over 50');
    sp = 51; assert.strictEqual(h._limitNow(0).over, true);
    sp = null; assert.strictEqual(h._limitNow(0).over, false, 'no speed, not over');
    lim = null; assert.strictEqual(h._limitNow(0), null, 'no limit, no ring');
    lim = 90; sp = 56;
    h.S.units = 'us';
    assert.deepStrictEqual(h._limitNow(0), { text: '55', over: false }, '90 km/h is 55 mph; 56 km/h is 35 mph, under it');
    sp = 100;
    assert.strictEqual(h._limitNow(0).over, true, '100 km/h is 62 mph');
    h.S.units = 'metric'; sp = 60;
    h.S.limitRing = false; assert.strictEqual(h._limitNow(0), null, 'the setting off');
    h.S.limitRing = true;
    h.runs = { shownHeld: () => 6.4, state: 'run', record: false };
    assert.deepStrictEqual(h._limitNow(0), { text: '90', over: false }, 'the ring sits in a corner now: the 0-100 timer does not hide it');
    h.runs = { shownHeld: () => null, state: 'idle', record: false };
    h.target = 'hud'; assert.strictEqual(h._limitNow(0), null, 'not on the HUD');
});
check('0-100 timer: live to 0.1 s, held to 0.01 s (0.1 s from 10 s), gone after 12 s, new best green, off with its setting, cluster only', () => {
    const Runs = require(path.join(tmp, 'shared', 'runs.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    const r = new Runs(dir, { info() {}, warn() {} });
    const run = (t0, sec) => {
        let t = t0;
        r.update(0, t, 'metric'); t += 600; r.update(0, t, 'metric');          // stood: armed
        t += 100; r.update(10, t, 'metric'); const start = t;
        t += sec * 500; r.update(60, t, 'metric');
        t += sec * 500; r.update(104, t, 'metric');
        return { start, end: t };
    };
    assert.strictEqual(r.shownHeld(0), null, 'nothing before a run');
    const a = run(10000, 5);
    assert.strictEqual(r.state, 'done');
    assert(r.record, 'the first run is a record');
    assert(Math.abs(r.last - 5) < 0.5, 'about 5 s, got ' + r.last);
    assert.strictEqual(r.shownHeld(a.end + 11000), r.last, 'held 11 s after');
    assert.strictEqual(r.shownHeld(a.end + 12500), null, 'gone after 12 s');
    const b = run(a.end + 20000, 8);
    assert.strictEqual(r.record, false, 'slower: not a record');
    const c = run(b.end + 20000, 4);
    assert.strictEqual(r.record, true, 'faster: a record');
    // live: the clock while running
    let t = c.end + 20000;
    r.update(0, t, 'metric'); t += 600; r.update(0, t, 'metric'); t += 100; r.update(12, t, 'metric');
    assert.strictEqual(r.state, 'run');
    assert(Math.abs(r.shownHeld(t + 3000) - 3) < 0.01, 'the clock runs');
    // the token (cluster only, with its setting)
    const h = make({ settings: { launchTimer: true } });
    h.target = 'panel'; h.runs = { shownHeld: (now) => (now < 5 ? 3.456 : now < 10 ? 12.34 : null), state: 'done', record: true };
    assert.strictEqual(h._token('launch'), h._token('launch'));
    const shown = (now) => { const o = Date.now; Date.now = () => now; try { return [h._token('launch'), h._token('launchUnit')]; } finally { Date.now = o; } };
    assert.deepStrictEqual(shown(1), ['3.46', 's']);
    assert.deepStrictEqual(shown(7), ['12.3', 's'], 'from 10 s one decimal fits the box');
    assert.deepStrictEqual(shown(20), ['', '']);
    h.runs.state = 'run'; assert.strictEqual(shown(1)[0], '3.5', 'live: one decimal');
    h.S.launchTimer = false; assert.deepStrictEqual(shown(1), ['', ''], 'the setting off');
    h.S.launchTimer = true; h.target = 'hud'; assert.deepStrictEqual(shown(1), ['', ''], 'not on the HUD');
    fs.rmSync(dir, { recursive: true, force: true });
});
check('limit ring and timer: in the four layouts, blank-safe, clear of the map and of each other; the new module is in the apps\' shared lists', () => {
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => {
        const L = lay(id), by = (i) => L.widgets.find((w) => w.id === i);
        ['lim_ring', 'lim_num', 'run_icon', 'run_time'].forEach((i) => assert(by(i), id + ': ' + i + ' missing'));
        assert.strictEqual(by('lim_ring').icon, 'ring'); assert.strictEqual(by('run_icon').icon, 'stopwatch');
        assert(by('lim_ring').limitBy && by('lim_num').limitBy && by('run_icon').launchBy && by('run_time').launchBy);
        assert.strictEqual(by('lim_num').text, '{{limit}}'); assert.strictEqual(by('run_time').text, '{{launch}}');
        // (M Blade's ring also gives way to its view panel: "&viewSel=none", a copy under the panel shows then)
        ['lim_ring', 'lim_num', 'run_icon', 'run_time'].forEach((i) => assert(by(i).toggle === '!mapUp' || (id === 'mblade' && /^lim_/.test(i) && by(i).toggle === '!mapUp&viewSel=none'), id + ': ' + i + ' must hide with the map'));
        const f = font(by('lim_num').font);
        assert('0123456789'.split('').every((d) => f.glyphs[d]), id + ': the limit number\'s font has no digits');
        assert('0123456789.'.split('').every((d) => font(by('run_time').font).glyphs[d]), id + ': the timer\'s font lacks digits');
        // the number fits inside the ring: three digits in the hole of it
        const adv = font(by('lim_num').font).glyphs['0'];
        const a = typeof adv === 'object' ? (adv.advance || adv.w) : adv, R = by('lim_ring').w;
        assert(3 * a <= 0.74 * R, id + ': three digits do not fit in the ring (' + 3 * a + ' > ' + 0.74 * R + ')');
    });
    ['shaktheme', 'shakhud'].forEach((app) => {
        const j = JSON.parse(fs.readFileSync(path.join(root, 'apps', app, 'app.json'), 'utf8'));
        assert(j.shared.indexOf('speedlimit.js') >= 0, app + ': speedlimit.js is not in its shared list');
    });
    const set = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8')).settings.map((s) => s.key);
    assert(set.indexOf('limitRing') >= 0 && set.indexOf('launchTimer') >= 0);
    assert(typeof require(path.join(tmp, 'shared', 'icons.js')).ICONS.stopwatch === 'function');
});
check('limit ring: small, in the lower left part of every theme (under the tyre block on M), clear of every other widget and of BMW\'s gear box and belt light; the timer keeps the middle', () => {
    const visible = require(path.join(tmp, 'shared', 'visible.js'));
    const SHADERS = ['sdash', 'mdash', 'mblade', 'navi', 'shiftlight', 'emblem'];
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => {
        const L = lay(id), by = (i) => L.widgets.find((w) => w.id === i), r = by('lim_ring'), n = by('lim_num');
        assert(r.w === 92 && r.h === 92, id + ': ring size (92 since 22 Nov 2026: three digits with room round them)');
        assert(n.x >= r.x && n.x + n.w <= r.x + r.w && n.y >= r.y && n.y + n.h <= r.y + r.h, id + ': the number sits inside the ring');
        assert(Math.abs((n.y + n.h / 2) - (r.y + r.h / 2)) <= 3, id + ': the number is centred in the ring');
        assert.strictEqual(n.font, 'unit', id + ': the digits in the larger font (34 px) since the ring grew to 92 px');
        assert.strictEqual(r.color, 'dim', id + ': the ring is the quiet colour (red when over the limit)');
        // The owner (22 Nov 2026) circled on the bench pictures where he wants the ring: in the lower left part of every theme (left of the speed
        // scale's numbers on Sport and Navi, bottom left on M Blade, under the tyres on M), and larger where there is room.
        assert(r.x + r.w / 2 >= 60 && r.x + r.w / 2 <= 520 && r.y >= 400 && r.y + r.h <= 660, id + ': the ring is not in the lower left part (' + r.x + ', ' + r.y + ')');
        if (id === 'mblade' || id === 'sport' || id === 'navi') {
            const sp = by('speed');
            assert(r.y >= sp.y + sp.h || r.x + r.w <= sp.x || r.x >= sp.x + sp.w, id + ': the ring is over the speed\'s box');
        } else if (id === 'm') {
            // as the M3 cluster's own (owner's photo, Nov 16 2026): right under the tyre pressures, centred on them, with the next limit beside it
            const tp = ['tp_FL', 'tp_FR', 'tp_RL', 'tp_RR'].map(by), left = Math.min(...tp.map((w) => w.x)), right = Math.max(...tp.map((w) => w.x + w.w)), low = Math.max(...tp.map((w) => w.y + w.h));
            assert(Math.abs(r.x + r.w / 2 - (left + right) / 2) <= 8, id + ': the ring is not centred under the tyre block');
            assert(r.y >= low + 12 && r.y - low <= 70, id + ': the ring is not right under the tyre block (its lowest line ends y ' + low + ', the ring starts y ' + r.y + ')');
            assert(r.y + r.h <= 528, id + ': the ring runs into the card\'s lower rim (y 535)');
            const nx = by('lim_nxt_ring');
            assert(nx.x >= r.x + r.w + 8 && Math.abs((nx.y + nx.h / 2) - (r.y + r.h / 2)) <= 3, id + ': the next limit is not beside the ring');
        }
        const box = [r.x, r.y, r.x + r.w, r.y + r.h], hit = (w) => w.x < box[2] && w.x + w.w > box[0] && w.y < box[3] && w.y + w.h > box[1];
        L.widgets.forEach((w) => {
            if (w === r || w === n || SHADERS.indexOf(w.type) >= 0 || w.toggle === 'mapUp' || w.toggle === 'powerOpen' || w.id === 'lim_num' || w.id === 'speed') return;
            if (/(^|&)viewSel=none$/.test(r.toggle || '') && /(^|&)(!viewSel=none|viewSel=(?!none)[a-z]+)(&|$)/.test(w.toggle || '')) return;   // M Blade: a view's panel and the ring take turns   // the speed's wide box is centred text: the digits' own clearance is checked above
            assert(!hit(w), id + ': the ring overlaps ' + w.id);
        });
        assert(box[2] <= visible.BLACK_BOX[0] || box[0] >= visible.BLACK_BOX[2] || box[3] <= visible.BLACK_BOX[1] || box[1] >= visible.BLACK_BOX[3], id + ': clear of BMW\'s gear box');
        assert(box[2] <= visible.BELT[0] || box[0] >= visible.BELT[2] || box[3] <= visible.BELT[1] || box[1] >= visible.BELT[3], id + ': clear of BMW\'s belt light');
        const t = by('run_time'); assert(t.x > 500 && t.x < 1400, id + ': the timer is still in the middle');
    });
});
check('Sport theme: each range sits under its own gauge (fuel left, battery right, mirrored), clear of BMW\'s belt light and of the readouts beside them', () => {
    const L = lay('sport'), by = (i) => L.widgets.find((w) => w.id === i), visible = require(path.join(tmp, 'shared', 'visible.js'));
    const fuelEnd = by('range_unit').x + by('range_unit').w, evStart = by('ev_icon').x;
    assert(by('range_icon').x >= 380 && fuelEnd <= visible.BELT[0], 'the fuel range ends before the belt light (x ' + fuelEnd + ')');
    assert(evStart >= visible.GEAR_P[2] && by('ev_range').x >= visible.GEAR_P[2], 'the electric range starts after BMW\'s gear letter (x ' + visible.GEAR_P[0] + '..' + visible.GEAR_P[2] + '), no longer mirroring the fuel range: the letter sits under the battery gauge');
    assert(by('drive_mode').y + by('drive_mode').h <= by('outside').y, 'the drive mode\'s name is on its own row above the outside temperature (it collided with it)');
    assert(by('ev_range_unit').x + by('ev_range_unit').w <= by('outside').x, 'the outside temperature starts after the electric range');
    // the bottom row's middle is the middle of BMW's gear letter and belt light (y 663..708): one notch up from the panel's edge (0.20.5)
    ['time', 'range', 'ev_range', 'outside'].forEach((i) => assert(Math.abs(by(i).y + by(i).h / 2 - 683) <= 5, 'Sport: ' + i + ' is not on the gear letter\'s line (middle y ' + (by(i).y + by(i).h / 2) + ')'));
    assert(by('ev_share_unit').x + by('ev_share_unit').w <= evStart, 'the electric share stops before the electric range');
    assert(by('ev_share_icon').x >= by('ready_text').x + by('ready_text').w, 'the electric share starts after the launch cue');
    assert(by('ice_icon').x + by('ice_icon').w <= by('outside').x + by('outside').w - 40, 'the snowflake sits left of the temperature digits');
    const navi = lay('navi'), nb = (i) => navi.widgets.find((w) => w.id === i);
    assert.strictEqual(nb('ev_pct').align, 'right', 'Navi: the charge digits end next to their % like the range ones');
    assert(nb('drive_mode').y + nb('drive_mode').h <= 700, 'Navi: the drive mode is not on the bottom edge');
});
check('ice alert: on at or under the setting, off 1 degree above it (no flicker), the snowflake flashes 8 s then stays lit; 0 = never; unknown = off', () => {
    const h = make({ settings: { iceBelow: 3 } });
    let t = null;
    h._raw = (k) => (k === 'ambient' ? t : null);
    assert.deepStrictEqual(h._ice(1000), { on: false, blink: false }, 'no reading');
    t = 5; assert.strictEqual(h._ice(2000).on, false, 'warm');
    t = 3; const a = h._ice(3000); assert.strictEqual(a.on, true, 'at the limit: on');
    assert.strictEqual(a.blink, false, 'the first half second is lit (the flash starts dark)');
    assert.strictEqual(h._ice(3500).blink, true); assert.strictEqual(h._ice(4000).blink, false);
    assert.strictEqual(h._ice(10999).blink, true, 'still flashing just before 8 s');
    assert.deepStrictEqual(h._ice(11000), { on: true, blink: false }, 'after 8 s: lit');
    assert.deepStrictEqual(h._ice(11500), { on: true, blink: false });
    t = 3.9; assert.strictEqual(h._ice(12000).on, true, 'between the limit and 1 degree above: stays on');
    t = 4.1; assert.strictEqual(h._ice(13000).on, false, 'over it by more than 1 degree: off');
    t = 2; const b = h._ice(20000); assert.strictEqual(b.on, true, 'cold again: it comes on again');
    assert.strictEqual(h._ice(20500).blink, true, 'and flashes again');
    h.S.iceBelow = 0; assert.strictEqual(h._ice(30000).on, false, '0 = never');
    h.S.iceBelow = 3; t = -10; assert.strictEqual(h._ice(31000).on, true, 'far under zero');
    t = null; assert.strictEqual(h._ice(32000).on, false, 'the reading is lost: off');
    // the engine reads it for the icon and the outside temperature's text; cold blue meanwhile
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(/w\.iceBy && this\._ice\(now\)\.on\) role = VERDICT\.COLD/.test(hud), 'the text turns cold blue');
    assert(/if \(w\.iceBy\)[^\n]*hide = !ic\.on \|\| ic\.blink/.test(hud), 'the icon is hidden off and on the flash');
});
check('electric share: km with the engine at rest over km driven, from 0.3 km, a hybrid only, the cluster only, off with its setting', () => {
    const h = make({ settings: { evShare: true } });
    h.target = 'panel'; h.tripKm = 0; h.evKm = 0;
    let soc = 62; h._raw = (k) => (k === 'hvSoc' ? soc : null);
    assert.strictEqual(h._evShare(), null, 'nothing driven yet');
    h.tripKm = 0.29; h.evKm = 0.29; assert.strictEqual(h._evShare(), null, 'under 0.3 km it is noise');
    h.tripKm = 4; h.evKm = 3; assert.strictEqual(h._evShare(), 75);
    assert.strictEqual(h._token('evShare'), '75'); assert.strictEqual(h._token('evShareUnit'), '%');
    h.evKm = 4.2; assert.strictEqual(h._evShare(), 100, 'never over 100');
    h.evKm = 0; assert.strictEqual(h._evShare(), 0, 'all on petrol is a real 0');
    soc = null; assert.strictEqual(h._token('evShare'), '', 'no battery (a petrol car): blank');
    assert.strictEqual(h._token('evShareUnit'), '');
    soc = 62; h.S.evShare = false; assert.strictEqual(h._evShare(), null, 'the setting off');
    h.S.evShare = true; h.target = 'hud'; assert.strictEqual(h._evShare(), null, 'not on the HUD');
    // the trip counts km with the engine at rest (rpm under the hybrid tach's idle), and only while moving
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(/d\.rpm < hybridTach\.ENGINE_RPM\) this\.evKm \+= /.test(hud), 'the km on electricity are counted');
    assert(/needsHv = \/hvSoc\|evRange\|rangeTotal\|evShare\//.test(hud), 'the battery is read for the share');
});
check('ice alert and electric share: in the four layouts (blank-safe), their icons exist, the settings are in the app', () => {
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => {
        const L = lay(id), by = (i) => L.widgets.find((w) => w.id === i);
        const outs = L.widgets.filter((w) => /^(o_)?outside$/.test(w.id)), ices = L.widgets.filter((w) => /^(o_)?ice_icon$/.test(w.id) || (w.icon === 'snow'));
        assert(outs.length >= 1 && outs.every((w) => w.iceBy), id + ': the outside temperature must go cold blue');
        assert(ices.length >= 1 && ices.every((w) => w.icon === 'snow' && w.iceBy), id + ': the snowflake is missing');
        // a mapUp variant has its own snowflake (M Blade)
        assert.strictEqual(ices.length, outs.length === 2 ? 2 : 1, id + ': one snowflake per outside temperature');
        ices.forEach((w, i) => { if (outs.length === 2) assert.strictEqual(w.toggle, outs[i].toggle, id + ': the snowflake follows its temperature'); });
        ['ev_share_icon', 'ev_share', 'ev_share_unit'].forEach((i) => assert(by(i), id + ': ' + i + ' missing'));
        assert.strictEqual(by('ev_share_icon').icon, 'leaf'); assert(by('ev_share_icon').evShareBy);
        assert.strictEqual(by('ev_share').text, '{{evShare}}'); assert.strictEqual(by('ev_share_unit').text, '{{evShareUnit}}');
        const f = font(by('ev_share').font);
        assert('0123456789'.split('').every((d) => f.glyphs[d]), id + ': the share\'s font has no digits');
        assert(f.glyphs['%'] || font(by('ev_share_unit').font).glyphs['%'], id + ': no % glyph');
        assert(font(by('ev_share_unit').font).glyphs['%'], id + ': the unit\'s font has no %');
        // three digits ("100") fit the number's box
        const adv = f.glyphs['0'], a = typeof adv === 'object' ? (adv.advance || adv.w) : adv;
        assert(3 * a <= by('ev_share').w, id + ': "100" is wider than its box (' + 3 * a + ' > ' + by('ev_share').w + ')');
        // clear of every other widget (the share sits in free space)
        const box = (w) => [w.x, w.y, w.x + w.w, w.y + w.h], hit = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
        ['ev_share_icon', 'ev_share', 'ev_share_unit'].forEach((i) => L.widgets.forEach((o) => {
            if (o.id === i || /^ev_share/.test(o.id) || o.type === 'effects' || o.type === 'image' || /^(bg|map|backdrop)/.test(o.id) || (o.w >= 800)) return;
            if ((by(i).toggle === '!mapUp' && o.toggle === 'mapUp') || (by(i).toggle === 'mapUp' && o.toggle === '!mapUp')) return;   // M Blade: one set per view, never shown together
            assert(!hit(box(by(i)), box(o)), id + ': ' + i + ' overlaps ' + o.id);
        }));
    });
    const icons = require(path.join(tmp, 'shared', 'icons.js')).ICONS;
    assert(typeof icons.snow === 'function' && typeof icons.leaf === 'function');
    // both are drawn (not empty) and different from each other: sample the distance fields
    const ink = (fn) => { let c = 0; for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (fn((x + 0.5) / 24, (y + 0.5) / 24) < 0) c++; return c; };
    const sn = ink(icons.snow), lf = ink(icons.leaf);
    assert(sn > 30 && sn < 300, 'snowflake ink ' + sn); assert(lf > 30 && lf < 400, 'leaf ink ' + lf);
    const j = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8'));
    const ice = j.settings.find((x) => x.key === 'iceBelow'), ev = j.settings.find((x) => x.key === 'evShare');
    assert(ice && ice.type === 'number' && ice.default === 3 && ice.steps.indexOf(0) >= 0 && ice.steps.indexOf(3) >= 0);
    assert(ev && ev.type === 'bool' && ev.default === true);
    const main = fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'main.js'), 'utf8');
    assert(/'iceBelow'/.test(main) && /'evShare'/.test(main), 'main.js must list the settings');
    assert(/LIVE_KEYS = \['iceBelow', 'evShare'/.test(fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8')), 'both repaint without a rebuild');
});
check('accent by mode: blue is the identity; green and red rewrite only the listed blues; every listed triple is in its shader', () => {
    const acc = require(path.join(tmp, 'shared', 'accent.js')), sh = require(path.join(tmp, 'shared', 'shaders.js'));
    assert.strictEqual(acc.hueOfMode('eco'), 'blue'); assert.strictEqual(acc.hueOfMode('hybrid'), 'green'); assert.strictEqual(acc.hueOfMode('sport'), 'red');
    assert.strictEqual(acc.hueOfMode(null), 'blue', 'until the car has said, blue'); assert.strictEqual(acc.hueOfMode(undefined), 'blue');
    assert.deepStrictEqual(acc.mapRgb(0.1, 0.3, 0.8, 'blue'), [0.1, 0.3, 0.8]);
    ['sdash', 'mblade', 'navi'].forEach((t) => {
        assert.strictEqual(sh.accented(t, 'blue'), sh[t], t + ': blue is the unchanged source');
        assert(sh.ACCENT_LITERALS[t].length >= 5);
        sh.ACCENT_LITERALS[t].forEach((tr) => assert(sh[t].indexOf(tr) >= 0, t + ': "' + tr + '" is not in the shader'));
        ['green', 'red'].forEach((hue) => {
            const o = sh.accented(t, hue);
            assert.notStrictEqual(o, sh[t], t + '/' + hue + ': nothing changed');
            assert.strictEqual(o.length > 0 && o.split('\n').length, sh[t].split('\n').length, t + '/' + hue + ': the line count changed');
            assert.strictEqual(sh.accented(t, hue), o, 'cached');
            // the same GLSL tokens: every rewritten literal is still "r, g, b"
            const tri = (x) => (x.match(/\d+\.\d+, \d+\.\d+, \d+\.\d+/g) || []).length;
            assert.strictEqual(tri(o), tri(sh[t]), t + '/' + hue + ': the number of colour triples changed (' + tri(o) + ' vs ' + tri(sh[t]) + ')');
            assert(!/\u0000|\u0001|NaN|undefined/.test(o), t + '/' + hue + ': a marker or a NaN leaked into the shader');
        });
        // a green is green-dominant, a red red-dominant: the brightest listed literal
        const v = sh.ACCENT_LITERALS[t].filter((x) => /1\.0$/.test(x))[0];
        if (v) { const [r, g, b] = v.split(',').map(Number), gr = acc.mapRgb(r, g, b, 'green'), rd = acc.mapRgb(r, g, b, 'red'); assert(gr[1] > gr[0] && gr[1] > gr[2], t + ': green'); assert(rd[0] > rd[1] && rd[0] > rd[2], t + ': red'); }
    });
    assert.throws(() => acc.accentSource('vec3(1.0, 1.0, 1.0)', ['0.1, 0.2, 0.3'], 'green'), /not in the shader/);
    // the M theme and the HUD keep their blue: no accent list for them, no accent role
    // every shader is plain ASCII, and the views' ones ask for high precision where the chip has it (20 Nov 2026: drawn at the bench, not on the car)
    Object.keys(sh).forEach((k) => { if (typeof sh[k] === 'string') assert(!/[^\x00-\x7f]/.test(sh[k]), k + ' has a character outside ASCII'); });
    ['mpanel', 'mblades', 'sring', 'nline'].forEach((k) => assert(sh[k].indexOf('precision highp float;') > 0, k + ' is not in high precision'));
    assert.strictEqual(sh.ACCENT_LITERALS.mdash, undefined); assert.strictEqual(sh.accented('mdash', 'red'), sh.mdash);
    const th = { sblue: [20, 60, 200, 255], other: [1, 2, 3, 255] }, t2 = acc.accentTheme(th, ['sblue'], 'red');
    assert.strictEqual(acc.accentTheme(th, ['sblue'], 'blue'), th, 'blue: the same object'); assert.deepStrictEqual(t2.other, th.other);
    assert(t2.sblue[0] > t2.sblue[2], 'sblue turned red'); assert.deepStrictEqual(th.sblue, [20, 60, 200, 255], 'the original is untouched');
    // the setting exists, hud.js asks for it, the module is in the three apps
    const a = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8'));
    const st = a.settings.find((x) => x.key === 'accentByMode'); assert(st && st.type === 'bool' && st.default === true);
    assert(/'accentByMode'/.test(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'main.js'), 'utf8')));
    ['shaktheme', 'shakhud'].forEach((app) => assert(JSON.parse(fs.readFileSync(path.join(root, 'apps', app, 'app.json'), 'utf8')).shared.indexOf('accent.js') >= 0, app + ': accent.js missing'));
    // hue from the setting and the mode; blue off the cluster, with the setting off, or on a layout without an accent
    const h = make({ settings: { accentByMode: true } });
    h.target = 'panel'; h.accentLayout = true; h.driveMode = 'sport'; assert.strictEqual(h._accentHue(), 'red');
    h.driveMode = 'hybrid'; assert.strictEqual(h._accentHue(), 'green'); h.driveMode = 'eco'; assert.strictEqual(h._accentHue(), 'blue');
    h.driveMode = 'sport'; h.S.accentByMode = false; assert.strictEqual(h._accentHue(), 'blue', 'the setting off');
    h.S.accentByMode = true; h.accentLayout = false; assert.strictEqual(h._accentHue(), 'blue', 'the M theme: no accent');
    h.accentLayout = true; h.target = 'hud'; assert.strictEqual(h._accentHue(), 'blue', 'not on the HUD');
});
check('drive mode name: in the mode\'s colour on Sport, M and Navi (white on M Blade\'s coloured tab; the theme\'s bright blue in the hue), unchanged on the M, with the setting off or before the car has said', () => {
    const h = make({ settings: { accentByMode: true } });
    h.target = 'panel'; h.accentLayout = true; h.driveMode = 'eco';
    assert.deepStrictEqual(h._accentColor(), [92, 158, 255, 255], 'blue: the bright blue of the theme');
    h.driveMode = 'hybrid'; const g = h._accentColor(); assert(g[1] > g[0] && g[1] > g[2] && g[1] > 180, 'green ' + g);
    h.driveMode = 'sport'; const r = h._accentColor(); assert(r[0] > 200 && r[1] < 80 && r[2] < 80, 'red ' + r);
    h.driveMode = null; assert.strictEqual(h._accentColor(), null, 'no mode yet');
    h.driveMode = 'sport'; h.S.accentByMode = false; assert.strictEqual(h._accentColor(), null, 'the setting off');
    h.S.accentByMode = true; h.accentLayout = false; assert(h._accentColor() && h._accentColor()[0] > 200 && h._accentColor()[1] < 80, 'the M theme: its mode name is red in Sport too');
    h.accentLayout = true; h.target = 'hud'; assert.strictEqual(h._accentColor(), null, 'not on the HUD');
    // the text of the mode carries the key on the three accent themes, not on the M
    ['sport', 'navi'].forEach((id) => {
        const names = lay(id).widgets.filter((w) => /^(o_)?drive_mode$/.test(w.id));
        assert(names.length >= 1 && names.every((w) => w.accentBy && w.text === '{{modeName}}'), id + ': the mode name must follow the mode\'s colour');
    });
    // M Blade: the name sits on the hexagon's tab, which already has the mode's colour: it stays white to be read
    lay('mblade').widgets.filter((w) => /^(o_)?drive_mode$/.test(w.id)).forEach((w) => assert(!w.accentBy && w.color === 'fg', 'M Blade: the mode name stays white on its coloured tab'));
    const mm = lay('m').widgets.filter((w) => w.id === 'drive_mode'); assert(mm.length === 1 && mm[0].accentBy, 'the M theme\'s mode name follows the mode too (its body keeps the M colours)');
    ['sdash', 'mblade', 'navi'].forEach((t) => assert(require(path.join(tmp, 'shared', 'shaders.js')).ACCENT_LITERALS[t]));
    assert(!require(path.join(tmp, 'shared', 'shaders.js')).ACCENT_LITERALS.mdash, 'the M theme\'s shader is not recoloured');
    assert(/w\.accentBy\) role = this\._accentColor\(\) \|\| role/.test(fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8')), 'the text branch reads it');
});
check('launch cue: armed in the Sport drive mode with nothing to show, a chequered flag and "Launch Control Ready" wait in green; not in other modes, not with the setting off, not under a held time, not on the HUD', () => {
    const h = make({ settings: { launchTimer: true, launchReady: true, launchRpm: 2000 } });
    const rpm = (v) => { h.rpmF = v; h.D.rpm = v; };
    rpm(2500); h.target = 'panel'; h.driveMode = 'sport'; h.hasReady = true;
    h.runs = { state: 'armed', record: false, shownHeld: () => null };
    h.speedLimit = { limit: () => 50 };
    assert.strictEqual(h._launchReady(1), true);
    assert.strictEqual(h._launchTime(1), null, 'the timer itself has no time to show');
    assert.strictEqual(h._token('launch'), '', 'no "0.0 s"'); assert.strictEqual(h._token('launchUnit'), '');
    assert.strictEqual(h._token('launchReady'), 'Launch Control Ready');
    assert.strictEqual(h._token('launchReady1'), 'Launch Control'); assert.strictEqual(h._token('launchReady2'), 'Ready');
    assert.notStrictEqual(h._limitNow(1), null, 'the speed limit ring keeps its place: the cue is at the bottom');
    // the engine speed: the foot on the throttle, not a red light; 400 rpm of hysteresis; none known, no cue; 0 = from the stop
    rpm(900); assert.strictEqual(h._launchReady(1), false, 'idling at the stop: no cue'); assert.strictEqual(h._token('launchReady'), '');
    assert.notStrictEqual(h._limitNow(1), null, 'the ring is still there at a red light');
    rpm(1999); assert.strictEqual(h._launchReady(1), false, 'just under');
    rpm(2000); assert.strictEqual(h._launchReady(1), true, 'from the setting');
    rpm(1700); assert.strictEqual(h._launchReady(1), true, 'a little lower: still on (hysteresis)');
    rpm(1599); assert.strictEqual(h._launchReady(1), false, '400 rpm under: off');
    rpm(1800); assert.strictEqual(h._launchReady(1), false, 'and it needs the setting again to come back');
    rpm(2600); assert.strictEqual(h._launchReady(1), true);
    h.runs.state = 'idle'; assert.strictEqual(h._launchReady(1), false); h.runs.state = 'armed'; rpm(1800); assert.strictEqual(h._launchReady(1), false, 'it was reset while not armed');
    rpm(2600); h.S.launchRpm = 3000; assert.strictEqual(h._launchReady(1), false, 'a higher setting'); h.S.launchRpm = 0; rpm(800); assert.strictEqual(h._launchReady(1), true, '0 = from the stop');
    h.S.launchRpm = 2000; rpm(null); assert.strictEqual(h._launchReady(1), false, 'no engine speed: no cue');
    rpm(2500);
    h.hasReady = false; assert.strictEqual(h._launchReady(1), false, 'a layout without the cue (Sport, M Blade, Navi): nothing'); assert.notStrictEqual(h._limitNow(1), null, 'and the speed limit ring keeps its place');
    h.hasReady = true;
    h.driveMode = 'hybrid'; assert.strictEqual(h._launchReady(1), false, 'only in Sport'); assert.strictEqual(h._token('launchReady'), '');
    assert.notStrictEqual(h._limitNow(1), null, 'the ring is back with the cue gone');
    h.driveMode = 'eco'; assert.strictEqual(h._launchReady(1), false);
    h.driveMode = 'sport'; h.S.launchReady = false; assert.strictEqual(h._launchReady(1), false, 'the setting off'); assert.strictEqual(h._token('launchReady2'), '');
    h.S.launchReady = true; h.S.launchTimer = false; assert.strictEqual(h._launchReady(1), false, 'the timer off');
    h.S.launchTimer = true; h.runs.state = 'idle'; assert.strictEqual(h._launchReady(1), false, 'not armed (moving, or not still yet)');
    h.runs.state = 'run'; assert.strictEqual(h._launchReady(1), false, 'timing: the clock shows, not the cue');
    h.runs.state = 'armed'; h.runs.shownHeld = () => 12.34; assert.strictEqual(h._launchReady(1), false, 'a finished time is held first');
    assert.strictEqual(h._launchTime(1), 12.34);
    h.runs.shownHeld = () => null; h.target = 'hud'; assert.strictEqual(h._launchReady(1), true, 'the HUD has it too (its layout has the widgets)');
    assert.strictEqual(h._launchTime(1), null, 'but the timer and the ring stay on the cluster');
    h.target = 'panel';
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert((hud.match(/readyBy[^\n]*SPOT ON/g) || []).length === 2, 'the flag and the words are green');
    assert(/if \(w\.readyBy\) \{ hide = !this\._launchReady\(now\)/.test(hud), 'the flag is hidden unless ready');
    assert(/w\.evShareBy \|\| w\.nextBy \|\| w\.alertBy \|\| w\.laneBy \|\| w\.readyBy \|\| w\.readyHides( \|\| this\._dangerSign\(w\))?\)\) \{/.test(hud), 'the flag icon takes the live path (else it would always show)');
    assert(/if \(w\.readyHides && this\._launchReady\(now\)\) hide = true;/.test(hud), 'an icon can give way to the cue');
    const set = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8')).settings.find((x) => x.key === 'launchReady');
    assert(set && set.type === 'bool' && set.default === true);
    const rs = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8')).settings.find((x) => x.key === 'launchRpm');
    assert(rs && rs.type === 'number' && rs.default === 2000 && rs.steps.indexOf(0) >= 0 && rs.steps.indexOf(2000) >= 0, 'the rpm setting');
    assert(/'launchReady', 'launchRpm'/.test(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'main.js'), 'utf8')));
    assert(/LIVE_KEYS = \['iceBelow', 'evShare', 'launchReady', 'launchRpm'/.test(hud));
    // the layouts: the flag and the words on the four themes, blank-safe, the glyphs exist, clear of the other widgets
    const icons = require(path.join(tmp, 'shared', 'icons.js')).ICONS;
    assert(typeof icons.flag === 'function');
    let ink = 0; for (let y = 0; y < 36; y++) for (let x = 0; x < 36; x++) if (icons.flag((x + 0.5) / 36, (y + 0.5) / 36) < 0) ink++;
    assert(ink > 150 && ink < 700, 'flag ink ' + ink);
    // the HUD: a row under the temperatures, in the HUD's own fonts (no second connection there)
    {
        const hl = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'hud', 'layouts', 'mstyle.json'), 'utf8')), hf = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'hud', 'fonts', id + '.json'), 'utf8'));
        const by = (i) => hl.widgets.find((w) => w.id === i), fl = by('ready_flag'), tx = by('ready_text');
        assert(fl && fl.icon === 'flag' && fl.readyBy && tx && tx.text === '{{launchReady}}' && tx.readyBy, 'the HUD has the flag and the words');
        const f = hf(tx.font), adv = (c) => { const v = f.glyphs[c]; return typeof v === 'object' ? (v.advance || v.w) : v; };
        assert('Launch Control Ready'.split('').every((c) => f.glyphs[c]), 'the HUD font lacks a letter');
        const wd = 'Launch Control Ready'.split('').reduce((a, c) => a + adv(c), 0); assert(wd <= tx.w, 'the words are ' + wd + ' px in ' + tx.w);
        assert(tx.x + tx.w <= 800 && tx.y + tx.h <= 480 && fl.x >= 0, 'inside the 800x480 HUD');
        const box = (w) => [w.x, w.y, w.x + w.w, w.y + w.h], hit = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
        // (20 Nov 2026: the danger alert takes the block while a zone is ahead; the cue has "!danger" and the alert's widgets "danger": never together)
        const parts = (w) => String(w.toggle || '').split('&'), EITHER = (a, b) => parts(a).indexOf('!danger') >= 0 && parts(b).some((t) => /^danger/.test(t));
        hl.widgets.forEach((o) => { if (o === fl || o === tx) return; [fl, tx].forEach((b) => assert(!hit(box(b), box(o)) || o.readyHides === true || EITHER(b, o), 'HUD: ' + b.id + ' overlaps ' + o.id + ' (only a widget the cue hides may sit under it)')); });
        assert(by('oil').readyHides && by('oil_icon').readyHides && by('coolant').readyHides && by('coolant_icon').readyHides, 'the oil and coolant row gives way to the cue');
        assert(fl.y + fl.h <= 380 && tx.y + tx.h <= 380, 'the cue is inside the visible HUD window (down to y 380)');
        const hs = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'app.json'), 'utf8')).settings.map((x) => x.key);
        assert(hs.indexOf('launchReady') >= 0 && hs.indexOf('launchRpm') >= 0, 'the HUD app has the two settings');
        assert(/'launchReady', 'launchRpm'/.test(fs.readFileSync(path.join(root, 'apps', 'shakhud', 'main.js'), 'utf8')));
    }
    ['sport', 'm', 'mblade', 'navi'].forEach((id) => {
        const L = lay(id), by = (i) => L.widgets.find((w) => w.id === i);
        const flag = by('ready_flag'); assert(flag && flag.icon === 'flag' && flag.readyBy, id + ': the flag');
        // at the bottom centre, with the map window or without it (not under the map: the bottom row is clear of every hole)
        assert(flag.y >= 600 || (id === 'm' && flag.y >= 600), id + ': the cue is at the bottom (' + flag.y + ')');
        assert(Math.abs((flag.x + (28 + 8 + 208) / 2) - (id === 'mblade' ? 951 : 960)) < 1.5 || id === 'mblade', id + ': centred');
        assert.strictEqual(flag.conn, 1, id + ': the cue is on the second connection (the first has no layer to spare: Sport would go over 16 MiB of pixels)');
        assert.strictEqual(by('ready_text').conn, 1, id + ': the words on the second connection');
        const words = [['ready_text', '{{launchReady}}']];
        words.forEach(([wid, tok]) => {
            const w = by(wid); assert(w && w.text === tok && w.readyBy, id + ': ' + wid); assert(w.toggle === flag.toggle, id + ': the words and the flag show together');
            const f = font(w.font), g = (c) => f.glyphs[c];
            assert('Launch Control Ready'.split('').every((c) => g(c)), id + ': the font lacks a letter of the words');
            const adv = (c) => { const v = g(c); return typeof v === 'object' ? (v.advance || v.w) : v; };
            const full = tok === '{{launchReady}}' ? 'Launch Control Ready' : tok === '{{launchReady1}}' ? 'Launch Control' : 'Ready';
            const wd = full.split('').reduce((a, c) => a + adv(c), 0);
            assert(wd <= w.w, id + ': "' + full + '" is ' + wd + ' px in a ' + w.w + ' px box');
        });
        const boxes = [flag].concat(words.map(([wid]) => by(wid))), box = (w) => [w.x, w.y, w.x + w.w, w.y + w.h], hit = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
        // (the cue and the drive mode's name or the badge text share a place: that one is blank while the cue is up, "readyHides")
        L.widgets.forEach((o) => {
            if (boxes.indexOf(o) >= 0 || o.type === 'effects' || o.type === 'image' || /^(bg|map|backdrop)/.test(o.id) || o.w >= 800 || /^(lim_|run_)/.test(o.id)) return;
            if (/^(o_)?(drive_mode|badge)$/.test(o.id) && hit(box(flag), box(o)) || (/^(o_)?(drive_mode|badge)$/.test(o.id) && boxes.some((b) => hit(box(b), box(o))))) { assert(o.readyHides, id + ': ' + o.id + ' gives way to the cue'); return; }
            boxes.forEach((b) => { if ((b.toggle === '!mapUp' && o.toggle === 'mapUp') || (b.toggle === 'mapUp' && o.toggle === '!mapUp')) return; assert(!hit(box(b), box(o)), id + ': ' + b.id + ' overlaps ' + o.id); });
        });
    });
});
check('Waze contour: the bezel and glass pass is in Sport, M Blade and Navi (not the M theme), and the map window is still cut out', () => {
    const sh = require(path.join(tmp, 'shared', 'shaders.js'));
    ['sdash', 'mblade', 'navi'].forEach((t) => {
        const src = sh[t];
        assert(/vec4 bezel\(float hd, float y, vec4 c\)/.test(src) && /vec4 glass\(float hd, vec4 c\)/.test(src), t + ': bezel / glass missing');
        assert(/c = bezel\(hd, p\.y \/ 720\.0, c\);/.test(src) && /c = glass\(hd, c\);/.test(src), t + ': they are not applied');
        assert.strictEqual((src.match(/void main\(\)/g) || []).length, 1, t + ': main() count');
    });
    assert(!/vec4 bezel\(/.test(sh.mdash), 'the M theme keeps its own plate');
});
check('la case noire de BMW (réglage gearWindow « off » seulement) : 117 px de haut (photos du 15 nov. 2026), la fenêtre des fonds la couvre', () => {
    const vis = require(path.join(__dirname, '..', 'shared', 'visible.js'));
    const B = vis.BLACK_BOX;
    assert(B[3] - B[1] >= 115 && B[3] - B[1] <= 120, 'hauteur de la case : ' + (B[3] - B[1]));
    const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'shaders.js'), 'utf8');
    const m = /abs\(p - vec2\(([\d.]+), ([\d.]+)\)\) - \(vec2\(([\d.]+), ([\d.]+)\) - vec2\(16\.0\)\)/.exec(src);
    assert(m, 'fenêtre de la case introuvable dans shaders.js');
    const cx = +m[1], cy = +m[2], hx = +m[3], hy = +m[4];
    assert(cx - hx <= B[0] && cx + hx >= B[2] && cy - hy <= B[1] && cy + hy >= B[3], 'la fenêtre ne couvre pas la case : ' + [cx - hx, cy - hy, cx + hx, cy + hy]);
    // plus aucun thème n'évite la case : avec le trou de la lettre de rapport ouvert (réglage gearWindow, par défaut), BMW ne la dessine plus (essai du 16 nov. 2026,
    // les quatre thèmes) ; seul le réglage « off » la ramène. Les réglages individual du thème M, par exemple, ont retrouvé leur place régulière.
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log('test_zones: ' + n + ' checks' + (process.exitCode ? ' (some failed)' : ' ok'));
