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
                assert(c.x + c.w <= 1030 && c.y >= 585, pre + 'charge_note is not left of the foot, under the hexagon');
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
        check('mblade: with the map up the window is inside Waze on cluster\'s slot, the hexagon gives way, the fuel is a flat bar right under the window, the strips and the blade moved right but clear of BMW\'s black box', () => {
            const o = by('backdrop_open'), n = by('backdrop');
            const win = [o.hole[0] + o.holeInset, o.hole[1] + o.holeInset, o.hole[0] + o.hole[2] - o.holeInset, o.hole[1] + o.hole[3] - o.holeInset];
            assert(!o.hex, 'no hexagon (and so no tabs) with the map up: the window takes its place');
            assert(win[0] >= 416 && win[1] >= 120 && win[2] <= 1504 && win[3] <= 600, 'the window leaves Waze on cluster\'s own slot (x 416..1504, y 120..600): ' + win);
            assert(o.fuelH === true && !n.fuelH, 'the fuel bar must be flat with the map up only');
            const left = 1920 - o.g0[2], right = 1920 - o.g0[1];                 // the flat bar, back in panel px
            assert(left >= win[0] && right <= win[2], 'the fuel bar is wider than the window');
            assert(o.g0[0] >= win[3] + 8 && o.g0[0] + 27 <= 684 - 20, 'the fuel bar is not right under the window, clear of the bottom row');
            assert(o.g1[0] > n.g1[0] && o.g2[0] > n.g2[0] && o.bl[2] > n.bl[2], 'not moved to the right');
            assert(win[2] + 10 <= 1050, 'the window runs into the blade, whose base starts near x 1050 (' + win[2] + ')');
            const f = ['o_f_lo', 'o_f_mid', 'o_f_hi', 'o_fuel_icon'].map(by);
            assert(f.every((w) => w && w.toggle === 'mapUp' && w.x >= win[0] - 60 && w.x + w.w <= win[2] + 20), 'fuel scale outside the window\'s span');
            assert(!by('o_f_hi').text || by('o_f_hi').y >= o.g0[0] + 27, 'the scale is not under the bar');
            ['o_gear', 'o_speed', 'o_speed_unit'].forEach((id) => assert(by(id).x + by(id).w <= win[0] - 10, id + ' is not in the left column, clear of the window'));
        });
        // the bottom row's right end exists twice: for the normal view (no prefix, backdrop) and for the map view ("o_", backdrop_open),
        // where the oil, the electric range and the outside temperature follow the strips
        const VIEWS = [['', '!mapUp', 'backdrop'], ['o_', 'mapUp', 'backdrop_open']];
        check('mblade: the clock, the fuel range, the electric range, the oil and coolant temperatures and the outside temperature share one line at the bottom (same y), in both views', () => {
            VIEWS.forEach(([pre]) => {
                const ys = [by('time'), by('range'), by(pre + 'ev_range'), by(pre + 'oil'), by(pre + 'cool'), by(pre + 'outside')].map((w) => w.y);
                assert(ys.every((y) => y === ys[0]), pre + ' y differ: ' + ys.join(', '));
                ['range_icon', pre + 'ev_icon', pre + 'oil_icon', pre + 'cool_icon'].forEach((i) => assert(by(i).y === 681, i + ' is not on the line'));
                ['range_unit', pre + 'ev_range_unit', pre + 'oil_unit', pre + 'cool_unit', pre + 'outside_unit'].forEach((i) => assert(by(i).y === 687, i + ' is not on the line'));
            });
        });
        check('mblade: the coolant, the oil and the electric range are on the bottom row in the range\'s lettering and height, the oil under its strip and the electric range under the battery strip, before the outside temperature, in both views', () => {
            VIEWS.forEach(([pre, tog, bid]) => {
                const ids = ['ev_range', 'oil', 'cool'].map((i) => by(pre + i));
                assert(ids.every((w) => w.font === 'm_mid' && w.y === by('range').y), pre + ': not the range\'s lettering and line');
                assert(by(pre + 'oil').tempBy === 'oil' && by(pre + 'cool').tempBy === 'coolant', pre + ': tempBy missing');
                ['ev_range', 'oil', 'cool', 'oil_icon', 'cool_icon', 'ev_icon', 'oil_unit', 'cool_unit', 'ev_range_unit', 'outside', 'outside_unit'].forEach((i) => assert(by(pre + i).toggle === tog, pre + i + ': not for its own view'));
                const right = (id) => by(pre + id).x + by(pre + id).w, b = by(bid);
                assert(by(pre + 'cool_icon').x >= 1190, pre + ': in the hexagon\'s tabs / red glow');
                assert(by(pre + 'oil_icon').x > right('cool_unit') && by(pre + 'ev_icon').x > right('oil_unit') && by(pre + 'outside').x > right('ev_range_unit'), pre + ': the readouts touch or are out of order');
                assert(by(pre + 'outside').x - right('ev_range_unit') >= 0 && by(pre + 'outside_unit').x + 30 <= 1890, pre + ': outside temperature too close to the electric range or to the panel edge');
                const under = (g) => g[0] + g[3] * (g[2] - g[1]);                          // a strip's left edge at its bottom
                assert(Math.abs(by(pre + 'oil_icon').x + 40 - (under(b.g1) + 13)) <= 50, pre + ': the oil reading is not under the oil strip');
                assert(by(pre + 'ev_icon').x >= under(b.g2) - 15 && by(pre + 'ev_icon').x <= under(b.g2) + 15, pre + ': the electric range is not under the battery strip');
            });
        });
        check('mblade: nothing shown together overlaps anything else (text and icon boxes), in either view', () => {
            const g = (w) => (w.toggle === 'powerShut' ? '!mapUp' : w.toggle === 'powerOpen' ? 'mapUp' : w.toggle) || '';
            // the danger alert (al_), the limit ring (lim_), the 0-100 timer (run_) and the launch cue (ready_, over the drive mode's name) share their places by design: they take turns
            const own = (w) => /^(al_|lim_|run_|(o_)?ready_)/.test(w.id);
            const ws = L.widgets.filter((w) => /^(text|icon)$/.test(w.type) && !own(w));
            L.widgets.filter((w) => /^(lim_|run_|(o_)?ready_)/.test(w.id)).forEach((a) => ws.forEach((b) => {
                if (/ready_/.test(a.id) && /drive_mode$/.test(b.id)) return;      // the launch cue takes the drive mode name's place
                if ((g(a) === 'mapUp' && g(b) === '!mapUp') || (g(a) === '!mapUp' && g(b) === 'mapUp')) return;
                assert(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), a.id + ' overlaps ' + b.id);
            }));
            ws.forEach((a, i) => ws.slice(i + 1).forEach((b) => {
                if ((g(a) === 'mapUp' && g(b) === '!mapUp') || (g(a) === '!mapUp' && g(b) === 'mapUp')) return;
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
            assert(!overlap(w, visible.BLACK_BOX), w.id + ' in the black box');
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
