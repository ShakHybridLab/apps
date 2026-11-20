'use strict';
// The two ShakTheme layouts copied from the screenshot: "M Blade" (mblade) and "Navi" (navi). Checks that they are
// listed in every theme setting, carry what the owner asked for (the hybrid battery where the photo has the oil gauge, the
// oil temperature in the free space on the right, the ONE OF ONE lettering (Navi only, centred under the shift light, gone while the Waze window is open),
// the shift light where BMW's own sits), keep clear of BMW's black box, seat-belt light and the hood, and cut the map window
// that Cluster Centre / Cluster Info read. Run: node tools/test_mblade_navi.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const visible = require('../shared/visible');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const app = read('apps/shaktheme/app.json');
const NAMES = ['mblade', 'navi'];
let bad = 0;
function check(what, fn) { try { fn(); } catch (e) { bad++; console.log('FAIL ' + what + ': ' + e.message); } }
const overlap = (w, z) => w.x < z[2] && w.x + w.w > z[0] && w.y < z[3] && w.y + w.h > z[1];

NAMES.forEach((n) => {
    const L = read('apps/shaktheme/hud/layouts/' + n + '.json');
    const by = (id) => L.widgets.find((w) => w.id === id);
    const ofType = (t) => L.widgets.filter((w) => w.type === t);

    check(n + ': listed in the four theme settings', () => {
        ['hudLayout', 'inHybrid', 'inSport', 'inEco'].forEach((k) => {
            const s = app.settings.find((x) => x.key === k);
            assert(s && s.options.some((o) => o[0] === n), k + ' lacks ' + n);
        });
    });
    check(n + ': ids unique, panel layout, every widget inside 1920x720', () => {
        assert.strictEqual(L.schemaVersion, 2);
        const ids = L.widgets.map((w) => w.id);
        assert.strictEqual(new Set(ids).size, ids.length, 'duplicate widget id');
        L.widgets.forEach((w) => { if (typeof w.x === 'number') assert(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= 720, w.id + ' off the panel'); });
    });
    check(n + ': the battery is where the photo has the oil gauge, the oil temperature is its own readout', () => {
        const toks = L.widgets.filter((w) => w.type === 'text').map((w) => w.text);
        // Navi has the battery as a bar of its own (its % shows); M Blade draws it as the strip beside the oil's (no number: the scale 0 / 50 / 100 %)
        (n === 'navi' ? ['{{hvSoc}}', '{{evRange}}', '{{oil}}', '{{rangeTotal}}'] : ['{{evRange}}', '{{oil}}', '{{coolant}}', '{{rangeTotal}}', '{{tc:50}}', '{{tc:100}}', '{{tc:150}}']).forEach((t) => assert(toks.includes(t), 'no ' + t));
        assert(L.widgets.some((w) => w.type === n), 'no ' + n + ' shader widget');
    });
    if (n === 'mblade') {
        check('mblade: hybrid rev counter: both blades ask for it, the unit and the CHARGE note are tokens whose letters the fonts have, the shader reads the charge', () => {
            ['backdrop', 'backdrop_open'].forEach((id) => assert(by(id).hybridTach === true, id + ' does not ask for hybridTach'));
            ['', 'o_'].forEach((pre) => {
                const u = by(pre + 'rpm_unit'), c = by(pre + 'charge_note');
                assert(u && u.text === '{{tachUnit}}' && u.font === 'm_tiny', pre + 'rpm_unit is not the {{tachUnit}} token');
                assert(c && c.text === '{{chargeNote}}' && c.font === 'm_unit', pre + 'charge_note is missing');
                if (!pre) assert(c.x + c.w <= 1030 && c.y >= 585, 'charge_note is not left of the foot, under the hexagon');
                // with the map up the fuel bar runs under the window up to the foot: CHARGE is in the left column, under the speed
                else assert(c.x + c.w <= by('backdrop_open').hole[0] - 10 && c.y >= by('o_speed').y + by('o_speed').h, 'o_charge_note is not in the left column under the speed');
            });
            const glyphs = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shaktheme', 'hud', 'fonts', f + '.json'), 'utf8')).glyphs;
            const tiny = glyphs('m_tiny'), unit = glyphs('m_unit');
            'kW x 10'.split('').forEach((ch) => assert(tiny[ch], 'm_tiny lacks "' + ch + '" (kW x 10)'));
            'CHARGE'.split('').forEach((ch) => assert(unit[ch], 'm_unit lacks "' + ch + '" (CHARGE)'));
            const hud = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8'), sh = fs.readFileSync(path.join(__dirname, '..', 'shared', 'shaders.js'), 'utf8');
            ["require('./hybrid_tach')", "case 'tachUnit'", "case 'chargeNote'", "w.hybridTach === true"].forEach((s) => assert(hud.includes(s), 'hud.js lacks ' + s));
            assert(/uniform vec4 u_red;/.test(sh) && sh.includes('ft < u_red.a'), 'the shader does not read the charge');
        });
        check(n + ': the hexagon as in the photo: the gear letter big in the void, the speed small right under it with its unit beside it, kW below, in both views', () => {
            ['', 'o_'].forEach((pre) => {
                const g = by(pre + 'gear'), s = by(pre + 'speed'), u = by(pre + 'speed_unit'), k = by(pre + 'power');
                assert(g && s && u && k, pre + ': a gear, speed, unit or kW widget is missing');
                assert(g.text === '{{stage}}' && g.font === 'm_gear', pre + 'gear: not the big selector letter');
                assert(s.text === '{{speed}}' && s.font === 'm_spd' && s.align === 'right', pre + 'speed: not the small speed');
                assert(s.y >= g.y + g.h - 10, pre + 'speed is not under the gear letter');
                assert(u.x >= s.x + s.w && Math.abs((u.y + u.h) - (s.y + s.h)) <= 20, pre + 'unit is not beside the speed');
                assert(k.y >= s.y + s.h, pre + 'kW is not below the speed');
            });
        });
        check('mblade: the oil and the battery strips are side by side, aligned (same top, bottom, slope), 130 px apart; the fuel strip has its own', () => {
            ['backdrop', 'backdrop_open'].forEach((id) => {
                const b = by(id);
                assert(b.g0 && b.g1 && b.g2, id + ' lacks a strip');
                assert(b.g1[1] === b.g2[1] && b.g1[2] === b.g2[2] && b.g1[3] === b.g2[3], id + ': oil and battery strips are not aligned');
                assert(Math.abs(b.g2[0] - b.g1[0]) >= 120 && Math.abs(b.g2[0] - b.g1[0]) <= 140, id + ': oil and battery strips are not 130 px apart');
            });
        });
        check('mblade: with the map up the window is inside Waze on cluster\'s slot, the hexagon gives way, the fuel is a flat bar right under the window, the strips and the blade moved right, the window centred on the car', () => {
            const o = by('backdrop_open'), n = by('backdrop');
            const win = [o.hole[0] + o.holeInset, o.hole[1] + o.holeInset, o.hole[0] + o.hole[2] - o.holeInset, o.hole[1] + o.hole[3] - o.holeInset];
            // the hexagon goes to the left column, smaller, with the gear and the speed in it (BMW's own M cluster beside its map, owner's photo of Nov 18
            // 2026); its tabs stay off (the bottom row and the belt light are there)
            assert(o.hex && o.hex[2] > 0 && o.hex[2] < 1 && !o.deco, 'a smaller hexagon without its tabs with the map up');
            assert(o.hex[0] + 570 * o.hex[2] <= win[0], 'the small hexagon runs into the window');
            ['o_gear', 'o_speed'].forEach((id) => assert(by(id).x >= o.hex[0] && by(id).x + by(id).w <= o.hex[0] + 570 * o.hex[2], id + ' is not in the small hexagon'));
            assert(win[0] >= 416 && win[1] >= 120 && win[2] <= 1504 && win[3] <= 600, 'the window leaves Waze on cluster\'s own slot (x 416..1504, y 120..600): ' + win);
            assert(o.fuelH === true && !n.fuelH, 'the fuel bar must be flat with the map up only');
            const left = 1920 - o.g0[2], right = 1920 - o.g0[1];                 // the flat bar, back in panel px
            assert(left >= win[0] && right <= win[2], 'the fuel bar is wider than the window');
            assert(o.g0[0] >= win[3] + 8 && o.g0[0] + 27 <= by('o_time').y - 20, 'the fuel bar is not right under the window, clear of the bottom row');
            assert(o.g1[0] > n.g1[0] && o.g2[0] > n.g2[0] && o.bl[2] > n.bl[2], 'not moved to the right');
            const base = o.bl[2] + o.bl[3] * (o.bl[1] - o.bl[0]);                // the blade's left edge at its foot
            assert(win[2] + 10 <= base, 'the window runs into the blade, whose base starts at x ' + Math.round(base) + ' (' + win[2] + ')');
            // Waze on cluster on the owner's car draws the map in its slot, the car in the middle (x 960): the window is centred on it (photo of Nov 18 2026)
            assert(Math.abs((win[0] + win[2]) / 2 - 960) <= 2, 'the window is not centred on x 960, where Waze puts the car: ' + win);
            const f = ['o_f_lo', 'o_f_mid', 'o_f_hi', 'o_fuel_icon'].map(by);
            assert(f.every((w) => w && w.toggle === 'mapUp' && w.x >= win[0] - 60 && w.x + w.w <= win[2] + 20), 'fuel scale outside the window\'s span');
            assert(!by('o_f_hi').text || by('o_f_hi').y >= o.g0[0] + 27, 'the scale is not under the bar');
            ['o_gear', 'o_speed', 'o_speed_unit'].forEach((id) => assert(by(id).x + by(id).w <= win[0] - 10, id + ' is not in the left column, clear of the window'));
        });
        // the bottom row's right end exists twice: for the normal view (no prefix, backdrop) and for the map view ("o_", backdrop_open),
        // where the oil, the electric range and the outside temperature follow the strips
        const VIEWS = [['', '!mapUp', 'backdrop'], ['o_', 'mapUp', 'backdrop_open']];
        check('mblade: the clock and the fuel range share the bottom line (same y), in both views, level with BMW\'s gear letter (its middle on the letter\'s)', () => {
            // (with the map up the range goes with the flat fuel bar under the map: checked below)
            VIEWS.filter(([pre]) => !pre).forEach(([pre]) => {
                const ys = [by(pre + 'time'), by(pre + 'range')].map((w) => w.y);
                assert(ys.every((y) => y === ys[0]), pre + ' y differ: ' + ys.join(', '));
                assert(Math.abs(ys[0] + 29 / 2 - 683) <= 5, pre + ' the line is not centred on the belt light and the gear letter: y ' + ys[0]);
                assert(by(pre + 'range_icon').y === ys[0] - 3 && by(pre + 'range_unit').y === ys[0] + 3, pre + ' the range\'s icon or unit is off the line');
            });
        });
        check('mblade: the oil and the electric range sit on one row right under their strips, each centred under its own strip (no icon: the strip\'s own is above), in both views', () => {
            VIEWS.forEach(([pre]) => {
                const b = by(pre === '' ? 'backdrop' : 'backdrop_open');
                const mid = (g) => g[0] + g[3] * (g[2] - g[1]) + 33;                    // the middle of a strip's lower end
                const ink = { oil: 77, ev_range: 42 };                                    // a three-digit oil, a two-digit electric range
                const unitOf = (n) => by(pre + n + '_unit');
                const y = by(pre + 'oil').y;
                assert(by(pre + 'ev_range').y === y && unitOf('oil').y === y + 3 && unitOf('ev_range').y === y + 3, pre + ': the row is not one line');
                assert(y >= b.g1[2] + 6 && y + 29 <= 660, pre + ': the row is not between the strips\' lower end (y ' + b.g1[2] + ') and BMW\'s gear hole (y 660)');
                assert(y + 29 + 6 <= by(pre + 'time').y, pre + ': the row is not above the bottom line');
                [['oil', b.g1], ['ev_range', b.g2]].forEach(([n, g]) => {
                    const val = by(pre + n), u = unitOf(n);
                    assert(by(pre + n).font === 'm_mid' && val.x + val.w <= u.x && !val.icon, n + ': value and unit out of order');
                    const left = val.x + val.w - ink[n], right = u.x + u.w - (n === 'oil' ? 2 : 0);     // the longest group, from the first digit to the end of the unit
                    const centre = (left + right) / 2;
                    assert(Math.abs(centre - mid(g)) <= 22, pre + n + ': the value is not under its strip (group middle ' + centre + ', strip middle ' + mid(g) + ')');
                });
                const o = by(pre + 'oil'), ou = unitOf('oil'), e = by(pre + 'ev_range');
                assert(e.x + e.w - 62 - (ou.x + ou.w) >= 15, pre + ': the oil and the electric range touch');
                assert(by(pre + 'oil').tempBy === 'oil', pre + ': the oil value does not take its colour');
                assert(!by(pre + 'oil_icon') && !by(pre + 'ev_icon'), pre + ': an icon is back under the strips (it made the two groups touch)');
            });
            // the map view follows the strips
            const sx = by('backdrop_open').g1[0] - by('backdrop').g1[0];      // how far the strips moved right with the map up
            assert(sx > 0 && by('o_oil').x - by('oil').x === sx && by('o_ev_range').x - by('ev_range').x === sx, 'the map view\'s values do not follow the strips (' + sx + ')');
        });
        check('mblade: the coolant (over) and the outside temperature (under) are one table at the far right, same in both views: icons, values and units each in one column', () => {
            const rows = [['cool', 'cool_icon', 'cool_unit'], ['outside', 'ice_icon', 'outside_unit']].map((r) => r.map((i) => by(i)));
            assert(!by('out_icon'), 'the outside temperature has no thermometer (it looks like the coolant\'s: the owner would confuse them)');
            // (the coolant gives way to the views' panel: "viewSel=none"; copies show it in the same place with the map up and a view, xb_mc_, and on the bottom row
            // without the map, xb_vc_, where the fuel range takes its place under the fuel strip; the engine view has it in its panel)
            rows.forEach((r) => r.forEach((w) => assert(!w.toggle || w.toggle === 'viewSel=none', w.id + ': the column is the same in both views')));
            ['cool_icon', 'cool', 'cool_unit'].forEach((k) => {
                const m = by('xb_mc_' + k), v = by('xb_vc_' + k);
                assert(m && m.x === by(k).x && m.y === by(k).y && m.toggle === 'mapUp&!viewSel=none&!viewSel=gauges', k + ': no copy with the map up and a view');
                assert(v && v.y >= by('time').y - 3 && v.toggle === '!mapUp&!viewSel=none&!viewSel=gauges', k + ': no copy on the bottom row with a view');
            });
            assert(by('cool').tempBy === 'coolant' && by('cool_icon').tempBy === 'coolant', 'tempBy missing');
            assert(by('outside').iceBy && by('ice_icon').iceBy && by('ice_icon').icon === 'snow', 'the snowflake and the ice colour are missing');
            assert(rows[0][0].y === by('oil').y, 'the coolant is not on the sensors\' row (the oil\'s)');
            assert(rows[1][0].y === by('time').y, 'the outside temperature is not on the bottom line');
            assert(new Set(rows.map((r) => r[0].x + r[0].w)).size === 1, 'the values do not end at the same x');
            assert(new Set(rows.map((r) => r[1].x)).size === 1, 'the icons are not in one line');
            assert(new Set(rows.map((r) => r[2].x)).size === 1, 'the units are not in one line');
            rows.forEach(([val, ic, unit]) => {
                assert(val.font === 'm_mid' && ic.x + ic.w <= val.x && val.x + val.w <= unit.x + 6, val.id + ': icon, value and unit out of order');
                assert(ic.x >= 1712 && unit.x + unit.w <= 1920, val.id + ': too close to the strips (map view: the electric range ends x 1664) or off the panel');
            });
                        // the oil is under its strip now: nothing of it is in the right column
            assert(by('o_ev_range_unit').x + by('o_ev_range_unit').w <= by('ice_icon').x - 10, 'the electric range runs into the right column in the map view');
        });
        check('mblade: each bar keeps its reading next to it (owner, Nov 18 2026): the fuel range under the fuel strip without the map, beside the flat bar with it, under the strip moved right with a view', () => {
            const n = by('backdrop'), o = by('backdrop_open'), v = n.alt.set;      // (the backdrop's other face while a view shows, since 20 Nov 2026: one layer, not two taking turns)
            const low = (g) => g[0] + g[3] * (g[2] - g[1]);            // the strip's left edge at its lower end
            const mid = (w) => w.x + w.w / 2;
            // the normal dial: the range on the bottom row, under the fuel strip (it leans right: its lower end is the right one)
            assert(Math.abs(mid(by('range')) - (low(n.g0) + 13)) <= 90, 'the range is not under the fuel strip');
            // the map: level with the flat bar, just left of its pump
            const pump = by('o_fuel_icon'), r = by('o_range'), u = by('o_range_unit');
            assert(Math.abs((r.y + r.h / 2) - (o.g0[0] + 13.5)) <= 4, 'the range is not level with the flat fuel bar');
            assert(u.x + u.w <= pump.x - 4 && r.x + r.w <= u.x + 2 && r.x > 520, 'the range is not just left of the bar\'s pump');
            // a view: the strip moved right of the battery's, its range under it on the oil's row, the normal one hidden
            const vr = by('xb_vrange');
            assert(vr && vr.toggle === '!mapUp&!viewSel=none' && vr.y === by('oil').y, 'no range under the moved strip');
            assert(Math.abs(vr.x + vr.w - 29 - (low(v.g0) + 33)) <= 25, 'the range is not centred under the moved strip');
            ['range', 'range_icon', 'range_unit'].forEach((k) => assert.strictEqual(by(k).toggle, '!mapUp&viewSel=none', k + ' does not give way with a view'));
            assert(!by('o_range_icon'), 'the map view has the range\'s icon again (the bar\'s pump is beside it)');
        });
        check('mblade: nothing shown together overlaps anything else (text and icon boxes), in either view', () => {
            const g = (w) => (w.toggle === 'powerShut' ? '!mapUp' : w.toggle === 'powerOpen' ? 'mapUp' : w.toggle) || '';
            // two widgets never show together when their toggles contradict: "mapUp" and "!mapUp", "driveSport" and "!driveSport", or two different views (viewSel=a, viewSel=b, or !viewSel=a)
            const excl = (a, b) => g(a).split('&').some((p) => g(b).split('&').some((q) => {
                const np = p.charAt(0) === '!', nq = q.charAt(0) === '!', kp = np ? p.slice(1) : p, kq = nq ? q.slice(1) : q;
                if (!kp || !kq) return false;
                if (kp === kq) return np !== nq;
                return kp.indexOf('viewSel=') === 0 && kq.indexOf('viewSel=') === 0 && !np && !nq;
            }));
            // the danger alert (al_), the limit ring (lim_), the 0-100 timer (run_) and the launch cue (ready_, over the drive mode's name) share their places by design: they take turns
            const own = (w) => /^(al_|(xb_v)?lim_|run_|(o_)?ready_)/.test(w.id);
            const ws = L.widgets.filter((w) => /^(text|icon)$/.test(w.type) && !own(w));
            L.widgets.filter((w) => /^((xb_v)?lim_|run_|(o_)?ready_)/.test(w.id)).forEach((a) => ws.forEach((b) => {
                if (/ready_/.test(a.id) && /drive_mode$/.test(b.id)) return;      // the launch cue takes the drive mode name's place
                if (excl(a, b)) return;
                assert(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), a.id + ' overlaps ' + b.id);
            }));
            ws.forEach((a, i) => ws.slice(i + 1).forEach((b) => {
                if (excl(a, b)) return;
                assert(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), a.id + ' overlaps ' + b.id);
            }));
        });
        check('mblade: with the map up nothing is drawn over the map window', () => {
            const h = L.widgets.find((w) => w.hole), i = h.holeInset || 6;
            const win = [h.hole[0] + i, h.hole[1] + i, h.hole[0] + h.hole[2] - i, h.hole[1] + h.hole[3] - i];
            L.widgets.filter((w) => /^(text|icon)$/.test(w.type) && w.toggle !== '!mapUp' && w.toggle !== 'powerShut' && w.id.indexOf('al_') !== 0).forEach((w) => {
                assert(!overlap(w, win), w.id + ' is over the map window');
            });
        });
    }
    check(n + ': every text fits its box with its longest value (nothing cut: three-digit speeds and temperatures, mph / F, the longest unit)', () => {
        const fonts = {};
        const adv = (font, s) => {
            if (!fonts[font]) fonts[font] = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/shaktheme/hud/fonts/' + font + '.json'), 'utf8')).glyphs;
            return s.split('').reduce((a, ch) => { const g = fonts[font][ch]; assert(g, font + ' has no glyph for ' + JSON.stringify(ch) + ' in "' + s + '"'); return a + g.advance; }, 0);
        };
        // the longest thing each token can print
        const WORST = { '{{ms:': '330', '{{tc:': '302', '{{speed}}': '330', '{{oil}}': '302', '{{coolant}}': '302', '{{evRange}}': '99', '{{range}}': '999', '{{rangeTotal}}': '999',
            '{{ambient}}': '+104', '{{time}}': '12:59', '{{ampmLc}}': 'pm', '{{stage}}': 'M', '{{tachUnit}}': '1/min x 1000', '{{chargeNote}}': 'CHARGE', '{{powerKw}}': '-150', '{{modeName}}': 'COMFORT', '{{hvSoc}}': '100',
            '{{u:speedLc}}': 'km/h', '{{u:distLc}}': 'km', '{{u:temp}}': '\u00b0F' };
        const cut = [];
        L.widgets.filter((w) => w.type === 'text').forEach((w) => {
            let s = w.text;
            Object.keys(WORST).forEach((k) => { s = s.split(k === '{{ms:' || k === '{{tc:' ? /^$/ : k).join(WORST[k]); });
            // M Blade's speed labels: 0 / 30 / 60 / 90 km/h (0 / 20 / 40 / 60 mph) are the first four, 120 and up have three digits
            s = s.replace(/\{\{ms:(\d+)\}\}/g, (m, i) => (Number(i) < 4 ? '90' : '330')).replace(/\{\{tc:\d+\}\}/g, '302');
            if (/\{\{/.test(s)) return;                 // a token this test doesn't know
            const wid = adv(w.font, s);
            if (wid > w.w) cut.push(w.id + ' "' + s + '" is ' + wid + ' px wide in a ' + w.w + ' px box (' + w.font + ')');
        });
        assert(!cut.length, cut.join('; '));
    });
    if (n === 'navi') check(n + ': the oil readout sits in the free column on the right, clear of BMW\'s gear box', () => {
        const oil = by('oil'), icon = by('oil_icon');
        assert(oil && icon, 'no oil readout');
        assert(oil.x >= 1600 && !overlap(oil, visible.BLACK_BOX) && !overlap(icon, visible.BLACK_BOX));
    });
    check(n + ': ONE OF ONE lettering: only in Navi, centred right under the shift light, gone while the map window is open', () => {
        const e = by('emblem');
        if (n === 'mblade') { assert(!e, 'M Blade has no room for it'); return; }
        assert(e && e.type === 'emblem' && e.setting === 'emblem' && !e.keepWithMap, 'must be hidden while the window is open');
        assert(Math.abs(e.x + e.w / 2 - 960) <= 2, 'not centred');
        const s = ofType('shiftlight')[0];
        assert(e.y >= s.y + s.h && e.y + 96 <= 215, 'not between the shift light and the gear');
    });
    check(n + ': shift light centred at the top, switched by stockShiftLight, above the map window', () => {
        const s = ofType('shiftlight')[0];
        assert(s && s.toggle === 'stockShiftLight');
        assert(Math.abs(s.x + s.w / 2 - 960) <= 2, 'not centred');
        const hole = L.widgets.map((w) => w.hole).find(Boolean);
        assert(hole && s.y + s.h <= hole[1], 'over the map window');
    });
    check(n + ': the centre window: a hole, shown while Waze is up, plus the Cluster Centre rectangle', () => {
        const h = L.widgets.find((w) => w.hole);
        assert(h && h.holeWhen === 'mapUp' && h.hole.length === 4 && h.holeInset > 0);
        assert(L.widgets.some((w) => w.toggle === 'mapUp') && L.widgets.some((w) => w.toggle === '!mapUp'), 'no open / closed readouts');
    });
    check(n + ': the window covers the middle of Waze\'s map (drawn at x 416..1504, y 120..600) or, with mapPlace, is a map-sized window; it clears the black box', () => {
        const h = L.widgets.find((w) => w.hole), i = h.holeInset || 6;
        const win = { x: h.hole[0] + i, y: h.hole[1] + i, w: h.hole[2] - 2 * i, h: h.hole[3] - 2 * i };
        if (h.mapPlace === true) {
            // Waze on cluster draws the map right in the window (map_window.js): any window works, if it is a size a map can be read in and the hood doesn't cover it
            assert(win.w >= 400 && win.h >= 300, 'the window is too small for a map: ' + win.w + 'x' + win.h);
            assert(win.x >= 0 && win.y >= 0 && win.x + win.w <= 1920 && win.y + win.h <= 720, 'the window is off the panel');
            assert(visible.hoodY(win.x) <= win.y && visible.hoodY(win.x + win.w) <= win.y, 'the window is under the hood');
        } else {
            assert(win.x <= 900 && win.x + win.w >= 1000, 'x 900..1000 (around the map\'s middle, x 960) is not in it');
            assert(win.y <= 360 && win.y + win.h >= 590, 'the map\'s middle and its lower part (y 360..590, where the arrow is) are not in it');
        }
        assert(!overlap(win, visible.BLACK_BOX) && !overlap(win, visible.BELT), 'under BMW\'s black box or belt light');
    });
    check(n + ': no text, icon or emblem in BMW\'s black box or seat-belt light, none under the hood', () => {
        L.widgets.filter((w) => /^(text|icon|emblem|badge|atext)$/.test(w.type)).forEach((w) => {
            // BMW's black box: only the normal view keeps clear of it (the gear letter's hole, on by default, keeps BMW from drawing it; with the map
            // up the blade had to move right to centre the window, Nov 18 2026)
            if (w.toggle !== 'mapUp') assert(!overlap(w, visible.BLACK_BOX), w.id + ' in the black box');
            assert(!overlap(w, visible.BELT), w.id + ' in the seat-belt light');
            const a = w.type === 'emblem' ? w.x + 114 : w.x, b = w.type === 'emblem' ? w.x + 246 : w.x + w.w;    // (the emblem's ink is 132 px wide, centred in its 360 px box)
            assert(visible.hoodY(a) <= w.y + 2 && visible.hoodY(b) <= w.y + 2, w.id + ' under the hood');
        });
    });
    check(n + ': the danger zone alert card: under the hood, clear of BMW\'s zones, of the map window and of every readout', () => {
        const cards = ['al_card', 'al_card2'].map(by);
        assert(cards.every(Boolean), 'no alert card');
        const h = L.widgets.find((w) => w.hole), i = h.holeInset || 6;
        const win = { x: h.hole[0] + i, y: h.hole[1] + i, w: h.hole[2] - 2 * i, h: h.hole[3] - 2 * i };
        cards.forEach((c) => {
            assert(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1920 && c.y + c.h <= 720, c.id + ' off the panel');
            assert(!overlap(c, visible.BLACK_BOX) && !overlap(c, visible.BELT), c.id + ' in the black box or belt light');
            assert(c.y >= visible.CAMERA[3] || c.x >= visible.CAMERA[2] || c.x + c.w <= visible.CAMERA[0], c.id + ' in the camera\'s box');
            assert(visible.hoodY(c.x) <= c.y + 2 && visible.hoodY(c.x + c.w) <= c.y + 2, c.id + ' under the hood');
            assert(!overlap(c, [win.x, win.y, win.x + win.w, win.y + win.h]), c.id + ' over the map window');
            L.widgets.filter((w) => /^(text|icon|emblem|badge|atext)$/.test(w.type) && w.id.indexOf('al_') !== 0).forEach((w) => {
                const a = w.type === 'emblem' ? w.x + 114 : w.x, b = w.type === 'emblem' ? w.x + 246 : w.x + w.w;
                assert(!(a < c.x + c.w && b > c.x && w.y < c.y + c.h && w.y + w.h > c.y), c.id + ' covers ' + w.id);
            });
        });
        // everything of the alert sits inside the wide card
        L.widgets.filter((w) => w.id.indexOf('al_') === 0 && w.type !== 'box').forEach((w) => {
            assert(w.x >= cards[0].x && w.y >= cards[0].y && w.x + w.w <= cards[0].x + cards[0].w && w.y + w.h <= cards[0].y + cards[0].h, w.id + ' outside the card');
        });
    });
});
console.log(bad ? bad + ' FAILED' : 'mblade / navi: all checks pass');
process.exit(bad ? 1 : 0);
