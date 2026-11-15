'use strict';
// The signals the app only reads (shared/probes.js, the page's Signals tab): declared with the flags the owner's catalog lists, kept and logged
// without flooding, translated, shipped by both apps. node tools/test_probes.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PROBES, Probes, rawOf, SHOWN } = require('../shared/probes');
const fr = require('../shared/fr');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const app = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', n, 'app.json'), 'utf8'));
const theme = app('shaktheme'), hud = app('shakhud');

// "get notify" in the catalog photos is "rs", "notify" alone "s" (a notifier without getter)
const FLAGS = { sign: 's', next: 'rs', fas: 'rs', fasx: 'rs', wheel: 's', pdrive: 's', pdrive2: 's', pdist: 'rs', cc: 'rs', cbs: 'rs', ccrisk: 'rs' };

check('every probe is declared in ShakTheme\'s app.json with the flags the catalog lists (a signal the car does not have breaks the installation)', () => {
    assert.deepStrictEqual(PROBES.map((p) => p.id).sort(), Object.keys(FLAGS).sort(), 'the probes are not the ones listed here');
    PROBES.forEach((p) => {
        assert(theme.signals[p.iface], p.id + ': interface not declared: ' + p.iface);
        assert.strictEqual(theme.signals[p.iface][p.field], FLAGS[p.id], p.id + ': flags of ' + p.field);
        assert(/^de\.bmw\./.test(p.iface), p.id + ': the interface name starts with de.bmw.');
    });
});
check('ShakHUD declares none of them (it asks for no signal it does not use)', () => {
    PROBES.forEach((p) => assert(!(hud.signals && hud.signals[p.iface] && hud.signals[p.iface][p.field]), p.id + ' is declared by ShakHUD'));
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
console.log(failed ? failed + ' FAILED' : 'probes: all checks pass');
process.exit(failed ? 1 : 0);
