#!/usr/bin/env python3
"""Adds the French accented letters to the kit's page fonts (kit/runtime/fonts/label.json and bold.json), which only hold plain ASCII.
Each accented glyph is the plain letter's own bitmap with an accent drawn over it (a stroke as thick as the font's stems), so the
look stays the font's. Run once; running it again changes nothing.  python3 tools/bake_accents.py"""
import base64, json, os, zlib
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, '..', 'kit', 'runtime', 'fonts')
# letter: (base letter, accent)
ACCENTED = {
    'é': ('e', 'acute'), 'è': ('e', 'grave'), 'ê': ('e', 'circ'), 'ë': ('e', 'diaer'), 'à': ('a', 'grave'), 'â': ('a', 'circ'),
    'ä': ('a', 'diaer'), 'î': ('i', 'circ'), 'ï': ('i', 'diaer'), 'ô': ('o', 'circ'), 'ö': ('o', 'diaer'), 'ù': ('u', 'grave'),
    'û': ('u', 'circ'), 'ü': ('u', 'diaer'), 'ç': ('c', 'cedil'),
    'É': ('E', 'acute'), 'È': ('E', 'grave'), 'Ê': ('E', 'circ'), 'À': ('A', 'grave'), 'Â': ('A', 'circ'), 'Ç': ('C', 'cedil'),
    'Î': ('I', 'circ'), 'Ô': ('O', 'circ'), 'Ù': ('U', 'grave'), 'Û': ('U', 'circ'),
}
SS = 8       # supersampling for the accent strokes

def stroke(draw, pts, wpx):
    draw.line([(x * SS, y * SS) for x, y in pts], fill=255, width=max(1, int(round(wpx * SS))), joint='curve')

def accent_bitmap(kind, w, size, stem):
    """The accent alone: (bitmap rows x w, rows) with the accent's lowest pixel on its last row."""
    ah = max(3, int(round(size * 0.27)))
    im = Image.new('L', (w * SS, ah * SS), 0)
    d = ImageDraw.Draw(im)
    cx = w / 2.0
    t = max(1.0, stem)
    if kind == 'acute':
        stroke(d, [(cx - ah * 0.15, ah - 0.4 * t), (cx + ah * 0.45, t * 0.5)], t)
    elif kind == 'grave':
        stroke(d, [(cx + ah * 0.15, ah - 0.4 * t), (cx - ah * 0.45, t * 0.5)], t)
    elif kind == 'circ':
        stroke(d, [(cx - ah * 0.5, ah - 0.5 * t), (cx, t * 0.6), (cx + ah * 0.5, ah - 0.5 * t)], t)
    elif kind == 'diaer':
        r = max(0.9, t * 0.62)
        for px in (cx - ah * 0.42, cx + ah * 0.42):
            d.ellipse([(px - r) * SS, (ah - 2 * r - 0.2) * SS, (px + r) * SS, (ah - 0.2) * SS], fill=255)
    im = im.resize((w, ah), Image.LANCZOS)
    return np.array(im), ah

def cedilla_bitmap(w, size, stem):
    dh = max(3, int(round(size * 0.22)))
    im = Image.new('L', (w * SS, dh * SS), 0)
    d = ImageDraw.Draw(im)
    cx = w / 2.0
    stroke(d, [(cx, 0), (cx + dh * 0.1, dh * 0.45), (cx - dh * 0.25, dh * 0.95)], max(1.0, stem * 0.8))
    return np.array(im.resize((w, dh), Image.LANCZOS)), dh

def extend(fam):
    path = os.path.join(DIR, fam + '.json')
    d = json.load(open(path))
    bold = fam == 'bold'
    for s in d['sizes']:
        if str(ord('é')) in s['glyphs']:
            continue                                                       # already done
        W, H = s['atlasW'], s['atlasH']
        atlas = np.frombuffer(zlib.decompress(base64.b64decode(s['alpha'])), dtype=np.uint8).reshape(H, W)
        size = s['size']
        stem = size * (0.13 if bold else 0.09)
        new, cells = [], {}
        for ch, (base, acc) in ACCENTED.items():
            g = s['glyphs'][str(ord(base))]
            x, y, w, h, ox, oy, adv = g
            bm = atlas[y:y + h, x:x + w]
            if acc == 'cedil':
                cb, dh = cedilla_bitmap(w, size, stem)
                out = np.zeros((h + dh - 1, w), dtype=np.uint8)
                out[:h] = bm
                out[h - 1:h - 1 + dh] = np.maximum(out[h - 1:h - 1 + dh], cb)
                rec = [0, 0, w, out.shape[0], ox, oy, adv]
            else:
                ab, ah = accent_bitmap(acc, w, size, stem)
                gap = 1 if size >= 18 else 0
                out = np.zeros((h + ah + gap, w), dtype=np.uint8)
                out[:ah] = ab
                out[ah + gap:] = bm
                rec = [0, 0, w, out.shape[0], ox, oy - ah - gap, adv]
            new.append((ch, out, rec))
        # the atlas keeps its width (1024) and grows downward: the new cells go in bands under the old ones
        tall = max(o.shape[0] for _, o, _ in new)
        bands, row, x = [], [], 0
        for item in new:
            ww = item[1].shape[1] + 2
            if x + ww > W:
                bands.append(row); row, x = [], 0
            row.append(item); x += ww
        bands.append(row)
        newW, newH = W, H + len(bands) * (tall + 2)
        big = np.zeros((newH, newW), dtype=np.uint8)
        big[:H, :W] = atlas
        y0 = H
        for row in bands:
            x = 0
            for ch, o, rec in row:
                big[y0:y0 + o.shape[0], x:x + o.shape[1]] = o
                rec[0], rec[1] = x, y0
                s['glyphs'][str(ord(ch))] = rec
                x += o.shape[1] + 2
            y0 += tall + 2
        s['atlasW'], s['atlasH'] = newW, newH
        s['alpha'] = base64.b64encode(zlib.compress(big.tobytes(), 9)).decode()
    json.dump(d, open(path, 'w'), separators=(',', ':'))
    print(fam, 'ok', [(s['size'], s['atlasW'], s['atlasH']) for s in d['sizes']])

if __name__ == '__main__':
    for fam in ('label', 'bold'):
        extend(fam)
