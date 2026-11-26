#!/usr/bin/env python3
"""Bake the HUD's bitmap font atlases from the Barlow TTFs in tools/fonts-src/.

    UV_CACHE_DIR=... uv run --no-project --with pillow python tools/bake_fonts.py [app_id ...]

Runs on the Mac only (needs Pillow). The car never rasterizes fonts: it blits
these pre-drawn glyphs (shared/hud_text.js). Each app has its own set (FONTS below); output per
font, in apps/<app_id>/hud/fonts/<name>.json: the metrics plus the atlas as
one alpha byte per pixel (coverage), base64 in "alpha". JSON because the kit's
build packs the app's data folders into hud.pack, which holds JSON only, and
because then the car needs no PNG decoder. Barlow is SIL OFL 1.1; the licence
ships in each app's NOTICE.

Metrics: every glyph cell is the same height, from the highest ink to the lowest
ink across the font's glyph set, so a widget's y is the top of its tallest
character. `ox` shifts a cell from the pen position (ink overhang), `advance`
moves the pen. Digits get one shared advance (tabular), so a changing number
doesn't shift sideways.
"""
import base64, json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'fonts-src')
APPS = os.path.join(HERE, '..', 'apps')

UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
DIGITS = '0123456789'
LOWER = 'abcdefghijklmnopqrstuvwxyz'
# ShakTheme, 1920x720 LCD: the shared small print in Barlow Condensed, then each theme's own numbers.
CLUSTER_FONTS = [
    # ('big', 124 px) and ('small', 50 px) went on 21 Nov 2026 with 'm_spd': no theme used them any more
    ('gear', 'BarlowCondensed-Bold.ttf', 330, DIGITS + 'PRND-'),
    ('unit', 'BarlowCondensed-SemiBold.ttf', 34, UPPER + DIGITS + '/°%>·.: -'),
    ('head', 'BarlowCondensed-SemiBold.ttf', 24, UPPER + DIGITS + '/°%>·.: -'),
    ('scale', 'BarlowCondensed-SemiBold.ttf', 30, DIGITS),
    ('badge', 'BarlowCondensed-SemiBold.ttf', 30, UPPER + LOWER + DIGITS + ' -'),   # the model badge (shared/badges.js)
    # M: the wide squared numbers (Michroma, SIL OFL) and Barlow for the small print
    ('m_num', 'Orbitron[wght].ttf', 36, DIGITS, 0, 'Black', {'0': 'O'}),
    ('m_num_m', 'Orbitron[wght].ttf', 40, DIGITS, 0, 'Black', {'0': 'O'}),   # 1.1 times: the middle step of the zone zoom
    ('m_num_z', 'Orbitron[wght].ttf', 43, DIGITS, 0, 'Black', {'0': 'O'}),   # the same, 1.2 times larger (zone zoom of the scale number)
    ('m_gear', 'Orbitron[wght].ttf', 125, 'PRNDSM-' + DIGITS, 3, 'Black', {'0': 'O'}),
    ('m_speed', 'Orbitron[wght].ttf', 78, DIGITS + '-', 3, 'Black', {'0': 'O'}),
    ('m_gear_p', 'Orbitron[wght].ttf', 68, 'PRNDSM-' + DIGITS, 3, 'Black', {'0': 'O'}),   # the gear in the M theme's plate under the Waze map
    ('m_speed_p', 'Orbitron[wght].ttf', 68, DIGITS + '-', 3, 'Black', {'0': 'O'}),   # and the speed beside it
    ('m_gl', 'Orbitron[wght].ttf', 25, DIGITS + '/.-', 0, 'Black', {'0': 'O'}),
    ('m_gl_m', 'Orbitron[wght].ttf', 28, DIGITS, 0, 'Black', {'0': 'O'}),   # 1.1 times: the middle step of the zone zoom
    ('m_gl_z', 'Orbitron[wght].ttf', 30, DIGITS, 0, 'Black', {'0': 'O'}),   # the same, 1.2 times larger (zone zoom of the rev number)
    ('m_big', 'Orbitron[wght].ttf', 100, DIGITS + '-', 3, 'Black', {'0': 'O'}),   # M Blade's speed in the void: three digits (110 km/h and up) fit it, 264 px
    ('m_band', 'Orbitron[wght].ttf', 92, DIGITS + '-', 3, 'Black', {'0': 'O'}),   # M Blade's speed inside the hexagon's dark band with km/h beside it: "330" is about 243 px (21 Nov 2026)
    ('m_mid', 'Orbitron[wght].ttf', 34, DIGITS + ':+-.', 0, 'Bold', {'0': 'O'}),
    ('m_tyre', 'Orbitron[wght].ttf', 25, DIGITS + '.-', 0, 'Bold', {'0': 'O'}),
    ('lim_num', 'BarlowSemiCondensed-SemiBold.ttf', 27, DIGITS),      # the speed limit in the danger alert's ring (Sport, M): three digits in 46 px
    ('r_val', 'Orbitron[wght].ttf', 24, DIGITS + ':+-.', 0, 'Bold', {'0': 'O'}),   # the value inside one of Sport's round gauges (71 px across)
    ('r_val_s', 'Orbitron[wght].ttf', 19, DIGITS + ':+-.', 0, 'Bold', {'0': 'O'}),   # the same, small: Sport's round gauges beside the Waze map (51 px across)
    ('m_unit', 'Barlow-Medium.ttf', 30, LOWER + UPPER + '°/-.'),
    ('m_label', 'Orbitron[wght].ttf', 20, UPPER + ' -', 0, 'Bold'),
    # the names of the rows in M Blade's views, written out in full with their accents (the owner, 19 Nov 2026: "naturel, pas de langage court")
    ('m_name', 'Barlow-Medium.ttf', 22, UPPER + LOWER + " -'éèêàçùôî"),
    ('m_name_s', 'Barlow-Medium.ttf', 18, UPPER + LOWER + " -'éèêàçùôî"),      # the same, small: the two-line names under Sport's round gauges
    ('m_tiny', 'Barlow-Medium.ttf', 26, LOWER + DIGITS + 'CFW./ -°%'),
    ('m_badge', 'Barlow-Medium.ttf', 26, UPPER + LOWER + DIGITS + ' -'),
    ('mode', 'Barlow-Medium.ttf', 22, UPPER + LOWER + DIGITS + ' -'),   # the drive mode, small, bottom right of every theme ({{modeName}})
    # Sport: BMW Live Cockpit style, the wide numbers in Michroma like BMW's own
    ('s_scale', 'Michroma-Regular.ttf', 27, DIGITS, 1),
    ('s_scale_m', 'Michroma-Regular.ttf', 30, DIGITS, 1),   # 1.1 times: the middle step of the zone zoom
    ('s_scale_z', 'Michroma-Regular.ttf', 32, DIGITS, 1),   # the scale number at the marker, 1.2 times larger, while its bar is in its zone
    ('s_speed', 'Michroma-Regular.ttf', 74, DIGITS + '-', 3),
    ('s_gear', 'Michroma-Regular.ttf', 70, DIGITS + 'PRNDSM-', 3),
    ('s_val', 'Michroma-Regular.ttf', 26, DIGITS + ':+-.', 1),
    ('s_unit', 'Barlow-Medium.ttf', 24, LOWER + UPPER + DIGITS + '°/-. %'),
    ('s_gl', 'Michroma-Regular.ttf', 21, DIGITS + '/', 1),
    # the numbers of the road signs (the speed limit, the danger alert's limit) in DIN 1451, the lettering of European road signs (DINish, SIL
    # OFL; the owner, 23 Nov 2026: "la police du chiffre du panneau est bizarre, mets la police des panneaux de limitation européens"): l in the
    # 92 px sign, m in the 64 px ones (M Blade, Navi), s in Sport's and M's alert card (a 54 px ring)
    # (23 Nov 2026, "with 3 digits it is too tight, as the original": digits about 0.38 of the sign, three digits in the condensed cut, "3")
    ('sign_l', 'DINish-Bold.ttf', 50, DIGITS),
    ('sign_l3', 'DINishCondensed-Bold.ttf', 50, DIGITS),
    ('sign_m', 'DINish-Bold.ttf', 35, DIGITS),
    ('sign_m3', 'DINishCondensed-Bold.ttf', 35, DIGITS),
    ('sign_s', 'DINish-Bold.ttf', 24, DIGITS),
    ('sign_s3', 'DINishCondensed-Bold.ttf', 24, DIGITS),
] + [
    # Shak (23 Nov 2026): the ShakHUD's lettering, as the owner asked ("la police la même que le HUD"): Orbitron Black for the numbers, Bold for
    # the readouts, its zero drawn as the plain O; the units and the drive mode's name in Barlow (Orbitron has no accented letters)
    ('e_speed', 'Orbitron[wght].ttf', 112, DIGITS + '-', 0, 'Black', {'0': 'O'}),          # the speed in the hexagon
    ('e_big', 'Orbitron[wght].ttf', 66, DIGITS + '-', 0, 'Black', {'0': 'O'}),             # the speed on the left while the map is up
    ('e_gear', 'Orbitron[wght].ttf', 54, DIGITS + 'PRNDSM-', 0, 'Black', {'0': 'O'}),      # the gear
    ('e_num', 'Orbitron[wght].ttf', 24, DIGITS + '-', 0, 'Black', {'0': 'O'}),             # small numbers
    ('e_rnum', 'Orbitron[wght].ttf', 32, DIGITS, 0, 'Black', {'0': 'O'}),                  # the rev band's numbers
    ('e_snum', 'Orbitron[wght].ttf', 24, DIGITS + '-', 0, 'Black', {'0': 'O'}),            # the speed band's numbers
    # the magnifier on the number the band has reached (owner, 23 Nov 2026: "un effet loupe qu'on voit un peu mais pas trop"): 1.07 then 1.15 times
    ('e_rnum_m', 'Orbitron[wght].ttf', 34, DIGITS, 0, 'Black', {'0': 'O'}),
    ('e_rnum_z', 'Orbitron[wght].ttf', 37, DIGITS, 0, 'Black', {'0': 'O'}),
    ('e_snum_m', 'Orbitron[wght].ttf', 26, DIGITS + '-', 0, 'Black', {'0': 'O'}),
    ('e_snum_z', 'Orbitron[wght].ttf', 28, DIGITS + '-', 0, 'Black', {'0': 'O'}),
    ('e_val', 'Orbitron[wght].ttf', 26, DIGITS + ':+-.,/ ', 0, 'Bold', {'0': 'O'}),        # the readouts (clock, temperatures, ranges)
    ('e_unit', 'Barlow-Medium.ttf', 22, LOWER + UPPER + DIGITS + '°/-.,:%· x'),             # units and captions
    ('e_mode', 'BarlowSemiCondensed-SemiBold.ttf', 28, UPPER + LOWER + DIGITS + " -+'éèêàçùôîÉ"),            # the drive mode
    ('sign_xl', 'DINish-Bold.ttf', 84, DIGITS),                 # the big speed limit sign on Evo's left (150 px)
    ('sign_xl3', 'DINishCondensed-Bold.ttf', 84, DIGITS),
    # Circuit (26 Nov 2026, after the owner's photo of a race car's round dial: "copie tout pareil"): squared italic numbers (Orbitron, its zero the plain O,
    # narrowed to the picture's digits), the words in Barlow Condensed as on the picture (TRIP, SPORT); squeeze and slant: see bake()
    ('c_num', 'Orbitron[wght].ttf', 60, DIGITS, 0, 'Bold', {'0': 'O'}, '', 0.18, 0.8),          # the dial's numbers 0..7
    ('c_num_m', 'Orbitron[wght].ttf', 64, DIGITS, 0, 'Bold', {'0': 'O'}, '', 0.18, 0.8),        # the magnifier's middle step, 1.07 times
    ('c_num_z', 'Orbitron[wght].ttf', 69, DIGITS, 0, 'Bold', {'0': 'O'}, '', 0.18, 0.8),        # and its top, 1.15 times
    ('c_speed', 'Orbitron[wght].ttf', 94, DIGITS + '-', 0, 'Black', {'0': 'O'}, '', 0.12, 0.78),   # the speed, left of the dial
    ('c_gear', 'Orbitron[wght].ttf', 130, DIGITS + 'PRNDSM-', 0, 'Black', {'0': 'O'}, '', 0.12, 0.8),   # the gear in the dial's hub
    ('c_unit', 'BarlowSemiCondensed-SemiBold.ttf', 24, LOWER + UPPER + DIGITS + '/ .°%', 0, None, None, '', 0.12),   # mph, tr/min x 1000, the M of the gear
    ('c_mode', 'BarlowCondensed-SemiBold.ttf', 34, UPPER + DIGITS + " -+%'./°", 0, None, None, '°'),   # SPORT, the lines under it (capitals only: a short cell, the lines sit close)
    ('c_lbl', 'BarlowCondensed-SemiBold.ttf', 30, UPPER + LOWER + DIGITS + " .-/'éèêàçùôîÉÈÊÂÎÔ"),     # TRIP and the views' names, in grey
    ('c_val', 'BarlowSemiCondensed-SemiBold.ttf', 40, DIGITS + '.-:+,/ LR'),                        # 0202.0 and the views' readings
    ('c_tiny', 'BarlowSemiCondensed-SemiBold.ttf', 19, LOWER + UPPER + DIGITS + '/ .', 0, None, None, '', 0.12),   # x 1000 RPM under the dial
    ('c_vu', 'BarlowSemiCondensed-SemiBold.ttf', 28, LOWER + UPPER + '/%° '),                               # their units (mi, km, °C)
    ('c_time', 'BarlowSemiCondensed-Medium.ttf', 34, DIGITS + ':+-°. ' + LOWER + UPPER),             # 2:46 pm, +22 °C
    ('c_side', 'BarlowCondensed-SemiBold.ttf', 26, 'FEHC'),                                         # the side gauges' F and E
    ('c_lim', 'BarlowCondensed-Bold.ttf', 46, DIGITS + '-PRNDSM'),                                  # the gearbox in the box under the speed
]
FONTS = {'shaktheme': CLUSTER_FONTS, 'shakhud': [
    # the owner, 22 Nov 2026, with a photo of an M car's HUD: "I want all the writing to look like that": the squared numbers of the M theme
    # (Orbitron, its zero drawn as the plain O) for every number and word; Barlow stays only for the small print (tr/min x 1000)
    ('small', 'Barlow-Medium.ttf', 13, LOWER + UPPER + DIGITS + '/.:-°%>· '),
    ('rnum', 'Orbitron[wght].ttf', 20, DIGITS, 0, 'Black', {'0': 'O'}),   # the rev counter's numbers, under the bar
    ('big', 'Orbitron[wght].ttf', 42, DIGITS + '-%.', 0, 'Black', {'0': 'O'}),      # the battery's percent, the danger distance (".": 1.2 km, 0.4 mi; missing before 0.6.59)
    ('mid', 'Orbitron[wght].ttf', 17, LOWER + UPPER + DIGITS + '/.:-°%>· ', 0, 'Bold', {'0': 'O'}),   # ranges, temperatures, the alert's words
    ('sign_m', 'DINish-Bold.ttf', 33, DIGITS),     # the danger alert's limit on its white sign (60 px), in the road signs' DIN 1451
    ('sign_m3', 'DINishCondensed-Bold.ttf', 33, DIGITS),   # three digits: the condensed cut
]}
PAD = 2
ATLAS_W = 1024


