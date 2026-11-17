#!/usr/bin/env python3
"""Regroupe les textes et icônes d'un thème en feuilles d'images serrées (pixels de cluster-render).

Contexte : cluster-render a 16 Mio de mémoire de pixels pour toutes les applis ensemble, chaque image compte deux fois
(w * h * 8 octets) ; sur la voiture il en reste environ 10 Mio pour un thème (photos du 15 nov. 2026 : une feuille refusée,
tout ce qu'elle porte manque à l'écran). Le moteur (shared/hud.js, _plan) rangeait les textes dans l'ordre du fichier
et ne regardait que la taille : une diagonale de chiffres tenait dans une feuille presque vide (2,5 Mio pour 0,25 Mio de texte).

Ici : une classification ascendante. On part d'une feuille par texte ; on fusionne à chaque fois la paire dont la boîte englobante
grandit le moins, jusqu'à K feuilles. Chaque widget reçoit "sheet": "sN" (le moteur ne range ensemble que des widgets de même clé)
et "conn" (les couches par connexion : 8 au plus, effets compris). Le coût compte les deux états de la carte Waze (mapUp) ;
les autres bascules (alertes, puissance...) sont comptées allumées (pire cas).

    python3 tools/pack_sheets.py sport 8      # réécrit apps/shaktheme/hud/layouts/sport.json
    python3 tools/pack_sheets.py m 8
(mblade et navi : tools/gen_mblade_navi.py appelle pack() après sa génération.)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUTS = os.path.join(HERE, '..', 'apps', 'shaktheme', 'hud', 'layouts')
IMG = ('text', 'icon', 'emblem', 'badge')
CAP = 8            # couches par connexion (CompositorLimits.per_client)
NCONN = 4          # MAX_CONN


def shown(w, mapup, view=None, sport=False):
    """le widget est-il à l'écran dans cet état : carte Waze ouverte ou non, la vue en cours (réglage viewSel : None = aucune) et le mode
    de conduite (sport : la voiture est en Sport, bascule « driveSport »)"""
    t = w.get('toggle')
    if not t:
        return True
    for part in t.split('&'):            # "a&!b": every one of them
        neg = part.startswith('!')
        k = part[1:] if neg else part
        if k.startswith('viewSel='):
            on = view == k[len('viewSel='):]
        elif k == 'driveSport':
            on = sport
        else:
            on = mapup if k == 'mapUp' else True
        if on == neg:                       # "a" veut a allumé, "!a" veut a éteint
            return False
    return True


def box(ms):
    x0 = min(m['x'] for m in ms); y0 = min(m['y'] for m in ms)
    x1 = max(m['x'] + m['w'] for m in ms); y1 = max(m['y'] + m['h'] for m in ms)
    return x0, y0, x1 - x0, y1 - y0


def areas(ms):
    """la boîte de la feuille dans chaque état (sans carte, avec carte), en pixels"""
    out = []
    for st in (False, True):
        s = [m for m in ms if shown(m, st)]
        out.append(box(s)[2] * box(s)[3] if s else 0)
    return out


def cost(ms):
    return sum(areas(ms))


def mib(px):
    return px * 8 / 1048576.0


def hit(a, b):
    return a['x'] < b['x'] + b['w'] and b['x'] < a['x'] + a['w'] and a['y'] < b['y'] + b['h'] and b['y'] < a['y'] + a['h']


def together(a, b):
    """a et b peuvent être à l'écran en même temps (même état de la carte)"""
    return any(shown(a, st) and shown(b, st) for st in (False, True))


def valid(groups, order, layers):
    """Aucune feuille ne contient deux textes dont les boîtes se recouvrent (la feuille écrase), et l'ordre de création des
    feuilles (celui de leur premier membre) respecte l'ordre du fichier pour tout ce qui se recouvre, effets compris."""
    first = [min(order[id(w)] for w in g) for g in groups]
    for g in groups:
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                if together(g[i], g[j]) and hit(g[i], g[j]):
                    return False
    for gi in range(len(groups)):
        for gj in range(gi + 1, len(groups)):
            before = after = False
            for a in groups[gi]:
                for b in groups[gj]:
                    if together(a, b) and hit(a, b):
                        if order[id(a)] < order[id(b)]:
                            before = True
                        else:
                            after = True
            if (before and after) or (before and first[gi] > first[gj]) or (after and first[gj] > first[gi]):
                return False
    for gi, g in enumerate(groups):
        for lay, li in layers:
            over = [order[id(m)] for m in g if hit(m, lay)]
            if not over:
                continue
            if min(over) > li and first[gi] < li:
                return False
            if max(over) < li and first[gi] > li:
                return False
            if min(over) < li < max(over):
                return False
    return True


