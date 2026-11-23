#!/usr/bin/env python3
"""Writes apps/shaktheme/hud/layouts/evo.json, the Shak cluster theme.

After the owner's picture of a race cluster (23 Nov 2026), without its badges: his SHAK logo at the top in the middle, a row of pill
lights under it (the shift light), the rev counter as a band of blocks stretched across the top (flat in the middle, its ends bent down)
and the speed as the same band upside down under it, joined into a hexagon; in the hexagon the speed and the gear, or the Waze map while it is up (the speed and the gear then go to the left panel). On the left without the
map: the speed limit as a big road sign and the danger zone alert; on the right: the BC views (gauges, tyres, drive, electric, under the drive
mode); along the bottom: the fuel on the left, the oil and the coolant in the middle, the battery on the right, each with a bar of blocks.
Black backdrop, neon magenta lines (shaders.js evo), bold italic numbers (fonts e_*, tools/bake_fonts.py).

Kept clear of the car's own zones (shared/visible.js): the hood at the top corners, BMW's black box (x 1406..1597, y 322..440), its belt
light (x 587..626, y 663..700) and its gear letter (x 1386..1454, y 662..708).
Usage: python3 tools/gen_evo.py   (from the app's root)
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_sheets
import add_sensor_bars
from gen_mblade_navi import text, icon, danger_alert, ev_share

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'shaktheme', 'hud', 'layouts', 'evo.json')

# the two bands, after the owner's picture: stretched arcs, flat in the middle with rounded shoulders, symmetric about x 960 (shaders.js evo):
# [y of the straight middle (the outer edge), half its length, the shoulder's radius, the end's angle (degrees), the end's length, width, blocks]
REV = [144, 302, 125, 52, 62, 42, 56]          # the revs: bends down at both ends (ends at x 523 / 1397, y 241)
SPD = [560, 290, 140, 36, 30, 36, 48]          # the speed: the same upside down, shallower (ends at x 564 / 1356, y 516)
VISOR = [272, 220, 70, 42, 70, 0, 1]           # the line under the revs' numbers (ends at x 641 / 1279, y 337), run out to the sides
HOLE = [600, 282, 720, 218]                    # the map's window in the hexagon (Waze draws the map there)
# the bottom row, as on the picture: one line each (icon, value, unit, then a bar of slanted blocks), fuel on the left, oil and coolant in the
# middle tray (its sides run from x 618 / 1302 at the ledge down to 652 / 1268), the battery on the right; the bars have their own layer
BAR_Y = 667
BARS = {'barF': [272, BAR_Y, 220], 'barO': [820, BAR_Y, 134], 'barC': [1130, BAR_Y, 134], 'barB': [1706, BAR_Y, 162]}
RPM_MAX = 7000


def path_point(P, f, t, inset):
    """The point at t (0 = the left end, 1 = the right end) along band P's outer edge, moved `inset` px to the band's side (outwards when
    negative); f = 1 for a band that bends down, -1 for one that bends up (the same maths as shaders.js evo pathAt)."""
    y0, a, R, ph, Ls = P[0], P[1], P[2], math.radians(P[3]), P[4]
    L = a + R * ph + Ls
    s = (t - 0.5) * 2 * L
    side, s = (1 if s >= 0 else -1), abs(s)
    Y0 = f * y0
    if s <= a:
        q, n = (s, Y0), (0.0, 1.0)
    elif s <= a + R * ph:
        an = (s - a) / R
        q, n = (a + R * math.sin(an), Y0 + R - R * math.cos(an)), (-math.sin(an), math.cos(an))
    else:
        u = s - a - R * ph
        T = (a + R * math.sin(ph), Y0 + R - R * math.cos(ph))
        q, n = (T[0] + u * math.cos(ph), T[1] + u * math.sin(ph)), (-math.sin(ph), math.cos(ph))
    qx, qy = q[0] + inset * n[0], q[1] + inset * n[1]
    return 960 + side * qx, f * qy


def label(id, x, y, w, h, t, font, color='fg', **kw):
    return text(id, round(x - w / 2.0), round(y - h / 2.0), w, h, t, font, color, 'center', **kw)


def evo():
    W = []
    W.append({'id': 'backdrop', 'type': 'evo', 'class': 'content', 'z': 1, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
              'revPath': REV, 'spdPath': SPD, 'visor': VISOR, 'hole': HOLE, 'holeWhen': 'mapUp', 'holeInset': 0, 'mapPlace': True,
              'rpmMax': RPM_MAX, 'hybridTach': True, 'chgOnBar': True})
    # the bars in two layers, left and right of BMW's gear letter (no layer may touch its hole, shared/gear_window.js: it would black out the strip)
    none = [0, BAR_Y, 0]
    W.append({'id': 'bars', 'type': 'evobars', 'class': 'content', 'z': 2, 'x': 0, 'y': 640, 'w': 1380, 'h': 56, 'conn': 1,
              'barF': BARS['barF'], 'barO': BARS['barO'], 'barC': BARS['barC'], 'barB': none})
    W.append({'id': 'bars_r', 'type': 'evobars', 'class': 'content', 'z': 2, 'x': 1460, 'y': 640, 'w': 460, 'h': 56, 'conn': 2,
              'barF': none, 'barO': none, 'barC': none, 'barB': BARS['barB']})
    # the owner's logo, top middle (always, the map up or not), and the pill lights under it
    W.append({'id': 'logo', 'type': 'emblem', 'name': 'shak', 'keepWithMap': True, 'z': 5, 'x': 910, 'y': 2, 'w': 100, 'h': 96})
    W.append({'id': 'shiftlight', 'type': 'shiftlight', 'style': 'pills', 'z': 3, 'x': 690, 'y': 100, 'w': 540, 'h': 28, 'segments': 5,
              'from': 3000, 'red': 4500, 'flash': 5500, 'gap': 10, 'center': 40, 'toggle': 'stockShiftLight'})
    # the rev band's numbers 0..7 under it (6 and 7 in red), its unit under the 3 and 4, CHARGE left of the band's left end
    for k in range(8):
        x, y = path_point(REV, 1, k / 7.0, REV[5] + 26)
        W.append(label('rev%d' % k, x, y, 40, 40, str(k), 'e_rnum', 'fg' if k < 6 else 'hot'))
    W.append(text('rev_unit', 860, 238, 200, 29, '{{tachUnit}}', 'e_unit', 'dim', 'center'))
    W.append(text('rev_charge', 380, 252, 110, 29, '{{chargeNote}}', 'e_unit', 'fg', 'right'))
    # the speed band's numbers (the Sport theme's scale, 0..320 km/h, 0..200 mph) under it, "km/h" under the middle
    for k in range(9):
        x, y = path_point(SPD, -1, k / 8.0, -24)
        W.append(label('spd%d' % k, x, y, 84, 34, '{{spd:%d}}' % k, 'e_snum', 'fg', near=['speed', k]))
    # in the hexagon: the speed and the gear (while the map is down), the launch cue over them
    W.append(text('speed', 700, 284, 378, 120, '{{speed}}', 'e_speed', 'fg', 'right', toggle='!mapUp'))
    W.append(text('speed_unit', 1084, 364, 80, 29, '{{u:speedLc}}', 'e_unit', 'fg', 'left', toggle='!mapUp'))
    W.append(text('gear', 900, 432, 120, 61, '{{gear}}', 'e_gear', 'fg', 'center', toggle='!mapUp'))
    W.append(icon('ready_flag', 'flag', 838, 512, 28, 28, 'fg', 1, readyBy=True, toggle='!mapUp'))
    W.append(text('ready_text', 874, 514, 212, 24, '{{launchReady}}', 'mode', 'fg', 'left', 1, readyBy=True, toggle='!mapUp'))
    # the left panel's top row: the clock and the outside temperature
    W.append(text('time', 170, 158, 120, 33, '{{time}}', 'e_val', 'fg', 'right'))
    W.append(text('ampm', 296, 164, 44, 29, '{{ampmLc}}', 'e_unit', 'dim'))
    W.append(icon('ice_icon', 'snow', 344, 158, 24, 34, 'dim', iceBy=True))
    W.append(text('outside', 370, 158, 96, 33, '{{ambient}}', 'e_val', 'fg', 'right', iceBy=True))
    W.append(text('outside_unit', 472, 164, 40, 29, '{{u:temp}}', 'e_unit', 'dim'))
    # the left panel without the map (owner, 23 Nov 2026: "à gauche ... en gros la limitation de vitesse et l'alerte radar"): the limit as a big
    # road sign, the next one beside it, the 0-100 timer under that; with the map: the speed and the gear, the limit sign smaller beside them
    W.append(icon('lim_ring', 'ring', 150, 232, 150, 150, 'dim', toggle='!mapUp', limitBy=True))
    W.append(text('lim_num', 150, 280, 150, 64, '{{limit}}', 'unit', 'fg', 'center', toggle='!mapUp', limitBy=True))
    W.append(icon('lim_nxt_ring', 'ring', 320, 246, 72, 72, 'dim', toggle='!mapUp', nextBy=True))
    W.append(text('lim_nxt_num', 320, 268, 72, 29, '{{nextLimit}}', 'm_tiny', 'dim', 'center', toggle='!mapUp', nextBy=True))
    W.append(icon('run_icon', 'stopwatch', 318, 340, 32, 36, 'dim', toggle='!mapUp', launchBy=True))
    W.append(text('run_time', 352, 341, 110, 33, '{{launch}}', 'e_val', 'fg', 'right', toggle='!mapUp', launchBy=True, rate=100))
    W.append(text('run_unit', 466, 346, 30, 29, '{{launchUnit}}', 'e_unit', 'dim', toggle='!mapUp'))
    W.append(text('mspeed', 120, 224, 280, 70, '{{speed}}', 'e_big', 'fg', 'center', toggle='mapUp'))
    W.append(text('mspeed_unit', 210, 296, 100, 29, '{{u:speedLc}}', 'e_unit', 'dim', 'center', toggle='mapUp'))
    W.append(text('mgear', 200, 340, 120, 61, '{{gear}}', 'e_gear', 'fg', 'center', toggle='mapUp'))
    W.append(icon('o_lim_ring', 'ring', 400, 326, 88, 88, 'dim', toggle='mapUp', limitBy=True))
    W.append(text('o_lim_num', 400, 352, 88, 37, '{{limit}}', 'unit', 'fg', 'center', toggle='mapUp', limitBy=True))
    # the danger zone alert under them (both states), the car's warning triangle and lane assist wheel, and the share driven on electricity
    W += danger_alert(176, 436, 76)
    W.append(icon('lim_alert', 'warn', 150, 538, 56, 56, 'dim', alertBy=True))
    W.append(icon('lim_lane', 'wheel', 214, 538, 56, 56, 'dim', laneBy=True))
    W += ev_share(300, 550, 29, 34, 332, 550, 90, 33, 'e_val', 428, 556, 40, 29, 'e_unit')
    # the right panel's top row: the drive mode (the BC views open under it, tools/add_sensor_bars.py evo_views)
    W.append(text('drive_mode', 1400, 150, 340, 38, '{{modeName}}', 'e_mode', 'accent', 'right', accentBy=True))
    # the bottom row: fuel (left), oil and coolant (the middle tray), the battery (right), each on one line before its bar
    Y = 650
    W.append(icon('fuel_icon', 'fuel', 96, Y, 29, 34, 'fg'))
    W.append(text('range', 126, Y, 84, 33, '{{rangeTotal}}', 'e_val', 'fg', 'right'))
    W.append(text('range_unit', 216, Y + 6, 50, 29, '{{u:distLc}}', 'e_unit', 'dim'))
    W.append(icon('oil_icon', 'oilcan', 664, Y, 29, 34, 'dim', tempBy='oil'))
    W.append(text('oil', 698, Y, 72, 33, '{{oil}}', 'e_val', 'fg', 'right', tempBy='oil'))
    W.append(text('oil_unit', 774, Y + 6, 40, 29, '{{u:temp}}', 'e_unit', 'dim'))
    W.append(icon('cool_icon', 'therm', 976, Y, 29, 34, 'dim', tempBy='coolant'))
    W.append(text('cool', 1010, Y, 72, 33, '{{coolant}}', 'e_val', 'fg', 'right', tempBy='coolant'))
    W.append(text('cool_unit', 1086, Y + 6, 40, 29, '{{u:temp}}', 'e_unit', 'dim'))
    W.append(icon('batt_icon', 'battery', 1470, Y, 26, 34, 'dim'))
    W.append(text('ev_pct', 1500, Y, 60, 33, '{{hvSoc}}', 'e_val', 'fg', 'right'))
    W.append(text('ev_pct_unit', 1564, Y + 6, 26, 29, '%', 'e_unit', 'dim'))
    W.append(text('ev_range', 1594, Y, 60, 33, '{{evRange}}', 'e_val', 'fg', 'right'))
    W.append(text('ev_range_unit', 1658, Y + 6, 40, 29, '{{u:distLc}}', 'e_unit', 'dim'))
    return {
        'schemaVersion': 2, 'name': 'Shak', 'theme': 'evo', 'runUp': False, 'viewsWithMap': True,
        '_about': "Shak, generated by tools/gen_evo.py (edit that and regenerate): after the owner's picture of a race cluster "
                  "(23 Nov 2026), without its badges. His SHAK logo top middle, pill lights under it (the shift light), the rev counter as an arc "
                  "of blocks over a hexagon, the speed as an arc of blocks under it; in the hexagon the speed and the gear, or the Waze map (the "
                  "speed and the gear then on the left). Left without the map: the speed limit as a big sign, the danger alert; right: the BC "
                  "views under the drive mode; bottom: fuel, oil, coolant, battery with bars of blocks. Widget reference: shared/hud.js header.",
        'widgets': W,
    }


# the image sheets: fixed groups of widgets that sit close together (cluster-render's pixel memory is the sum of the sheets' boxes); the rest
# (the logo, the danger card) is packed by tools/pack_sheets.py
GROUPS = {
    'xs_e_rev': ['rev%d' % k for k in range(8)] + ['rev_unit', 'rev_charge'],
    'xs_e_spd': ['spd%d' % k for k in range(9)],
    'xs_e_mid': ['speed', 'speed_unit', 'gear', 'ready_flag', 'ready_text'],
    'xs_e_top': ['time', 'ampm', 'ice_icon', 'outside', 'outside_unit', 'drive_mode'],
    'xs_e_left': ['lim_ring', 'lim_num', 'lim_nxt_ring', 'lim_nxt_num', 'run_icon', 'run_time', 'run_unit', 'lim_alert', 'lim_lane',
                  'ev_share_icon', 'ev_share', 'ev_share_unit'],
    'xs_e_map': ['mspeed', 'mspeed_unit', 'mgear', 'o_lim_ring', 'o_lim_num'],
    'xs_e_bot': ['fuel_icon', 'range', 'range_unit', 'oil_icon', 'oil', 'oil_unit', 'cool_icon', 'cool', 'cool_unit',
                 'batt_icon', 'ev_pct', 'ev_pct_unit', 'ev_range', 'ev_range_unit'],
}
SHEETS = 3

if __name__ == '__main__':
    L = evo()
    for sheet, ids in GROUPS.items():
        for w in L['widgets']:
            if w['id'] in ids:
                w['sheet'] = sheet
    print('evo', pack_sheets.pack(L['widgets'], SHEETS))
    print('evo', add_sensor_bars.add('evo', L['widgets']))
    with open(OUT, 'w') as f:
        json.dump(L, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('wrote', os.path.normpath(OUT), len(L['widgets']), 'widgets')
