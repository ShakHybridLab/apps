#!/usr/bin/env python3
"""Fabrique la carte des limitations de vitesse de ShakLimites à partir d'OpenStreetMap.

Entrée (stdin ou fichier) : des lignes GeoJSON, une route par ligne (« osmium export -f geojsonseq » d'un extrait filtré sur les grandes
routes : voir .github/workflows/limites.yml, qui télécharge la France chez Geofabrik et lance tout ça sur GitHub, là où il y a internet).
Sortie : apps/shaklimites/limits/ : un petit fichier par carreau de 0,5 degré (t_<lat>_<lon>.json, les routes en binaire compact dans une
chaîne base64) et index.json (date, nombre de routes, kilomètres). L'appli ne lit que le carreau où est la voiture (shared/limits_map.js).

Ne sont gardées que les routes qui portent une limitation (maxspeed) : une limite devinée serait pire que rien.
    python3 tools/build_limits.py routes.geojsonseq [dossier de sortie]
Python seul, aucune dépendance. Données © les contributeurs d'OpenStreetMap, licence ODbL.
"""
import base64, json, math, os, struct, sys, time

STEP = 0.5          # un carreau : 0,5 degré de côté
MARGIN = 0.05       # les coordonnées d'un carreau couvrent ce débord de chaque côté (une route qui dépasse un peu)
TOL_M = 6.0         # simplification : un point à moins de 6 m de la ligne est retiré
MAX_SEG_M = 600.0   # un tronçon droit plus long est recoupé (il reste ainsi dans le débord du carreau)
CLASSES = {'motorway': 0, 'motorway_link': 0, 'trunk': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2, 'secondary': 3, 'secondary_link': 3, 'tertiary': 4}
WORDS = {'fr:urban': 50, 'fr:rural': 80, 'fr:motorway': 130, 'fr:zone30': 30, 'fr:zone20': 20, 'fr:living_street': 20}


def limit_of(tags):
    """la limitation en km/h, ou None (pas de maxspeed, « none », variable, en mph...)"""
    v = str(tags.get('maxspeed') or '').strip().lower()
    if not v:
        return None
    if v in WORDS:
        return WORDS[v]
    if v.endswith('km/h'):
        v = v[:-4].strip()
    if v.isdigit():
        n = int(v)
        return n if 5 <= n <= 130 and n % 5 == 0 else None
    return None


def metres(lat0):
    return 111320.0 * math.cos(math.radians(lat0)), 110540.0


def simplify(pts, tol):
    """Douglas-Peucker, en mètres (pts : [(lon, lat)])"""
    if len(pts) < 3:
        return pts
    kx, ky = metres(pts[0][1])
    xy = [(p[0] * kx, p[1] * ky) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]; bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        worst, wi = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if d2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > worst:
                worst, wi = d, i
        if worst > tol and wi > 0:
            keep[wi] = True
            stack.append((a, wi)); stack.append((wi, b))
    return [p for p, k in zip(pts, keep) if k]


def densify(pts, max_m):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        kx, ky = metres(a[1])
        d = math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)
        n = int(d // max_m)
        for i in range(1, n + 1):
            f = i / float(n + 1)
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
        out.append(b)
    return out


def length_m(pts):
    t = 0.0
    for a, b in zip(pts, pts[1:]):
        kx, ky = metres(a[1])
        t += math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)
    return t


def tile_of(lon, lat):
    return int(math.floor(lat / STEP)), int(math.floor(lon / STEP))


def enc(v, origin):
    return max(0, min(65535, int(round((v - (origin * STEP - MARGIN)) / (STEP + 2 * MARGIN) * 65535))))


def build(lines, out):
    tiles = {}
    stats = {'lues': 0, 'gardees': 0, 'sans_limite': 0, 'points': 0, 'km': 0.0}
    for line in lines:
        line = line.strip().lstrip('\x1e')
        if not line:
            continue
        try:
            f = json.loads(line)
        except ValueError:
            continue
        g = f.get('geometry') or {}
        tags = f.get('properties') or {}
        if g.get('type') != 'LineString' or tags.get('highway') not in CLASSES:
            continue
        stats['lues'] += 1
        lim = limit_of(tags)
        if lim is None:
            stats['sans_limite'] += 1
            continue
        pts = [(float(c[0]), float(c[1])) for c in g.get('coordinates') or [] if len(c) >= 2]
        if len(pts) < 2:
            continue
        one = str(tags.get('oneway') or '').lower()
        oneway = one in ('yes', 'true', '1', '-1') or (tags.get('highway') in ('motorway', 'motorway_link') and one != 'no') or tags.get('junction') == 'roundabout'
        if one == '-1':
            pts.reverse()
        pts = densify(simplify(pts, TOL_M), MAX_SEG_M)
        stats['gardees'] += 1
        stats['km'] += length_m(pts) / 1000.0
        flags = CLASSES[tags['highway']] | (8 if oneway else 0)
        # des suites de tronçons dans le même carreau (celui du milieu de chaque tronçon)
        run, cur = [], None
        def flush():
            if cur is not None and len(run) >= 2:
                b = tiles.setdefault(cur, [bytearray(), 0])
                b[0] += struct.pack('<BBH', lim, flags, len(run))
                for (lo, la) in run:
                    b[0] += struct.pack('<HH', enc(lo, cur[1]), enc(la, cur[0]))
                b[1] += 1
                stats['points'] += len(run)
        for a, b2 in zip(pts, pts[1:]):
            t = tile_of((a[0] + b2[0]) / 2.0, (a[1] + b2[1]) / 2.0)
            if t != cur:
                flush()
                cur, run = t, [a]
            run.append(b2)
        flush()
    os.makedirs(out, exist_ok=True)
    for name in os.listdir(out):
        if name.startswith('t_') and name.endswith('.json'):
            os.remove(os.path.join(out, name))
    total = 0
    for (ilat, ilon), (buf, n) in sorted(tiles.items()):
        with open(os.path.join(out, 't_%d_%d.json' % (ilat, ilon)), 'w') as fh:
            json.dump({'v': 1, 'lat': ilat, 'lon': ilon, 'n': n, 'b': base64.b64encode(bytes(buf)).decode('ascii')}, fh, separators=(',', ':'))
        total += len(buf)
    index = {'v': 1, 'step': STEP, 'margin': MARGIN, 'date': time.strftime('%Y-%m-%d'), 'tiles': len(tiles), 'ways': stats['gardees'],
             'points': stats['points'], 'km': int(round(stats['km'])), 'bytes': total, 'read': stats['lues'], 'noLimit': stats['sans_limite'],
             'source': 'OpenStreetMap (ODbL), extrait Geofabrik France'}
    with open(os.path.join(out, 'index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)
    return index


if __name__ == '__main__':
    src = open(sys.argv[1], encoding='utf-8') if len(sys.argv) > 1 and sys.argv[1] != '-' else sys.stdin
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'shaklimites', 'limits')
    print(json.dumps(build(src, out)))
