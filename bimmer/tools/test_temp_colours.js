'use strict';
// node tools/test_temp_colours.js: the M theme's oil and coolant temperatures (blue while cold, green once warm, flashing red over the
// warning limit; "tempBy" in shared/hud.js), the settings behind them, and that the bottom row clears the hood and the belt light.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const visible = require('../shared/visible');

const root = path.join(__dirname, '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'apps/shaktheme/hud/layouts/m.json'), 'utf8'));
const byId = (id) => m.widgets.find((w) => w.id === id);
assert.strictEqual(byId('oil').tempBy, 'oil'); assert.strictEqual(byId('oil').text, '{{oil}}');
assert.strictEqual(byId('cool').tempBy, 'coolant'); assert.strictEqual(byId('cool').text, '{{coolant}}');
assert.ok(byId('oil_icon') && byId('cool_icon') && byId('oil_unit') && byId('cool_unit'));
assert.ok(!byId('ev_pct') && !byId('ev_pct_unit'), 'the exact % is not in the bottom row (the dial shows it)');
assert.ok(byId('ev_range') && byId('ev_range_unit'), 'the electric range is');

const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/shaktheme/app.json'), 'utf8'));
const item = (k) => app.settings.find((s) => s.key === k);
assert.strictEqual(item('oilCold').default, 75); assert.strictEqual(item('coolantCold').default, 70);
assert.ok(item('oilCold').steps.includes(75) && item('coolantCold').steps.includes(70));

const hud = fs.readFileSync(path.join(root, 'shared/hud.js'), 'utf8');
['w.tempBy', "'oilCold'", "'coolantCold'", 'WARN_DIM', "VERDICT['SPOT ON']", 'VERDICT.COLD'].forEach((s) => assert.ok(hud.includes(s), 'hud.js: ' + s));
assert.ok(/LIVE_KEYS = \[[^\]]*'oilCold'[^\]]*'coolantCold'/.test(hud), 'a threshold change repaints, no rebuild');

// the new widgets: on the panel, under no hood, off the belt light
const mine = ['oil_icon', 'oil', 'oil_unit', 'cool_icon', 'cool', 'cool_unit', 'outside', 'outside_unit', 'ev_icon', 'ev_range', 'ev_range_unit'];
const found = visible.check(m.widgets.filter((w) => mine.includes(w.id)), 'panel');
assert.deepStrictEqual(found, [], 'bottom row: ' + found.join('; '));
// and they do not overlap each other
const boxes = mine.map(byId).filter((w) => w.type === 'text' || w.type === 'icon');
boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
    const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!hit || /_unit$/.test(a.id) || /_unit$/.test(b.id), a.id + ' overlaps ' + b.id);
}));
console.log('test_temp_colours: ok');
