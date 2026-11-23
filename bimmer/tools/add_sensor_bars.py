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


def danger_card(d, x, y, sheet, conn, h=78, top=12):
    """The danger zone alert of shared/danger.js in Sport and M (M Blade and Navi have theirs, tools/gen_mblade_navi.py danger_alert): a dark rounded
    card with a red outline, a camera, DANGER, the distance and, when the source gives it, the speed limit in red. One card (272 x 78) for both
    cases and no ring around the limit (a ring and its number overlap: two layers more), so one layer more only (the box; its texts join `sheet`,
    none of them overlapping another). Shown only while a zone is ahead (toggle "danger"); re-made at each run."""
    # (h, top: a lower card where the place is short, 20 Nov 2026: the owner found M's "trop serré" between the shift lights and the gear)
    d['widgets'] = [w for w in d['widgets'] if not w['id'].startswith('al_')]
    k = {'toggle': 'danger'}
    # the speed limit in a red ring, as a road sign and as M Blade's and Navi's cards have it (20 Nov 2026, the owner: "y a plus le cercle autour").
    # The ring is drawn by the card's own layer (BOX u_ring: no layer more) and only while the alert has a limit ("ringWhen").
    rr = min(27, h // 2 - 6)
    d['widgets'] += [
        {'id': 'al_card', 'type': 'box', 'z': 4, 'x': x, 'y': y, 'w': 272, 'h': h, 'fill': [10, 10, 14, 255], 'line': RED, 'border': 3, 'radius': 20,
         'ring': [229, h / 2.0, rr, 5], 'ringWhen': 'dangerLimit', 'toggle': 'danger', 'conn': 0},
        icon('al_cam', x + 14, y + (h - min(48, h - 14)) // 2, min(48, h - 14), min(48, h - 14), 'cam', RED, sheet, conn, **k),
        text('al_title', x + 72, y + top, 118, 19, 'DANGER', 'm_label', RED, 'left', sheet, conn, **k),
        # before the zone the distance to its edge; in it, the words (20 Nov 2026: "10 m", the smallest distance shown, read as a camera 10 m away)
        text('al_dist', x + 62, y + top + 22, 88, 29, '{{dangerDist}}', 'm_mid', 'fg', 'right', sheet, conn, toggle='dangerAhead'),
        text('al_unit', x + 154, y + top + 21, 40, 36, '{{dangerUnit}}', 'm_unit', 'dim', 'left', sheet, conn, toggle='dangerAhead'),
        text('al_in', x + 68, y + top + 25, 126, 24, 'Dans la zone', 'm_name', 'fg', 'left', sheet, conn, toggle='dangerInside'),
        text('al_limit', x + 229 - 23, y + (h - 23) // 2, 46, 23, '{{dangerLimit}}', 'lim_num', 'fg', 'center', sheet, conn, toggle='dangerLimit'),
    ]
    for w in d['widgets'][-6:]:
        if not w.get('conn'):
            w.pop('conn', None)
    # the card's own layer: the connection that stays the least loaded in every view (8 layers each at most)
    card = d['widgets'][-7]
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


# M's own views (19 Nov 2026: each theme its own drawing). The theme shows its tyres on the left and its drive settings on the right all the time:
# the views change the LEFT place. No view: the tyres, as before. Engine: four small silver blades, as the theme's two rev blades (shaders.js
# MBLADES). Drive: the G-meter. Left of the left rev blade (x 530 at its middle), above the fuel gauge (y 410), right of x 250.
# (30 px lower since the owner found the block "un peu trop haut, pas bien centré": in the middle of the height between the arc and the bottom line)
MB = dict(x0=250, x1=380, t0=208, pitch=58, xv=466, xu=470)


def _m(d):
    new = []
    by = {w['id']: w for w in d['widgets']}
    VN = 'viewSel=none'
    # the tyres' readings and the car between them give way to a view (the car is drawn by the backdrop: a copy of it without the car)
    for k in ('tyre_unit_p', 'tyre_icon', 'tyre_unit_t') + tuple(p + c for p in ('tp_', 'tt_') for c in ('FL', 'FR', 'RL', 'RR')):
        if k in by:
            by[k]['toggle'] = VN
    # (one backdrop with an "alt" face since 20 Nov 2026: the layer stays when a view opens, the theme does not blink)
    b = by['backdrop']
    b.pop('toggle', None)
    b['alt'] = {'when': '!viewSel=none', 'set': {'tyres': [b['tyres'][0], b['tyres'][1], 0]}}
    S_T, C_T = _sheet(d, 'tp_FL')
    for vname, vp, ROWS, NAMES in (('gauges', 'g_', CARD_ROWS, GAUGE_NAMES), ('electric', 'e_', ELEC_ROWS, ELEC_NAMES)):
        tg = 'viewSel=%s' % vname
        rows = []
        for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(ROWS):
            T = MB['t0'] + r * MB['pitch']
            tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
            new += [text('xb_' + vp + '%s_name' % k, MB['x0'] - 4, T - 10, 240, 20, NAMES[k], 'm_name_s', 'dim', 'left', S_T, C_T, toggle=tg),
                    text('xb_' + vp + '%s' % k, MB['xv'] - 82, T + 14, 82, 21, tok, 'r_val', 'fg', 'right', S_T, C_T, toggle=tg, **tb),
                    text('xb_' + vp + '%s_unit' % k, MB['xu'], T + 8, 44, 32, unit, 'm_tiny', 'dim', 'left', S_T, C_T, toggle=tg)]
            rows.append({'y': T + 25, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
        new.append({'id': 'xb_card_g' if vname == 'gauges' else 'xb_card_e', 'type': 'mblades', 'class': 'content', 'z': 2, 'x': 236, 'y': 210, 'w': 160, 'h': 210, 'bar': [MB['x0'], MB['x1']],
                    'rows': rows, 'lean': 0.55, 'toggle': tg, 'conn': 3})
    # the drive view: the G-meter where the tyres were, its two readings under it
    new += drive_g('xb_dg', 289, 196, 160, 284, 360, 170, S_T, C_T, 'viewSel=drive', stacked=True)       # (above the limit's ring, y 424)
    d['widgets'] += new
    # the danger zone alert (shared/danger.js, ShakRadar): above the gear letter, under BMW's shift light; its texts join the gear's sheet
    # (64 px high in the middle of the 84 px between the shift lights, y 162, and the gear, y 246: 10 px of air above and under it)
    danger_card(d, 824, 172, *_sheet(d, 'gear'), h=64, top=5)
    for w in d['widgets']:           # (the badge gave way to the boost's value in the bottom row until 19 Nov 2026: that value is in the left place now)
        if w['id'] == 'badge':
            w.pop('toggle', None)


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
# (19 Nov 2026: the point carried 28 px further left, the right side where it was: "le fond bleu rallongé")
PT, PB, PYM, PK, PTX, PW = 167, 589, 386, 0.586, 12, 555
V_ON = '!mapUp&!viewSel=none'           # a view shows, the map is closed
V_OFF = '!mapUp&viewSel=none'           # no view, the map is closed: the normal dial
# the normal dial's pieces that give way to the panel (tools/gen_mblade_navi.py makes them with "!mapUp")
V_GIVE = ['spd%d' % i for i in range(9)] + ['spd_unit', 'f_hi', 'f_mid', 'f_lo', 'fuel_icon', 'lim_ring', 'lim_num', 'lim_nxt_ring', 'lim_nxt_num',
                                            'lim_alert', 'lim_lane', 'backdrop', 'range_icon', 'range', 'range_unit']
ROW_T = [225, 317, 409, 501]            # each row's label line (top y); its bar's middle is 36 px lower
BAR = [190, 390]                        # the bars' ends (the values end at x 505: the panel's two colour bands start there on the rows near its point)
# the engine view's rows, as the photo's: the boost, the oil, the coolant, the outside (icon, signal, min, max, the scale's labels, the value, its unit,
# where the red end starts, the bar's tone)
GAUGE_ROWS = (('boost', 'gauge', 'boost', 0, 2, ('{{pc:0}}', '{{pc:1}}', '{{pc:2}}'), '{{boostPos}}', '{{u:pressure}}', 0.8, 'boost'),
              ('oil', 'oilPour', 'oil', 50, 150, ('{{tc:50}}', '{{tc:100}}', '{{tc:150}}'), '{{oil}}', '{{u:temp}}', 0.8, 'temp'),
              ('cool', 'tempWave', 'coolant', 50, 150, ('{{tc:50}}', '{{tc:100}}', '{{tc:150}}'), '{{coolant}}', '{{u:temp}}', 0.8, 'temp'),
              ('out', 'tempOut', 'ambient', -20, 50, ('{{tc:-20}}', '{{tc:15}}', '{{tc:50}}'), '{{ambient}}', '{{u:temp}}', None, 'ice'))


# The electric view (19 Nov 2026, the owner: "électrique aussi ?", "oui"): the battery's charge, the electric range, what the motor gives and what it
# takes back. Readings the app has already (hud.js _raw: hvSoc, evRange, evPower, evRecup). Same rows as the engine view, in each theme's drawing.
# M Blade's rows carry their scale's three labels; the others the short form (CARD_ROWS' shape).
ELEC_ROWS_MB = (('batt', 'battery', 'hvSoc', 0, 100, ('0', '50', '100'), '{{hvSoc}}', '%', None, 'blue'),
                ('erange', 'battBolt', 'evRange', 0, 60, ('0', '30', '60'), '{{evRange}}', '{{u:distLc}}', None, 'blue'),
                ('epow', 'gauge', 'evPower', 0, 80, ('0', '40', '80'), '{{evPower}}', 'kW', None, 'blue'),
                ('erec', 'leaf', 'evRecup', 0, 60, ('0', '30', '60'), '{{evRecup}}', 'kW', None, 'green'))
ELEC_ROWS = tuple((k, ic, sig, mn, mx, tok, unit, red, tone) for (k, ic, sig, mn, mx, _l, tok, unit, red, tone) in ELEC_ROWS_MB)
ELEC_NAMES = {'batt': 'Charge de la batterie', 'erange': 'Autonomie électrique', 'epow': 'Puissance électrique', 'erec': "Récupération d'énergie"}
ELEC_NAMES2 = {'batt': ('Charge de', 'la batterie'), 'erange': ('Autonomie', 'électrique'), 'epow': ('Puissance', 'électrique'), 'erec': ('Récupération', "d'énergie")}


def panel_x(y):
    """the panel's left side at y (its right side is PW px further)"""
    return PTX + PK * abs(y - PYM)


def mpanel(id, tog, rows=None, div=2, seg=24, **kw):
    half = max(PYM - PT, PB - PYM)
    o = {'id': id, 'type': 'mpanel', 'class': 'content', 'z': 2, 'x': PTX, 'y': PT, 'w': int(round(PW + PK * half)) + 1, 'h': PB - PT,
         'shape': [PTX, PYM, PK, PW], 'bar': BAR, 'div': div, 'seg': seg, 'rows': rows or [], 'toggle': tog}
    o.update(kw)
    return o


# the tyres' view (19 Nov 2026): the car from above in the middle of the panel, a glass plate at each corner with its tyre's pressure over its
# temperature (the plates' middles: left and right x, front and rear y)
TILES = [204, 458, 312, 476]
# the engine view's names, in the label font's capitals (the scale's numbers go under the bar's ends)
# written out in full, in a font that has the accents (m_name): the owner, 19 Nov 2026, "huile moteur et liquide de refroidissement", "naturel, pas
# de langage court"
GAUGE_NAMES = {'boost': 'Pression du turbo', 'oil': 'Huile moteur', 'cool': 'Liquide de refroidissement', 'out': 'Température extérieure'}


def _mblade_views(d, SA, SB, SL, SF):
    """the panel and what it shows in each view (SA: the sheet of the upper rows, SB: of the lower ones, SL: the limit's, SF: the fuel strip's)"""
    by = {w['id']: w for w in d['widgets']}
    for k in V_GIVE:
        if k in by:
            by[k]['toggle'] = V_OFF
    new = []
    # the backdrop without the speed line, the fuel strip right of the battery's (130 px, as the two strips), leaning the same way
    # (one widget with an "alt" face since 20 Nov 2026, not a second backdrop taking its turn: the layer stays, the theme does not blink)
    b = by['backdrop']
    b['toggle'] = '!mapUp'
    g2 = b['g2']
    G3 = [g2[0] + 130, g2[1], g2[2], g2[3]]
    b['alt'] = {'when': V_ON, 'set': {'sq': [b['sq'][0], b['sq'][1], 0], 'g0': G3}}
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
    # (where the owner circled it on the bench pictures, 22 Nov 2026: under the panel's right end, on the bottom row; larger, 92 px, so three digits
    # have room; the next limit, the triangle and the wheel to its left, right of the clock)
    # (23 Nov 2026, "la limitation est trop grande depuis la dernière mise à jour": the white sign 74 px, the next one 50, on the same centres)
    for src, nid, x, y, sz in (('lim_ring', 'xb_vlim_ring', 449, 607, 74), ('lim_nxt_ring', 'xb_vlim_nxt_ring', 375, 619, 50),
                               ('lim_alert', 'xb_vlim_alert', 306, 616, 56), ('lim_lane', 'xb_vlim_lane', 242, 616, 56)):
        if src in by:
            new.append(dict(by[src], id=nid, x=x, y=y, w=sz, h=sz, toggle=V_ON, sheet=SL))
            num = {'lim_ring': 'lim_num', 'lim_nxt_ring': 'lim_nxt_num'}.get(src)
            if num in by:
                new.append(dict(by[num], id=nid.replace('_ring', '_num'), x=x, y=y + (sz - by[num]['h']) // 2 + 1, w=sz, toggle=V_ON, sheet=SL))
    # the engine view: four rows, each an icon, the scale over its bar (the max red where the bar's end is red), the unit, the value right of the bar
    for vname, pfx, ROWS, NAMES in (('gauges', 'xb_vg_', GAUGE_ROWS, GAUGE_NAMES), ('electric', 'xb_ve_', ELEC_ROWS_MB, ELEC_NAMES)):
      tg = 'viewSel=%s&!mapUp' % vname
      rows = []
      for r, (k, ic, sig, mn, mx, labels, tok, unit, red, tone) in enumerate(ROWS):
          T = ROW_T[r]
          sh = SA if r < 2 else SB
          tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
          # the icon, the name over the bar's left end and the unit over its right end, the scale's two ends under the bar, the value big on the right
          new += [icon(pfx + '%s_ic' % k, 142, T + 14, 30, 34, ic, 'fg', sh, 0, toggle=tg, **({'tempBy': sig} if tone == 'temp' else {})),
                  text(pfx + '%s_name' % k, BAR[0] + 6, T - 6, 300, 24, NAMES[k], 'm_name', 'dim', 'left', sh, 0, toggle=tg),
                  text(pfx + '%s_min' % k, BAR[0] - 14, T + 56, 64, 23, labels[0], 'm_gl', 'dim', 'left', sh, 0, toggle=tg),
                  text(pfx + '%s_max' % k, BAR[1] - 70, T + 56, 64, 23, labels[2], 'm_gl', RED if red else 'dim', 'right', sh, 0, toggle=tg),
                  text(pfx + '%s' % k, BAR[1] + 8, T + 22, 107, 29, tok, 'm_mid', 'fg', 'right', sh, 0, toggle=tg, **tb),
                  text(pfx + '%s_unit' % k, BAR[1] + 61, T + 52, 54, 32, unit, 'm_tiny', 'dim', 'right', sh, 0, toggle=tg)]
          rows.append({'y': T + 36, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
      new.append(mpanel('xb_vpan_g' if vname == 'gauges' else 'xb_vpan_e', tg, rows))
    # the tyres: the four corners round a tyre, the pressure big over the temperature, the units on top
    tt = 'viewSel=tyres&!mapUp'
    cxm = (TILES[0] + TILES[1]) // 2
    new.append(text('xb_vty_title', cxm - 180, 184, 360, 24, 'Pression et température des pneus', 'm_name', 'dim', 'center', SA, 0, toggle=tt))
    new.append(text('xb_vty_u', cxm - 165, 212, 330, 32, '{{u:pressure}} · {{u:temp}}', 'm_tiny', 'dim', 'center', SA, 0, toggle=tt))
    for corner, x, yc, sh in (('FL', TILES[0], TILES[2], SA), ('FR', TILES[1], TILES[2], SA), ('RL', TILES[0], TILES[3], SB), ('RR', TILES[1], TILES[3], SB)):
        new += [text('xb_vty_p' + corner, x - 55, yc - 30, 110, 29, '{{tyreP:%s}}' % corner, 'm_mid', 'fg', 'center', sh, 0, toggle=tt, tyreBy=corner),
                text('xb_vty_t' + corner, x - 55, yc + 10, 110, 23, '{{tyreT:%s}}' % corner, 'm_tyre', 'dim', 'center', sh, 0, toggle=tt)]
    new.append(mpanel('xb_vpan_t', tt, mode='tyres', tiles=TILES))
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
    new.append(mpanel('xb_vpan_dr', td, rows, div=3, seg=3))
    return new


def vcard(id, x, y, w, h, tog, conn, card, glass, edge, bar=None, rows=None, **kw):
    """the views' card of Sport, M and Navi (shaders.js VCARD): the glass, its edge, and inside it the rows of bars or the tyres' view"""
    o = {'id': id, 'type': 'vcard', 'class': 'content', 'z': 2, 'x': x, 'y': y, 'w': w, 'h': h, 'card': card, 'glass': glass, 'edge': edge,
         'bar': bar or [x, x + 1], 'rows': rows or [], 'seg': 24, 'div': 2, 'toggle': tog, 'conn': conn}
    o.update(kw)
    return o


# the engine view's rows in the other themes' card (the row's key, its icon, its signal, min, max, the value, its unit, where the red end starts, its tone)
CARD_ROWS = (('boost', 'gauge', 'boost', 0, 2, '{{boostPos}}', '{{u:pressure}}', 0.8, 'boost'),
             ('oil', 'oilPour', 'oil', 50, 150, '{{oil}}', '{{u:temp}}', 0.8, 'temp'),
             ('cool', 'tempWave', 'coolant', 50, 150, '{{coolant}}', '{{u:temp}}', 0.8, 'temp'),
             ('out', 'tempOut', 'ambient', -20, 50, '{{ambient}}', '{{u:temp}}', None, 'ice'))


def card_views(pre, X, Y, W, H, G, sheets, conn, cconn):
    """The three views in one card (19 Nov 2026: "un design sportif dans chaque thème"). G, the card's grid: pitch (the rows' step), x0 (the icon),
    xn (the name and the bar's left end), x1 (the bar's right end), xv (the value's right end), xu (the unit), vfont / ufont / lfont (value, unit,
    drive label), card / glass / edge / lean / rule (the look), tiles [left x, right x, front y, rear y], gm [x, y, size] and gt [x, y, w] (the G-meter
    and its two readings), title (the tyres' title's y, or None). sheets: (gauges, tyres, drive) sheet keys; conn: the texts', cconn: the cards'."""
    new = []
    look = dict(card=G['card'], glass=G['glass'], edge=G['edge'], lean=G['lean'], rule=G['rule'])
    bar = [G['xn'], G['x1']]
    tg, tt = 'viewSel=gauges&!mapUp', 'viewSel=tyres&!mapUp'
    rows = []
    for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(CARD_ROWS):
        T = Y + G['top'] + r * G['pitch']
        tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
        new += [icon(pre + 'g_%s_ic' % k, G['x0'], T + G['by'] - 20, 28, 32, ic, 'fg', sheets[0], conn, toggle=tg, **({'tempBy': sig} if tone == 'temp' else {})),
                text(pre + 'g_%s_name' % k, G['xn'] + 4, T - 9, G['x1'] - G['xn'] + 92, 24, GAUGE_NAMES[k], 'm_name', 'dim', 'left', sheets[0], conn, toggle=tg),
                text(pre + 'g_%s' % k, G['xv'] - G['vw'], T + G['by'] - 13, G['vw'], G['vh'], tok, G['vfont'], 'fg', 'right', sheets[0], conn, toggle=tg, **tb),
                text(pre + 'g_%s_unit' % k, G['xu'], T + G['by'] - 16, 46, G['uh'], unit, G['ufont'], 'dim', 'left', sheets[0], conn, toggle=tg)]
        rows.append({'y': T + G['by'], 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
    new.append(vcard(pre + 'card_g', X, Y, W, H, tg, cconn, bar=bar, rows=rows, div=-1, **look))       # (no marks under the bars: the rows are close)
    # the tyres: the car from above, a plate at each corner
    TL = G['tiles']
    cx = (TL[0] + TL[1]) // 2
    if G.get('title') is not None:
        new.append(text(pre + 't_title', cx - 180, G['title'], 360, 24, 'Pression et température des pneus', 'm_name', 'dim', 'center', sheets[1], conn, toggle=tt))
    for corner, x, yc in (('FL', TL[0], TL[2]), ('FR', TL[1], TL[2]), ('RL', TL[0], TL[3]), ('RR', TL[1], TL[3])):
        new += [text(pre + 't_p' + corner, x - 55, yc - 30, 110, 29, '{{tyreP:%s}}' % corner, 'm_mid', 'fg', 'center', sheets[1], conn, toggle=tt, tyreBy=corner),
                text(pre + 't_t' + corner, x - 55, yc + 10, 110, 23, '{{tyreT:%s}}' % corner, 'm_tyre', 'dim', 'center', sheets[1], conn, toggle=tt)]
    new.append(vcard(pre + 'card_t', X, Y, W, H, tt, cconn, mode='tyres', tiles=TL, **look))
    # the drive view: the G-meter in Sport, else what each part does in the drive mode, on a bar in three steps
    ds, dn = 'viewSel=drive&driveSport&!mapUp', 'viewSel=drive&!driveSport&!mapUp'
    gm, gt = G['gm'], G['gt']
    new += drive_g(pre + 'dg', gm[0], gm[1], gm[2], gt[0], gt[1], gt[2], sheets[2], conn, ds, stacked=True)
    new.append(vcard(pre + 'card_ds', X, Y, W, H, ds, cconn, **look))
    rows = []
    for r, (k, ic) in enumerate(SETUP_ROWS):
        T = Y + G['top'] + r * G['pitch']
        new += [icon(pre + 'dr_%s_ic' % k, G['x0'], T + G['by'] - 22, 28, 34, ic, 'fg', sheets[2], conn, toggle=dn),
                text(pre + 'dr_%s' % k, G['xn'] + 4, T - 9, G['xv'] - G['xn'], G['lh'], '{{setup:%s}}' % k, G['lfont'], 'fg', 'left', sheets[2], conn, toggle=dn)]
        rows.append({'y': T + G['by'], 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    new.append(vcard(pre + 'card_dr', X, Y, W, H, dn, cconn, bar=bar, rows=rows, seg=3, div=3, **look))
    return new


# Sport: between the two dials, right of the limit's rings (x 704..776), under the launch timer (y 333..359)
SPORT_CARD = dict(top=18, pitch=54, by=32, x0=806, xn=840, x1=1020, xv=1116, xu=1120, vw=92, vfont='s_val', vh=26, ufont='s_unit', uh=29, lfont='s_unit', lh=29,
                  card=[0.08, 14, 5], glass=[0.02, 0.07, 0.22], edge=[0.36, 0.62, 1.0], lean=0.5, rule=43,
                  tiles=[866, 1098, 444, 540], gm=[806, 415, 150], gt=[966, 462, 190], title=None)
# Navi: right of the emblem and the speed, ABOVE the place BMW keeps black on the car (shared/visible.js BLACK_BOX: x 1406..1597, y 322..440)
NAVI_CARD = dict(top=10, pitch=50, by=28, x0=1190, xn=1228, x1=1434, xv=1542, xu=1548, vw=104, vfont='s_val', vh=26, ufont='m_tiny', uh=32, lfont='m_label', lh=19,
                 card=[0.0, 24, 0], glass=[0.015, 0.05, 0.15], edge=[0.78, 0.86, 1.0], lean=0.3, rule=39,
                 tiles=[1265, 1505, 173, 261], gm=[1200, 132, 170], gt=[1392, 188, 196], title=None)


# Sport's own views (19 Nov 2026, the owner: "chaque thème différent", "original et très sportif"): four round gauges in a row between the two
# dials, right of the limit's rings (x 704..776), left of the gear (x 1315), under the launch timer (y 333..359). Each: the value in the ring, its unit
# under it in the arc's opening, its name in two lines under the ring.
# (centred on the screen's middle, x 960, since the owner found them "bizarre sur le côté": lower then, under the limit's rings, y 310..450)
SR = dict(x=696, y=452, w=528, h=120, x0=762, sp=132, cy=511, R=49, th=9, glass=[0.01, 0.04, 0.14], edge=[0.36, 0.62, 1.0])
SPORT_NAMES = {'boost': ('Pression', 'du turbo'), 'oil': ('Huile', 'moteur'), 'cool': ('Liquide de', 'refroidissement'), 'out': ('Température', 'extérieure')}


def sring(id, tog, conn, rows=None, **kw):
    o = {'id': id, 'type': 'sring', 'class': 'content', 'z': 2, 'x': SR['x'], 'y': SR['y'], 'w': SR['w'], 'h': SR['h'], 'card': [SR['R'], SR['th'], 26],
         'glass': SR['glass'], 'edge': SR['edge'], 'bar': [SR['x0'], SR['x0'] + SR['sp']], 'rows': rows or [], 'seg': 22, 'div': -1, 'toggle': tog, 'conn': conn}
    o.update(kw)
    return o


def sport_views(pre, sheets, conn, cconn):
    new = []
    tg, tt = 'viewSel=gauges&!mapUp', 'viewSel=tyres&!mapUp'
    cy, R = SR['cy'], SR['R']
    for vname, vp, ROWS, NAMES in (('gauges', 'g_', CARD_ROWS, SPORT_NAMES), ('electric', 'e_', ELEC_ROWS, ELEC_NAMES2)):
        tg = 'viewSel=%s&!mapUp' % vname
        rows = []
        for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(ROWS):
            cx = SR['x0'] + r * SR['sp']
            tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
            n1, n2 = NAMES[k]
            new += [text(pre + vp + '%s' % k, cx - 41, cy - 15, 82, 21, tok, 'r_val', 'fg', 'center', sheets[0], conn, toggle=tg, **tb),
                    text(pre + vp + '%s_unit' % k, cx - 24, cy + 14, 48, 29, unit, 's_unit', 'dim', 'center', sheets[0], conn, toggle=tg),
                    text(pre + vp + '%s_name' % k, cx - 66, cy + R + 13, 132, 20, n1, 'm_name_s', 'dim', 'center', sheets[0], conn, toggle=tg),
                    text(pre + vp + '%s_nameb' % k, cx - 66, cy + R + 33, 132, 20, n2, 'm_name_s', 'dim', 'center', sheets[0], conn, toggle=tg)]
            rows.append({'y': cy, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
        new.append(sring(pre + ('card_g' if vname == 'gauges' else 'card_e'), tg, cconn, rows))
    # the tyres: the car from above in a frame with cut corners, in the middle of the same place
    mx_ = SR['x'] + SR['w'] // 2
    TL = [mx_ - 116, mx_ + 116, 442, 538]             # (the frame: x 778..1142, right of the limit's rings)
    for corner, x, yc in (('FL', TL[0], TL[2]), ('FR', TL[1], TL[2]), ('RL', TL[0], TL[3]), ('RR', TL[1], TL[3])):
        new += [text(pre + 't_p' + corner, x - 55, yc - 30, 110, 29, '{{tyreP:%s}}' % corner, 'm_mid', 'fg', 'center', sheets[1], conn, toggle=tt, tyreBy=corner),
                text(pre + 't_t' + corner, x - 55, yc + 10, 110, 23, '{{tyreT:%s}}' % corner, 'm_tyre', 'dim', 'center', sheets[1], conn, toggle=tt)]
    new.append(sring(pre + 'card_t', tt, cconn, mode='tyres', tiles=TL, x=mx_ - 182, y=372, w=364, h=236))
    # the drive view: the G-meter in Sport; else four rings in three steps, the part's icon in each and what it does under it
    ds, dn = 'viewSel=drive&driveSport&!mapUp', 'viewSel=drive&!driveSport&!mapUp'
    new += drive_g(pre + 'dg', mx_ - 180, 396, 180, mx_ + 16, 456, 180, sheets[2], conn, ds, stacked=True)
    rows = []
    for r, (k, ic) in enumerate(SETUP_ROWS):
        cx = SR['x0'] + r * SR['sp']
        new += [icon(pre + 'dr_%s_ic' % k, cx - 14, cy - 17, 28, 34, ic, 'fg', sheets[2], conn, toggle=dn),
                text(pre + 'dr_%s' % k, cx - 66, cy + R + 14, 132, 29, '{{setup:%s}}' % k, 's_unit', 'fg', 'center', sheets[2], conn, toggle=dn)]
        rows.append({'y': cy, 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    new.append(sring(pre + 'card_dr', dn, cconn, rows, seg=3, div=3))
    return new


# Sport with the Waze map up (20 Nov 2026): there was no view at all then, the four rings' place is under the map. The same rings in small, two
# on each side of the map (the window: x 524..1396): one above and one below the speed on the left, one above and one below the gear on the right,
# each with its value and unit inside and its icon beside it (no room for the names written out). SM: each ring's middle (x, y), the radius;
# every ring 4 px or more inside the dial's frame (its lower sides lean in: x 373 + 0.645 (y - 493) on the left).
SM = dict(at=((430, 176), (430, 452), (1490, 176), (1490, 452)), R=36, th=8, top=124, h=380, w=112)


def sport_map_views(pre, conn, cconn):
    new = []
    SL, SRT = 'xs_sl', 'xs_sr'                       # the left pair's texts and the right pair's: two small sheets, not one across the map

    def side(i):
        cx, cy = SM['at'][i]
        return cx, cy, (SL if i < 2 else SRT), i < 2

    def rings(id, tog, rows, **kw):
        out = []
        for left in (True, False):
            (x0, _), (x1, _) = SM['at'][0:2] if left else SM['at'][2:4]
            out.append(sring(id + ('l' if left else 'r'), tog, cconn, rows[:2] if left else rows[2:], x=min(x0, x1) - 56, y=SM['top'], w=SM['w'], h=SM['h'],
                             bar=[x0, x1], card=[SM['R'], SM['th'], 26], **kw))
        return out

    def badge(id, i, ic, tog, color='fg', **kw):
        cx, cy, sh, left = side(i)
        outer = i % 2 == 0          # the upper rings' icon on the outer side (the drive mode's icon is on the map's side there), the lower rings' on the map's
        return icon(id, cx - 76 if left == outer else cx + 56, cy - 12, 20, 24, ic, color, sh, conn, toggle=tog, **kw)

    for vname, vp, ROWS in (('gauges', 'g', CARD_ROWS), ('electric', 'e', ELEC_ROWS)):
        tg = 'viewSel=%s&mapUp' % vname
        rows = []
        for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(ROWS):
            cx, cy, sh, left = side(r)
            tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
            new += [text(pre + vp + '_%s' % k, cx - 30, cy - 15, 60, 18, tok, 'r_val_s', 'fg', 'center', sh, conn, toggle=tg, **tb),
                    text(pre + vp + '_%s_unit' % k, cx - 24, cy + 5, 48, 29, unit, 's_unit', 'dim', 'center', sh, conn, toggle=tg),
                    badge(pre + vp + '_%s_ic' % k, r, ic, tg, **({'tempBy': sig} if tone == 'temp' else {}))]
            rows.append({'y': cy, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
        new += rings(pre + vp + '_ring', tg, rows)
    # the tyres: each one's pressure over its temperature in a ring, where the wheel is on the car (front ones on top, left ones on the left)
    tt = 'viewSel=tyres&mapUp'
    rows = []
    for i, corner in enumerate(('FL', 'RL', 'FR', 'RR')):
        cx, cy, sh, left = side(i)
        new += [text(pre + 't_p' + corner, cx - 30, cy - 15, 60, 18, '{{tyreP:%s}}' % corner, 'r_val_s', 'fg', 'center', sh, conn, toggle=tt, tyreBy=corner),
                text(pre + 't_t' + corner, cx - 24, cy + 6, 48, 23, '{{tyreT:%s}}' % corner, 'm_tyre', 'dim', 'center', sh, conn, toggle=tt),
                badge(pre + 't_ic' + corner, i, 'tyre', tt, 'dim')]
        rows.append({'y': cy, 'signal': 'none', 'min': 0, 'max': 1})
    new += rings(pre + 't_ring', tt, rows)
    # the drive view: in Sport the G-meter under the speed and its two readings under the gear; else each part's ring in three steps, its icon inside
    ds, dn = 'viewSel=drive&driveSport&mapUp', 'viewSel=drive&!driveSport&mapUp'
    gx, gy = SM['at'][1]
    new.append({'id': pre + 'dg', 'type': 'gmeter', 'class': 'content', 'z': 5, 'x': gx - 52, 'y': gy - 52, 'w': 104, 'h': 104, 'toggle': ds, 'conn': conn})
    rx, ry = SM['at'][3]
    new += [text(pre + 'dside', rx - 62, ry - 30, 124, 28, '{{gSide}}', 's_unit', 'fg', 'center', SRT, conn, toggle=ds),
            text(pre + 'dfwd', rx - 62, ry + 4, 124, 28, '{{gFwd}}', 's_unit', 'fg', 'center', SRT, conn, toggle=ds)]
    rows = []
    for i, (k, ic) in enumerate(SETUP_ROWS):
        cx, cy, sh, left = side(i)
        new.append(icon(pre + 'dr_%s_ic' % k, cx - 14, cy - 17, 28, 34, ic, 'fg', sh, conn, toggle=dn))
        rows.append({'y': cy, 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    new += rings(pre + 'dr_ring', dn, rows, seg=3, div=3)
    return new


# Navi with the Waze map up (20 Nov 2026: no view at all then): its thin lines in a narrow column between the map (x 1396) and the speed (x 1570),
# above the place BMW keeps black (y 322). Each row: its icon, its value and unit, the hairline with its sliding ring under them.
NM = dict(x=1400, y=124, w=168, h=192, x0=1408, x1=1562, t0=143, pitch=44)       # (the last row's line 12 px above the stepped one)


def navi_map_views(pre, conn, cconn):
    new = []
    S = 'xs_nm'

    def col(id, tog, rows=None, **kw):
        return nline(id, tog, cconn, rows, x=NM['x'], y=NM['y'], w=NM['w'], h=NM['h'], bar=[NM['x0'], NM['x1']], card=[110, 10, 0], **kw)

    for vname, vp, ROWS in (('gauges', 'g', CARD_ROWS), ('electric', 'e', ELEC_ROWS)):
        tg = 'viewSel=%s&mapUp' % vname
        rows = []
        for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(ROWS):
            T = NM['t0'] + r * NM['pitch']
            tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
            new += [icon(pre + vp + '_%s_ic' % k, NM['x0'], T - 16, 28, 34, ic, 'fg', S, conn, toggle=tg, **({'tempBy': sig} if tone == 'temp' else {})),
                    text(pre + vp + '_%s' % k, NM['x0'] + 30, T - 6, 80, 21, tok, 'r_val', 'fg', 'right', S, conn, toggle=tg, **tb),
                    text(pre + vp + '_%s_unit' % k, NM['x0'] + 114, T - 12, 44, 32, unit, 'm_tiny', 'dim', 'left', S, conn, toggle=tg)]
            rows.append({'y': T + 24, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
        new.append(col(pre + vp + '_col', tg, rows))
    tt = 'viewSel=tyres&mapUp'
    new += tyres(pre + 't_', NM['x0'], 140, 'm_tyre', 'm_tiny', S, conn, colw=62, gap=30, rowp=36, rowt=26, rear=104, toggle=tt)
    ds, dn = 'viewSel=drive&driveSport&mapUp', 'viewSel=drive&!driveSport&mapUp'
    new += drive_g(pre + 'dg', NM['x0'] + 17, 132, 120, NM['x0'], 256, NM['x1'] - NM['x0'], S, conn, ds, stacked=True)
    rows = []
    for r, (k, ic) in enumerate(SETUP_ROWS):
        T = NM['t0'] + r * NM['pitch']
        new += [icon(pre + 'dr_%s_ic' % k, NM['x0'], T - 16, 28, 34, ic, 'fg', S, conn, toggle=dn),
                text(pre + 'dr_%s' % k, NM['x0'] + 36, T - 6, 118, 19, '{{setup:%s}}' % k, 'm_label', 'fg', 'left', S, conn, toggle=dn)]
        rows.append({'y': T + 24, 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    new.append(col(pre + 'dr_col', dn, rows, seg=3, div=3))
    return new


# Navi's own views (19 Nov 2026): thin lines, no card. Right of the emblem and the speed, under the danger alert's card (y 38..114), above the place
# BMW keeps black (shared/visible.js BLACK_BOX: x 1406..1597, y 322..440). Each row: its name, its value and unit at the right, a hairline under them
# with a ring that slides to the level; the theme's stepped line under the rows.
NL = dict(x=1170, y=114, w=430, h=206, x0=1182, x1=1592, t0=142, pitch=44, glass=[0.01, 0.04, 0.12], edge=[0.8, 0.88, 1.0], step=[330, 16, 0])


def nline(id, tog, conn, rows=None, **kw):
    o = {'id': id, 'type': 'nline', 'class': 'content', 'z': 2, 'x': NL['x'], 'y': NL['y'], 'w': NL['w'], 'h': NL['h'], 'card': NL['step'],
         'glass': NL['glass'], 'edge': NL['edge'], 'bar': [NL['x0'], NL['x1']], 'rows': rows or [], 'seg': 24, 'div': -1, 'toggle': tog, 'conn': conn}
    o.update(kw)
    return o


def navi_views(pre, sheets, conn, cconn):
    new = []
    tg, tt = 'viewSel=gauges&!mapUp', 'viewSel=tyres&!mapUp'
    for vname, vp, ROWS, NAMES in (('gauges', 'g_', CARD_ROWS, GAUGE_NAMES), ('electric', 'e_', ELEC_ROWS, ELEC_NAMES)):
        tg = 'viewSel=%s&!mapUp' % vname
        rows = []
        for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(ROWS):
            T = NL['t0'] + r * NL['pitch']
            tb = {'tempBy': sig} if tone == 'temp' else {'iceBy': True} if tone == 'ice' else {}
            new += [text(pre + vp + '%s_name' % k, NL['x0'], T - 9, 280, 24, NAMES[k], 'm_name', 'dim', 'left', sheets[0], conn, toggle=tg),
                    text(pre + vp + '%s' % k, 1464, T - 6, 84, 21, tok, 'r_val', 'fg', 'right', sheets[0], conn, toggle=tg, **tb),
                    text(pre + vp + '%s_unit' % k, 1552, T - 12, 44, 32, unit, 'm_tiny', 'dim', 'left', sheets[0], conn, toggle=tg)]
            rows.append({'y': T + 24, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
        new.append(nline(pre + ('card_g' if vname == 'gauges' else 'card_e'), tg, cconn, rows))
    # the tyres: the car as an outline, each wheel's readings at the end of its line
    TL = [1258, 1512, 173, 261]
    for corner, x, yc in (('FL', TL[0], TL[2]), ('FR', TL[1], TL[2]), ('RL', TL[0], TL[3]), ('RR', TL[1], TL[3])):
        new += [text(pre + 't_p' + corner, x - 55, yc - 32, 110, 29, '{{tyreP:%s}}' % corner, 'm_mid', 'fg', 'center', sheets[1], conn, toggle=tt, tyreBy=corner),
                text(pre + 't_t' + corner, x - 55, yc + 8, 110, 23, '{{tyreT:%s}}' % corner, 'm_tyre', 'dim', 'center', sheets[1], conn, toggle=tt)]
    new.append(nline(pre + 'card_t', tt, cconn, mode='tyres', tiles=TL))
    # the drive view: the G-meter in Sport, else each part's name over a line in three dashes
    ds, dn = 'viewSel=drive&driveSport&!mapUp', 'viewSel=drive&!driveSport&!mapUp'
    new += drive_g(pre + 'dg', 1200, 132, 170, 1392, 188, 196, sheets[2], conn, ds, stacked=True)
    new.append(nline(pre + 'card_ds', ds, cconn))
    rows = []
    for r, (k, ic) in enumerate(SETUP_ROWS):
        T = NL['t0'] + r * NL['pitch']
        new += [icon(pre + 'dr_%s_ic' % k, NL['x0'], T - 14, 28, 34, ic, 'fg', sheets[2], conn, toggle=dn),
                text(pre + 'dr_%s' % k, NL['x0'] + 40, T - 6, 300, 19, '{{setup:%s}}' % k, 'm_label', 'fg', 'left', sheets[2], conn, toggle=dn)]
        rows.append({'y': T + 24, 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    new.append(nline(pre + 'card_dr', dn, cconn, rows, seg=3, div=3))
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
    # without the map the views' texts keep sheets of their own, xs_va / xs_vb (20 Nov 2026, the owner: "quand j'appuie tout bug un peu, ça clignote"): sharing the sheets of the
    # theme's own texts, each press of BC changed those sheets, so the gear, the speed and the strips' numbers were taken off and drawn again
    # (with the Waze map up too, since the sheets were packed apart on 20 Nov 2026: there is room for this one, 17 layers at most)
    S_RIGHT = 'xs_mo'
    new += _mblade_views(d, 'xs_va', 'xs_va', 'xs_vl', 'xs_vf')      # (the upper and the lower rows in one sheet: one layer less, the same memory)
    # With the Waze map up (20 Nov 2026, the owner: the views with the map were "trop simple", two readings on bare slanted bars): the same panel
    # in small, right of the blade's numbers and above the danger alert's card (y 340), mirrored: its point to the right, the two colour bands on
    # the left, towards the blade. Two readings (the oil has its strip just under): each an icon, the value, the unit, and its leaning bar.
    MX, MY, MW, MH, MK = 1646, 122, 266, 214, 0.12
    MZ = MW - 4 - int(round(MK * MH / 2)) - 2                  # the band's width: the point 4 px from the right edge, the corners 2 px from the left one
    MBAR = [1704, 1876]

    def mini(id, tog, rows=None, **kw):
        o = {'id': id, 'type': 'mpanel', 'class': 'content', 'z': 2, 'x': MX, 'y': MY, 'w': MW, 'h': MH, 'shape': [MX + 4, MY + MH // 2, MK, MZ],
             'bar': MBAR, 'div': 2, 'seg': 24, 'rows': rows or [], 'rule': 57, 'flip': True, 'bands': 0.42, 'toggle': tog, 'conn': 3}
        o.update(kw)
        return o

    def mini_rows(pfx, tog, ROWS):
        out, rows = [], []
        for r, (k, ic, sig, mn, mx, tok, unit, red, tone) in enumerate(ROWS):
            T = 180 + r * 77                                   # (the first row's unit, at the right, clears the hood: y 185 at x 1882)
            tb = {'tempBy': sig} if tone == 'temp' else {}
            out += [icon(pfx + k + '_ic', MBAR[0], T, 28, 34, ic, 'fg', S_RIGHT, 1, toggle=tog, **tb),
                    text(pfx + k, MBAR[0] + 30, T + 2, 96, 29, tok, 'm_mid', 'fg', 'right', S_RIGHT, 1, toggle=tog, **tb),
                    text(pfx + k + '_unit', MBAR[0] + 130, T + 5, 48, 32, unit, 'm_tiny', 'dim', 'left', S_RIGHT, 1, toggle=tog)]
            rows.append({'y': T + 54, 'signal': sig, 'min': mn, 'max': mx, 'red': red if red else 2, 'tone': tone})
        return out + [mini(pfx + 'pan', tog, rows)]

    by_row = {r[0]: r for r in CARD_ROWS}
    new += mini_rows('xb_mg_', 'viewSel=gauges&mapUp', (by_row['boost'], by_row['cool']))
    new += mini_rows('xb_me_', 'viewSel=electric&mapUp', (ELEC_ROWS[2], ELEC_ROWS[3]))          # the power and what is won back: the charge and the range have their strip
    # the tyres: the car in small between the two columns, each wheel in its tyre's colour
    tm = 'viewSel=tyres&mapUp'
    new += tyres('xb_mty', 1676, 176, 'm_tyre', 'm_tiny', S_RIGHT, 1, colw=62, gap=72, rowp=34, rowt=26, rear=96, toggle=tm)     # (12 px of air under the rear tyres' temperatures)
    new = [w for w in new if w['id'] != 'xb_mtyic']                                              # (the car is drawn by the panel: no wheel glyph)
    new.append(mini('xb_mtpan', tm, mode='tyres', car=0.55, tiles=[1676 + 62 + 36 - 1, 1676 + 62 + 36 + 1, 176 + 34 + 26, 176 + 96 + 26]))
    new += drive_g('xb_mdg', 1712, 150, 120, 1676, 274, 196, S_RIGHT, 1, 'viewSel=drive&driveSport&mapUp', stacked=True)
    new.append(mini('xb_mdspan', 'viewSel=drive&driveSport&mapUp'))
    new += drive_rows('xb_mdr_', 1698, 186, 38, S_RIGHT, 1, 'viewSel=drive&!driveSport&mapUp', 'm_label', 150, shiftx=36)
    new.append(mini('xb_mdrpan', 'viewSel=drive&!driveSport&mapUp'))
    d['widgets'] += new


def _sport(d):
    new = []
    # the danger zone alert, in the middle under the emblem (and over the top of the map when it shows): its texts join the timer's sheet
    danger_card(d, 824, 256, *_sheet(d, 'run_time'), h=66, top=8)       # (air between the emblem, y 244, and the launch timer, y 333)
    # the three views in one slanted glass card in the middle, between the two dials (19 Nov 2026), under the launch timer (y 333..359)
    new += sport_views('xb_', ('xs_s', 'xs_t', 'xs_dr'), 3, 2)
    new += sport_map_views('xb_sm', 3, 2)
    d['widgets'] += new



def _navi(d):
    new = []
    # the oil's bar stays under its value in the right column; the three views open in one rounded glass card left of that column, right of the
    # speed (19 Nov 2026)
    new.append(meter('xb_oil_bar', 1644, 436, 200, 7, 'oil', 50, 150, [0.25, 0.8], [BLUE, GREEN, RED], 30, 2, 3))
    # (under the danger alert's card, y 38..114)
    new += navi_views('xb_', ('xs_n', 'xs_t', 'xs_dr'), 1, 2)
    new += navi_map_views('xb_nm', 1, 2)
    d['widgets'] += new


# Shak (23 Nov 2026, the owner: "à droite on mettra les thèmes BC"): every view in the right panel, the same with the map up or not,
# under the drive mode and its divider (y 190), right of BMW's black box (x 1597), the hood leaves it from y 196 at the far right. Each row: its
# icon, its value and unit, a hairline with the sliding ring under them (the neon line of the theme's frame round it).
# short names: the panel is narrower than Navi's card (the long ones were cut: "Liquide de refroidis", 23 Nov 2026)
EV_NAMES = {'boost': 'Turbo', 'oil': 'Huile moteur', 'cool': 'Refroidissement', 'out': 'Extérieur',
            'batt': 'Batterie', 'erange': 'Autonomie', 'epow': 'Puissance', 'erec': 'Récupération'}
# Shak's own view rows (the intake air of the engine unit is left out: its reading is not confirmed on this car): key, icon, name, value, unit, signal of its bar (None: no bar), min, max, red from, tone
EV_ENGINE = (('boost', 'gauge', 'Turbo', '{{boostPos}}', '{{u:pressure}}', 'boost', 0, 2, 0.8, 'boost'),
             ('peak', 'gauge', 'Pic du turbo', '{{boostPeak}}', '{{u:pressure}}', None, 0, 0, None, None),
             ('avg', 'stopwatch', 'Vitesse moyenne', '{{avgSpeed}}', '{{u:speedLc}}', None, 0, 0, None, None))
EV_ELEC = (('batt', 'battery', 'Batterie', '{{hvSoc}}', '%', 'hvSoc', 0, 100, None, 'blue'),
           ('share', 'leaf', 'Part en électrique', '{{evShare}}', '{{evShareUnit}}', None, 0, 0, None, None))
EV = dict(x=1440, y=232, w=392, h=330, x0=1454, x1=1816, t0=272, pitch=72, glass=[0.05, 0.0, 0.05], edge=[1.0, 0.45, 0.86], step=[300, 12, 0])


def evbars(id, tog, conn, rows):
    """One layer of the Shak views' bars of slanted blocks (shaders.js evbars), under the rows of one view."""
    return {'id': id, 'type': 'evbars', 'class': 'content', 'z': 2, 'x': EV['x'], 'y': EV['y'], 'w': EV['w'], 'h': EV['h'],
            'bar': [EV['x0'], EV['x1']], 'rows': rows, 'toggle': tog, 'conn': conn}


def evo_views(pre, conn, cconn):
    """The Shak theme's views, in its right panel, in the theme's own style (owner, 23 Nov 2026: "inspire-toi du thème actuel, pas des vues des
    autres thèmes : la barre comme l'autonomie"): each row its icon and name, the value and unit on the right, and under them a bar of slanted
    blocks like the bottom row's (one layer per view, shaders.js evbars); the tyres round the car seen from above; the G-meter or the drive settings."""
    new = []
    S = 'xs_ev'
    x0, x1 = EV['x0'], EV['x1']
    # what the theme does not show elsewhere (owner, 23 Nov 2026: "le thème BC reprend à peu près la même chose"): the oil, the coolant and the
    # electric range are on the bottom row, the outside temperature on the top one, the power and the recuperation in the left panel
    for vname, vp, ROWS in (('gauges', 'g', EV_ENGINE), ('electric', 'e', EV_ELEC)):
        tg = 'viewSel=%s' % vname
        rows = []
        for r, (k, ic, name, tok, unit, sig, mn, mx, red, tone) in enumerate(ROWS):
            T = EV['t0'] + r * EV['pitch']
            new += [icon(pre + vp + '_%s_ic' % k, x0, T - 18, 28, 34, ic, 'fg', S, conn, toggle=tg),
                    text(pre + vp + '_%s_name' % k, x0 + 38, T - 13, 190, 24, name, 'm_name', 'dim', 'left', S, conn, toggle=tg),
                    text(pre + vp + '_%s' % k, x0 + 228, T - 19, 84, 27, tok, 'e_val', 'fg', 'right', S, conn, toggle=tg),
                    text(pre + vp + '_%s_unit' % k, x0 + 316, T - 19, 56, 27, unit, 'e_unit', 'dim', 'left', S, conn, toggle=tg)]      # (the value's baseline)
            if sig:                       # a reading with a scale: its bar under it; the others are a value alone
                rows.append(dict({'y': T + 26, 'signal': sig, 'min': mn, 'max': mx}, **({'low': True} if sig == 'hvSoc' else {})))      # (the charge: red when low)
        new.append(evbars(pre + vp + '_bars', tg, cconn, rows))
    # the tyres: pressure over temperature at each corner, round the car seen from above (its wheels green, as on the picture)
    tt = 'viewSel=tyres'
    new.append(text(pre + 't_u', x0, 250, x1 - x0, 27, '{{u:pressure}} · {{u:temp}}', 'e_unit', 'dim', 'center', S, conn, toggle=tt))
    for corner, cx, cy in (('FL', x0 + 60, 300), ('FR', x1 - 60, 300), ('RL', x0 + 60, 420), ('RR', x1 - 60, 420)):
        new += [text(pre + 't_p' + corner, cx - 60, cy, 120, 27, '{{tyreP:%s}}' % corner, 'e_val', 'fg', 'center', S, conn, toggle=tt, tyreBy=corner),
                text(pre + 't_t' + corner, cx - 60, cy + 34, 120, 27, '{{tyreT:%s}}' % corner, 'e_unit', 'dim', 'center', S, conn, toggle=tt)]
    new.append(nline(pre + 't_col', tt, cconn, None, x=EV['x'], y=EV['y'], w=EV['w'], h=EV['h'], bar=[x0, x1], card=[0, 0, 0],
                     glass=[0.0, 0.0, 0.0], edge=EV['edge'], mode='tyres', tiles=[x0 + 60, x1 - 60, 316, 436]))
    ds, dn = 'viewSel=drive&driveSport', 'viewSel=drive&!driveSport'
    new += drive_g(pre + 'dg', x0 + 10, 262, 190, x0 + 214, 330, 148, S, conn, ds, stacked=True)
    rows = []
    for r, (k, ic) in enumerate(SETUP_ROWS):
        T = EV['t0'] + r * EV['pitch']
        new += [icon(pre + 'dr_%s_ic' % k, x0, T - 18, 28, 34, ic, 'fg', S, conn, toggle=dn),
                text(pre + 'dr_%s' % k, x0 + 40, T - 14, 300, 27, '{{setup:%s}}' % k, 'e_unit', 'fg', 'left', S, conn, toggle=dn)]
        rows.append({'y': T + 26, 'signal': 'setupLevel:' + k, 'min': 0, 'max': 3})
    # three levels (comfort, sport, sport plus): three wide blocks (owner, 23 Nov 2026: "trop de traits, fais des traits plus larges")
    new.append(dict(evbars(pre + 'dr_bars', dn, cconn, rows), pitch=(EV['x1'] - EV['x0'] + 6) / 3.0))
    return new


def _evo(d):
    d['widgets'] += evo_views('xb_ev', 1, 2)


BUILD = {'m': _m, 'mblade': _mblade, 'sport': _sport, 'navi': _navi, 'evo': _evo}
CAP = pack_sheets.CAP


# (la vue, la voiture est en Sport) : la vue « Conduite » montre autre chose en Sport (G-force) et hors Sport (réglages des modes)
STATES = ((None, False), ('gauges', False), ('tyres', False), ('drive', True), ('drive', False), ('electric', False))


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
