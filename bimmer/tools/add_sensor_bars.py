#!/usr/bin/env python3
"""Ajoute aux quatre thèmes de ShakTheme (Sport, M, M Blade, Navi) les barres de température d'huile, de liquide de refroidissement et de
pression du turbo, et le bloc des pneus (pression + température), chacun dans sa vue (réglage `viewSel` : « gauges » pour les barres, « tyres » pour les pneus, « drive » pour la G-force en mode Sport et les réglages des modes sinon ; le bouton du volant les fait défiler). Les widgets ajoutés portent
l'identifiant `xb_...` ; l'outil les retire d'abord, puis les remet : on peut le relancer autant de fois qu'on veut.

    python3 tools/add_sensor_bars.py sport m mblade navi    # réécrit apps/shaktheme/hud/layouts/<thème>.json

Les textes et icônes ajoutés ont leurs propres feuilles (clé `xs_...`) : le rangement des autres (tools/pack_sheets.py) n'est pas refait,
l'outil donne seulement une connexion à chaque nouvelle couche (la moins chargée, 8 au plus). Les couches et la mémoire de pixels de
cluster-render sont comptées avec les barres par tools/test_pixel_memory.js (20 couches au plus, 8 par connexion, 6,5 Mio).
tools/gen_mblade_navi.py l'appelle (add) après avoir rangé les feuilles, pour que les thèmes régénérés gardent leurs barres.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_sheets  # noqa: E402

LAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'shaktheme', 'hud', 'layouts') + os.sep
BLUE = [61, 139, 255, 255]; GREEN = [47, 210, 122, 255]; RED = [255, 42, 42, 255]


def load(n):
    with open(LAY + n + '.json', encoding='utf-8') as f:
        return json.load(f)


def save(n, d):
    with open(LAY + n + '.json', 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=2, ensure_ascii=False); f.write('\n')


def strip(d):
    d['widgets'] = [w for w in d['widgets'] if not w['id'].startswith('xb_')]


def meter(id, x, y, w, h, signal, mn, mx, at, colors, segs, gap, conn, z=5, toggle='viewSel=gauges', **kw):
    o = {'id': id, 'type': 'meter', 'class': 'content', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'signal': signal, 'min': mn, 'max': mx,
         'segments': segs, 'gap': gap, 'colors': colors, 'at': at, 'toggle': toggle, 'conn': conn}
    o.update(kw)
    return o
def text(id, x, y, w, h, t, font, color='fg', align='left', sheet=None, conn=0, toggle='viewSel=gauges', **kw):
    o = {'id': id, 'type': 'text', 'z': 5, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align, 'toggle': toggle}
    if sheet: o['sheet'] = sheet
    o['conn'] = conn
    o.update(kw)
    return o
def icon(id, x, y, w, h, ic, color='dim', sheet=None, conn=0, toggle='viewSel=gauges', **kw):
    o = {'id': id, 'type': 'icon', 'icon': ic, 'z': 5, 'x': x, 'y': y, 'w': w, 'h': h, 'color': color, 'toggle': toggle}
    if sheet: o['sheet'] = sheet
    o['conn'] = conn
    o.update(kw)
    return o
# oil 50..150 C: cold blue under oilCold (75), green, red from warnOil (130); coolant 40..130: blue under 70, red from 115; boost 0..2 bar
OIL = dict(mn=50, mx=150, at=[0.25, 0.8])
COOL = dict(mn=40, mx=130, at=[0.34, 0.84])



def _sheet(d, wid):
    """The sheet key and the connection of widget `wid` (a widget that joins it shares its layer)."""
    w = next(x for x in d['widgets'] if x['id'] == wid)
    return w.get('sheet'), w.get('conn', 0)


def danger_card(d, x, y, sheet, conn):
    """The danger zone alert of shared/danger.js in Sport and M (M Blade and Navi have theirs, tools/gen_mblade_navi.py danger_alert): a dark rounded
    card with a red outline, a camera, DANGER, the distance and, when the source gives it, the speed limit in red. One card (272 x 78) for both
    cases and no ring around the limit (a ring and its number overlap: two layers more), so one layer more only (the box; its texts join `sheet`,
    none of them overlapping another). Shown only while a zone is ahead (toggle "danger"); re-made at each run."""
    d['widgets'] = [w for w in d['widgets'] if not w['id'].startswith('al_')]
    h, top = 78, 12
    k = {'toggle': 'danger'}
    d['widgets'] += [
        {'id': 'al_card', 'type': 'box', 'z': 4, 'x': x, 'y': y, 'w': 272, 'h': h, 'fill': [10, 10, 14, 255], 'line': RED, 'border': 3, 'radius': 20,
         'toggle': 'danger', 'conn': 0},
        icon('al_cam', x + 14, y + (h - 48) // 2, 48, 48, 'cam', RED, sheet, conn, **k),
        text('al_title', x + 72, y + top, 118, 19, 'DANGER', 'm_label', RED, 'left', sheet, conn, **k),
        text('al_dist', x + 62, y + top + 25, 88, 29, '{{dangerDist}}', 'm_mid', 'fg', 'right', sheet, conn, **k),
        text('al_unit', x + 154, y + top + 24, 40, 36, '{{dangerUnit}}', 'm_unit', 'dim', 'left', sheet, conn, **k),
        text('al_limit', x + 200, y + (h - 29) // 2, 62, 29, '{{dangerLimit}}', 'm_tiny', RED, 'center', sheet, conn, toggle='dangerLimit'),
    ]
    for w in d['widgets'][-5:]:
        if not w.get('conn'):
            w.pop('conn', None)
    # the card's own layer: the connection that stays the least loaded in every view (8 layers each at most)
    card = d['widgets'][-6]
    best = None
    for c in range(pack_sheets.NCONN):
        card['conn'] = c
        per = loads(d['widgets'])
        key = (max(max(p.values()) for p in per), sum(p.get(c, 0) for p in per), c)
        if best is None or key < best:
            best = key
    card['conn'] = best[2]
    if not card['conn']:
        card.pop('conn')


def _m(d):
    new = []
    # boost in the gap of the bottom row (between the electric share and the oil), bars under the three values
    # (their texts join the bottom row's sheet, the oil's: one layer less, room for the danger alert's card)
    S_ROW, C_ROW = _sheet(d, 'oil')
    new += [icon('xb_boost_icon', 790, 624, 29, 34, 'gauge', sheet=S_ROW, conn=C_ROW),
            text('xb_boost', 820, 624, 96, 34, '{{boostPos}}', 'm_mid', align='right', sheet=S_ROW, conn=C_ROW),
            text('xb_boost_unit', 922, 630, 48, 29, '{{u:pressure}}', 'm_tiny', 'dim', sheet=S_ROW, conn=C_ROW)]
    new += [meter('xb_boost_bar', 790, 662, 180, 8, 'boost', 0, 1.6, [0.75, 0.9], ['fg', 'fg', RED], 12, 3, 2),
            meter('xb_oil_bar', 1058, 662, 176, 8, 'oil', OIL['mn'], OIL['mx'], OIL['at'], [BLUE, GREEN, RED], 12, 3, 3),
            # le liquide est juste à gauche du trou de la lettre de rapport de BMW (shared/gear_window.js, taille 1 : x 1380..1460 dès y 660) : sa
            # barre s'arrête avant (8 segments, presque le pas des 12 des deux autres) ; à 176 px le trou l'effaçait (« left out », banc du 18 nov. 2026)
            meter('xb_cool_bar', 1268, 662, 110, 8, 'coolant', COOL['mn'], COOL['mx'], COOL['at'], [BLUE, GREEN, RED], 8, 3, 3)]
    d['widgets'] += new
    # the danger zone alert (shared/danger.js, ShakRadar): above the gear letter, under BMW's shift light; its texts join the gear's sheet
    danger_card(d, 824, 166, *_sheet(d, 'gear'))
    for w in d['widgets']:           # the optional badge text sits where the boost value goes: it gives way during the gauges view
        if w['id'] == 'badge':
            w['toggle'] = '!viewSel=gauges'


def slant(id, x, y, w, h, sensor, mn, mx, conn, slant=12, z=5, toggle='viewSel=gauges', **kw):
    o = {'id': id, 'type': 'slantbar', 'class': 'content', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'signal': sensor, 'sensor': sensor, 'min': mn, 'max': mx,
         'slant': slant, 'toggle': toggle, 'conn': conn}
    o.update(kw)
    return o


def tyres(prefix, x0, y0, font, ufont, sheet, conn, colw=72, gap=48, rowp=34, rowt=28, rear=104, cap=None, tcolor='dim', toggle='viewSel=tyres', **kw):
    # a 2 x 2 block: pressure over temperature at each corner, the wheel glyph between the columns, the units on top
    W = 2 * colw + gap
    r = [text(prefix + 'u', x0, y0, W, 24, '{{u:pressure}} · {{u:temp}}', ufont, 'dim', 'center', sheet, conn, toggle=toggle)]
    yy = {'F': y0 + rowp, 'R': y0 + rear}
    for corner, cx, yr in (('FL', x0, yy['F']), ('FR', x0 + colw + gap, yy['F']), ('RL', x0, yy['R']), ('RR', x0 + colw + gap, yy['R'])):
        r.append(text(prefix + 'p' + corner, cx, yr, colw, 26, '{{tyreP:%s}}' % corner, font, 'fg', 'center', sheet, conn, toggle=toggle, tyreBy=corner))
        r.append(text(prefix + 't' + corner, cx, yr + rowt, colw, 26, '{{tyreT:%s}}' % corner, font, tcolor, 'center', sheet, conn, toggle=toggle))
    r.append(icon(prefix + 'ic', x0 + colw + (gap - 29) // 2, (yy['F'] + yy['R']) // 2 + 6, 29, 29, 'tyre', 'dim', sheet, conn, toggle=toggle))
    return r


SETUP_ROWS = (('engine', 'gauge'), ('chassis', 'shock'), ('steering', 'wheel'), ('gearbox', 'cog'))


def segbar(id, x, y, w, h, key, conn, toggle, **kw):
    o = {'id': id, 'type': 'segbar', 'class': 'content', 'z': 5, 'x': x, 'y': y, 'w': w, 'h': h, 'signal': 'setupLevel:' + key, 'max': 3,
         'color': 'hot', 'toggle': toggle, 'conn': conn}
    o.update(kw)
    return o


def drive_g(prefix, x, y, size, tx, ty, tw, sheet, conn, toggle, font='s_unit', stacked=False):
    """La vue « Conduite » en mode Sport : le G-mètre du moteur (anneaux, trace du point) et dessous la g de côté (0.42 L) et en long (0.31 ACC),
    côte à côte, ou l'une sur l'autre (`stacked`, centrées dans la largeur `tw`)."""
    if stacked:
        side = text(prefix + 'side', tx, ty, tw, 28, '{{gSide}}', font, 'fg', 'center', sheet, conn, toggle=toggle)
        fwd = text(prefix + 'fwd', tx, ty + 30, tw, 28, '{{gFwd}}', font, 'fg', 'center', sheet, conn, toggle=toggle)
    else:
        side = text(prefix + 'side', tx, ty, tw, 28, '{{gSide}}', font, 'fg', 'right', sheet, conn, toggle=toggle)
        fwd = text(prefix + 'fwd', tx + tw + 16, ty, tw + 30, 28, '{{gFwd}}', font, 'fg', 'left', sheet, conn, toggle=toggle)
    return [{'id': prefix + 'g', 'type': 'gmeter', 'class': 'content', 'z': 5, 'x': x, 'y': y, 'w': size, 'h': size, 'toggle': toggle, 'conn': conn}, side, fwd]


def drive_rows(prefix, x, y0, dy, sheet, conn, toggle, font, lw, bars=None, shiftx=44):
    """La vue « Conduite » hors du mode Sport : ce que chaque partie (moteur, châssis, direction, boîte) fait dans le mode de conduite en cours,
    une icône, son nom et, si `bars` (conn, largeur, y sous le nom, hauteur) est donné, un trait de trois crans (1 doux, 2 sport, 3 sport plus)."""
    r = []
    for i, (k, ic) in enumerate(SETUP_ROWS):
        y = y0 + i * dy
        r.append(icon(prefix + k + '_ic', x, y, 28, 34, ic, 'fg', sheet, conn, toggle=toggle))
        r.append(text(prefix + k, x + shiftx, y + 4, lw, 28, '{{setup:%s}}' % k, font, 'fg', 'left', sheet, conn, toggle=toggle))
        if bars:
            r.append(segbar(prefix + k + '_bar', x + shiftx, y + bars[1], bars[0], bars[2], k, conn, toggle))
    return r


# M Blade's views open in a blue panel on the left, in place of the speed scale, as BMW M's own cluster does (owner's photo of Nov 18 2026: the
# engine's readings on the left, the hexagon with the gear beside them; "it takes away a part of the dial, like Waze" and "it carries the
# hexagon's shape on to the far left"). The panel is the hexagon carried on to the left: the same top and bottom (y 167, 589), a band whose two
# sides are "<": the left one ends in a point (PTX, PYM), the right one follows the hexagon's left side 18 px away (its two arms, carried on,
# meet at x 585, y 386 with DX -30). The speed line, its labels and the fuel strip give way (the fuel strip goes right of
# the battery's, as the photo's small gauges); the speed limit's ring goes under the panel, bottom left.
PT, PB, PYM, PK, PTX, PW = 167, 589, 386, 0.586, 40, 527
V_ON = '!mapUp&!viewSel=none'           # a view shows, the map is closed
V_OFF = '!mapUp&viewSel=none'           # no view, the map is closed: the normal dial
# the normal dial's pieces that give way to the panel (tools/gen_mblade_navi.py makes them with "!mapUp")
V_GIVE = ['spd%d' % i for i in range(9)] + ['spd_unit', 'f_hi', 'f_mid', 'f_lo', 'fuel_icon', 'lim_ring', 'lim_num', 'lim_nxt_ring', 'lim_nxt_num',
                                            'lim_alert', 'lim_lane', 'backdrop', 'range_icon', 'range', 'range_unit']
ROW_T = [225, 317, 409, 501]            # each row's label line (top y); its bar's middle is 36 px lower
BAR = [206, 410]                        # the bars' ends
# the engine view's rows, as the photo's: the boost, the oil, the coolant, the outside (icon, signal, min, max, the scale's labels, the value, its unit,
# where the red end starts, the bar's tone)
GAUGE_ROWS = (('boost', 'gauge', 'boost', 0, 2, ('{{pc:0}}', '{{pc:1}}', '{{pc:2}}'), '{{boostPos}}', '{{u:pressure}}', 0.8, 'boost'),
              ('oil', 'oilPour', 'oil', 50, 150, ('{{tc:50}}', '{{tc:100}}', '{{tc:150}}'), '{{oil}}', '{{u:temp}}', 0.8, 'temp'),
              ('cool', 'tempWave', 'coolant', 50, 150, ('{{tc:50}}', '{{tc:100}}', '{{tc:150}}'), '{{coolant}}', '{{u:temp}}', 0.8, 'temp'),
              ('out', 'tempOut', 'ambient', -20, 50, ('{{tc:-20}}', '{{tc:15}}', '{{tc:50}}'), '{{ambient}}', '{{u:temp}}', None, 'ice'))


def panel_x(y):
    """the panel's left side at y (its right side is PW px further)"""
    return PTX + PK * abs(y - PYM)


