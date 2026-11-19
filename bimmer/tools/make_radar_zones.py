#!/usr/bin/env python3
"""Fabrique la liste des « zones de danger » de l'alerte de ShakTheme à partir de la liste officielle des radars fixes.

Source : Ministère de l'Intérieur, « Liste des radars fixes en France », data.gouv.fr, Licence Ouverte / Open Licence 2.0
(https://www.data.gouv.fr/datasets/liste-des-radars-fixes-en-france/). Le CSV est en ISO-8859-1, séparé par des « ; », colonnes
« Numéro de radar;Type de radar;Date de mise en service;VMA ;Latitude; Longitude ».

Ce qui est gardé est une zone, pas un radar : en France une aide à la conduite annonce une zone de danger, pas l'emplacement exact ni le
type d'un radar (décret n° 2012-3, article R413-15 ; ceci n'est pas un avis juridique). Donc :
  - le centre de la zone est arrondi à 0,002 degré (220 m sur 150 m environ) : le radar est dans sa zone, pas à son centre ; les radars
    d'une même case forment une seule zone ; le type, le numéro et la date sont retirés ; la position exacte n'est écrite nulle part ;
  - chaque zone garde la vitesse maximale autorisée (0 si inconnue) et sa taille : large (110 km/h ou plus : autoroute, 4 km autour),
    en ville (50 km/h ou moins : 300 m autour, comme les avertisseurs du commerce), sinon 2 km ;
  - avec les routes d'OpenStreetMap (les fichiers de .github/workflows/limites.yml), la direction de la route la plus proche du radar
    (à 60 m au plus), arrondie à 10 degrés, et si elle est à sens unique : la voiture qui roule sur l'autre chaussée, ou sur une route
    qui croise, n'est pas alertée (shared/radar_zones.js). « Sens unique » seulement pour un radar qui a un autre radar à moins de 500 m (son
    jumeau pour l'autre sens) : seul, il peut couvrir les deux sens et la liste ne le dit pas. Sans routes : pas de direction, la zone vaut
    pour tout le monde.

  - avec --osm : les radars fixes notés dans OpenStreetMap (highway=speed_camera) qui ne sont pas déjà dans la liste officielle (aucun
    radar officiel à moins de 150 m) s'ajoutent : la liste du ministère a parfois plusieurs mois de retard.
  - avec --enf : les relations « enforcement » d'OpenStreetMap (osmium cat -f opl), où les contributeurs notent pour un radar d'où vient la
    circulation contrôlée (membres « from » et « device »). Un radar qui en a une n'est plus deviné : un seul sens noté, la zone ne vaut
    que pour ce sens (même sur une route à double sens) ; deux sens opposés, elle vaut pour les deux. Sans relation, la règle du jumeau.

    python3 tools/make_radar_zones.py <radars.csv | url> [routes.geojsonseq ...] [--osm radars_osm.geojsonseq] [--enf enforcement.opl] [--out a.json] ...
Sortie par défaut : data/radars_fr_zones.json. Données des routes © les contributeurs d'OpenStreetMap, ODbL.
"""
import csv, io, json, math, os, sys, time, urllib.request

CELL = 0.002            # degrés : l'arrondi du centre d'une zone
RADIUS = 400           # mètres autour du centre
RADIUS_WIDE = 500      # limite de 110 ou plus : autoroute
RADIUS_TOWN = 300       # limite de 50 ou moins : en ville
WIDE_FROM, TOWN_TO = 110, 50
SAME_M = 150.0          # un radar d'OpenStreetMap à moins de ça d'un radar officiel : c'est le même
SNAP_M = 60.0           # la route du radar : la plus proche, à cette distance au plus
TWIN_M = 500.0          # un radar à sens unique sans autre radar à cette distance : il couvre les deux sens, les deux chaussées sont alertées
GRID = 0.002            # cases de la recherche des routes
DATASET = 'https://www.data.gouv.fr/api/1/datasets/liste-des-radars-fixes-en-france/'


def fetch(src):
    """le CSV : un fichier, une adresse, ou « auto » (le CSV le plus récent du jeu de données)"""
    if os.path.isfile(src):
        return open(src, 'rb').read(), os.path.basename(src)
    if src == 'auto':
        meta = json.loads(urllib.request.urlopen(DATASET, timeout=60).read().decode('utf-8'))
        res = [r for r in meta.get('resources', []) if str(r.get('format', '')).lower() == 'csv' and r.get('url')]
        res.sort(key=lambda r: str(r.get('last_modified') or r.get('created_at') or ''), reverse=True)
        if not res:
            raise SystemExit('aucun CSV dans le jeu de données')
        return urllib.request.urlopen(res[0]['url'], timeout=120).read(), str(res[0].get('last_modified') or '')[:10]
    return urllib.request.urlopen(src, timeout=120).read(), ''