def bake(out, name, file, size, chars, stroke=0, weight=None, subs=None, tuck='', slant=0, squeeze=1.0):
    """stroke: px of extra weight round every glyph (Michroma has one weight). weight: a named instance of a
    variable font (Orbitron: Regular .. Black), for the M theme's squared BMW-style gear, speed and numbers.
    subs: {char: glyph drawn for it} (Orbitron's zero is slashed; the M8's is plain, so its O stands in).
    tuck: characters added to a font after layouts were built on its cell height (° on value / y_val, Nov 7 2026):
    they don't count towards the cell, and one that rises above it is drawn lower so its top meets the cell's.
    slant: an italic drawn from the upright cut, the top of each glyph leaning right by slant x its height (Shak).
    squeeze: the glyphs made narrower (their widths times squeeze, the height kept): Orbitron is wider than the Circuit picture's digits."""
    font = ImageFont.truetype(os.path.join(SRC, file), size)
    if weight: font.set_variation_by_name(weight)
    subs = subs or {}
    glyph = lambda c: subs.get(c, c)
    ink = [c for c in chars if c != ' ']
    boxes = {c: font.getbbox(glyph(c), anchor='ls', stroke_width=stroke) for c in ink}
    top = min(b[1] for c, b in boxes.items() if c not in tuck)
    bottom = max(b[3] for c, b in boxes.items() if c not in tuck)
    drop = {c: max(0, top - boxes[c][1]) for c in tuck if c in boxes}
    height = bottom - top + 2 * PAD
    tab = (max(font.getlength(glyph(d)) for d in DIGITS if d in chars) + 2 * stroke) * squeeze if any(d in chars for d in DIGITS) else 0

    cells = []
    for c in chars:
        adv = font.getlength(glyph(c)) + (2 * stroke if c != ' ' else 0)
        if c == ' ':
            cells.append((c, None, 0, round(adv if adv else size * 0.25)))
            continue
        l, _, r, _ = boxes[c]
        w = r - l + 2 * PAD
        img = Image.new('L', (w, height), 0)
        ImageDraw.Draw(img).text((PAD - l, PAD - top + drop.get(c, 0)), glyph(c), font=font, fill=255, anchor='ls', stroke_width=stroke, stroke_fill=255)
        if squeeze != 1.0:
            img = img.resize((max(1, int(round(img.width * squeeze))), height), Image.LANCZOS)
            w = img.width; l = l * squeeze; adv = adv * squeeze
        if slant:
            k = slant * height
            img = img.transform((w + int(round(k)), height), Image.AFFINE, (1, slant, -k, 0, 1, 0), resample=Image.BICUBIC)
        shift = (tab - adv) / 2 if c in DIGITS else 0
        cells.append((c, img, round(l - PAD + shift), round(tab if c in DIGITS else adv)))

    # simple row packing
    x = y = 0
    placed = {}
    for c, img, ox, adv in cells:
        if img is None:
            continue
        if x + img.width > ATLAS_W:
            x, y = 0, y + height
        placed[c] = (x, y)
        x += img.width
    atlas_h = y + height
    atlas = Image.new('L', (ATLAS_W, atlas_h), 0)
    glyphs = {}
    for c, img, ox, adv in cells:
        if img is None:
            glyphs[c] = {'x': 0, 'y': 0, 'w': 0, 'h': 0, 'ox': 0, 'advance': adv}
            continue
        gx, gy = placed[c]
        atlas.paste(img, (gx, gy))
        glyphs[c] = {'x': gx, 'y': gy, 'w': img.width, 'h': img.height, 'ox': ox, 'advance': adv}
    meta = {'source': file, 'size': size, 'cellHeight': height, 'baseline': PAD - top, 'glyphs': glyphs,
            'width': ATLAS_W, 'height': atlas_h, 'alpha': base64.b64encode(atlas.tobytes()).decode('ascii')}
    with open(os.path.join(out, name + '.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)
    print('%-6s %3dpx  cell height %3d  atlas %dx%d  %d glyphs' % (name, size, height, ATLAS_W, atlas_h, len(glyphs)))


if __name__ == '__main__':
    import sys
    for app in sys.argv[1:] or sorted(FONTS):
        out = os.path.join(APPS, app, 'hud', 'fonts')
        os.makedirs(out, exist_ok=True)
        print(app)
        for spec in FONTS[app]:
            bake(out, *spec)
