#!/usr/bin/env python3
"""The zoom of the scale numbers (ShakTheme): the number nearest a bar's marker is drawn larger (1.2 times, a bigger bake of the same
font) and in the zone's colour while the bar is in its zone. The larger digits may need more room than a label's box has, so this
tags the scale labels of a layout with "near", "nearFont" (the bigger bake), "nearMid" (the middle step), "rpmMax" (the rev scale's top) and, where needed, "grow":

    python3 tools/zoom_labels.py m sport      # these layouts, in place (idempotent)

gen_mblade_navi.py calls zoomify() itself before it writes mblade.json and navi.json.

A box grows only as much as the larger digits need, away from the bar when it fits (a right aligned number to the left, a left aligned
one to the right, a centred one on both sides), clear of BMW's black box, the belt light, the hood and the panel's edge. "grow" is
[left, top, right, bottom], the px the box grew by: x, y, w, h already include them, so the nominal box is
x + grow[0], y + grow[1], w - grow[0] - grow[2], h - grow[1] - grow[3] (shared/hud.js draws the normal digits there).
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'apps', 'shaktheme', 'hud')
ZOOM = {'s_scale': 's_scale_z', 'm_num': 'm_num_z', 'm_gl': 'm_gl_z', 'e_rnum': 'e_rnum_z', 'e_snum': 'e_snum_z', 'c_num': 'c_num_z'}
MID = {'s_scale': 's_scale_m', 'm_num': 'm_num_m', 'm_gl': 'm_gl_m', 'e_rnum': 'e_rnum_m', 'e_snum': 'e_snum_m', 'c_num': 'c_num_m'}      # 1.1 times: the middle step of the number's growth (a soft rise, not a jump)
RPM_MAX = {'sport': 7000, 'm': 7000, 'mblade': 7000, 'navi': 7000, 'evo': 7000, 'circuit': 7000}       # the rev scale's top of each layout (the bars' _redMarks)
BLACK_BOX = (1406, 342, 1597, 419)
BELT = (587, 663, 626, 700)
# the speed scales of shared/hud.js (SPEED_SCALE, M_SCALE), metric and mph: a label's widest number in either unit sets its room
SCALES = {'speed': ([0, 30, 60, 90, 120, 150, 180, 250, 320], [0, 20, 40, 60, 80, 100, 120, 160, 200]),
          'mspeed': ([0, 30, 60, 90, 120, 150, 210, 270, 330], [0, 20, 40, 60, 80, 100, 130, 170, 205])}
_fonts = {}
_hood = None


def font(name):
    if name not in _fonts:
        with open(os.path.join(APP, 'fonts', name + '.json')) as f:
            _fonts[name] = json.load(f)
    return _fonts[name]


def width(name, text):
    g = font(name)['glyphs']
    return sum(g[c]['advance'] for c in text)


def hood_y(x):
    """visible.hoodY(x), through node (one call: all 1921 columns)."""
    global _hood
    if _hood is None:
        js = "const v=require('../shared/visible');console.log(JSON.stringify(Array.from({length:1921},(_,x)=>v.hoodY(x))))"
        _hood = json.loads(subprocess.check_output(['node', '-e', js], cwd=HERE))
    return _hood[max(0, min(1920, int(round(x))))]


def fits(x, y, w, h):
    """The box on the panel, clear of BMW's seat-belt light, not under the hood (as tools/test_mblade_navi.js asks). BMW's black box is no
    longer one (shared/visible.js: the gear letter's hole, on by default, keeps BMW from drawing it); BLACK_BOX stays for the record."""
    if x < 0 or y < 0 or x + w > 1920 or y + h > 720:
        return False
    for r in (BELT,):
        if x < r[2] and x + w > r[0] and y < r[3] and y + h > r[1]:
            return False
    return hood_y(x) <= y + 2 and hood_y(x + w) <= y + 2


def kind(layout, w):
    """('speed' | 'mspeed' | 'rpm', index) when w is a scale label of that layout, else None."""
    i, t = w.get('id', ''), w.get('text', '')
    if w.get('type') != 'text' or w.get('font') not in ZOOM:
        return None
    m = re.fullmatch(r'\{\{(spd|ms):(\d+)\}\}', t)
    if m:
        return ('mspeed' if m.group(1) == 'ms' else 'speed', int(m.group(2)))
    if layout == 'sport' and re.fullmatch(r'rpm\d', i):
        return ('rpm', int(t))
    if layout == 'mblade' and re.fullmatch(r'(o_)?n\d', i):
        return ('rpm', int(t))
    if layout == 'navi' and re.fullmatch(r'(o_)?rev\d', i):
        return ('rpm', int(t))
    if layout == 'evo' and re.fullmatch(r'rev\d', i):
        return ('rpm', int(t))
    if layout == 'circuit' and re.fullmatch(r'm?n\d', i):
        return ('rpm', int(t))
    if layout == 'm' and re.fullmatch(r'n[lr]\d', i):
        return ('rpm', int(t))
    return None


def zoomify(layout, widgets):
    n = 0
    for w in widgets:
        k = kind(layout, w)
        if not k:
            continue
        # every reached step, not only in the zone (owner, 23 Nov 2026: "un effet loupe à chaque étape", the Shak theme first, then "les autres thèmes aussi")
        w['zoomAlways'] = True
        if 'nearFont' in w:
            w.setdefault('nearMid', MID[w['font']])
            continue
        f, z = w['font'], ZOOM[w['font']]
        digits = '0' * (max(len(str(v[k[1]])) for v in SCALES[k[0]]) if k[0] in SCALES else 1)
        ew = max(0, width(z, digits) + 2 - w['w'])
        ew += ew % 2                                              # even, so a centred number stays on its pixel
        eh = max(0, font(z)['cellHeight'] + 2 - w['h'])
        eh += eh % 2
        a = w.get('align')
        hs = [(ew, 0), (ew // 2, ew // 2), (0, ew)] if a == 'right' else [(0, ew), (ew // 2, ew // 2), (ew, 0)] if a == 'left' else [(ew // 2, ew // 2), (ew, 0), (0, ew)]
        vs = [(eh // 2, eh // 2), (0, eh), (eh, 0)]
        pick = next(((l, t, r, b) for (l, r) in hs for (t, b) in vs if fits(w['x'] - l, w['y'] - t, w['w'] + l + r, w['h'] + t + b)), None)
        if pick is None:
            raise SystemExit('%s %s: no room for the zoomed number' % (layout, w['id']))
        l, t, r, b = pick
        w['near'] = [k[0], k[1]]
        w['nearFont'] = z
        w['nearMid'] = MID[f]
        if k[0] == 'rpm':
            w['rpmMax'] = RPM_MAX[layout]
            if layout in ('navi', 'evo'):
                w['zoomColor'] = False          # these sit on the lit stripe itself, which already takes the zone's colour: they only grow
        if l or t or r or b:
            w['x'] -= l; w['y'] -= t; w['w'] += l + r; w['h'] += t + b
            w['grow'] = [l, t, r, b]
        n += 1
    return n


if __name__ == '__main__':
    for name in sys.argv[1:]:
        p = os.path.join(APP, 'layouts', name + '.json')
        with open(p) as f:
            d = json.load(f)
        n = zoomify(name, d['widgets'])
        with open(p, 'w') as f:
            f.write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
        print(name, n, 'labels')