def pins(g, pin):
    """les connexions imposées (hors 0) des membres d'un groupe"""
    return {pin[id(w)] for w in g if pin.get(id(w))}


def totals(g):
    """les pixels de toutes les feuilles dans chaque état de la carte"""
    t = [0, 0]
    for x in g:
        a = areas(x)
        t[0] += a[0]; t[1] += a[1]
    return t


def score(g):
    """le pire des deux états d'abord (c'est lui qui remplit la mémoire), la somme ensuite"""
    t = totals(g)
    return (max(t), sum(t))


def improve(g, order, layers, pin, passes=8):
    """Après la fusion gloutonne : déplace un widget à la fois vers la feuille où le pire état coûte le moins de pixels (jamais plus de
    feuilles, toujours un rangement valide) tant que cela fait baisser le total."""
    for _ in range(passes):
        moved = False
        base = score(g)
        for i in range(len(g)):
            for w in list(g[i]):
                best = None
                for j in range(len(g)):
                    if j == i or len(pins(g[j] + [w], pin)) > 1:
                        continue
                    new = [list(x) for x in g]
                    new[i].remove(w); new[j].append(w)
                    new = [x for x in new if x]
                    sc = score(new)
                    if sc < (base[0] - 1, base[1] + 10 ** 9) and (best is None or sc < best[0]):
                        if valid(new, order, layers):
                            best = (sc, new)
                if best is not None:
                    g = best[1]; base = best[0]; moved = True
                    break
        if not moved:
            break
    return g


def groups_of(widgets, k, order, layers, pin=None):
    pin = pin or {}
    g = [[w] for w in widgets]
    c = [cost(x) for x in g]
    while len(g) > k:
        cands = []
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                cands.append((cost(g[i] + g[j]) - c[i] - c[j], i, j))
        cands.sort()
        for inc, i, j in cands:
            merged = g[:i] + [g[i] + g[j]] + g[i + 1:j] + g[j + 1:]
            if len(pins(g[i] + g[j], pin)) > 1:
                continue
            if valid(merged, order, layers):
                g = merged; c = [cost(x) for x in g]
                break
        else:
            return improve(g, order, layers, pin)          # plus aucune fusion possible : plus de feuilles que demandé
    return improve(g, order, layers, pin)


def plan(widgets, mapup, view=None, sport=False):
    """le rangement du moteur (hud.js _plan) avec les clés "sheet" : [{ key, conn, members }]"""
    p = []
    for w in widgets:
        if not shown(w, mapup, view, sport):
            continue
        if w['type'] not in IMG or w.get('own'):
            p.append({'layer': True, 'w': w, 'conn': int(w.get('conn', 0) or 0)})
            continue
        conn = int(w.get('conn', 0) or 0); key = w.get('sheet')
        after = -1
        for i, e in enumerate(p):
            if e['conn'] != conn:
                continue
            if (hit(e['w'], w) if e.get('layer') else any(hit(m, w) for m in e['members'])):
                after = i
        sheet = None
        for i in range(after + 1, len(p)):
            s = p[i]
            if s.get('layer') or s['conn'] != conn or s.get('key') != key:
                continue
            if key:
                sheet = s; break
        if sheet is None:
            sheet = {'key': key, 'conn': conn, 'members': []}
            p.append(sheet)
        sheet['members'].append(w)
    return p


def memory(widgets, mapup, view=None, sport=False):
    px = 0; n = 0; per = {}
    for e in plan(widgets, mapup, view, sport):
        n += 1; per[e['conn']] = per.get(e['conn'], 0) + 1
        if e.get('layer'):
            if e['w']['type'] in IMG:
                px += e['w']['w'] * e['w']['h']
        else:
            b = box(e['members']); px += b[2] * b[3]
    return mib(px), n, per


