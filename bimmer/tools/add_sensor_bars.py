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



def _m(d):
    new = []
    # boost in the gap of the bottom row (between the electric share and the oil), bars under the three values
    new += [icon('xb_boost_icon', 790, 624, 29, 34, 'gauge', sheet='xs_m', conn=1),
            text('xb_boost', 824, 624, 92, 34, '{{boost}}', 'm_mid', align='right', sheet='xs_m', conn=1),
            text('xb_boost_unit', 922, 630, 48, 29, '{{u:pressure}}', 'm_tiny', 'dim', sheet='xs_m', conn=1)]
    new += [meter('xb_boost_bar', 790, 662, 180, 8, 'boost', 0, 1.6, [0.75, 0.9], ['fg', 'fg', RED], 12, 3, 2),
            meter('xb_oil_bar', 1058, 662, 176, 8, 'oil', OIL['mn'], OIL['mx'], OIL['at'], [BLUE, GREEN, RED], 12, 3, 3),
            meter('xb_cool_bar', 1268, 662, 176, 8, 'coolant', COOL['mn'], COOL['mx'], COOL['at'], [BLUE, GREEN, RED], 12, 3, 3)]
    d['widgets'] += new
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


def _mblade(d):
    new = []
    # the tyres top left, over the fuel gauge, and the coolant and the boost top right, over the rev blade's numbers, with a slanted bar each
    # (the oil already has its strip beside the blade): both are free in the two views (the gear letter of the map view is at y 291) ;
    # their texts join the sheets of what lies under them ("s7" the fuel gauge, "s6" the rev numbers): no layer more (tools/test_pixel_memory.js)
    X = 1580
    new += [icon('xb_cool_icon', X, 156, 26, 34, 'tempWave', 'fg', 's6', 0, tempBy='coolant'),
            text('xb_cool', X + 34, 158, 104, 29, '{{coolant}}', 'm_mid', 'fg', 'right', 's6', 0, tempBy='coolant'),
            text('xb_cool_unit', X + 142, 161, 44, 32, '{{u:temp}}', 'm_tiny', 'dim', 'left', 's6', 0),
            slant('xb_cool_bar', X, 198, 260, 14, 'coolant', 40, 130, 2),
            icon('xb_boost_icon', X, 256, 29, 34, 'gauge', 'fg', 's6', 0),
            text('xb_boost', X + 34, 258, 104, 29, '{{boost}}', 'm_mid', 'fg', 'right', 's6', 0),
            text('xb_boost_unit', X + 142, 261, 60, 32, '{{u:pressure}}', 'm_tiny', 'dim', 'left', 's6', 0),
            slant('xb_boost_bar', X, 298, 260, 14, 'boost', 0, 1.6, 3)]
    new += tyres('xb_ty', 150, 128, 'm_tyre', 'm_tiny', 's7', 1)
    # the drive view in the same top right corner: the G-meter in Sport, else the setup rows (no bars: the layers are used up); the texts join "s6"
    # (the danger alert's card sits at y 340..418 when a zone is ahead, and BMW's black box at x 1406..1597: all stop above it or right of it)
    new += drive_g('xb_dg', 1640, 116, 186, 1628, 306, 110, 's6', 0, 'viewSel=drive&driveSport')
    new += drive_rows('xb_dr_', 1580, 138, 50, 's6', 0, 'viewSel=drive&!driveSport', 'm_label', 170)
    d['widgets'] += new
    for w in d['widgets']:           # the coolant's number is now beside its bar
        if w['id'] in ('cool_icon', 'cool', 'cool_unit'):
            w['toggle'] = '!viewSel=gauges'


def _sport(d):
    new = []
    TG = 'viewSel=gauges&!mapUp'
    X = 790; Y0 = 420; DY = 54
    rows = [('oil', 'oilPour', 'oil', 50, 150, '{{oil}}', '{{u:temp}}'), ('cool', 'tempWave', 'coolant', 40, 130, '{{coolant}}', '{{u:temp}}'), ('boost', 'gauge', 'boost', 0, 1.6, '{{boost}}', '{{u:pressure}}')]
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
            text('xb_boost', X + 40, 293, 96, 34, '{{boost}}', 'm_mid', 'fg', 'right', 'xs_n', 1, toggle=NM),
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
