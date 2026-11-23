#!/usr/bin/env python3
"""Bake the owner's SHAK logo (tools/logo-src/shak.png, his own picture) into apps/shaktheme/hud/emblems/shak.json = { w, h, rgba } for the
Shak theme (an "emblem" widget with "name": "shak"; shared/emblems.js draws it as it is). The black around it becomes see-through:
the alpha comes from the brightness, the colour is un-premultiplied so the silver and the magenta keep their shade on the cluster's black.
Usage: python3 tools/bake_logo.py [size]   (size: the box's height in px, 84 by default)"""
import base64, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'logo-src', 'shak.png')
OUT = os.path.join(HERE, '..', 'apps', 'shaktheme', 'hud', 'emblems', 'shak.json')


def main():
    size = int(sys.argv[1]) if len(sys.argv) > 1 else 84
    im = Image.open(SRC).convert('RGB')
    # the shield alone: what is brighter than the near-black backdrop
    g = im.convert('L').point(lambda v: 255 if v > 24 else 0)
    im = im.crop(g.getbbox())
    h = size
    w = max(1, round(im.width * h / im.height))
    im = im.resize((w, h), Image.LANCZOS)
    px = bytearray()
    for r, gg, b in im.getdata():
        m = max(r, gg, b)
        a = min(255, int(m * 1.25)) if m > 10 else 0
        if a:
            k = 255.0 / a
            px += bytes((min(255, int(r * k)), min(255, int(gg * k)), min(255, int(b * k)), a))
        else:
            px += b'\0\0\0\0'
    with open(OUT, 'w') as f:
        json.dump({'w': w, 'h': h, 'rgba': base64.b64encode(bytes(px)).decode()}, f)
    print('wrote', os.path.normpath(OUT), w, 'x', h)


if __name__ == '__main__':
    main()