def pack(widgets, k, verbose=False):
    """Met "sheet" et "conn" sur les textes et icônes de `widgets` (liste modifiée en place) ; renvoie un résumé."""
    img = [w for w in widgets if w['type'] in IMG and not w.get('own')]
    # la pastille « Launch Control Ready » reste sur la 2e connexion (la 1re n'a pas de couche à lui laisser, test_zones)
    pin = {id(w): 1 for w in img if w.get('readyBy')}
    # un widget avec "pinConn": N reste sur la connexion N (une feuille qui le porte y va aussi) : pour libérer une connexion pleine
    pin.update({id(w): int(w['pinConn']) for w in img if w.get('pinConn')})
    # les feuilles « fixes » : un widget dont la clé commence par "xs_" (tools/add_sensor_bars.py) garde sa feuille, rangée à part ;
    # seul le reste est regroupé en `k` feuilles (ainsi les barres de capteurs ajoutent leurs feuilles sans bousculer le rangement des autres)
    fixed = {}
    for w in img:
        if str(w.get('sheet') or '').startswith('xs_'):
            fixed.setdefault(w['sheet'], []).append(w)
    img = [w for w in img if not str(w.get('sheet') or '').startswith('xs_')]
    for w in img:
        w.pop('sheet', None)
        if id(w) not in pin:
            w.pop('conn', None)
    for ms in fixed.values():
        for w in ms:
            w.pop('conn', None)
    eff = {}
    for w in widgets:
        if w['type'] not in IMG or w.get('own'):
            c = int(w.get('conn', 0) or 0); eff[c] = eff.get(c, 0) + 1
    index = {id(w): i for i, w in enumerate(widgets)}
    layers = [(w, index[id(w)]) for w in widgets if w['type'] not in IMG or w.get('own')]
    g = groups_of(img, k, index, layers, pin)
    g.sort(key=lambda m: min(index[id(x)] for x in m))
    if len(g) > k:
        print('  %d feuilles au lieu de %d (recouvrements)' % (len(g), k))
    keys = ['s%d' % i for i in range(len(g))]
    for key, ms in sorted(fixed.items(), key=lambda kv: min(index[id(x)] for x in kv[1])):
        g.append(ms); keys.append(key)
    room = [CAP - eff.get(c, 0) for c in range(NCONN)]
    for members in g:                 # les feuilles imposées réservent leur place d'abord
        for c in pins(members, pin):
            room[c] -= 1
    for i, members in enumerate(g):
        want = pins(members, pin)
        c = next(iter(want)) if want else next((c for c in range(NCONN) if room[c] > 0), None)
        if c is None or room[c] < 0:
            raise SystemExit('pas assez de couches : %d feuilles + %s effets sur %d connexions' % (k, eff, NCONN))
        if not want:
            room[c] -= 1
        for w in members:
            w['sheet'] = keys[i]
            if c:
                w['conn'] = c
            else:
                w.pop('conn', None)
    # le moteur ne doit pas avoir à couper une feuille : même nombre de feuilles dans les deux états
    for st in (False, True):
        m, n, per = memory(widgets, st)
        want = len([1 for members in g if any(shown(x, st) for x in members)]) + len([1 for w in widgets if (w['type'] not in IMG or w.get('own')) and shown(w, st)])
        if n != want:
            print('  attention : %d couches planifiées (état %s), %d attendues : un texte en recouvre un autre d\'une autre feuille' % (n, 'carte' if st else 'sans carte', want))
    return {'sheets': len(g), 'nomap': memory(widgets, False), 'map': memory(widgets, True)}


def main():
    name, k = sys.argv[1], int(sys.argv[2])
    p = os.path.join(LAYOUTS, name + '.json')
    L = json.load(open(p))
    r = pack(L['widgets'], k)
    with open(p, 'w') as f:
        json.dump(L, f, indent=2)
        f.write('\n')
    print(name, r)


if __name__ == '__main__':
    main()