def radars(raw):
    text = raw.decode('latin-1')
    rows = list(csv.reader(io.StringIO(text), delimiter=';'))
    head = [h.strip().lower() for h in rows[0]]
    col = {k: next(i for i, h in enumerate(head) if h.startswith(k)) for k in ('vma', 'latitude', 'longitude')}
    tcol = next((i for i, h in enumerate(head) if h.startswith('type')), None)
    out = []
    for r in rows[1:]:
        if len(r) <= max(col.values()):
            continue
        try:
            lat = float(r[col['latitude']].replace('+', '').replace(',', '.').strip())
            lon = float(r[col['longitude']].replace('+', '').replace(',', '.').strip())
        except ValueError:
            continue
        vma = r[col['vma']].strip()
        # un radar de feu rouge ou de passage à niveau (ETFR, ETPN) n'a pas de vitesse dans la liste et se trouve à un carrefour, presque toujours
        # en ville : zone courte (une zone de 2 km en pleine ville couvrait tout un quartier). Le type lui-même n'est pas gardé.
        kind = r[tcol].strip().upper() if tcol is not None and tcol < len(r) else ''
        out.append((lat, lon, int(vma) if vma.isdigit() else 0, kind in ('ETFR', 'ETPN')))
    return out


def osm_cameras(files, cams):
    """les radars d'OpenStreetMap (points highway=speed_camera) qui ne sont pas dans la liste officielle : [(lat, lon, limite, court)]"""
    grid = {}
    for c in cams:
        grid.setdefault((int(c[0] / 0.005), int(c[1] / 0.005)), []).append(c)
    out = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip().lstrip('\x1e')
                if not line:
                    continue
                try:
                    ft = json.loads(line)
                except ValueError:
                    continue
                g = ft.get('geometry') or {}
                tags = ft.get('properties') or {}
                if g.get('type') != 'Point' or tags.get('highway') != 'speed_camera':
                    continue
                lon, lat = float(g['coordinates'][0]), float(g['coordinates'][1])
                ky, kx = 110540.0, 111320.0 * math.cos(math.radians(lat))
                gy, gx = int(lat / 0.005), int(lon / 0.005)
                known = any(math.hypot((c[0] - lat) * ky, (c[1] - lon) * kx) <= SAME_M
                            for a in (-1, 0, 1) for b in (-1, 0, 1) for c in grid.get((gy + a, gx + b), ()))
                if known:
                    continue
                v = str(tags.get('maxspeed') or '').strip()
                limit = int(v) if v.isdigit() and 20 <= int(v) <= 130 else 0
                c = (lat, lon, limit, False)
                out.append(c)
                grid.setdefault((gy, gx), []).append(c)       # (deux points d'OpenStreetMap pour le même radar ne comptent qu'une fois)
    return out


