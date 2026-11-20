#!/usr/bin/env python3
"""Writes ShakHUD's layout (apps/shakhud/hud/layouts/mstyle.json): the M Style rev counter, a bent bar (a rising slant, then a level
run) with its numbers under it. Run it again after changing a number here.  python3 tools/gen_shakhud.py

HUD scene 800x480, what the windshield shows: x 120..680, y 100..380 (shared/visible.js). BMW's own speed sits at the bottom left
(x 120..350, y 235..380): kept clear. Waze's HUD map (Waze on cluster) is drawn by another app in the same scene, under our layers:
everything here is a thin line or a small number, nothing fills an area. The top middle is kept clear of the turn-signal arrows
(Cluster Info: x 349..451, y 146..170): the numbers sit above them."""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'apps', 'shakhud', 'hud', 'layouts', 'mstyle.json')
P0, P1, P2 = (136, 190), (246, 116), (626, 116)       # the bar's start, its bend, its end
BAR = 20                                               # its width
RPM_MAX, CORNER = 7000, 2000                           # the scale's end, the rpm at the bend
TICK_GAP, TICK_LEN = 3, 10                             # the long tick (even thousands), from the bar's edge
LAB_W, LAB_H = 24, 18                                  # a number's box (font "small")
RECT = (120, 100, 530, 128)                            # the effect layer, x y w h

def unit(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n)

def tick(k):
    """Where the tick of k thousand rpm is, and the direction (under the bar) its normal points to."""
    fr = k * 1000.0 / RPM_MAX
    c = CORNER / float(RPM_MAX)
    d1, d2 = unit((P1[0] - P0[0], P1[1] - P0[1])), unit((P2[0] - P1[0], P2[1] - P1[1]))
    if abs(fr - c) < 1e-3:
        d = unit((d1[0] + d2[0], d1[1] + d2[1]))
        p = P1
    elif fr < c:
        t = fr / c
        d, p = d1, (P0[0] + (P1[0] - P0[0]) * t, P0[1] + (P1[1] - P0[1]) * t)
    else:
        t = (fr - c) / (1 - c)
        d, p = d2, (P1[0] + (P2[0] - P1[0]) * t, P1[1] + (P2[1] - P1[1]) * t)
    return p, (-d[1], d[0])

def label(k):
    p, n = tick(k)
    r = BAR / 2.0 + TICK_GAP + TICK_LEN + 2 + LAB_H / 2.0
    cx, cy = p[0] + n[0] * r, p[1] + n[1] * r
    return {'id': 'rev%d' % k, 'type': 'text', 'font': 'small', 'color': 'fg', 'align': 'center', 'class': 'content', 'z': 10,
            'x': int(round(cx - LAB_W / 2.0)), 'y': int(round(cy - LAB_H / 2.0)), 'w': LAB_W, 'h': LAB_H, 'text': str(k)}

widgets = [{
    'id': 'revcounter', 'type': 'mstyle', 'class': 'overlay', 'z': 10,
    'x': RECT[0], 'y': RECT[1], 'w': RECT[2], 'h': RECT[3],
    'pts': [list(P0), list(P1), list(P2)], 'bar': BAR, 'corner': CORNER, 'rpmMax': RPM_MAX,
    'hybridTach': True, 'chgOnBar': True,
}]
widgets += [label(k) for k in (0, 2, 4, 6)]
# the shift light, BMW's modern one (the M cars' own): slanted lights on each side of a red block, filling from the outer ends in as the
# rpm climbs from 3000, the block red at "shiftLightRed" (4500), everything flashing red from "shiftLightFlash" (5500). Under the numbers,
# right of the bend, clear of the turn-signal arrows (y 146..170) and of BMW's speed; the setting "shiftLights" hides it.
widgets.append({'id': 'shiftlight', 'type': 'shiftlight', 'class': 'overlay', 'z': 10, 'x': 330, 'y': 182, 'w': 296, 'h': 22,
                'segments': 5, 'from': 3000, 'gap': 6, 'center': 40, 'skew': 8, 'toggle': 'shiftLights', 'red': 4500, 'flash': 5500})
