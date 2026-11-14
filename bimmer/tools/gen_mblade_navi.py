#!/usr/bin/env python3
"""Writes apps/shaktheme/hud/layouts/mblade.json and navi.json (the M Blade and Navi cluster themes).

Both are traced off a photo of a BMW cluster (Nov 14 2026): positions measured on an enlarged copy, mapped to the X3's
1920x720 panel by two anchors (BMW's seat-belt light at x 606, y 681; the map slot 416,120 1088x480), then kept clear of the
car's own zones (hood, the black box at x 1406..1597 y 342..419, the belt light at x 587..626 y 663..700, the map slot).
Edit this and run it again; the shaders (shared/shaders.js mblade, navi) take their geometry from the "backdrop" widget.
Usage: python3 tools/gen_mblade_navi.py   (from the app's root)
"""
import json, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'shaktheme', 'hud', 'layouts')


def text(id, x, y, w, h, t, font, color='fg', align=None, conn=0, **kw):
    d = {'id': id, 'type': 'text', 'z': 5, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color}
    if align:
        d['align'] = align
    if conn:
        d['conn'] = conn
    d.update(kw)
    return d


def icon(id, name, x, y, w, h, color='dim', conn=0, **kw):
    d = {'id': id, 'type': 'icon', 'icon': name, 'z': 5, 'x': x, 'y': y, 'w': w, 'h': h, 'color': color}
    if conn:
        d['conn'] = conn
    d.update(kw)
    return d


def shiftlight(x, y):
    return {'id': 'shiftlight', 'type': 'shiftlight', 'z': 3, 'x': x, 'y': y, 'w': 420, 'h': 56, 'segments': 5, 'from': 3000,
            'red': 4500, 'flash': 5500, 'gap': 11, 'center': 72, 'toggle': 'stockShiftLight'}


def emblem(x, y, keep):
    # keep: it stays while the Waze map is up
    return {'id': 'emblem', 'type': 'emblem', 'setting': 'emblem', 'keepWithMap': keep, 'z': 5, 'x': x, 'y': y, 'w': 360, 'h': 96}


RED = [255, 64, 56, 255]


def danger_alert(x, y, h):
    """The danger zone alert (shared/danger.js), in Waze's style: a dark rounded card with a red outline, a camera, DANGER,
    the distance and, when the source gives it, the speed limit in a red ring. Shown only while a zone is ahead (toggle
    "danger"; "dangerLimit" / "dangerNoLimit" pick the card with or without the limit sign). Drawn clear of the map window and
    of BMW's zones, where the theme has room: the caller picks x, y and the height (the card is 272 wide, 210 without the limit)."""
    top = round((h - 54) / 2.0)
    W = []
    for id, w, tog in (('al_card', 272, 'dangerLimit'), ('al_card2', 210, 'dangerNoLimit')):
        W.append({'id': id, 'type': 'box', 'z': 4, 'x': x, 'y': y, 'w': w, 'h': h, 'fill': [10, 10, 14, 255], 'line': RED,
                  'border': 3, 'radius': 20, 'toggle': tog, 'conn': 1})
    k = {'toggle': 'danger'}
    W.append(icon('al_cam', 'cam', x + 14, y + round((h - 48) / 2.0), 48, 48, RED, 1, **k))
    W.append(text('al_title', x + 72, y + top, 130, 19, 'DANGER', 'm_label', RED, 'left', 1, **k))
    W.append(text('al_dist', x + 72, y + top + 25, 78, 29, '{{dangerDist}}', 'm_mid', 'fg', 'right', 1, **k))
    W.append(text('al_unit', x + 154, y + top + 24, 42, 36, '{{dangerUnit}}', 'm_unit', 'dim', 'left', 1, **k))
    W.append(icon('al_ring', 'ring', x + 196, y + round((h - 64) / 2.0), 64, 64, RED, 1, toggle='dangerLimit'))
    W.append(text('al_limit', x + 196, y + round((h - 29) / 2.0), 64, 29, '{{dangerLimit}}', 'm_tiny', 'fg', 'center', 1, toggle='dangerLimit'))
    return W


