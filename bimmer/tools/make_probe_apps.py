#!/usr/bin/env python3
"""Écrit apps/<appli d'essai>/app.json et main.js à partir de shared/probe_sets.js (une table pour les noms, rien à recopier).

    python3 tools/make_probe_apps.py        # shakvolant, shakmanette, shakconso, shakgps, shakmedia

Les applis d'essai de signaux (shared/signal_probe.js) ne portent jamais les thèmes : la voiture refuse l'installation ENTIÈRE si un seul
signal déclaré ne lui convient pas, donc un nom incertain ne se déclare que dans son appli d'essai.
"""
import json
import os
import subprocess

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SETS = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./shared/probe_sets.js')))"], cwd=ROOT))

MAIN = """'use strict';
/**
 * %(title)s : appli d'essai, lecture seule (shared/signal_probe.js, noms dans shared/probe_sets.js). Ne touche à aucun thème.
 */
const mgu = require('./kit/mgu');
const probe = require('./signal_probe');
const SET = require('./probe_sets').%(id)s;

mgu.run({
    start(ctx) {
        require('./survive').install(ctx.log);       // une erreur que personne n'a rattrapée ne ferme pas l'appli (shared/survive.js)
        try {
            probe.start(ctx, SET);
        } catch (e) {
            ctx.log.error('%(title)s failed to start: ' + (e && e.stack || e));
        }
    }
});
"""

for app, s in SETS.items():
    d = os.path.join(ROOT, 'apps', app)
    os.makedirs(d, exist_ok=True)
    spec = {
        'id': app, 'title': s['title'] + ' (essai)', 'description': s['description'], 'version': s.get('version', '0.2.1'), 'vendor': 'custom',
        'loggingId': s['logId'], 'iconGlyph': s['glyph'], 'shared': ['signal_probe.js', 'probe_sets.js', 'survive.js'],
        'signals': {i: {f: 's' for f in fields} for i, fields in s['signals'].items()},
        'screens': [{'name': 'MAIN', 'kind': 'canvas', 'title': s['title']}],
        'settings': [], 'config': {'lang': 'fr', 'readOnly': True},
    }
    with open(os.path.join(d, 'app.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, indent=2, ensure_ascii=False); f.write('\n')
    with open(os.path.join(d, 'main.js'), 'w', encoding='utf-8') as f:
        f.write(MAIN % {'id': app, 'title': s['title']})
    print('écrit', app)