widgets += [
    {'id': 'rev_unit', 'type': 'text', 'font': 'small', 'color': 'dim', 'align': 'left', 'class': 'content', 'z': 10,
     'x': 574, 'y': 142, 'w': 104, 'h': 18, 'text': '{{tachUnit}}'},
    {'id': 'rev_charge', 'type': 'text', 'font': 'small', 'color': 'fg', 'align': 'left', 'class': 'content', 'z': 10,
     'x': 574, 'y': 161, 'w': 104, 'h': 18, 'text': '{{chargeNote}}'},
    # the tyre pressure warning, top left above the bar: nothing while the tyres are fine, the lowest pressure in yellow (red much lower) otherwise
    {'id': 'tyre_icon', 'type': 'icon', 'icon': 'tyre', 'color': 'dim', 'tyreBy': 'any', 'tyreOnly': True, 'class': 'content', 'z': 10,
     'x': 124, 'y': 102, 'w': 28, 'h': 28},
    {'id': 'tyre_warn', 'type': 'text', 'font': 'mid', 'color': 'fg', 'align': 'left', 'tyreBy': 'any', 'class': 'content', 'z': 10,
     'x': 156, 'y': 102, 'w': 70, 'h': 29, 'text': '{{tyreMin}}'},
]
# The bottom right block, what the windshield shows to the right of BMW's own speed (x 120..350): the battery's charge big, the electric and
# the fuel range beside it, a slanted battery bar (light blue, green while charging, red in reserve: 10 %, as the numbers and the ranges: 90 km of fuel), the oil and coolant
# temperatures under it (an oil can and a thermometer, no words). Hidden with the setting "showBattery". All inside x 372..676, y 246..361.
BX, BW = 372, 304
widgets += [
    {'id': 'soc', 'lowWhen': 'battery', 'type': 'text', 'font': 'big', 'color': 'fg', 'align': 'left', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': BX, 'y': 246, 'w': 150, 'h': 46, 'text': '{{hvSoc}}%'},
    {'id': 'ev_icon', 'lowWhen': 'battery', 'type': 'icon', 'icon': 'battBolt', 'color': 'dim', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': 546, 'y': 247, 'w': 28, 'h': 28},
    {'id': 'ev_range', 'lowWhen': 'battery', 'type': 'text', 'font': 'mid', 'color': 'fg', 'align': 'right', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': 576, 'y': 247, 'w': 100, 'h': 29, 'text': '{{evRange}} {{u:distLc}}'},
    {'id': 'fuel_icon', 'lowWhen': 'fuel', 'type': 'icon', 'icon': 'fuelBolt', 'color': 'dim', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': 546, 'y': 277, 'w': 28, 'h': 28},
    {'id': 'fuel_range', 'lowWhen': 'fuel', 'type': 'text', 'font': 'mid', 'color': 'fg', 'align': 'right', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': 576, 'y': 276, 'w': 100, 'h': 29, 'text': '{{rangeTotal}} {{u:distLc}}'},
    {'id': 'batbar', 'lowWhen': 'battery', 'type': 'slantbar', 'class': 'overlay', 'z': 10, 'toggle': 'showBattery', 'signal': 'hvSoc',
     'x': BX, 'y': 310, 'w': BW, 'h': 16, 'slant': 12, 'low': 15},
    {'id': 'oil_icon', 'type': 'icon', 'icon': 'oilPour', 'tempBy': 'oil', 'color': 'fg', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': BX, 'y': 332, 'w': 30, 'h': 30},
    {'id': 'oil', 'type': 'text', 'font': 'mid', 'color': 'fg', 'align': 'left', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'tempBy': 'oil', 'x': BX + 36, 'y': 333, 'w': 84, 'h': 29, 'text': '{{oil}}{{u:temp}}'},
    {'id': 'coolant_icon', 'type': 'icon', 'icon': 'tempWave', 'tempBy': 'coolant', 'color': 'fg', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'x': BX + BW - 118, 'y': 332, 'w': 30, 'h': 30},
    {'id': 'coolant', 'type': 'text', 'font': 'mid', 'color': 'fg', 'align': 'left', 'class': 'content', 'z': 10, 'toggle': 'showBattery',
     'tempBy': 'coolant', 'x': BX + BW - 82, 'y': 333, 'w': 82, 'h': 29, 'text': '{{coolant}}{{u:temp}}'},
]
# The danger zone alert (20 Nov 2026, the owner: "rajoute l'alerte radar sur le ShakHUD, fais-moi un beau truc et réaménage"). While a zone is ahead
# the bottom right block gives its place to the alert (toggle "danger": the battery block has "showBattery&!danger"): a red camera, ZONE DE DANGER,
# the distance big with its unit, the speed limit in a red ring when the source gives it, and under them a slanted red bar that fills on the way
# (0 at 500 m, full at the zone). The alert itself comes from another app (ShakTheme's radar list): this one only reads it (shared/danger.js).
for w in widgets:
    if w['id'] in ('oil_icon', 'oil', 'coolant_icon', 'coolant'):
        w['readyHides'] = True              # the launch cue takes their row while it shows (it was set by hand in the layout)
    if w.get('toggle') == 'showBattery':
        w['toggle'] = 'showBattery&!danger'
RED = [255, 42, 42, 255]
AL = {'class': 'content', 'z': 10, 'toggle': 'danger'}
widgets += [
    dict(AL, id='al_cam', type='icon', icon='cam', color=RED, x=BX, y=258, w=52, h=52),
    dict(AL, id='al_title', type='text', font='mid', color=RED, align='left', x=BX + 64, y=244, w=180, h=29, text='ZONE DE DANGER'),
    dict(AL, id='al_dist', type='text', font='big', color='fg', align='right', x=BX + 60, y=276, w=104, h=46, text='{{dangerDist}}', toggle='dangerAhead'),
    dict(AL, id='al_unit', type='text', font='mid', color='fg', align='left', x=BX + 170, y=292, w=40, h=29, text='{{dangerUnit}}', toggle='dangerAhead'),
    dict(AL, id='al_in', type='text', font='mid', color='fg', align='left', x=BX + 64, y=286, w=176, h=29, text='DANS LA ZONE', toggle='dangerInside'),
    dict(AL, id='al_ring', type='icon', icon='ring', color=RED, x=BX + BW - 62, y=258, w=60, h=60, toggle='dangerLimit'),
    dict(AL, id='al_limit', type='text', font='mid', color='fg', align='center', x=BX + BW - 56, y=274, w=48, h=29, text='{{dangerLimit}}', toggle='dangerLimit'),
    {'id': 'al_bar', 'type': 'slantbar', 'class': 'overlay', 'z': 10, 'toggle': 'danger', 'signal': 'dangerNear', 'min': 0, 'max': 1, 'tone': 'hot',
     'x': BX, 'y': 336, 'w': BW, 'h': 16, 'slant': 12, 'trackColor': [96, 22, 26, 255]},
    # the launch cue (a chequered flag and the words, in green, while launch control is armed): the row under the temperatures; it was added to the
    # layout by hand, and gives way to the alert
    {'id': 'ready_flag', 'type': 'icon', 'icon': 'flag', 'z': 5, 'x': BX, 'y': 332, 'w': 30, 'h': 30, 'color': 'fg', 'readyBy': True, 'toggle': '!danger'},
    {'id': 'ready_text', 'type': 'text', 'z': 5, 'x': BX + 38, 'y': 333, 'w': 266, 'h': 29, 'text': '{{launchReady}}', 'font': 'mid', 'color': 'fg',
     'align': 'left', 'readyBy': True, 'toggle': '!danger'},
]

doc = {
    'schemaVersion': 2, 'name': 'M Style',
    '_about': 'M Style, generated by tools/gen_shakhud.py: a bent rev bar at the top left (a rising slant, then a level run to 7), the numbers '
              'under it, red in the red zone, BMW\'s modern shift light under that; light blue (the power) while the battery alone drives, green while it charges (setting '
              '"Hybrid rev counter"). Thin lines and small numbers only, so Waze\'s HUD map under it stays readable; clear of BMW\'s '
              'speed (bottom left) and of the turn-signal arrows (top middle). Bottom right: the battery charge and bar, the electric and fuel range, oil and coolant.',
    'widgets': widgets,
}
with open(OUT, 'w') as f:
    json.dump(doc, f, indent=2)
    f.write('\n')
print('wrote', os.path.relpath(OUT), len(widgets), 'widgets')