# ------------------------------------------------------------------------------------------------ M Blade
# Traced off the owner's photo of a BMW M cluster (Nov 14 2026): the photo was warped to the 1920x720 panel (its four screen
# corners) and every element measured on it, so the numbers below are the photo's own, in panel px ("design" coordinates), except:
#  - the central group (hexagon, speed line, blade) sits DX px left of the photo's, so the blade's 3 and 4 keep ~40 px from the
#    black box BMW draws at x 1406..1597, y 342..419 (the photo's car has none);
#  - the rev scale reads 0..7 (the X3's 7000 rpm) over the photo's blade, the labels spaced to fill it;
#  - the photo's hexagon has the gear letter big in the void and the small speed under it with "km/h": both are kept (m_gear, m_spd).
# Waze's map is drawn at the centred 1088x480 of the panel (x 416..1504, y 120..600) and cannot be moved, so with the map up
# (Waze inside the theme, Cluster Centre, Cluster Info) the theme is rebuilt as the Sport theme is: the window in the middle
# (x 534..1386, y 120..600, the same as Sport's), the blade on the left, a small hexagon with the speed on the right above BMW's
# box, the strips and the temperatures below it, nothing under the map.
DX = -30
SLOPE = 0.5714                       # the labels' lean along the blade (x per y px)
RPM_Y0, RPM_Y7 = 613, 160            # y of the 0 and of the 7 mark on the photo's blade
SPD_Y = [613, 555, 497, 440, 380, 321, 266, 210, 153]    # y of the speed labels 0, 30 .. 150, 210, 270, 330


def spd_line_x(y, sp, sq):
    """x of the speed line at y: sp = [cap x, cap y, knee x, knee y], sq = [bottom x, bottom y, cap length]."""
    if y >= sp[3]:
        return sp[2] + (sq[0] - sp[2]) * (y - sp[3]) / float(sq[1] - sp[3])
    return sp[2] + (sp[0] - sp[2]) * (sp[3] - y) / float(sp[3] - sp[1])


def strip_x(g, y):
    return g[0] + g[3] * (y - g[1])


def mb_blade(pre, tog, T, s):
    """The rpm labels 0..7 and their unit along a blade placed by T (design x, y -> panel x, y) at scale s."""
    W = []
    for k in range(8):
        y = RPM_Y0 - k * (RPM_Y0 - RPM_Y7) / 7.0
        x = 1249 + SLOPE * (RPM_Y0 - y)
        px, py = T(x, y)
        W.append(text(pre + 'n%d' % k, round(px - 18), round(py - 15), 36, 30, str(k), 'm_num', 'fg', 'center', 1, toggle=tog))
    ux, uy = T(1391, 96)
    # the unit says what the marks mean: rpm, or kW x 10 while the battery alone drives (the hybrid rev counter, hud.js)
    W.append(text(pre + 'rpm_unit', round(ux - 85), round(uy), 170, 29, '{{tachUnit}}', 'm_tiny', 'fg', 'center', 1, toggle=tog))
    # CHARGE left of the foot while the battery charges (the foot itself fills green in the shader)
    cx, cy = T(1020, 604)
    W.append(text(pre + 'charge_note', round(cx - 110), round(cy - 15), 110, 30, '{{chargeNote}}', 'm_unit', 'fg', 'right', 1, toggle=tog))
    return W


