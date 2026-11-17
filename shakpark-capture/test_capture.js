'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// Le service de capture avec le décodeur de test : lecture de la demande, lancement, arrêt, relance, abandon, et lecture des images par video_bridge.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Capture, GRACE_MS, MAX_FAILS } = require('./capture');
const vb = require('../bimmer/shared/video_bridge');

let failed = 0;
function check(name, fn) { try { fn(); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-')), dir = path.join(base, 'req'), out = path.join(base, 'out');
fs.mkdirSync(out);
let T = 1000000;
const cap = new Capture({ dir, outDir: out, decoder: [process.execPath, path.join(__dirname, 'fake_decoder.js')], now: () => T });
const ask = (cam, t) => fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ t: t === undefined ? T : t, cam }));
const status = () => JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));

(async () => {
    cap.start(); clearInterval(cap.timer); cap.timer = null;           // on cadence les pas nous-mêmes
    check('sans demande : repos, rien lancé', () => { assert.strictEqual(cap.wanted(), 'off'); assert.strictEqual(cap.child, null); assert.strictEqual(status().state, 'idle'); });
    ask('rear'); cap.tick();
    check('« rear » demandée : un décodeur est lancé', () => { assert(cap.child, 'pas de décodeur'); assert.strictEqual(status().cam, 'rear'); });
    await sleep(500);
    check('les images du décodeur sont lisibles par video_bridge (seq qui avance, 320x180)', () => {
        const fd = fs.openSync(path.join(out, 'shakpark-rear'), 'r');
        const a = vb.readFrame(fd, null, null); assert(a && a.frame && a.head.w === 320 && a.head.h === 180, 'pas d\'image');
        fs.closeSync(fd);
        assert(a.head.seq >= 1);
    });
    ask('front'); cap.tick();
    check('changement de caméra : la rear est supprimée, la front est lancée', () => { assert(!fs.existsSync(path.join(out, 'shakpark-rear'))); assert.strictEqual(status().cam, 'front'); assert(cap.child); });
    await sleep(300);
    check('« front » écrit son fichier', () => assert(fs.existsSync(path.join(out, 'shakpark-front'))));
    check('demande périmée : traitée comme « off », décodeur gardé GRACE_MS puis arrêté', () => {
        T += 5000; cap.tick(); assert(cap.child, 'arrêté trop tôt');
        T += GRACE_MS + 10; cap.tick(); assert.strictEqual(cap.child, null); assert.strictEqual(status().state, 'idle'); assert(!fs.existsSync(path.join(out, 'shakpark-front')));
    });
    check('une demande qui revient pendant le délai garde le décodeur', () => {
        ask('rear'); cap.tick(); const c = cap.child; assert(c);
        ask('off'); T += 1000; cap.tick(); ask('rear'); cap.tick(); assert.strictEqual(cap.child, c, 'décodeur relancé pour rien'); assert.strictEqual(cap.offSince, null);
    });
    cap.stop(); await sleep(100);

    // décodeur qui échoue : relancé, puis abandon, sans planter
    const bad = new Capture({ dir, outDir: out, decoder: ['/nonexistent/shakpark-decode'], now: () => T });
    bad.start(); clearInterval(bad.timer); bad.timer = null;
    ask('front');
    for (let i = 0; i < 8; i++) { bad.tick(); T += 2100; ask('front'); await sleep(60); }
    check('décodeur absent : essais limités puis état « failed », le service reste en vie', () => { assert(bad.fails >= MAX_FAILS, 'échecs ' + bad.fails); assert.strictEqual(status().state, 'failed'); assert.strictEqual(bad.child, null); });
    check('une autre caméra demandée relance les essais', () => { ask('rear'); bad.tick(); assert.strictEqual(bad.cam, 'rear'); assert(bad.fails <= 1); });
    bad.stop();
    console.log(failed ? 'capture : ÉCHECS' : 'capture : 8 vérifications passent');
    process.exit(failed ? 1 : 0);
})();