def enforcement(files):
    """les relations « enforcement » d'OpenStreetMap : [(lat, lon du radar, [directions de la circulation contrôlée, en degrés])]"""
    nodes, rels = {}, []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('n'):
                    parts = line.split(' ')
                    x = next((q[1:] for q in parts if q.startswith('x')), '')
                    y = next((q[1:] for q in parts if q.startswith('y')), '').strip()
                    try:
                        nodes[parts[0][1:]] = (float(y), float(x))
                    except ValueError:
                        pass
                elif line.startswith('r'):
                    parts = line.rstrip('\n').split(' ')
                    tags = next((q[1:] for q in parts if q.startswith('T')), '')
                    mem = next((q[1:] for q in parts if q.startswith('M')), '')
                    if 'type=enforcement' not in tags or ('enforcement=' in tags and 'enforcement=maxspeed' not in tags and 'enforcement=average_speed' not in tags):
                        continue
                    dev, frm = [], []
                    for m in mem.split(','):
                        ref, _, role = m.partition('@')
                        if ref.startswith('n') and role == 'device':
                            dev.append(ref[1:])
                        elif ref.startswith('n') and role == 'from':
                            frm.append(ref[1:])
                    rels.append((dev, frm))
    out = []
    for dev, frm in rels:
        for d in dev:
            if d not in nodes:
                continue
            la, lo = nodes[d]
            kx, ky = 111320.0 * math.cos(math.radians(la)), 110540.0
            dirs = []
            for f2 in frm:
                if f2 in nodes:
                    dx, dy = (lo - nodes[f2][1]) * kx, (la - nodes[f2][0]) * ky
                    if dx * dx + dy * dy > 4.0:
                        dirs.append((math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0)
            if dirs:
                out.append((la, lo, dirs))
    return out


def sides(cams, brg, enf):
    """applique ce que les relations disent : renvoie (directions corrigées, nombre « un sens », nombre « deux sens »)"""
    grid = {}
    for e in enf:
        grid.setdefault((int(e[0] / 0.005), int(e[1] / 0.005)), []).append(e)
    one = both = 0
    out = list(brg)
    for i, c in enumerate(cams):
        lat, lon = c[0], c[1]
        ky, kx = 110540.0, 111320.0 * math.cos(math.radians(lat))
        gy, gx = int(lat / 0.005), int(lon / 0.005)
        dirs = []
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                for e in grid.get((gy + a, gx + b), ()):
                    if math.hypot((e[0] - lat) * ky, (e[1] - lon) * kx) <= SAME_M:
                        dirs += e[2]
        if not dirs:
            continue
        def off(x, y):
            a2 = abs(x - y) % 360.0
            return 360.0 - a2 if a2 > 180.0 else a2
        if all(off(d, dirs[0]) <= 60.0 for d in dirs):
            out[i] = (0.0, dirs[0], True)                 # un seul sens contrôlé : la zone ne vaut que pour lui
            one += 1
        else:
            road = brg[i][1] if brg[i] is not None else dirs[0]
            out[i] = (0.0, road, False)                   # les deux sens
            both += 1
    return out, one, both


def bearings(cams, files):
    """pour chaque radar : (direction de sa route en degrés depuis le nord, sens unique) ou None"""
    want = {}
    for i, (lat, lon, _, _) in enumerate(cams):
        gy, gx = int(math.floor(lat / GRID)), int(math.floor(lon / GRID))
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                want.setdefault((gy + a, gx + b), []).append(i)
    best = [None] * len(cams)          # (distance, direction, sens unique)
    for f in files:
        with open(f, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip().lstrip('\x1e')
                if not line:
                    continue
                try:
                    ft = json.loads(line)
                except ValueError:
                    continue
                g = ft.get('geometry') or {}
                if g.get('type') != 'LineString':
                    continue
                tags = ft.get('properties') or {}
                one = str(tags.get('oneway') or '').lower()
                oneway = one in ('yes', 'true', '1', '-1') or (tags.get('highway') in ('motorway', 'motorway_link') and one != 'no')
                pts = g.get('coordinates') or []
                if one == '-1':
                    pts = pts[::-1]
                for p, q in zip(pts, pts[1:]):
                    # toutes les cases que le tronçon traverse (un pas d'une demi-case : une ligne droite d'autoroute peut faire plus d'un kilomètre)
                    seen = set()
                    steps = int(max(abs(q[1] - p[1]), abs(q[0] - p[0])) / (GRID / 2.0)) + 1
                    for k in range(steps + 1):
                        f2 = k / float(steps)
                        key = (int(math.floor((p[1] + (q[1] - p[1]) * f2) / GRID)), int(math.floor((p[0] + (q[0] - p[0]) * f2) / GRID)))
                        for i in want.get(key, ()):
                            seen.add(i)
                    for i in seen:
                        lat, lon = cams[i][0], cams[i][1]
                        kx, ky = 111320.0 * math.cos(math.radians(lat)), 110540.0
                        ax, ay = (p[0] - lon) * kx, (p[1] - lat) * ky
                        bx, by = (q[0] - lon) * kx, (q[1] - lat) * ky
                        dx, dy = bx - ax, by - ay
                        d2 = dx * dx + dy * dy
                        t = 0.0 if d2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / d2))
                        d = math.hypot(ax + t * dx, ay + t * dy)
                        if d <= SNAP_M and d2 > 0 and (best[i] is None or d < best[i][0]):
                            best[i] = (d, (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0, oneway)
    # un radar peut couvrir les deux sens et la liste officielle ne le dit pas. Règle du propriétaire (19 nov. 2026) : un radar qui ne flashe
    # qu'un côté a souvent son jumeau tout près pour l'autre sens ; un radar seul dans TWIN_M (500 m) flashe les deux côtés. Donc « sens
    # unique » seulement pour un radar qui a un autre radar à moins de TWIN_M ; seul, la zone vaut pour les deux chaussées.
    for i, b in enumerate(best):
        if b is None or not b[2]:
            continue
        lat, lon = cams[i][0], cams[i][1]
        kx, ky = 111320.0 * math.cos(math.radians(lat)), 110540.0
        twin = any(j != i and abs(c[0] - lat) * ky <= TWIN_M and math.hypot((c[0] - lat) * ky, (c[1] - lon) * kx) <= TWIN_M and (c[0], c[1]) != (lat, lon)
                   for j, c in enumerate(cams))
        if not twin:
            best[i] = (b[0], b[1], False)
    return best


def main(argv):
    outs, args, osm, enf_files, i = [], [], [], [], 0
    while i < len(argv):
        if argv[i] == '--out':
            outs.append(argv[i + 1]); i += 2
        elif argv[i] == '--osm':
            osm.append(argv[i + 1]); i += 2
        elif argv[i] == '--enf':
            enf_files.append(argv[i + 1]); i += 2
        else:
            args.append(argv[i]); i += 1
    if not args:
        sys.exit(__doc__)
    if not outs:
        outs = [os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'radars_fr_zones.json')]
    raw, version = fetch(args[0])
    cams = radars(raw)
    if len(cams) < 1000:
        raise SystemExit('seulement %d radars lus : fichier inattendu, rien n\'est écrit' % len(cams))
    official = len(cams)
    extra = osm_cameras([f for f in osm if os.path.isfile(f)], cams)
    cams = cams + extra
    roads = [a for a in args[1:] if os.path.isfile(a)]
    brg = bearings(cams, roads) if roads else [None] * len(cams)
    enf = enforcement([f for f in enf_files if os.path.isfile(f)])
    brg, said_one, said_both = sides(cams, brg, enf)
    print('%d relations de contrôle dans OpenStreetMap : %d radars notés un seul sens, %d notés deux sens' % (len(enf), said_one, said_both))
    cells = {}
    for (lat, lon, limit, short), b in zip(cams, brg):
        key = (int(round(lat / CELL)), int(round(lon / CELL)))
        c = cells.setdefault(key, {'limit': 0, 'dirs': [], 'short': True})
        c['limit'] = max(c['limit'], limit)
        c['short'] = c['short'] and (short or 0 < limit <= TOWN_TO)
        c['dirs'].append(b)
    zones = []
    for (la, lo), c in sorted(cells.items()):
        limit = c['limit']
        flags = 0
        d = -1
        # une direction seulement quand tous les radars de la case en ont une et qu'elles s'accordent (à 30 degrés, sens compris pour un sens unique)
        ds = c['dirs']
        if ds and all(x is not None for x in ds):
            ref = ds[0]
            def same(x):
                if x[2] != ref[2]:
                    return False
                a = abs(x[1] - ref[1]) % 360.0
                a = 360.0 - a if a > 180.0 else a
                if not ref[2]:
                    a = min(a, 180.0 - a)
                return a <= 30.0
            if all(same(x) for x in ds):
                d = int(round(ref[1] / 10.0)) * 10 % 360
                flags |= 1 if ref[2] else 0
        if c['short']:
            flags |= 2
        zones.append([la, lo, limit, 1 if limit >= WIDE_FROM else 0, d, flags])
    doc = {
        'source': "Ministère de l'Intérieur, Liste des radars fixes en France, data.gouv.fr ; direction des routes et radars en plus : contributeurs d'OpenStreetMap (ODbL)",
        'official': official, 'osm': len(extra),
        'licence': 'Licence Ouverte / Open Licence 2.0',
        'version': version or time.strftime('%Y-%m-%d'),
        'made': time.strftime('%Y-%m-%d'),
        'about': "Danger zones, not cameras: centres rounded to 0.002 degree, several cameras in one cell are one zone, no type. zones: [lat / cell, "
                 "lon / cell, speed limit km/h (0: unknown), 1 for a wide zone, the road's direction in degrees from north (-1: unknown), "
                 "flags (1: one-way road, 2: in town)].",
        'cell': CELL, 'radius': RADIUS, 'radiusWide': RADIUS_WIDE, 'radiusTown': RADIUS_TOWN,
        'zones': zones,
    }
    text = json.dumps(doc, separators=(',', ':'), ensure_ascii=False) + '\n'
    for out in outs:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(text)
    print('%d radars de la liste officielle, %d de plus dans OpenStreetMap' % (official, len(extra)))
    print('%d radars -> %d zones (%d larges, %d en ville, %d avec une direction dont %d à sens unique), %d octets, version %s' % (
        len(cams), len(zones), sum(z[3] for z in zones), sum(1 for z in zones if z[5] & 2), sum(1 for z in zones if z[4] >= 0),
        sum(1 for z in zones if z[5] & 1), len(text), doc['version']))


if __name__ == '__main__':
    main(sys.argv[1:])
