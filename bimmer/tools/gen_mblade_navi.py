#!/usr/bin/env python3
"""Writes apps/shaktheme/hud/layouts/mblade.json and navi.json (the M Blade and Navi cluster themes).

Both are traced off a photo of a BMW cluster (Nov 14 2026): positions measured on an enlarged copy, mapped to the X3's
1920x720 panel by two anchors (BMW's seat-belt light at x 606, y 681; the map slot 416,120 1088x480), then kept clear of the
car's own zones (hood, the black box at x 1406..1597 y 322..440, the belt light at x 587..626 y 663..700, the map slot).
Edit this and run it again; the shaders (shared/shaders.js mblade, navi) take their geometry from the "backdrop" widget.
Usage: python3 tools/gen_mblade_navi.py   (from the app's root)
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zoom_labels import zoomify
import pack_sheets

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'shaktheme', 'hud', 'layouts')


def text(id, x, y, w, h, t, font, color='fg', align=None, conn=0, **kw):
    d = {'id': id, 'type': 'text', 'z': 5, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color}
    if align:
        d['align'] = align
    if conn:
        d['conn'] = conn
    if t in LOW_TEXT:
        d['lowWhen'] = LOW_TEXT[t]
    d.update(kw)
    return d


# the modern icons (shared/icons.js): the oil can with its drop, the thermometer with heat waves, the cell with a bolt, the pump
LOW_ICON = {'fuelPump': 'fuel', 'fuelBolt': 'fuel', 'battBolt': 'battery'}          # the reserve: the fuel range at 90 km, the charge at 10 %
LOW_TEXT = {'{{range}}': 'fuel', '{{rangeTotal}}': 'fuel', '{{evRange}}': 'battery', '{{hvSoc}}': 'battery'}
MODERN = {'oilcan': 'oilPour', 'therm': 'tempWave', 'battery': 'battBolt', 'fuel': 'fuelPump'}


def icon(id, name, x, y, w, h, color='dim', conn=0, **kw):
    name = MODERN.get(name, name)
    if name in LOW_ICON:
        kw.setdefault('lowWhen', LOW_ICON[name])      # in reserve: the shift red
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
#    black box BMW draws at x 1406..1597, y 322..440 (the photo's car has none);
#  - the rev scale reads 0..7 (the X3's 7000 rpm) over the photo's blade, the labels spaced to fill it;
#  - the photo's hexagon has the gear letter big in the void and the small speed under it with "km/h": both are kept (m_gear, m_spd).
# Waze's map is drawn at the centred 1088x480 of the panel (x 416..1504, y 120..600) and cannot be moved, so with the map up
# (Waze inside the theme, Cluster Centre, Cluster Info) the theme is rebuilt as the Sport theme is: the window in the middle
# (x 534..1386, y 120..600, the same as Sport's), the blade on the left, a small hexagon with the speed on the right above BMW's
# box, the strips and the temperatures below it, nothing under the map.
DX = -30
ROW = 668                            # the bottom row's text top in the normal view: the same height as with the map (ROW_O), now that BMW's black box is gone (gear window, size 1: x 1380..1460, y 660..720 stays free); units end at y 703
ROW_O = 668                          # ... and with the map up (the map and its fuel bar take the room above): one notch up from the panel's edge, its middle (y 682) on the middle of BMW's belt light and gear letter, the right end clear of their box
SLOPE = 0.5714                       # the labels' lean along the blade (x per y px)
RPM_Y0, RPM_Y7 = 613, 160            # y of the 0 and of the 7 mark on the photo's blade
SPD_Y = [613, 555, 497, 440, 380, 321, 266, 210, 153]    # y of the speed labels 0, 30 .. 150, 210, 270, 330


PLAIN = True                  # M Blade's launch cue: green (True: white)
HYB_BLUE = [77, 191, 255, 255]


def ev_share(ix, iy, iw, ih, nx, ny, nw, nh, num_font, ux, uy, uw, uh, unit_font, pre='', tog=None):
    """The share of the drive done on electricity: a leaf in the hybrid blue, the percentage, a % (all blank without a hybrid battery or under 0.3 km)."""
    k = {'toggle': tog} if tog else {}
    return [icon(pre + 'ev_share_icon', 'leaf', ix, iy, iw, ih, HYB_BLUE, evShareBy=True, **k),
            text(pre + 'ev_share', nx, ny, nw, nh, '{{evShare}}', num_font, 'fg', 'right', **k),
            text(pre + 'ev_share_unit', ux, uy, uw, uh, '{{evShareUnit}}', unit_font, 'dim', **k)]


def bottom_cue(y, cx=960):
    """The launch cue (Sport drive mode, standing still, the engine at the throttle speed) at the bottom centre, one row: a chequered flag in green and
    "Launch Control Ready" in the same small font as the drive mode's name, centred on `cx` (the row is 244 px wide). On the second connection:
    the first has no layer to spare."""
    x0 = cx - 122
    return [icon('ready_flag', 'flag', x0, y, 28, 28, 'fg', 1, readyBy=True),
            text('ready_text', x0 + 36, y + 2, 212, 24, '{{launchReady}}', 'mode', 'fg', 'left', 1, readyBy=True)]


def tab_cue(cx, pre, toggle, plain):
    """M Blade's launch cue: where the drive mode's name is written, on the hexagon's tab (the name gives way while it is up). One row centred on `cx`:
    the flag, then the words in the name's font. `plain`: in the widgets' own white (the tab already has the mode's colour) rather than green."""
    x0 = cx - 122
    mark = 'plain' if plain else True
    return [icon(pre + 'ready_flag', 'flag', x0, 666, 28, 28, 'fg', 1, toggle=toggle, readyBy=mark),
            text(pre + 'ready_text', x0 + 36, 668, 212, 24, '{{launchReady}}', 'mode', 'fg', 'left', 1, toggle=toggle, readyBy=mark)]


def limit_and_timer(cx, top, R, compact=False, ring=None, next_at=None):
    """The speed limit ring (a ring with the limit in it, white, red while the car is over it) and the 0-100 timer (a stopwatch, the time, an s):
    both are blank until they have something to show, and neither is drawn while the Waze map is up (Waze shows the limit itself).
    The timer takes the place cx, top, R in the middle; `compact`: the timer stacked (the stopwatch over the time) to fit the narrow place it has.
    `ring` = (x, y, size): the ring itself sits in a bottom corner, small, out of the way (the digits in the alert ring's font); it is
    not drawn in the middle, so the timer has it to itself."""
    if ring:
        rx, ry, rs = ring
        out = [icon('lim_ring', 'ring', rx, ry, rs, rs, 'dim', toggle='!mapUp', limitBy=True),
               text('lim_num', rx, ry + (rs - 29) // 2 + 1, rs, 29, '{{limit}}', 'm_tiny', 'fg', 'center', toggle='!mapUp', limitBy=True)]
        # the next limit the camera recognised: a smaller ring under it (blank until there is one), and the car's check control message: a warning
        # triangle above it (yellow, only with the setting "carAlert"); and the lane assist's steering wheel above it (setting "carLane"); the same in the Sport and M themes (hud/layouts/*.json)
        nx = 64
        dx, dy = next_at or ((rs - nx) // 2, rs + 4)          # the next limit's ring sits under the ring, or where `next_at` = (dx, dy) says (BMW's black box takes the bottom)
        out += [icon('lim_nxt_ring', 'ring', rx + dx, ry + dy, nx, nx, 'dim', toggle='!mapUp', nextBy=True),
                text('lim_nxt_num', rx + dx, ry + dy + (nx - 29) // 2 + 1, nx, 29, '{{nextLimit}}', 'm_tiny', 'dim', 'center', toggle='!mapUp', nextBy=True),
                icon('lim_alert', 'warn', rx + (rs - 56) // 2, ry - 60, 56, 56, 'dim', toggle='!mapUp', alertBy=True),
                icon('lim_lane', 'wheel', rx + (rs - 56) // 2, ry - 120, 56, 56, 'dim', toggle='!mapUp', laneBy=True)]       # the lane assist's steering wheel (setting "carLane"), above the triangle
    else:
        out = [icon('lim_ring', 'ring', cx - R // 2, top, R, R, 'fg', toggle='!mapUp', limitBy=True),
               text('lim_num', cx - R // 2, top + (R - 37) // 2, R, 37, '{{limit}}', 'unit', 'fg', 'center', toggle='!mapUp', limitBy=True)]
    if compact:
        out += [icon('run_icon', 'stopwatch', cx - 13, top - 4, 26, 30, 'dim', toggle='!mapUp', launchBy=True),
                text('run_time', cx - 50, top + 30, 100, 34, '{{launch}}', 'm_mid', 'fg', 'center', toggle='!mapUp', launchBy=True, rate=100)]
    else:
        T = top + 29
        out += [icon('run_icon', 'stopwatch', cx - 98, T - 1, 32, 36, 'dim', toggle='!mapUp', launchBy=True),
                text('run_time', cx - 58, T, 120, 34, '{{launch}}', 'm_mid', 'fg', 'right', toggle='!mapUp', launchBy=True, rate=100),
                text('run_unit', cx + 68, T + 6, 30, 29, '{{launchUnit}}', 'm_tiny', 'dim', toggle='!mapUp')]
    return out


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
    ik = dict(k)
    if name == 'o':
        ik['tempBy'] = 'oil'                  # the oil can takes the colour of the oil temperature's number
    W.append(icon(pre + name + '_icon', icon_name, round(strip_x(G, top + 117 * (bot - top) / 176.0) - 13 - 36), round(top + 110 * (bot - top) / 176.0),
                  icon_w, 34, 'fg', 1, **ik))
    return W


ROW1 = 622                             # the row of the three sensors: just under the strips' lower end (y 611), above BMW's gear hole (it starts at y 660)
RC_ICON, RC_NUM, RC_UNIT = 1726, 1754, 1862   # the right column: the icons, the numbers' left edge (box 104 wide, right edge 1858), the units


def mb_under_strips(pre, tog, cx_oil, cx_ev, y=ROW1):
    """The oil temperature and the electric range, each centred right under its own strip (cx: the middle of the strip's lower end), on the
    sensors' row (ROW1). No icon here: the strip's own icon (the oil can, the battery) is just above, and with icons the two groups touched
    (the strips are 130 px apart). The number ends 20 px (oil) or 6 px (range) right of the strip's middle and its unit follows at once, so a two- or
    three-digit value stays under the strip. The oil takes the colour of its value (tempBy: blue cold, green warm, red flashing over the limit).
    The value boxes hold the longest value (302 F = 87 px, an electric range 99 = 58)."""
    k = {'toggle': tog} if tog else {}
    ro, re_ = cx_oil + 20, cx_ev + 6
    return [text(pre + 'oil', ro - 87, y, 87, 29, '{{oil}}', 'm_mid', 'fg', 'right', 1, tempBy='oil', **k),
            text(pre + 'oil_unit', ro + 1, y + 3, 28, 32, '{{u:temp}}', 'm_tiny', 'dim', conn=1, **k),
            text(pre + 'ev_range', re_ - 58, y, 58, 29, '{{evRange}}', 'm_mid', 'fg', 'right', 1, **k),
            text(pre + 'ev_range_unit', re_ + 1, y + 3, 36, 32, '{{u:distLc}}', 'm_tiny', 'dim', conn=1, **k)]


def mb_side_block():
    """The coolant temperature (no strip of its own, with its thermometer) and the outside temperature (no icon), in one table at the far right: the coolant on the sensors' row,
    a little above, the outside temperature on the bottom row. The same in both views (clear of the strips, whose right edge is x 1692 at most).
    Icons in one column, values ending at the same x, units in one column. The coolant is coloured by its value (tempBy); the outside one has NO
    icon (its thermometer looks like the coolant's: the owner would confuse them, Nov 16 2026), it goes blue near freezing (iceBy) and a snowflake
    shows then in the icon column."""
    W = [icon('cool_icon', 'therm', RC_ICON, ROW1 - 3, 26, 34, 'fg', 1, tempBy='coolant'),
         text('cool', RC_NUM, ROW1, 104, 29, '{{coolant}}', 'm_mid', 'fg', 'right', 1, tempBy='coolant'),
         text('cool_unit', RC_UNIT, ROW1 + 3, 44, 32, '{{u:temp}}', 'm_tiny', 'dim', conn=1),
         icon('ice_icon', 'snow', RC_ICON, ROW - 1, 24, 32, 'dim', iceBy=True),
         text('outside', RC_NUM, ROW, 104, 29, '{{ambient}}', 'm_mid', 'fg', 'right', 1, iceBy=True),
         text('outside_unit', RC_UNIT, ROW + 3, 44, 32, '{{u:temp}}', 'm_tiny', 'dim', conn=1)]
    return W


def mblade():
    W = []
    base = {'type': 'mblade', 'class': 'content', 'z': 1, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'rpmMax': 7000, 'hybridTach': True}
    # ---- the normal view: the photo's own geometry, the central group DX px left
    SP = [610, 125, 500, 322]                    # speed line: cap left end, knee
    SQ = [663, 606, 52]                          # bottom end, cap length
    G0 = [339, 432, 611, 0.575]                  # fuel strip (leans right: outer line on the left)
    G1 = [1523, 443, 611, -0.565]                # oil temperature strip (leans left: outer line on the right), as the photo's but 8 px shorter at the top: BMW's black box ends at y 440
    G2 = [1653, 443, 611, -0.565]                # hybrid battery strip, 130 px right of it, the same top and bottom
    W.append(dict(base, id='backdrop', toggle='!mapUp', hex=[612 + DX, 167, 1.0, 0], sp=SP, sq=SQ, sy=[613, 321, 153],
                  bl=[137, 560, 1333 + DX, -0.558], br=[1487 + DX, -0.605, 13, 130], bx=[1.0, 1245 + DX, 864 + DX, 0],
                  scale=[RPM_Y7, RPM_Y0], g0=G0, g1=G1, g2=G2, deco=True))
    # ---- with the map up: the map in a window in the middle of Waze on cluster's own slot (x 416..1504, y 120..600, where it draws the map by
    # default; a Waze on cluster that honours our window (0.9.107+, see mapPlace) fills this same window with the map centred on the car).
    # The first version put the window at the far left like the photo's own map view, outside that slot: with the Waze on cluster the
    # owner's car runs only a sliver of the map showed in it and BMW's own dial showed through the rest (photos of Nov 15 2026). The hexagon
    # gives way (no room beside a window this wide); the gear and the speed take the left column, the blade and the two strips stay on the
    # right a little further right than the normal view (the blade's "4" is the limit: BMW's black box starts at x 1406), the fuel as a
    # flat bar under the window
    HB = 18                                       # the blade is this far right of the normal view (its "4" is the limit: BMW's black box)
    SX = 30                                       # the two strips (and the oil / electric range / outside under them)
    WIN = [446, 128, 582, 450]                    # the window (x, y, w, h): inside Waze's slot, clear of the shift light above and the blade at the right
    LX = 84                                       # the gear's box in the left column (the hood's limit is x 80 at y 167)
    INS = 10
    FB = [462, 962, 598]                          # the flat fuel bar: left end x, right end x, top y (27 thick), under the window
    G1o = [G1[0] + SX, G1[1], G1[2], G1[3]]
    G2o = [G2[0] + SX, G2[1], G2[2], G2[3]]
    G0o = [FB[2], 1920 - FB[1], 1920 - FB[0], 0]  # the first strip, lying flat: in the frame the shader turns it into
    W.append(dict(base, id='backdrop_open', toggle='mapUp',
                  bl=[137, 560, 1333 + DX + HB, -0.558], br=[1487 + DX + HB, -0.605, 13, 130],
                  bx=[1.0, 1245 + DX + HB, 992, 0],
                  scale=[RPM_Y7, RPM_Y0], g0=G0o, g1=G1o, g2=G2o, fuelH=True,
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
    # (its name stays white: it sits on the hexagon's tab, which already takes the mode's colour)
    W.append(text('drive_mode', 851, 668, 200, 24, '{{modeName}}', 'mode', 'fg', 'center', 1, toggle='!mapUp', readyHides=True))
    W.extend(tab_cue(851 + 100, '', '!mapUp', PLAIN))
    W.append(text('o_gear', LX, 291, 280, 101, '{{stage}}', 'm_gear', align='center', toggle='mapUp'))
    W.append(text('o_speed', LX + 10, 449, 170, 40, '{{speed}}', 'm_spd', 'fg', 'right', toggle='mapUp'))
    W.append(text('o_speed_unit', LX + 190, 461, 80, 32, '{{u:speedLc}}', 'm_tiny', 'fg', 'left', toggle='mapUp'))
    W.append(text('o_power', LX + 15, 528, 120, 29, '{{powerKw}}', 'm_mid', 'fg', 'right', 1, toggle='powerOpen'))
    W.append(text('o_power_unit', LX + 141, 528, 50, 36, 'kW', 'm_unit', 'dim', 'left', 1, toggle='powerOpen'))
    W.append(text('o_drive_mode', 860, 668, 200, 24, '{{modeName}}', 'mode', 'fg', 'center', 1, toggle='mapUp', readyHides=True))
    W.extend(tab_cue(960, 'o_', 'mapUp', PLAIN))
    W.extend(mb_blade('', '!mapUp', lambda x, y: (x + DX, y), 1.0))
    W.extend(mb_blade('o_', 'mapUp', lambda x, y: (x + DX + HB, y), 1.0))
    # the strips' numbers: fuel on the left; on the right the oil temperature (50 / 100 / 150) and the battery (0 / 50 / 100 %)
    W.extend(mb_fuel('', '!mapUp', G0))
    W.extend(mb_right_strip('', '!mapUp', G1, 'o', '{{tc:150}}', '{{tc:100}}', '{{tc:50}}', '{{u:temp}}', 'oilcan', 30))
    W.extend(mb_right_strip('', '!mapUp', G2, 'b', '100', '50', '0', '%', 'battery'))
    W.extend(mb_right_strip('o_', 'mapUp', G1o, 'o', '{{tc:150}}', '{{tc:100}}', '{{tc:50}}', '{{u:temp}}', 'oilcan', 30))
    W.extend(mb_right_strip('o_', 'mapUp', G2o, 'b', '100', '50', '0', '%', 'battery'))
    W.extend(mb_fuel_flat('o_', 'mapUp', FB[0], FB[1], FB[2]))
    # bottom row, as the photo: the clock at the far left, the range with its pump, the outside temperature at the far right. Two heights: in the
    # normal view the whole row is above BMW's gear letter and its black box; with the map up it stays at the bottom, one notch up (ROW_O)
    for pre, tog, y in (('', '!mapUp', ROW), ('o_', 'mapUp', ROW_O)):
        W.append(text(pre + 'time', 40, y, 130, 29, '{{time}}', 'm_mid', 'fg', 'right', toggle=tog))
        W.append(text(pre + 'ampm', 176, y + 3, 53, 32, '{{ampmLc}}', 'm_tiny', 'dim', toggle=tog))
        W.append(icon(pre + 'range_icon', 'fuelBolt', 313, y - 3, 29, 34, 'fg', 1, toggle=tog))
        W.append(text(pre + 'range', 348, y, 112, 29, '{{rangeTotal}}', 'm_mid', 'fg', 'right', 1, toggle=tog))
        W.append(text(pre + 'range_unit', 466, y + 3, 44, 32, '{{u:distLc}}', 'm_tiny', 'dim', conn=1, toggle=tog))
    W.extend(limit_and_timer(672, 318, 76, True, ring=(234, 540, 72), next_at=(-68, 4)))   # the timer in the black void left of the gear letter; the ring small, bottom left above the clock (no clean place by the speed there)
    W.extend(ev_share(662, ROW - 3, 26, 34, 692, ROW + 3, 52, 32, 'm_tiny', 748, ROW + 3, 26, 32, 'm_tiny', '', '!mapUp'))   # the normal view: right of the speed scale's 0
    W.extend(ev_share(632, ROW_O - 3, 26, 34, 662, ROW_O + 3, 52, 32, 'm_tiny', 718, ROW_O + 3, 26, 32, 'm_tiny', 'o_', 'mapUp'))   # the map view: between the belt light and the fuel scale's 1/2
    # the oil and the electric range sit centred under their strips (they follow the strips 30 px right in the map view); the coolant and the outside
    # temperature are a table at the far right
    W.extend(mb_under_strips('', '!mapUp', round(strip_x(G1, G1[2]) + 33), round(strip_x(G2, G2[2]) + 33)))
    W.extend(mb_under_strips('o_', 'mapUp', round(strip_x(G1o, G1o[2]) + 33), round(strip_x(G2o, G2o[2]) + 33)))
    W.extend(mb_side_block())
    W += danger_alert(1612, 340, 78)       # right of BMW's black box (x < 1597), above the strips (y 443)
    return {
        'schemaVersion': 2, 'name': 'M Blade', 'theme': 'mblade', 'runUp': False,
        '_about': "M Blade, traced off a photo of a BMW M cluster (Nov 14 2026; the photo was warped to the panel and measured), generated by "
                  "tools/gen_mblade_navi.py (edit that and regenerate): the speed scale as a cyan line with a knee on the left (a marker at "
                  "the speed), a blue hexagon in panels with the gear letter big in the void across it (D, or S / M by the shifter programme, P R N) and the "
                  "speed small right under it with km/h (the drive mode on the four tabs under it, the battery's power in kW under the speed "
                  "when eDrive Live shares it), the red rev blade on the right (0..7000 rpm, the "
                  "stock-style shift light at the top), the fuel strip bottom left and, bottom right, two aligned strips: the oil temperature "
                  "(blue under 75 deg, green warm, red flashing over the limit) and the hybrid battery in %. Along the bottom row, in one "
                  "lettering: the clock and the fuel range at the left, the outside temperature at the right, clear of BMW's belt light (x 587..626, "
                  "y 663..700); a row of sensors just above (y 622): the oil temperature and the electric range, each centred under its strip, "
                  "and the coolant temperature at the far right over the outside one. Waze's map normally sits at "
                  "the centred 1088x480 of the panel; Waze on the cluster 0.9.107 or later takes a window from shared/map_window.js "
                  "(map_window.txt) and this layout asks for a window in the middle of that slot (x 446..1028, y 128..586) when "
                  "'Show Waze map inside the theme' is on. The theme is then rebuilt (backdrop_open and the o_ readouts): no hexagon (the "
                  "gear, the speed and the power move to a column at the left of the window), the blade (18 px) and the strips (30 px, with the oil, electric range and outside temperature under them) move to the right so nothing is tight against the map, the speed scale gives way to the map "
                  "and the vertical fuel strip becomes a flat bar under the map (pump icon, 0 / 1/2 / 1). "
                  "Nothing is drawn under the map. Clear of the black box BMW draws at x 1406..1597, y 322..440. Widget reference: "
                  "shared/hud.js header.",
        'widgets': W,
    }


# ------------------------------------------------------------------------------------------------ Navi
def navi():
    W = []
    base = {'type': 'navi', 'class': 'content', 'z': 1, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
            'scale': [236, 612], 'line2': [577, 1500, 1620], 'barL': [152, 679, 240], 'barR': [1140, 679, 210],
            'rpmMax': 7000, 'hybridTach': True, 'chgOnBar': True}
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
    # the purple stripe is the rev counter (lit up to the rpm, or, while the battery alone drives, up to its power in light blue; green while it
    # charges, hud.js): its eight marks 0..7 inside it (they would be under the map window if they sat right of it), on the same scale as the
    # speed's (the shader's u_sc), the unit above its top and "CHARGE" beside the unit while the battery charges
    def rev_labels(pre, tog, B):
        out = []
        for k in range(8):
            y = 612 - k * (612 - 236) / 7.0
            xl = B['tip'][0] + (y - B['tip'][1]) / B['slope']
            sep = B['sep'][0] + B['sep'][1] * (y - 300)
            edge = B['edge'][0] + B['edge'][1] * (y - 300)
            cx = xl + sep + 0.68 * (edge - sep)
            out.append(text(pre + 'rev%d' % k, round(cx - 15), round(y - 12), 30, 23, str(k), 'm_gl', 'fg', 'center', 1, toggle=tog))
        return out
    W.extend(rev_labels('', '!mapUp', W[0]['band']))
    W.extend(rev_labels('o_', 'mapUp', W[1]['band']))
    W.append(text('rev_unit', 170, 186, 170, 29, '{{tachUnit}}', 'm_tiny', 'fg', 'center', 1))
    W.append(text('rev_charge', 350, 185, 110, 30, '{{chargeNote}}', 'm_unit', 'fg', 'left', 1))
    # speed: big in the middle while there is no map window, big on the right (above BMW's black box) while there is
    # (no gear: BMW's own black box, its gear slot, already shows it; the speed takes the gear's place, in the big font)
    W.append(text('speed', 760, 222, 400, 117, '{{speed}}', 'm_gear', align='center', toggle='!mapUp'))
    W.append(text('speed_unit', 760, 346, 400, 29, '{{u:speedLc}}', 'm_tiny', 'dim', 'center', toggle='!mapUp'))
    W.append(text('mspeed', 1570, 207, 280, 82, '{{speed}}', 'm_big', align='center', toggle='mapUp'))
    W.append(text('mspeed_unit', 1670, 314, 80, 29, '{{u:speedLc}}', 'm_tiny', 'dim', 'center', toggle='mapUp'))
    # the two bars along the bottom, each with its remaining range above its right end: the fuel on the left, the hybrid
    # battery on the right of the middle, ending before BMW's gear letter (x 1386..1454, see shared/visible.js GEAR_P); the clock between them
    # stops before BMW's belt light (x 587)
    W.append(icon('fuel_icon', 'fuel', 112, 662, 29, 34))
    W.append(icon('range_icon', 'fuelBolt', 214, 632, 29, 34))                # the total range: fuel and electric
    W.append(text('range', 226, 630, 114, 34, '{{rangeTotal}}', 'm_mid', 'fg', 'right'))
    W.append(text('range_unit', 346, 636, 48, 29, '{{u:distLc}}', 'm_tiny', 'dim'))
    W.extend(limit_and_timer(960, 420, 92, ring=(703, 236, 72)))   # the timer under the speed; the ring small, left of the speed digits
    W.extend(bottom_cue(661))                                      # the bottom centre, between the clock and the battery bar
    W.extend(ev_share(632, 664, 29, 34, 664, 664, 90, 34, 'm_mid', 758, 670, 36, 29, 'm_tiny'))   # bottom row, between the clock and the battery bar
    W.append(text('time', 395, 664, 140, 34, '{{time}}', 'm_mid', 'fg', 'right'))
    W.append(text('ampm', 541, 670, 44, 29, '{{ampmLc}}', 'm_tiny', 'dim'))
    W.append(icon('batt_icon', 'battery', 1100, 662, 26, 34, 'dim', 1))
    W.append(text('ev_pct', 1140, 630, 90, 34, '{{hvSoc}}', 'm_mid', 'fg', 'right', 1))
    W.append(text('ev_pct_unit', 1236, 636, 30, 29, '%', 'm_tiny', 'dim', conn=1))
    W.append(text('ev_range', 1270, 630, 60, 34, '{{evRange}}', 'm_mid', 'fg', 'right', 1))
    W.append(text('ev_range_unit', 1336, 636, 44, 29, '{{u:distLc}}', 'm_tiny', 'dim', conn=1))
    # the oil and outside temperatures in the free space on the right (right of the map window, under BMW's black box)
    # (now that BMW's black box is gone they follow the speed's block, 50 px under its unit, instead of sitting under the box's old place)
    TY = 396
    W.append(icon('oil_icon', 'oilcan', 1644, TY, 29, 34, 'dim', 1, tempBy='oil'))
    W.append(text('oil', 1684, TY + 1, 96, 34, '{{oil}}', 'm_mid', 'fg', 'right', 1, tempBy='oil'))
    W.append(text('oil_unit', 1786, TY + 7, 44, 29, '{{u:temp}}', 'm_tiny', 'dim', conn=1))
    W.append(text('outside', 1676, TY + 61, 104, 34, '{{ambient}}', 'm_mid', 'fg', 'right', 1, iceBy=True))
    W.append(icon('ice_icon', 'snow', 1610, TY + 60, 26, 34, 'dim', iceBy=True))
    W.append(text('outside_unit', 1786, TY + 67, 44, 29, '{{u:temp}}', 'm_tiny', 'dim', conn=1))
    W += danger_alert(1196, 38, 76)         # in the top strip right of the shift light: clear of the map window (y 120) and of the hood
    W.append(text('drive_mode', 1664, 668, 216, 22, '{{modeName}}', 'mode', 'dim', 'right', 1, accentBy=True))
    return {
        'schemaVersion': 2, 'name': 'Navi', 'theme': 'navi', 'runUp': False,
        '_about': "Navi, after a photo of a BMW map view (Nov 14 2026), generated by tools/gen_mblade_navi.py (edit that and regenerate): "
                  "a wide diagonal band on the left: the textured blue stripe is the speed (a white marker at the speed on the "
                  "same scale as the Sport theme), the violet stripe is the rev counter (lit up to the rpm with marks 0..7; the hybrid rev "
                  "counter of hud.js: the battery's power in light blue while it alone drives, in green while it charges, the unit and CHARGE above it), the big rounded map window with the white line under it that steps up at the right, and thin bars along the bottom: "
                  "fuel with its range on the left, the hybrid battery with its electric range on the right (in place of the photo's oil "
                  "temperature, which moves to the free column on the right). The stock-style shift light and the lettering are at the top. Without a "
                  "map window the speed is big in the middle; with one (Waze, Cluster Centre, Cluster Info) the theme is rebuilt "
                  "as the Sport theme is (backdrop_open and the o_ readouts): the window at x 534..1386, y 120..600, the band steeper "
                  "and narrower on the left, the speed big on the right above BMW's black box, nothing under the map. Clear of BMW's belt light (x 587..626, y 663..700). Widget reference: shared/hud.js header.",
        'widgets': W,
    }


SHEETS = {'mblade': 14, 'navi': 10}      # image sheets per theme: the memory a theme takes is the sum of their boxes (tools/pack_sheets.py)

if __name__ == '__main__':
    for name, L in (('mblade', mblade()), ('navi', navi())):
        zoomify(name, L['widgets'])                        # the scale numbers that grow in their zone: bigger boxes (tools/zoom_labels.py)
        print(name, pack_sheets.pack(L['widgets'], SHEETS[name]))   # tight sheets for cluster-render's pixel memory (tools/pack_sheets.py)
        p = os.path.join(OUT, name + '.json')
        with open(p, 'w') as f:
            json.dump(L, f, indent=2)
            f.write('\n')
        print('wrote', os.path.normpath(p), len(L['widgets']), 'widgets')