def mb_fuel(pre, tog, G):
    """The numbers and pump of the fuel strip, which leans right ("\\"): its labels are on its right, as the photo's."""
    k = {'toggle': tog}
    top, bot = G[1], G[2]
    ys = [top + 11, top + 90 * (bot - top) / 179.0, bot - 11]      # the photo's 443, 522, 600 on a 432..611 strip
    W = []
    for y, t, n in zip(ys, ('1', '1/2', '0'), ('hi', 'mid', 'lo')):
        x = strip_x(G, y) + 27 + (11 if t == '1' else 9 if t == '1/2' else 13)
        W.append(text(pre + 'f_' + n, round(x), round(y - 12), 60, 23, t, 'm_gl', 'fg', 'left', 1, **k))
    px = strip_x(G, top + 129 * (bot - top) / 179.0) + 27 + 12
    W.append(icon(pre + 'fuel_icon', 'fuel', round(px), round(top + 114 * (bot - top) / 179.0), 28, 32, 'fg', 1, **k))
    return W


def mb_fuel_flat(pre, tog, x0, x1, y):
    """The flat fuel bar under the map window (the bar itself is drawn by the shader, 27 px thick from y): the pump left of it and the
    scale 0 / 1/2 / 1 under it."""
    k = {'toggle': tog}
    xm = (x0 + x1) / 2.0
    return [icon(pre + 'fuel_icon', 'fuel', x0 - 42, y - 3, 28, 32, 'fg', 1, **k),
            text(pre + 'f_lo', round(x0 - 10), y + 33, 40, 23, '0', 'm_gl', 'fg', 'left', 1, **k),
            text(pre + 'f_mid', round(xm - 30), y + 33, 60, 23, '1/2', 'm_gl', 'fg', 'center', 1, **k),
            text(pre + 'f_hi', round(x1 - 30), y + 33, 40, 23, '1', 'm_gl', 'fg', 'right', 1, **k)]


def mb_right_strip(pre, tog, G, name, hi, mid, lo, unit, icon_name, icon_w=26):
    """The numbers, unit and icon of a strip that leans left ("/"): its labels are on its left, as the photo's oil strip."""
    k = {'toggle': tog}
    top, bot = G[1], G[2]
    ys = [top + 10, top + 87 * (bot - top) / 176.0, bot - 11]
    W = []
    for y, t, n in zip(ys, (hi, mid, lo), ('hi', 'mid', 'lo')):
        W.append(text(pre + name + '_' + n, round(strip_x(G, y) - 13 - 70), round(y - 12), 70, 23, t, 'm_gl', 'fg', 'right', 1, **k))
    if unit:
        W.append(text(pre + name + '_unit', round(strip_x(G, top + 50 * (bot - top) / 176.0) - 13 - 52 - 8), round(top + 38 * (bot - top) / 176.0), 60, 32,
                      unit, 'm_tiny', 'fg', 'right', 1, **k))
    W.append(icon(pre + name + '_icon', icon_name, round(strip_x(G, top + 117 * (bot - top) / 176.0) - 13 - 36), round(top + 110 * (bot - top) / 176.0),
                  icon_w, 34, 'fg', 1, **k))
    return W


def mb_bottom_right(pre='', tog=None, dx=0, y=684):
    """The right end of the bottom row, on the fuel range's line and in its lettering (m_mid): the coolant temperature, the oil
    temperature (under its strip) and the electric range (under the battery strip), then the outside temperature (added by the
    caller). The two temperatures are coloured by their value (tempBy: blue cold, green warm, red flashing over the limit). The same
    in both views. Each is an icon, a number, a unit; the value boxes hold the longest value (three digits for the temperatures,
    302 F)."""
    k = {'toggle': tog} if tog else {}
    W = []
    for x, name, icon_name, tok, sig in ((1205, 'cool', 'therm', '{{coolant}}', 'coolant'), (1383, 'oil', 'oilcan', '{{oil}}', 'oil')):
        # the coolant is not under a strip: it keeps its place; the oil, and the electric range, follow their strips (dx)
        d = 0 if name == 'cool' else dx
        W.append(icon(pre + name + '_icon', icon_name, x + d, y - 3, 26, 34, 'fg', 1, **k))
        W.append(text(pre + name, x + d + 32, y, 87, 29, tok, 'm_mid', 'fg', 'right', 1, tempBy=sig, **k))
        W.append(text(pre + name + '_unit', x + d + 123, y + 3, 36, 32, '{{u:temp}}', 'm_tiny', 'dim', conn=1, **k))
    W += [icon(pre + 'ev_icon', 'battery', 1562 + dx, y - 3, 26, 34, 'fg', 1, **k),
          text(pre + 'ev_range', 1594 + dx, y, 62, 29, '{{evRange}}', 'm_mid', 'fg', 'right', 1, **k),
          text(pre + 'ev_range_unit', 1660 + dx, y + 3, 44, 32, '{{u:distLc}}', 'm_tiny', 'dim', conn=1, **k)]
    return W


