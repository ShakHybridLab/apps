'use strict';
// The hybrid rev counter (M Blade's blade, Sport's rev bracket): the decision in shared/hybrid_tach.js, and who asks for it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { state, ENGINE_RPM, CHARGE_KW } = require('../shared/hybrid_tach');
let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }
const root = path.join(__dirname, '..');
const layout = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', id + '.json'), 'utf8'));

check('engine running: rpm alone, never blue, whatever the power', () => {
    [[50, 3000], [-30, 2200], [0, ENGINE_RPM], [10, 7000]].forEach(([kw, rpm]) => {
        const s = state(kw, rpm);
        assert(!s.engineOff && !s.ev, kw + ' kW at ' + rpm + ' rpm');
    });
});
check('engine off, battery driving: ev, with its power', () => {
    [[35, 0], [0, 0], [82, 100], [0.5, ENGINE_RPM - 1]].forEach(([kw, rpm]) => {
        const s = state(kw, rpm);
        assert(s.engineOff && s.ev && s.chg === 0 && s.kw === kw, kw + ' kW at ' + rpm + ' rpm');
    });
});
check('charging: 0..1 over CHARGE_KW, nothing under 1 kW, with or without the engine', () => {
    assert.strictEqual(state(-CHARGE_KW / 2, 0).chg, 0.5);
    assert.strictEqual(state(-500, 0).chg, 1);
    assert.strictEqual(state(-0.5, 0).chg, 0);
    assert.strictEqual(state(-1, 0).chg, 1 / CHARGE_KW);
    assert(!state(-30, 0).ev, 'charging is not driving');
    assert.strictEqual(state(-30, 2500).chg, 0.5);                       // the engine charging: the foot / bar still know
    assert(state(-30, 2500).engineOff === false);
});
check('no shared power (a combustion car, no eDrive Live, a held last read): rpm alone', () => {
    [null, undefined, NaN, Infinity, '12'].forEach((kw) => {
        const s = state(kw, 0);
        assert(!s.ev && s.chg === 0 && s.kw === null, String(kw));
    });
});
check('an unknown rpm never counts as the engine being off', () => {
    [null, undefined, NaN].forEach((rpm) => {
        const s = state(40, rpm);
        assert(!s.engineOff && !s.ev, String(rpm));
    });
});
check('who asks: M Blade (both blades) and Sport yes; M and Navi no', () => {
    layout('mblade').widgets.filter((w) => w.type === 'mblade').forEach((w) => assert(w.hybridTach === true, w.id));
    const sp = layout('sport').widgets.find((w) => w.type === 'sdash');
    assert(sp.hybridTach === true && sp.chgOnBar === true, 'Sport asks for it and shows the charge on its bracket');
    ['m', 'navi'].forEach((id) => layout(id).widgets.forEach((w) => assert(!w.hybridTach, id + ' ' + w.id)));
});
check('Sport: the rev caption is the unit token, a CHARGE note sits left of it, letters in the font', () => {
    const L = layout('sport');
    const cap = L.widgets.find((w) => w.id === 'rpm_cap'), note = L.widgets.find((w) => w.id === 'charge_note');
    assert(cap && cap.text === '{{tachUnit}}' && note && note.text === '{{chargeNote}}');
    assert(note.x + note.w <= cap.x + 10 && note.y === cap.y, 'the note is not beside the caption');
    const f = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'fonts', cap.font + '.json'), 'utf8')).glyphs;
    '1/min x 1000kW x 10CHARGE'.split('').forEach((ch) => assert(f[ch], cap.font + ' lacks "' + ch + '"'));
});
check('the module ships with both apps that bundle hud.js, and hud.js uses it', () => {
    ['shaktheme', 'idrive_hud_widgets'].forEach((a) => {
        const j = JSON.parse(fs.readFileSync(path.join(root, 'apps', a, 'app.json'), 'utf8'));
        const list = JSON.stringify(j);
        assert(list.includes('"hybrid_tach.js"'), a + ' app.json does not list hybrid_tach.js');
    });
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(hud.includes("require('./hybrid_tach')") && hud.includes('_hybridTach('), 'hud.js does not use it');
    assert(!/HYBRID_(ENGINE_RPM|CHARGE_KW|CHARGE_MIN_KW)/.test(hud.replace(/\/\/.*$/gm, '')), 'hud.js still carries the old constants');
});
console.log('hybrid_tach: ' + n + ' checks' + (process.exitCode ? ' (some failed)' : ' pass'));
