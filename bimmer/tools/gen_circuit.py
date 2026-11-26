#!/usr/bin/env python3
"""Writes apps/shaktheme/hud/layouts/circuit.json, the Circuit cluster theme.

After the owner's photo of a race car's round dial (26 Nov 2026: "copie tout pareil, chaque détail compte, chaque ligne pareil"), warped to the
panel as design/photos/ref-circuit.png, every position read off it: a round rev dial in the middle (0..7, 0 at the bottom, 6 at the top, 30 degrees
a thousand) with its red ring, the zone as an orange and a red block, the hub lit up to the needle and the gear in it, the shifter's letter and three
lines beside it; the speed on its left over the speed limit's box; the fuel and (for the hybrid, in place of the photo's coolant) the battery as
stacks of seven bars at the two ends; on the right a panel framed by two white lines: the clock and the outside temperature over it, this drive's
distance and the range under it, and in it the BC views or, while it is up, the phone's map. Black backdrop and all the lines: shaders.js circuit.

The hybrid (owner: "optimise tout pour hybride"): while the battery alone drives, the needle shows its power on the same marks (kW x 10) in light
blue, green while it charges; the ring turns blue in the Electric mode; under the gear the battery's own range and the share driven on electricity.

Kept clear of the car's own zones (shared/visible.js): the hood at the top corners, its belt light (x 587..626, y 663..700) and its gear letter
(x 1386..1454, y 662..708).
Usage: python3 tools/gen_circuit.py   (from the app's root)
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_sheets
import add_sensor_bars
from gen_mblade_navi import text, icon, danger_alert, ev_share
from zoom_labels import zoomify

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'apps', 'shaktheme', 'hud', 'layouts', 'circuit.json')
FONTS = os.path.join(HERE, '..', 'apps', 'shaktheme', 'hud', 'fonts')

CENTER = [962, 365]            # the dial's centre (the photo's 6 and 0 at x 962, its 3 at y 365)
R_NUM = 330                    # the numbers' centres
# with the phone's map (owner, 26 Nov 2026: 02:00 "Waze, il faut absolument qu'il soit au milieu", 02:26 with a video of a cluster doing it: "garde le
# cadran taille d'origine, mets-le à droite, déplace ce qui gêne à gauche ; change de côté les barres de batterie pour qu'elles suivent l'essence ; tu
# peux réduire un peu Waze"): the dial slides to the right, 0.82 times its size (whole, the hood hides the top of the 6 and the 7 at the right of the
# panel past that), the battery's stack beside the fuel's, the speed, the gearbox, the signs, the clock and the temperatures over them, the map between
# them and the dial, between the two white lines (y 66 and 614, shaders.js circuit u_md)
HOLE = [580, 80, 720, 520]     # x 580..1300, y 80..600
M_CENTER, M_SCALE = [1630, 396], 0.82
M_BOX = [300, 284]             # the gearbox's box under the speed
RPM_MAX = 7000
_metrics = {}


def baseline(font):
    if font not in _metrics:
        with open(os.path.join(FONTS, font + '.json')) as f:
            j = json.load(f)
        _metrics[font] = (j['baseline'], j['cellHeight'])
    return _metrics[font][0]


def cell(font):
    baseline(font)
    return _metrics[font][1]


def on_base(id, x, base, w, t, font, color='fg', align=None, **kw):
    """A text whose letters stand on the line y = base (the photo's rows share one baseline whatever their size)."""
    return text(id, x, base - baseline(font), w, cell(font), t, font, color, align, **kw)


def dir_k(k):
    a = math.pi + k * math.pi / 6
    return math.sin(a), -math.cos(a)


def dial(W, pre, ctr, sc, tog, num, gear_font):
    """the dial's numbers 0..7 on their ticks (white, the photo's 7 too), the gear in the hub and its programme letter beside it"""
    for k in range(8):
        dx, dy = dir_k(k)
        cx, cy = ctr[0] + R_NUM * sc * dx, ctr[1] + R_NUM * sc * dy
        ww = round(60 * sc / 2) * 2
        W.append(text(pre + 'n%d' % k, round(cx - ww / 2), round(cy - cell(num) / 2.0), ww, cell(num), str(k), num, 'fg', 'center', toggle=tog))
    gw = round(120 * sc)
    W.append(text(pre + 'gear', round(ctr[0] + 41 * sc) - gw, round(ctr[1] - 59 * sc), gw, cell(gear_font), '{{gearBig}}', gear_font, 'gearC', 'right', toggle=tog))
    pb = round(ctr[1] + 35 * sc)
    W.append(on_base(pre + 'gear_prog', round(ctr[0] + 45 * sc), pb, 40, '{{gearProg}}', 'c_unit', 'prog', 'left', toggle=tog))
    ub = round(ctr[1] + 338 * sc)
    W.append(on_base(pre + 'rev_unit', round(ctr[0] + 36 * sc), ub, 200, '{{tachUnit}}', 'c_tiny', 'fg', 'left', toggle=tog))
    W.append(on_base(pre + 'rev_charge', round(ctr[0] + 36 * sc), ub - 25, 120, '{{chargeNote}}', 'c_tiny', 'fg', 'left', toggle=tog))
    lines2(W, pre, round(ctr[0] + 43 * sc), pb + 34, tog)       # (under the letter, the photo's SPORT under its M)


def left(W, pre, tog, sp_right, sp_base, box, ring_x, ring_y, icons):
    """the speed and its unit, the gearbox in its box (drawn by the backdrop), the speed limit as a round sign, the next one, the car's warning
    triangle and lane assist wheel"""
    W.append(on_base(pre + 'speed', sp_right - 240, sp_base, 240, '{{speed}}', 'c_speed', 'fg', 'right', toggle=tog))
    W.append(on_base(pre + 'speed_unit', sp_right + 8, sp_base, 80, '{{u:speedLc}}', 'c_unit', 'fg', 'left', toggle=tog))
    W.append(text(pre + 'box_gear', box[0] - 38, round(box[1] - 17.5), 76, cell('c_lim'), '{{gear}}', 'c_lim', 'fg', 'center', toggle=tog))
    W.append(icon(pre + 'lim_ring', 'ring', ring_x, ring_y, 74, 74, 'dim', limitBy=True, toggle=tog))
    W.append(text(pre + 'lim_num', ring_x, ring_y + 18, 74, 37, '{{limit}}', 'unit', 'fg', 'center', limitBy=True, toggle=tog))
    W.append(icon(pre + 'lim_nxt_ring', 'ring', ring_x + 84, ring_y + 11, 52, 52, 'dim', nextBy=True, toggle=tog))
    W.append(text(pre + 'lim_nxt_num', ring_x + 84, ring_y + 23, 52, 29, '{{nextLimit}}', 'm_tiny', 'dim', 'center', nextBy=True, toggle=tog))
    W.append(icon(pre + 'lim_alert', 'warn', icons[0][0], icons[0][1], icons[2], icons[2], 'dim', alertBy=True, toggle=tog))
    W.append(icon(pre + 'lim_lane', 'wheel', icons[1][0], icons[1][1], icons[2], icons[2], 'dim', laneBy=True, toggle=tog))


def lines2(W, pre, x, b1, tog):
    """the lines beside the gear (the photo's SPORT / TRACTION): the drive mode, the share driven on electricity"""
    W.append(on_base(pre + 'mode1', x, b1, 136, '{{modeShort}}', 'c_mode', 'fg', 'left', toggle=tog))
    W.extend(ev_share(x, b1 + 9, 26, 30, x + 30, b1 + 35 - baseline('c_mode'), 50, cell('c_mode'), 'c_mode', x + 83, b1 + 35 - baseline('c_mode'), 40,
                      cell('c_mode'), 'c_mode', pre=pre, tog=tog))


def temps(W, pre, x0, x1, base, tog):
    """the oil and the coolant, each its icon, its number and its unit (the photo's TRIP row; owner, 26 Nov 2026: "le logo huile à la place d'écrire
    huile, et tu le mets à la place de TRIP"), blue while cold, red over their limit (tempBy)"""
    for k, (key, ic, tok) in enumerate((('oil', 'oilcan', '{{oil}}'), ('cool', 'therm', '{{coolant}}'))):
        x = (x0, x1)[k]
        sig = 'oil' if key == 'oil' else 'coolant'
        W.append(icon(pre + key + '_icon', ic, x, base - 31, 29, 34, 'fg', tempBy=sig, toggle=tog))
        W.append(on_base(pre + key, x + 34, base, 66, tok, 'c_val', 'fg', 'right', tempBy=sig, toggle=tog))
        W.append(on_base(pre + key + '_unit', x + 104, base, 40, '{{u:temp}}', 'c_vu', 'fg', 'left', toggle=tog))


def side(W, pre, tog, fx, ex, ix, rx):
    """the battery's stack's F and E, its icon, under it its electric range and its charge"""
    W.append(text(pre + 'batt_f', fx, 436, 20, cell('c_side'), 'F', 'c_side', 'fg', 'right' if not pre else 'left', toggle=tog))
    W.append(text(pre + 'batt_e', ex, 612, 20, cell('c_side'), 'E', 'c_side', 'fg', 'right' if not pre else 'left', toggle=tog))
    W.append(icon(pre + 'batt_icon', 'battery', ix, 520, 24, 30, 'fg', toggle=tog))
    W.append(on_base(pre + 'ev_range', rx, 692, 70, '{{evRange}}', 'c_val', 'fg', 'right', lowWhen='battery', toggle=tog))
    W.append(on_base(pre + 'ev_range_unit', rx + 74, 692, 40, '{{u:distLc}}', 'c_vu', 'fg', 'left', toggle=tog))
    W.append(on_base(pre + 'ev_pct', rx + 114, 692, 66, '{{hvSoc}}', 'c_val', 'fg', 'right', lowWhen='battery', toggle=tog))
    W.append(on_base(pre + 'ev_pct_unit', rx + 184, 692, 26, '%', 'c_vu', 'fg', 'left', toggle=tog))


def top_row(W, pre, tog, run_x, time_x, out_x, base):
    """the 0-100 timer, the clock and the outside temperature (the photo's "2:46 pm" and "+72 °F")"""
    if run_x is not None:
        W.append(icon(pre + 'run_icon', 'stopwatch', run_x, base - 30, 28, 32, 'dim', launchBy=True, toggle=tog))
        W.append(on_base(pre + 'run_time', run_x + 30, base, 64, '{{launch}}', 'c_time', 'fg', 'right', launchBy=True, rate=100, toggle=tog))
        W.append(on_base(pre + 'run_unit', run_x + 96, base, 20, '{{launchUnit}}', 'c_time', 'dim', 'left', toggle=tog))
    W.append(on_base(pre + 'time', time_x, base, 84, '{{time}}', 'c_time', 'fg', 'right', toggle=tog))
    W.append(on_base(pre + 'ampm', time_x + 88, base, 44, '{{ampmLc}}', 'c_time', 'fg', 'left', toggle=tog))
    W.append(icon(pre + 'ice_icon', 'snow', out_x - 26, base - 30, 24, 32, 'dim', iceBy=True, toggle=tog))
    W.append(on_base(pre + 'outside', out_x, base, 80, '{{ambient}}', 'c_time', 'fg', 'right', iceBy=True, toggle=tog))
    W.append(on_base(pre + 'outside_unit', out_x + 88, base, 40, '{{u:temp}}', 'c_time', 'fg', 'left', toggle=tog))


def circuit():
    W = []
    W.append({'id': 'backdrop', 'type': 'circuit', 'class': 'content', 'z': 1, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'center': CENTER,
              'hole': HOLE, 'holeWhen': 'mapUp', 'holeInset': 0, 'mapPlace': True, 'rpmMax': RPM_MAX, 'hybridTach': True, 'chgOnBar': True,
              'alt': {'when': 'mapUp', 'set': {'center': M_CENTER, 'dscale': M_SCALE, 'mapMode': 1, 'box': M_BOX}}})
    # ---- without the map: the photo ----
    N = '!mapUp'
    dial(W, '', CENTER, 1, N, 'c_num', 'c_gear')
    # (02:01 "en dessous de la vitesse c'était la boîte de vitesses": the box under the speed is the gearbox, the limit a round sign beside it)
    left(W, '', N, 476, 392, [373, 478], 432, 428, ((432, 516), (486, 516), 44))
    top_row(W, '', N, 1140, 1258, 1440, 156)
    # under the panel, where the photo has TRIP and ODO: the oil and the coolant (the ranges are under the side gauges)
    temps(W, '', 1104, 1330, 588, N)
    for w in danger_alert(150, 182, 76):           # the danger zone alert, top left over the speed (both states)
        w['toggle'] = w['toggle'] + '&!mapUp'
        W.append(w)
    # the battery's stack on the right, its scale, its range and its charge (with the map: beside the fuel's, below)
    side(W, '', N, 1891, 1835, 1884, 1626)
    # ---- with the map: the dial on the right, the readouts on the left over the two stacks, the map between ----
    M = 'mapUp'
    dial(W, 'm', M_CENTER, M_SCALE, M, 'c_num', 'c_gear')
    top_row(W, 'm', M, None, 250, 412, 126)
    left(W, 'm', M, 470, 222, M_BOX, 352, 247, ((498, 244), (498, 290), 40))
    temps(W, 'm', 176, 352, 394, M)
    W.append(icon('mrun_icon', 'stopwatch', 96, 180, 28, 32, 'dim', launchBy=True, toggle=M))
    W.append(on_base('mrun_time', 126, 210, 64, '{{launch}}', 'c_time', 'fg', 'right', launchBy=True, rate=100, toggle=M))
    W.append(on_base('mrun_unit', 192, 210, 20, '{{launchUnit}}', 'c_time', 'dim', 'left', toggle=M))
    side(W, 'm', M, 268, 324, 270, 330)
    for w in danger_alert(596, 96, 76):            # over the map's top-left corner, as the phone's own alerts
        w['id'] = 'm' + w['id']
        w['toggle'] = w['toggle'] + '&mapUp'
        W.append(w)
    # ---- both states ----
    # the launch cue under the panel's (or the map's) bottom line, clear of BMW's gear letter
    W.append(icon('ready_flag', 'flag', 1100, 620, 26, 26, 'fg', readyBy=True))
    W.append(text('ready_text', 1132, 621, 240, 24, '{{launchReady}}', 'mode', 'fg', 'left', readyBy=True))
    # the side gauges' scales (the bars and lines: the backdrop): F at the top, E at the bottom, the pump and the battery in between
    W.append(text('fuel_f', 10, 436, 20, cell('c_side'), 'F', 'c_side', 'fg', 'left'))
    W.append(text('fuel_e', 66, 612, 20, cell('c_side'), 'E', 'c_side', 'fg', 'left'))
    W.append(icon('fuel_icon', 'fuel', 12, 520, 26, 30, 'fg'))
    # under each gauge its range (owner, 26 Nov 2026: "il faudrait afficher l'autonomie batterie et essence"): the fuel's on the left, the battery's
    # electric range and its charge on the right, white numbers and their units as the TRIP row's
    W.append(on_base('fuel_range', 120, 692, 118, '{{range}}', 'c_val', 'fg', 'right', lowWhen='fuel'))
    W.append(on_base('fuel_range_unit', 242, 692, 44, '{{u:distLc}}', 'c_vu', 'fg', 'left'))
    return {
        'schemaVersion': 2, 'name': 'Circuit', 'theme': 'circuit', 'runUp': False,
        '_about': "Circuit, generated by tools/gen_circuit.py (edit that and regenerate): after the owner's photo of a race car's round dial "
                  "(26 Nov 2026). The rev dial in the middle with the gear in its hub, the speed on the left over the gearbox's box, the fuel "
                  "and the battery as stacks of bars at the ends with their ranges, on the right a panel framed by two white lines with the BC "
                  "views. With the map: the map in the middle, the dial smaller on the left. Widget reference: shared/hud.js header.",
        'widgets': W,
    }


# the image sheets: fixed groups of widgets that sit close together (cluster-render's pixel memory is the sum of the sheets' boxes)
GROUPS = {
    'xs_c_num': ['n%d' % k for k in range(8)] + ['rev_unit', 'rev_charge'],
    'xs_c_hub': ['gear', 'gear_prog', 'mode1', 'ev_share_icon', 'ev_share', 'ev_share_unit'],
    'xs_c_left': ['speed', 'speed_unit', 'box_gear', 'lim_ring', 'lim_num', 'lim_nxt_ring', 'lim_nxt_num', 'lim_alert', 'lim_lane'],
    'xs_c_top': ['run_icon', 'run_time', 'run_unit', 'time', 'ampm', 'ice_icon', 'outside', 'outside_unit'],
    'xs_c_bot': ['oil_icon', 'oil', 'oil_unit', 'cool_icon', 'cool', 'cool_unit'],
    'xs_c_cue': ['ready_flag', 'ready_text'],
    'xs_c_sl': ['fuel_f', 'fuel_e', 'fuel_icon', 'fuel_range', 'fuel_range_unit'],
    'xs_c_sr': ['batt_f', 'batt_e', 'batt_icon', 'ev_range', 'ev_range_unit', 'ev_pct', 'ev_pct_unit'],
    # with the map
    'xs_c_mdial': ['mn%d' % k for k in range(8)] + ['mrev_unit', 'mrev_charge', 'mgear', 'mgear_prog', 'mmode1', 'mev_share_icon', 'mev_share', 'mev_share_unit'],
    'xs_c_mleft': ['mtime', 'mampm', 'mice_icon', 'moutside', 'moutside_unit', 'mspeed', 'mspeed_unit', 'mbox_gear', 'mlim_ring', 'mlim_num',
                   'mlim_nxt_ring', 'mlim_nxt_num', 'mlim_alert', 'mlim_lane', 'moil_icon', 'moil', 'moil_unit', 'mcool_icon', 'mcool', 'mcool_unit',
                   'mrun_icon', 'mrun_time', 'mrun_unit'],
    'xs_c_msl': ['mbatt_f', 'mbatt_e', 'mbatt_icon', 'mev_range', 'mev_range_unit', 'mev_pct', 'mev_pct_unit'],
}
SHEETS = 3

if __name__ == '__main__':
    L = circuit()
    for sheet, ids in GROUPS.items():
        for w in L['widgets']:
            if w['id'] in ids:
                w['sheet'] = sheet
    zoomify('circuit', L['widgets'])         # the magnifier on the reached numbers (tools/zoom_labels.py): they only grow, white as on the photo
    for w in L['widgets']:
        if w.get('nearFont'):
            w['zoomColor'] = False
    print('circuit', pack_sheets.pack(L['widgets'], SHEETS))
    print('circuit', add_sensor_bars.add('circuit', L['widgets']))
    with open(OUT, 'w') as f:
        json.dump(L, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('wrote', os.path.normpath(OUT), len(L['widgets']), 'widgets')