def mblade():
    W = []
    base = {'type': 'mblade', 'class': 'content', 'z': 1, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'rpmMax': 7000, 'hybridTach': True}
    # ---- the normal view: the photo's own geometry, the central group DX px left
    SP = [610, 125, 500, 322]                    # speed line: cap left end, knee
    SQ = [663, 606, 52]                          # bottom end, cap length
    G0 = [339, 432, 611, 0.575]                  # fuel strip (leans right: outer line on the left)
    G1 = [1527, 435, 611, -0.565]                # oil temperature strip (leans left: outer line on the right), as the photo's
    G2 = [1657, 435, 611, -0.565]                # hybrid battery strip, 130 px right of it, the same top and bottom
    W.append(dict(base, id='backdrop', toggle='!mapUp', hex=[612 + DX, 167, 1.0, 0], sp=SP, sq=SQ, sy=[613, 321, 153],
                  bl=[137, 560, 1333 + DX, -0.558], br=[1487 + DX, -0.605, 13, 130], bx=[1.0, 1245 + DX, 864 + DX, 0],
                  scale=[RPM_Y7, RPM_Y0], g0=G0, g1=G1, g2=G2, deco=True))
    # ---- with the map up, as the photo's own map view: the map in a window at the left where the speed scale was (Waze on cluster draws it
    # right there, see mapPlace), the hexagon right of it with a gap (it no longer goes under the window), the blade and the two strips a
    # little to the right of the normal view (the blade's "4" is the limit: BMW's black box starts at x 1406), the fuel as a flat bar
    # under the window
    HB = 18                                       # the blade is this far right of the normal view (its "4" is the limit: BMW's black box)
    SX = 30                                       # the two strips (and the oil / electric range / outside under them)
    HNAR = 0.08                                   # the hexagon is this share narrower than the photo's (same height): its right tip stays 20 px
    HTIP = 612 + DX + 32 + round(567 * HNAR)      # from the blade, its left tip, where the window ends, moves right
    WIN = [80, 167, HTIP - 18 - 80, 422]          # the window (x, y, w, h): from the hood's limit (x 80 at y 167) to 18 px before the hexagon's tip

    def hexx(x, rel):
        """A text box of the normal view (x) placed in the narrower hexagon: its centre keeps its place in the hexagon, `rel` px (photo
        design) right of the tip."""
        return round(x + (HTIP - (612 + DX)) - rel * HNAR)

    INS = 10
    FB = [122, 558, 606]                          # the flat fuel bar: left end x, right end x, top y (27 thick)
    G1o = [G1[0] + SX, G1[1], G1[2], G1[3]]
    G2o = [G2[0] + SX, G2[1], G2[2], G2[3]]
    G0o = [FB[2], 1920 - FB[1], 1920 - FB[0], 0]  # the first strip, lying flat: in the frame the shader turns it into
    W.append(dict(base, id='backdrop_open', toggle='mapUp', hex=[HTIP, 167, 1.0, HNAR],
                  bl=[137, 560, 1333 + DX + HB, -0.558], br=[1487 + DX + HB, -0.605, 13, 130],
                  bx=[1.0, 1245 + DX + HB, HTIP + round(252 * (1 - HNAR)), 0],
                  scale=[RPM_Y7, RPM_Y0], g0=G0o, g1=G1o, g2=G2o, fuelH=True, deco=True,
                  hole=[WIN[0] - INS, WIN[1] - INS, WIN[2] + 2 * INS, WIN[3] + 2 * INS], holeWhen='mapUp', holeInset=INS, holeRadius=14,
                  mapPlace=True))
    W.append(shiftlight(750, 32))          # where BMW's own shift light sits (x 750..1170), as on the M and Sport themes
    # the speed scale: nine labels left of the line (photo: right edge 22 px before the line), the unit above its cap
    for i, y in enumerate(SPD_Y):
        sw = 100 if i >= 4 else 70           # the labels from 120 km/h up have three digits
        W.append(text('spd%d' % i, round(spd_line_x(y, SP, SQ) - 22 - sw), round(y - 15), sw, 30, '{{ms:%d}}' % i, 'm_num', 'fg', 'right',
                      toggle='!mapUp'))
    W.append(text('spd_unit', 599, 92, 70, 32, '{{u:speedLc}}', 'm_tiny', 'fg', 'center', toggle='!mapUp'))
    # the hexagon, as the photo has it: the selector letter big in the void (D, or S / M by the shifter programme, P R N; BMW's own
    # box shows it too), the speed small right under it with "km/h" beside it, the battery's power in kW one line lower when eDrive
    # Live shares it, the drive mode on the tabs
    W.append(text('gear', 725, 291, 280, 101, '{{stage}}', 'm_gear', align='center', toggle='!mapUp'))
    W.append(text('speed', 735, 449, 170, 40, '{{speed}}', 'm_spd', 'fg', 'right', toggle='!mapUp'))
    W.append(text('speed_unit', 915, 461, 80, 32, '{{u:speedLc}}', 'm_tiny', 'fg', 'left', toggle='!mapUp'))
    W.append(text('power', 740, 528, 120, 29, '{{powerKw}}', 'm_mid', 'fg', 'right', 1, toggle='powerShut'))
    W.append(text('power_unit', 866, 528, 50, 36, 'kW', 'm_unit', 'dim', 'left', 1, toggle='powerShut'))
    W.append(text('drive_mode', 851, 668, 200, 24, '{{modeName}}', 'mode', 'fg', 'center', 1, toggle='!mapUp'))
    W.append(text('o_gear', hexx(725, 283), 291, 280, 101, '{{stage}}', 'm_gear', align='center', toggle='mapUp'))
    W.append(text('o_speed', hexx(735, 283), 449, 170, 40, '{{speed}}', 'm_spd', 'fg', 'right', toggle='mapUp'))
    W.append(text('o_speed_unit', hexx(915, 283), 461, 80, 32, '{{u:speedLc}}', 'm_tiny', 'fg', 'left', toggle='mapUp'))
    W.append(text('o_power', hexx(740, 283), 528, 120, 29, '{{powerKw}}', 'm_mid', 'fg', 'right', 1, toggle='powerOpen'))
    W.append(text('o_power_unit', hexx(866, 283), 528, 50, 36, 'kW', 'm_unit', 'dim', 'left', 1, toggle='powerOpen'))
    W.append(text('o_drive_mode', hexx(851, 369), 668, 200, 24, '{{modeName}}', 'mode', 'fg', 'center', 1, toggle='mapUp'))
    W.extend(mb_blade('', '!mapUp', lambda x, y: (x + DX, y), 1.0))
    W.extend(mb_blade('o_', 'mapUp', lambda x, y: (x + DX + HB, y), 1.0))
    # the strips' numbers: fuel on the left; on the right the oil temperature (50 / 100 / 150) and the battery (0 / 50 / 100 %)
    W.extend(mb_fuel('', '!mapUp', G0))
    W.extend(mb_right_strip('', '!mapUp', G1, 'o', '{{tc:150}}', '{{tc:100}}', '{{tc:50}}', '{{u:temp}}', 'oilcan', 30))
    W.extend(mb_right_strip('', '!mapUp', G2, 'b', '100', '50', '0', '%', 'battery'))
    W.extend(mb_right_strip('o_', 'mapUp', G1o, 'o', '{{tc:150}}', '{{tc:100}}', '{{tc:50}}', '{{u:temp}}', 'oilcan', 30))
    W.extend(mb_right_strip('o_', 'mapUp', G2o, 'b', '100', '50', '0', '%', 'battery'))
    W.extend(mb_fuel_flat('o_', 'mapUp', FB[0], FB[1], FB[2]))
    # bottom row, as the photo: the clock at the far left, the range with its pump, the outside temperature at the far right
    W.append(text('time', 40, 684, 130, 29, '{{time}}', 'm_mid', 'fg', 'right'))
    W.append(text('ampm', 176, 687, 53, 32, '{{ampmLc}}', 'm_tiny', 'dim'))
    W.append(icon('range_icon', 'fuel', 313, 681, 29, 34, 'fg', 1))
    W.append(text('range', 348, 684, 112, 29, '{{range}}', 'm_mid', 'fg', 'right', 1))
    W.append(text('range_unit', 466, 687, 44, 32, '{{u:distLc}}', 'm_tiny', 'dim', conn=1))
    # the right end follows the strips: in the map view they are SX px further right, so the oil, the electric range and the outside
    # temperature move with them (the coolant stays)
    W.extend(mb_bottom_right('', '!mapUp', 0))
    W.extend(mb_bottom_right('o_', 'mapUp', SX))
    W.append(text('outside', 1722, 684, 118, 29, '{{ambient}}', 'm_mid', 'fg', 'right', 1, toggle='!mapUp'))
    W.append(text('outside_unit', 1846, 687, 44, 32, '{{u:temp}}', 'm_tiny', 'dim', conn=1, toggle='!mapUp'))
    OX = SX - 16          # (its value box holds '+104', so its left 30 px are empty for '+22': it needs less than the strips' shift)
    W.append(text('o_outside', 1722 + OX, 684, 118, 29, '{{ambient}}', 'm_mid', 'fg', 'right', 1, toggle='mapUp'))
    W.append(text('o_outside_unit', 1846 + OX, 687, 44, 32, '{{u:temp}}', 'm_tiny', 'dim', conn=1, toggle='mapUp'))
    W += danger_alert(1612, 340, 78)       # right of BMW's black box (x < 1597), above the strips (y 435)
    return {
        'schemaVersion': 2, 'name': 'M Blade', 'theme': 'mblade',
        '_about': "M Blade, traced off a photo of a BMW M cluster (Nov 14 2026; the photo was warped to the panel and measured), generated by "
                  "tools/gen_mblade_navi.py (edit that and regenerate): the speed scale as a cyan line with a knee on the left (a marker at "
                  "the speed), a blue hexagon in panels with the gear letter big in the void across it (D, or S / M by the shifter programme, P R N) and the "
                  "speed small right under it with km/h (the drive mode on the four tabs under it, the battery's power in kW under the speed "
                  "when eDrive Live shares it), the red rev blade on the right (0..7000 rpm, the "
                  "stock-style shift light at the top), the fuel strip bottom left and, bottom right, two aligned strips: the oil temperature "
                  "(blue under 75 deg, green warm, red flashing over the limit) and the hybrid battery in %. Along the bottom row, in one "
                  "lettering: the clock, the fuel range, then the coolant temperature, the oil temperature and the electric range (each under "
                  "its strip) and the outside temperature, clear of BMW's belt light (x 587..626, y 663..700). Waze's map normally sits at "
                  "the centred 1088x480 of the panel; Waze on the cluster 0.9.107 or later takes a window from shared/map_window.js "
                  "(map_window.txt) and this layout asks for a narrow one at the far left like the photo (x 80..641, y 167..589) when "
                  "'Show Waze map inside the theme' is on. The theme is then rebuilt (backdrop_open and the o_ readouts): the hexagon "
                  "(8 % narrower, same height, its right tip stays put), the blade (18 px) and the strips (30 px, with the oil, electric range and outside temperature under them) move to the right so nothing is tight against the map, the speed scale gives way to the map "
                  "and the vertical fuel strip becomes a flat bar under the map (pump icon, 0 / 1/2 / 1). "
                  "Nothing is drawn under the map. Clear of the black box BMW draws at x 1406..1597, y 342..419. Widget reference: "
                  "shared/hud.js header.",
        'widgets': W,
    }