def mpanel(id, tog, rows=None, div=2):
    half = max(PYM - PT, PB - PYM)
    o = {'id': id, 'type': 'mpanel', 'class': 'content', 'z': 2, 'x': PTX, 'y': PT, 'w': int(round(PW + PK * half)) + 1, 'h': PB - PT,
         'shape': [PTX, PYM, PK, PW], 'bar': BAR, 'div': div, 'rows': rows or [], 'toggle': tog}
    return o


def _mblade_views(d, SA, SB, SL, SF):
    """the panel and what it shows in each view (SA: the sheet of the upper rows, SB: of the lower ones, SL: the limit's, SF: the fuel strip's)"""
    by = {w['id']: w for w in d['widgets']}
    for k in V_GIVE:
        if k in by:
            by[k]['toggle'] = V_OFF
    new = []
    # the backdrop without the speed line, the fuel strip right of the battery's (130 px, as the two strips), leaning the same way
    b = dict(by['backdrop'], id='xb_vback', toggle=V_ON)
    b['sq'] = [b['sq'][0], b['sq'][1], 0]
    g2 = b['g2']
    G3 = [g2[0] + 130, g2[1], g2[2], g2[3]]
    b['g0'] = G3
    b.pop('conn', None)
    new.append(b)
    top, bot = G3[1], G3[2]
    sx = lambda y: G3[0] + G3[3] * (y - top)
    for y, t, n in zip((top + 10, top + 87 * (bot - top) / 176.0, bot - 11), ('1', '1/2', '0'), ('hi', 'mid', 'lo')):
        new.append(text('xb_vf_' + n, round(sx(y) - 13 - 70), round(y - 12), 70, 23, t, 'm_gl', 'fg', 'right', SF, 1, toggle=V_ON))
    new.append(icon('xb_vf_icon', round(sx(top + 117 * (bot - top) / 176.0) - 13 - 36), round(top + 110 * (bot - top) / 176.0), 28, 32, 'fuelPump', 'fg', SF, 1,
                    toggle=V_ON, lowWhen='fuel'))
    # each strip keeps its reading (owner, Nov 18 2026: "a bar does not move without its reading"): the fuel range goes with the strip, under it on the
    # sensors' row as the oil and the electric range under theirs (no icon: the strip's pump is just above). The coolant, at the end of that row,
    # moves to the bottom row then, left of the outside temperature (tyres and drive views; the engine view has it in its panel)
    cx = sx(bot) + 33
    rv = round(cx + 16)
    if 'range' in by and 'oil' in by:
        y = by['oil']['y']
        new.append(dict(by['range'], id='xb_vrange', x=rv - 90, y=y, w=90, h=29, align='right', toggle=V_ON, sheet=SF))
        new.append(dict(by['range_unit'], id='xb_vrange_unit', x=rv + 1, y=y + 3, w=36, h=32, toggle=V_ON, sheet=SF))
    if 'cool' in by:
        TB = 'viewSel=none'
        for k in ('cool_icon', 'cool', 'cool_unit'):
            by[k]['toggle'] = TB
        y = by['time']['y']
        for k, x in (('cool_icon', 1500), ('cool', 1530), ('cool_unit', 1638)):
            o = by[k]
            # with the map up and a view (not the engine's) the column stays as it is; without the map it moves down
            new.append(dict(o, id='xb_mc_' + k, toggle='mapUp&!viewSel=none&!viewSel=gauges', sheet=o.get('sheet')))
            new.append(dict(o, id='xb_vc_' + k, x=x, y=y + (o['y'] - by['cool']['y']), toggle='!mapUp&!viewSel=none&!viewSel=gauges', sheet=SF))
    # the speed limit's ring under the panel, bottom left, and in a row right of it the next limit, the car's warning and the lane assist
    for src, nid, x, y, sz in (('lim_ring', 'xb_vlim_ring', 52, 596, 66), ('lim_nxt_ring', 'xb_vlim_nxt_ring', 126, 599, 60),
                               ('lim_alert', 'xb_vlim_alert', 194, 601, 56), ('lim_lane', 'xb_vlim_lane', 258, 601, 56)):
        if src in by:
            new.append(dict(by[src], id=nid, x=x, y=y, w=sz, h=sz, toggle=V_ON, sheet=SL))
            num = {'lim_ring': 'lim_num', 'lim_nxt_ring': 'lim_nxt_num'}.get(src)
            if num in by:
                new.append(dict(by[num], id=nid.replace('_ring', '_num'), x=x, y=y + (sz - 29) // 2 + 1, w=sz, toggle=V_ON, sheet=SL))
    # the engine view: four rows, each an icon, the scale over its bar (the max red where the bar's end is red), the unit, the value right of the bar
    tg = 'viewSel=gauges&!mapUp'
    rows = []
    for r, (k, ic, sig, mn, mx, labels, tok, unit, red, tone) in enumerate(GAUGE_ROWS):
        T = ROW_T[r]
        sh = SA if r < 2 else SB
        tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
        new += [icon('xb_vg_%s_ic' % k, 158, T + 2, 30, 34, ic, 'fg', sh, 0, toggle=tg, **({'tempBy': sig} if tone == 'temp' else {})),
                text('xb_vg_%s_min' % k, BAR[0], T, 64, 23, labels[0], 'm_gl', 'dim', 'left', sh, 0, toggle=tg),
                text('xb_vg_%s_mid' % k, (BAR[0] + BAR[1]) // 2 - 32, T, 64, 23, labels[1], 'm_gl', 'dim', 'center', sh, 0, toggle=tg),
                text('xb_vg_%s_max' % k, BAR[1] - 64, T, 64, 23, labels[2], 'm_gl', RED if red else 'dim', 'right', sh, 0, toggle=tg),
                text('xb_vg_%s_unit' % k, BAR[1] + 4, T - 5, 40, 32, unit, 'm_tiny', 'dim', 'left', sh, 0, toggle=tg),
                text('xb_vg_%s' % k, BAR[1] + 44, T + 22, 108, 29, tok, 'm_mid', 'fg', 'right', sh, 0, toggle=tg, **tb)]
        rows.append({'y': T + 36, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
    new.append(mpanel('xb_vpan_g', tg, rows))
    # the tyres: the four corners round a tyre, the pressure big over the temperature, the units on top
    tt = 'viewSel=tyres&!mapUp'
    new.append(text('xb_vty_u', 176, 205, 330, 32, '{{u:pressure}} · {{u:temp}}', 'm_tiny', 'dim', 'center', SA, 0, toggle=tt))
    for corner, x, yp, sh in (('FL', 176, 248, SA), ('FR', 396, 248, SA), ('RL', 176, 452, SB), ('RR', 396, 452, SB)):
        new += [text('xb_vty_p' + corner, x, yp, 110, 29, '{{tyreP:%s}}' % corner, 'm_mid', 'fg', 'center', sh, 0, toggle=tt, tyreBy=corner),
                text('xb_vty_t' + corner, x, yp + 34, 110, 23, '{{tyreT:%s}}' % corner, 'm_tyre', 'dim', 'center', sh, 0, toggle=tt)]
    new.append(icon('xb_vty_ic', 313, 350, 56, 56, 'tyre', 'dim', SB, 0, toggle=tt))
    new.append(mpanel('xb_vpan_t', tt))
    # the drive view: the G-meter in the panel in Sport, else the four parts' settings, each with its level on a bar in three steps
    new += drive_g('xb_vdg', 226, 216, 200, 216, 436, 220, SB, 0, 'viewSel=drive&driveSport&!mapUp', stacked=True)
    new.append(mpanel('xb_vpan_ds', 'viewSel=drive&driveSport&!mapUp'))
    td = 'viewSel=drive&!driveSport&!mapUp'
    rows = []
    for r, (k, ic) in enumerate(SETUP_ROWS):
        T = ROW_T[r]
        sh = SA if r < 2 else SB
        new += [icon('xb_vdr_%s_ic' % k, 158, T + 2, 30, 34, ic, 'fg', sh, 0, toggle=td),
                text('xb_vdr_%s' % k, BAR[0], T + 2, 260, 19, '{{setup:%s}}' % k, 'm_label', 'fg', 'left', sh, 0, toggle=td)]
        rows.append({'y': T + 36, 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    new.append(mpanel('xb_vpan_dr', td, rows, div=3))
    return new


def _mblade(d):
    new = []
    # Without the map the views open in the panel on the left (_mblade_views). With the map up the blade moves right to centre the window and the
    # hexagon takes the left column (tools/gen_mblade_navi.py, Nov 18 2026): the gauges and the drive view go to the far right corner, right of the
    # blade's numbers, under the hood and above the danger alert's card (y 340)
    def gauges(pre, X, Y, gap, tog, sheet, conn, bw=260):
        B = Y + gap                   # the boost's row
        return [icon(pre + 'cool_icon', X, Y, 26, 34, 'tempWave', 'fg', sheet, conn, toggle=tog, tempBy='coolant'),
                text(pre + 'cool', X + 34, Y + 2, 104, 29, '{{coolant}}', 'm_mid', 'fg', 'right', sheet, conn, toggle=tog, tempBy='coolant'),
                text(pre + 'cool_unit', X + 142, Y + 5, 44, 32, '{{u:temp}}', 'm_tiny', 'dim', 'left', sheet, conn, toggle=tog),
                slant(pre + 'cool_bar', X, Y + 42, bw, 14, 'coolant', 40, 130, 2, toggle=tog),
                icon(pre + 'boost_icon', X, B, 29, 34, 'gauge', 'fg', sheet, conn, toggle=tog),
                text(pre + 'boost', X + 34, B + 2, 104, 29, '{{boostPos}}', 'm_mid', 'fg', 'right', sheet, conn, toggle=tog),
                text(pre + 'boost_unit', X + 142, B + 5, 60, 32, '{{u:pressure}}', 'm_tiny', 'dim', 'left', sheet, conn, toggle=tog),
                slant(pre + 'boost_bar', X, B + 42, bw, 14, 'boost', 0, 1.6, 3, toggle=tog)]
    # the sheets, by a widget they hold (tools/pack_sheets.py numbers the sheets anew each time it runs): with a view up and the map closed the
    # speed labels' sheets and the limit's are empty (their widgets give way to the panel), the panel's texts take them
    sheet_of = lambda wid, dflt: next((w.get('sheet') for w in d['widgets'] if w['id'] == wid and w.get('sheet')), dflt)
    S_RIGHT = sheet_of('o_n7', 'xs_mo')
    new += _mblade_views(d, sheet_of('spd2', 'xs_va'), sheet_of('spd5', 'xs_vb'), sheet_of('lim_ring', 'xs_vl'), sheet_of('b_hi', 'xs_vf'))
    new += gauges('xb_m', 1662, 196, 72, 'viewSel=gauges&mapUp', S_RIGHT, 1, bw=200)
    new += tyres('xb_mty', 1670, 180, 'm_tyre', 'm_tiny', S_RIGHT, 1, rowp=30, rowt=26, rear=90, toggle='viewSel=tyres&mapUp')
    new += drive_g('xb_mdg', 1710, 150, 120, 1670, 276, 200, S_RIGHT, 1, 'viewSel=drive&driveSport&mapUp', stacked=True)
    new += drive_rows('xb_mdr_', 1662, 186, 38, S_RIGHT, 1, 'viewSel=drive&!driveSport&mapUp', 'm_label', 170)
    d['widgets'] += new


def _sport(d):
    new = []
    # the danger zone alert, in the middle under the emblem (and over the top of the map when it shows): its texts join the timer's sheet
    danger_card(d, 824, 250, *_sheet(d, 'run_time'))
    TG = 'viewSel=gauges&!mapUp'
    X = 790; Y0 = 420; DY = 54
    rows = [('oil', 'oilPour', 'oil', 50, 150, '{{oil}}', '{{u:temp}}'), ('cool', 'tempWave', 'coolant', 40, 130, '{{coolant}}', '{{u:temp}}'), ('boost', 'gauge', 'boost', 0, 1.6, '{{boostPos}}', '{{u:pressure}}')]
    for i, (k, ic, sensor, mn, mx, tok, un) in enumerate(rows):
        y = Y0 + i * DY
        new += [icon('xb_%s_icon' % k, X, y, 26, 32, ic, 'dim', 'xs_s', 3, toggle=TG, **({'tempBy': sensor} if sensor != 'boost' else {})),
                slant('xb_%s_bar' % k, X + 38, y + 8, 196, 16, sensor, mn, mx, 3 if i < 2 else 2, slant=14, toggle=TG, trackColor='faint'),
                text('xb_%s' % k, X + 236, y + 3, 100, 26, tok, 's_val', 'fg', 'right', 'xs_s', 3, toggle=TG),
                text('xb_%s_unit' % k, X + 342, y + 3, 40, 29, un, 's_unit', 'dim', 'left', 'xs_s', 3, toggle=TG)]
    new += tyres('xb_ty', 1440, 150, 'm_tyre', 'm_tiny', 'xs_t', 3, colw=60, gap=40, toggle='viewSel=tyres&!mapUp')
    # the drive view right of the middle (the launch timer sits in the middle, y 331..360): the G-meter in Sport, else the setup rows with their bar
    new += drive_g('xb_dg', 1096, 262, 200, 1086, 472, 220, 'xs_dg', 2, 'viewSel=drive&driveSport&!mapUp', stacked=True)
    new += drive_rows('xb_dr_', 1100, 262, 62, 'xs_dr', 2, 'viewSel=drive&!driveSport&!mapUp', 's_unit', 170, bars=(150, 38, 6))
    d['widgets'] += new



def _navi(d):
    new = []
    X = 1644
    NM = 'viewSel=gauges&!mapUp'          # the map view's big speed has its unit at y 314..343 in this column: the boost and the coolant wait for the map to close
    # the right column: boost and coolant above the oil, a thin bar under each value (the oil's and the boost's number follow the column's own look)
    new += [icon('xb_boost_icon', X, 292, 29, 34, 'gauge', 'dim', 'xs_n', 1, toggle=NM),
            text('xb_boost', X + 40, 293, 96, 34, '{{boostPos}}', 'm_mid', 'fg', 'right', 'xs_n', 1, toggle=NM),
            text('xb_boost_unit', X + 142, 299, 60, 29, '{{u:pressure}}', 'm_tiny', 'dim', 'left', 'xs_n', 1, toggle=NM),
            meter('xb_boost_bar', X, 332, 200, 7, 'boost', 0, 1.6, [0.75, 0.9], ['fg', 'fg', RED], 30, 2, 2, toggle=NM),
            icon('xb_cool_icon', X, 344, 26, 34, 'tempWave', 'dim', 'xs_n', 1, toggle=NM, tempBy='coolant'),
            text('xb_cool', X + 40, 345, 96, 34, '{{coolant}}', 'm_mid', 'fg', 'right', 'xs_n', 1, toggle=NM, tempBy='coolant'),
            text('xb_cool_unit', X + 142, 351, 44, 29, '{{u:temp}}', 'm_tiny', 'dim', 'left', 'xs_n', 1, toggle=NM),
            meter('xb_cool_bar', X, 384, 200, 7, 'coolant', 40, 130, [0.34, 0.84], [BLUE, GREEN, RED], 30, 2, 3, toggle=NM),
            meter('xb_oil_bar', X, 436, 200, 7, 'oil', 50, 150, [0.25, 0.8], [BLUE, GREEN, RED], 30, 2, 3)]
    new += tyres('xb_ty', 1170, 215, 'm_tyre', 'm_tiny', 'xs_t', 1, toggle='viewSel=tyres&!mapUp')
    # the drive view where the tyres are: the G-meter in Sport, else the setup rows with their bar (the map view has no room)
    new += drive_g('xb_dg', 1190, 196, 210, 1190, 410, 210, 'xs_dg', 1, 'viewSel=drive&driveSport&!mapUp', stacked=True)
    new += drive_rows('xb_dr_', 1172, 200, 64, 'xs_dr', 1, 'viewSel=drive&!driveSport&!mapUp', 'm_label', 190, bars=(190, 36, 6))
    d['widgets'] += new


BUILD = {'m': _m, 'mblade': _mblade, 'sport': _sport, 'navi': _navi}
CAP = pack_sheets.CAP


# (la vue, la voiture est en Sport) : la vue « Conduite » montre autre chose en Sport (G-force) et hors Sport (réglages des modes)
STATES = ((None, False), ('gauges', False), ('tyres', False), ('drive', True), ('drive', False))


def loads(widgets):
    """les couches de chaque connexion dans chaque état (carte fermée / ouverte, chaque vue) : une liste de {conn: n}"""
    return [pack_sheets.memory(widgets, st, v, sp)[2] for st in (False, True) for (v, sp) in STATES]


def place(widgets):
    """Donne une connexion aux nouvelles couches (les barres et chaque feuille "xs_...") : la moins chargée, 8 au plus partout.
    Le rangement des autres widgets (feuilles "sN", connexions) reste tel que l'outil de rangement l'a fait : le refaire ici le dégraderait."""
    items = []
    for w in widgets:
        if not w['id'].startswith('xb_'):
            continue
        key = ('bar', w['id']) if w['type'] not in pack_sheets.IMG or w.get('own') else ('sheet', w['sheet'])
        if key not in [i[0] for i in items]:
            items.append((key, []))
        [i for i in items if i[0] == key][0][1].append(w)
    for _key, ms in items:
        for w in ms:
            w.pop('conn', None)
    for key, ms in items:
        if key[0] == 'sheet' and not key[1].startswith('xs_'):      # une feuille qui existe déjà : sa connexion
            c = next((w.get('conn', 0) for w in widgets if w.get('sheet') == key[1] and not w['id'].startswith('xb_')), 0)
            for w in ms:
                if c:
                    w['conn'] = c
            continue
        best = None
        for c in range(pack_sheets.NCONN):
            for w in ms:
                if c:
                    w['conn'] = c
                else:
                    w.pop('conn', None)
            per = loads(widgets)
            worst = max(max(p.values()) if p else 0 for p in per)
            mine = sum(p.get(c, 0) for p in per)
            if best is None or (worst, mine, c) < best[0]:
                best = ((worst, mine, c), c)
        for w in ms:
            if best[1]:
                w['conn'] = best[1]
            else:
                w.pop('conn', None)


def add(name, widgets):
    """Retire les widgets `xb_` de `widgets` (liste modifiée en place), met ceux du thème `name`, puis leur donne leurs connexions."""
    d = {'widgets': [w for w in widgets if not w['id'].startswith('xb_')]}
    BUILD[name](d)
    widgets[:] = d['widgets']
    place(widgets)
    per = loads(widgets)
    n = len(STATES)
    return {'nomap': per[:n], 'map': per[n:]}


def main():
    for name in sys.argv[1:] or list(BUILD):
        d = load(name)
        print(name, add(name, d['widgets']))
        save(name, d)


if __name__ == '__main__':
    main()
