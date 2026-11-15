'use strict';
// The signals the app only reads (shared/probes.js, the page's Signals tab): declared with the flags the owner's catalog lists, kept and logged
// without flooding, translated, shipped by both apps. node tools/test_probes.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PROBES, Probes, rawOf, SHOWN, stateOf } = require('../shared/probes');
const fr = require('../shared/fr');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const app = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', n, 'app.json'), 'utf8'));
const theme = app('shaktheme'), hud = app('shakhud');

// "get notify" in the catalog photos is "rs", "notify" alone "s" (a notifier without getter)
const FLAGS = { rpm: 'rs', engt: 'rs', speed: 'rs', sign: 's', next: 'rs', fas: 'rs', fasx: 'rs', wheel: 's', pdrive: 's', pdrive2: 's', pdist: 'rs', cc: 'rs', cbs: 'rs', ccrisk: 'rs' };

check('every probe is declared in ShakTheme\'s app.json with the flags the catalog lists (a signal the car does not have breaks the installation)', () => {
    assert.deepStrictEqual(PROBES.map((p) => p.id).sort(), Object.keys(FLAGS).sort(), 'the probes are not the ones listed here');
    PROBES.forEach((p) => {
        assert(theme.signals[p.iface], p.id + ': interface not declared: ' + p.iface);
        assert.strictEqual(theme.signals[p.iface][p.field], FLAGS[p.id], p.id + ': flags of ' + p.field);
        assert(/^de\.bmw\./.test(p.iface), p.id + ': the interface name starts with de.bmw.');
    });
});
// the three the app draws from itself (régime, températures, vitesse): ShakHUD declares them too, since its rev counter needs them
const OWN = ['rpm', 'engt', 'speed'];
check('ShakHUD declares only the three the app draws from (it asks for no signal it does not use)', () => {
    PROBES.forEach((p) => {
        const has = !!(hud.signals && hud.signals[p.iface] && hud.signals[p.iface][p.field]);
        assert.strictEqual(has, OWN.indexOf(p.id) >= 0, p.id + (has ? ' is declared by ShakHUD' : ' is missing from ShakHUD'));
        if (has) assert.strictEqual(hud.signals[p.iface][p.field], FLAGS[p.id], p.id + ': flags in ShakHUD');
    });
});
check('the three the app draws from come first in the list, so they are the first rows of the Signals tab', () => {
    assert.deepStrictEqual(PROBES.slice(0, 3).map((p) => p.id), OWN);
});
check('a handler added for a field the car reads itself runs after the car\'s own: the rev counter keeps its value (kit/runtime/car.js)', () => {
    const Car = require('../kit/runtime/car');
    const seen = {}, got = [];
    const ctx = {
        log: { info() {}, warn() {} }, spec: { config: {} }, settings: { get: () => 'off' },
        signals: { watch: (iface, v, handlers) => { seen[iface] = handlers; return Promise.resolve({ iface, available: true }); } },
    };
    const CDS = 'de.bmw.infotainment.vehicle.CDS';
    const car = new Car(ctx, ['rpm', 'speed'], { [CDS]: { statusEngineSpeed2: (v) => got.push(v), other: () => {} } });
    seen[CDS].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 8000 });          // 8000 x 0.25 = 2000 rpm
    assert.strictEqual(car.data().rpm, 2000, 'the car lost its own rpm handler');
    assert.strictEqual(got.length, 1, 'the added handler did not run');
    assert.strictEqual(got[0].actualValueRPMEngineCrankshaft, 8000);
    seen[CDS].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 65535 });         // the car's "no value": the rpm stays, the added handler still hears it
    assert.strictEqual(car.data().rpm, 2000);
    assert.strictEqual(got.length, 2);
    assert.strictEqual(typeof seen[CDS].other, 'function', 'a field only the added handler knows is lost');
    car.subs.length = 0;
});
check('the build gives the app its declared signals (ctx.spec.signals): without them none of the probes, nor the camera\'s road signs, was ever read on the car', () => {
    const build = fs.readFileSync(path.join(__dirname, '..', 'kit', 'tools', 'build.py'), 'utf8');
    assert(/rt_spec = \{k: spec\.get\(k\) for k in \([^)]*'signals'\)/.test(build), 'build.py leaves signals out of app-spec.json');
    const hudJs = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    assert(/const decl = \(this\.ctx\.spec && this\.ctx\.spec\.signals\) \|\| \{\};/.test(hudJs), 'hud.js no longer reads ctx.spec.signals');
});
check('both apps ship probes.js, and ShakTheme has the Signals tab', () => {
    assert(theme.shared.indexOf('probes.js') >= 0 && hud.shared.indexOf('probes.js') >= 0, 'probes.js is not in a "shared" list');
    assert(/tabs: \[[^\]]*'signals'/.test(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shaktheme', 'main.js'), 'utf8')), 'no signals tab in main.js');
});
check('the page texts are in French, with their accents', () => {
    PROBES.forEach((p) => { assert.notStrictEqual(fr.tr(p.name), p.name, p.name + ': no French'); });
    ['Car signals', 'Signals of the car, read only', 'Not heard yet', 'Photograph this page after a drive: it shows the last values the car sent.',
        'Read only: nothing here changes the car.', '(empty)'].forEach((s) => assert.notStrictEqual(fr.tr(s), s, s + ': no French'));
    assert.strictEqual(fr.tr('3 of 11 read'), '3 sur 11 lus');
});
check('a value is kept newest first, three at most, a repeat changes nothing, and `heard` counts the probes heard', () => {
    const p = new Probes(null);
    assert.strictEqual(p.get('cc'), null); assert.strictEqual(p.heard(), 0);
    assert.strictEqual(p.feed('cc', { a: 1, b: 'x' }, 1000), true);
    assert.strictEqual(p.feed('cc', { a: 1, b: 'x' }, 1100), false);
    ['2', '3', '4'].forEach((a, i) => p.feed('cc', { a }, 2000 + i));
    const d = p.get('cc');
    assert.deepStrictEqual(d.vals, ['a=4', 'a=3', 'a=2']); assert.strictEqual(d.n, 5); assert.strictEqual(d.at, 2002);
    p.feed('cbs', null, 3000); assert.strictEqual(p.heard(), 1, 'a null reading is not a value'); p.feed('cbs', {}, 3000); assert.deepStrictEqual(p.get('cbs').vals, ['(empty)']); p.by.cbs = undefined;
    p.feed('pdist', { x: 1 }, 3000); assert.strictEqual(p.heard(), 2);
    assert.strictEqual(SHOWN.length, PROBES.length);
});
check('the log gets the first 12 distinct values, then one a minute, and never more than two a second', () => {
    const lines = [], p = new Probes({ info: (s) => lines.push(s) });
    for (let i = 0; i < 40; i++) p.feed('pdrive', { q: i }, 1000 + i * 600);          // a new value each 0.6 s
    assert.strictEqual(lines.length, 12, 'the first 12 only: ' + lines.length);
    assert(/^signal pdrive: q=0$/.test(lines[0]), lines[0]);
    p.feed('pdrive', { q: 99 }, 1000 + 40 * 600 + 30000); assert.strictEqual(lines.length, 12, 'a minute not up');
    p.feed('pdrive', { q: 100 }, 1000 + 12 * 600 + 61000); assert.strictEqual(lines.length, 13, 'one after a minute');
    const f = new Probes({ info: (s) => lines.push(s) }); const n = lines.length;
    for (let i = 0; i < 10; i++) f.feed('cc', { z: i }, 5000 + i * 100);                // ten changes in a second: two lines at most
    assert(lines.length - n <= 2, 'flooded: ' + (lines.length - n));
});
check('a value is one line of key=value, long ones cut', () => {
    assert.strictEqual(rawOf({ a: 1.123456789, b: 'x' }), 'a=1.12346 b=x');
    assert(rawOf({ k: 'y'.repeat(100) }).length < 60, 'a long value is not cut');
    assert.strictEqual(rawOf([1, 2]), '[1,2]'); assert.strictEqual(rawOf(null), '');
    assert(rawOf(JSON.parse('[' + '1,'.repeat(400) + '1]')).length <= 500, 'an array is not cut');
});
check('the page redraws the Signals tab by itself (a timer, on that tab only) and the tab list has seven entries that fit above the app\'s mark', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'shared', 'page.js'), 'utf8');
    assert(/this\.sigTimer = setInterval\(\(\) => \{ if \(this\.tab === 'signals'\) this\.kick\(\); \}, 2000\)/.test(page), 'no redraw timer');
    const m = page.match(/const RAIL8 = \{ x: 16, y: 54, w: 252, h: (\d+), gap: (\d+) \}/);
    assert(m, 'no RAIL8');
    const tabs = JSON.parse('[' + /tabs: \[([^\]]*)\]/.exec(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shaktheme', 'main.js'), 'utf8'))[1].replace(/'/g, '"') + ']');
    assert.strictEqual(tabs.length, 7);
    const last = 54 + 6 * (Number(m[1]) + Number(m[2])) + Number(m[1]);          // the bottom of the seventh tab
    assert(last <= 520 - 62 - 6, 'the tabs reach the mark: ' + last);
});
check('a silent probe says why: no subscription yet, refused, error, provider not answering, or subscribed and silent (French too)', () => {
    assert.strictEqual(stateOf(undefined, 'f'), 'Subscribing');
    assert.strictEqual(stateOf({ error: 'no SOME/IP config for x' }, 'f'), 'Error: no SOME/IP config for x');
    assert.strictEqual(stateOf({ failed: { f: 'nope' }, available: true }, 'f'), 'Refused: nope');
    assert.strictEqual(stateOf({ getFailed: { f: 'timeout' }, available: true }, 'f'), 'Read refused: timeout');
    assert.strictEqual(stateOf({ available: false, failed: {}, getFailed: {} }, 'f'), 'The car does not answer');
    assert.strictEqual(stateOf({ available: true, failed: {}, getFailed: { g: 'x' } }, 'f'), 'Subscribed, nothing received');
    assert.strictEqual(fr.tr('Subscribing'), 'Abonnement en cours');
    assert.strictEqual(fr.tr('The car does not answer'), 'La voiture ne répond pas');
    assert.strictEqual(fr.tr('Subscribed, nothing received'), 'Abonné, rien reçu');
    assert.strictEqual(fr.tr('Error: no SOME/IP config for x'), 'Erreur : no SOME/IP config for x');
    assert.strictEqual(fr.tr('Refused: nope'), 'Refusé : nope');
    assert.strictEqual(fr.tr('Read refused: timeout'), 'Lecture refusée : timeout');
});
check('signals.js keeps why a field was refused (failed / getFailed), for the Signals tab', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'kit', 'runtime', 'signals.js'), 'utf8');
    assert(/failed: \{\}, getFailed: \{\}/.test(src) && /res\.failed\[f\] =/.test(src) && /res\.getFailed\[f\] =/.test(src), 'signals.js does not record the refusals');
});
console.log(failed ? failed + ' FAILED' : 'probes: all checks pass');
process.exit(failed ? 1 : 0);