# ------------------------------------------------------------------------------------------------ Navi
def navi():
    W = []
    base = {'type': 'navi', 'class': 'content', 'z': 1, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
            'scale': [236, 612], 'line2': [577, 1500, 1620], 'barL': [152, 679, 240], 'barR': [1270, 679, 210]}
    W.append(dict(base, id='backdrop', toggle='!mapUp',
                  band={'tip': [1.5, 179.7], 'slope': 0.932, 'bottom': 618, 'sep': [93.6, 0.0225], 'edge': [224.5, -0.034], 'top': 227},
                  line=[474, 618, 1404, 1453]))
    # with the map up, as in Sport: the window in the middle (x 534..1386, y 120..600), the band steeper and narrower so it
    # stays left of it, nothing under the map; the speed goes to the right
    W.append(dict(base, id='backdrop_open', toggle='mapUp',
                  band={'tip': [40, 179.7], 'slope': 1.6, 'bottom': 618, 'sep': [80, 0.0225], 'edge': [190, -0.034], 'top': 227},
                  line=[500, 618, 1404, 1453],
                  hole=[524, 110, 872, 500], holeWhen='mapUp', holeInset=10, holeRadius=28))
    W.append(shiftlight(750, 34))          # where BMW's own shift light sits (x 750..1170)
    W.append(emblem(780, 100, False))      # the lettering, centred right under the shift light, over the gear; hidden while the map window is open
    # speed scale labels (SPEED_SCALE 0..250 / 0..160 mph) along the band's lower-left side; 88 wide: the top "250" is three wide
    # digits and was cut at its left edge in a 70 wide box (QA, Nov 14 2026); x stays right of the hood at the far left
    for i in range(8):
        y = 612 - 47 * i
        mg = 24 if i < 7 else 14          # the top one (250) is the widest and sits at the far left, so it moves 10 px nearer the band
        xl = 1.5 + (y - 179.7) / 0.932
        W.append(text('spd%d' % i, max(10, round(xl - mg - 88)), round(y - 19), 88, 38, '{{spd:%d}}' % i, 'm_num', align='right',
                      near=['speed', i], toggle='!mapUp'))
        xo = 40 + (y - 179.7) / 1.6
        W.append(text('o_spd%d' % i, max(10, round(xo - mg - 88)), round(y - 19), 88, 38, '{{spd:%d}}' % i, 'm_num', align='right',
                      near=['speed', i], toggle='mapUp'))
    # speed: big in the middle while there is no map window, big on the right (above BMW's black box) while there is
    # (no gear: BMW's own black box, its gear slot, already shows it; the speed takes the gear's place, in the big font)
    W.append(text('speed', 760, 222, 400, 117, '{{speed}}', 'm_gear', align='center', toggle='!mapUp'))
    W.append(text('speed_unit', 760, 346, 400, 29, '{{u:speedLc}}', 'm_tiny', 'dim', 'center', toggle='!mapUp'))
    W.append(text('mspeed', 1570, 207, 280, 82, '{{speed}}', 'm_big', align='center', toggle='mapUp'))
    W.append(text('mspeed_unit', 1670, 314, 80, 29, '{{u:speedLc}}', 'm_tiny', 'dim', 'center', toggle='mapUp'))
    # the two bars along the bottom, each with its remaining range above its right end: the fuel on the left, the hybrid
    # battery on the right (its charge above its left end); the clock between them stops before BMW's belt light (x 587)
    W.append(icon('fuel_icon', 'fuel', 112, 662, 29, 34))
    W.append(text('range', 226, 630, 114, 34, '{{range}}', 'm_mid', 'fg', 'right'))
    W.append(text('range_unit', 346, 636, 48, 29, '{{u:distLc}}', 'm_tiny', 'dim'))
    W.append(text('time', 395, 664, 140, 34, '{{time}}', 'm_mid', 'fg', 'right'))
    W.append(text('ampm', 541, 670, 44, 29, '{{ampmLc}}', 'm_tiny', 'dim'))
    W.append(icon('batt_icon', 'battery', 1230, 662, 26, 34, 'dim', 1))
    W.append(text('ev_pct', 1270, 630, 90, 34, '{{hvSoc}}', 'm_mid', 'fg', 'left', 1))
    W.append(text('ev_pct_unit', 1366, 636, 30, 29, '%', 'm_tiny', 'dim', conn=1))
    W.append(text('ev_range', 1400, 630, 60, 34, '{{evRange}}', 'm_mid', 'fg', 'right', 1))
    W.append(text('ev_range_unit', 1466, 636, 44, 29, '{{u:distLc}}', 'm_tiny', 'dim', conn=1))
    # the oil and outside temperatures in the free space on the right (right of the map window, under BMW's black box)
    W.append(icon('oil_icon', 'oilcan', 1644, 446, 29, 34, 'dim', 1))
    W.append(text('oil', 1684, 447, 96, 34, '{{oil}}', 'm_mid', 'fg', 'right', 1, tempBy='oil'))
    W.append(text('oil_unit', 1786, 453, 44, 29, '{{u:temp}}', 'm_tiny', 'dim', conn=1))
    W.append(icon('out_icon', 'therm', 1644, 506, 29, 34, 'dim', 1))
    W.append(text('outside', 1676, 507, 104, 34, '{{ambient}}', 'm_mid', 'fg', 'right', 1))
    W.append(text('outside_unit', 1786, 513, 44, 29, '{{u:temp}}', 'm_tiny', 'dim', conn=1))
    W += danger_alert(1196, 38, 76)         # in the top strip right of the shift light: clear of the map window (y 120) and of the hood
    W.append(text('drive_mode', 1664, 698, 216, 22, '{{modeName}}', 'mode', 'dim', 'right', 1))
    return {
        'schemaVersion': 2, 'name': 'Navi', 'theme': 'navi',
        '_about': "Navi, after a photo of a BMW map view (Nov 14 2026), generated by tools/gen_mblade_navi.py (edit that and regenerate): "
                  "a wide diagonal speed band on the left (textured blue stripe, violet stripe, a white marker at the speed on the "
                  "same scale as the Sport theme), the big rounded map window with the white line under it that steps up at the right, and thin bars along the bottom: "
                  "fuel with its range on the left, the hybrid battery with its electric range on the right (in place of the photo's oil "
                  "temperature, which moves to the free column on the right). The stock-style shift light and the lettering are at the top. Without a "
                  "map window the speed is big in the middle; with one (Waze, Cluster Centre, Cluster Info) the theme is rebuilt "
                  "as the Sport theme is (backdrop_open and the o_ readouts): the window at x 534..1386, y 120..600, the band steeper "
                  "and narrower on the left, the speed big on the right above BMW's black box, nothing under the map. Clear of BMW's belt light (x 587..626, y 663..700). Widget reference: shared/hud.js header.",
        'widgets': W,
    }


if __name__ == '__main__':
    for name, L in (('mblade', mblade()), ('navi', navi())):
        p = os.path.join(OUT, name + '.json')
        with open(p, 'w') as f:
            json.dump(L, f, indent=2)
            f.write('\n')
        print('wrote', os.path.normpath(p), len(L['widgets']), 'widgets')
