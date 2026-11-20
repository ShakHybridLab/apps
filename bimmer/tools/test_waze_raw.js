'use strict';
// node tools/test_waze_raw.js : tout le fichier d'état de Waze on Cluster tient sur une ligne (carte « Carte » de la page, et le journal), pour voir
// s'il contient une position (la liste des radars en aurait besoin) : shared/waze.js rawOf, et la lecture du fichier par Waze._poll.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Waze = require('../shared/waze');

let n = 0, bad = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { bad++; console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

check('rawOf : clés et valeurs sur une ligne, nombres arrondis à 5 décimales, valeurs longues coupées', () => {
    assert.strictEqual(Waze.rawOf({ state: 'idle', target: 'map', page: null }), 'state=idle target=map page=null');
    assert.strictEqual(Waze.rawOf({ lat: 48.856614999999, lon: 2.3522219 }), 'lat=48.85661 lon=2.35222');
    assert(Waze.rawOf({ s: 'x'.repeat(100) }).length < 40);
    assert(/pos=\{"lat":1,"lon":2\}/.test(Waze.rawOf({ pos: { lat: 1, lon: 2 } })));
    assert.strictEqual(Waze.rawOf(null), '');
    assert(Waze.rawOf(Object.keys(new Array(60).fill(0)).reduce((o, k) => { o['k' + k] = 'v'.repeat(30); return o; }, {})).length <= 400);
});

check('Waze lit le fichier d\'état entier : st.raw et st.keys, une ligne de journal quand les clés changent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-'));
    const f = path.join(dir, 'status.json');
    fs.writeFileSync(f, JSON.stringify({ state: 'idle', target: 'map', lat: 48.1, lon: 2.2 }));
    const lines = [];
    const w = new Waze({ status: f }, { info: (m) => lines.push(m), warn() {} }, () => {});
    return new Promise((resolve, reject) => {
        w._poll();
        setTimeout(() => {
            try {
                assert.strictEqual(w.st.state, 'idle');
                assert.strictEqual(w.st.target, 'map');
                assert.strictEqual(w.st.raw, 'state=idle target=map lat=48.1 lon=2.2');
                assert.strictEqual(w.st.keys, 'state,target,lat,lon');
                assert.strictEqual(lines.filter((l) => /status file/.test(l)).length, 1);
                w._poll();
                setTimeout(() => { try { assert.strictEqual(lines.filter((l) => /status file/.test(l)).length, 1, 'pas de nouvelle ligne tant que les clés sont les mêmes'); resolve(); } catch (e) { reject(e); } }, 150);
            } catch (e) { reject(e); }
        }, 150);
    }).then(() => { fs.rmSync && fs.rmSync(dir, { recursive: true, force: true }); console.log(bad ? bad + ' FAILED' : 'waze raw: ' + (n + 1) + ' checks pass'); }, (e) => { console.error('FAIL status file: ' + e.message); process.exitCode = 1; });
});
