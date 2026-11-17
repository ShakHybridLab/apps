'use strict';
// ShakPark sans voiture : la logique (shared/park.js) puis l'appli (shared/park_app.js) avec une horloge, un cluster-render et des
// fichiers d'images factices. Le point de presque tous les essais : aucune image hors des règles du propriétaire (avant : en D sous
// 15 km/h ; arrière : en R). Lancer : node tools/test_park.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vb = require('../shared/video_bridge');
const P = require('../shared/park');
const { ParkApp, FRAME_MS } = require('../shared/park_app');

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e.stack || e.message)); process.exitCode = 1; } }

// ---- les décodeurs ----
check('le sélecteur : statusActualStageDrive (P 1, R 2, N 3, D 4) et statusGearSelectionDrive (N 1, R 2, P 3, rapports 5 à 13)', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 'R', 'D', 9].map(P.stageOfStatus), ['P', 'R', 'N', 'D', 'R', 'D', undefined]);
    assert.deepStrictEqual([1, 2, 3, 4, 5, 13, 14, 'R', '_3', 'NP', undefined].map(P.stageOfSelection), ['N', 'R', 'P', undefined, 'D', 'D', undefined, 'R', 'D', undefined, undefined]);
});
check('la vitesse : échelle 1/64, 65535 = invalide, valeur absolue', () => {
    assert.strictEqual(P.speedOf({ speedVehicleCentreOfGravity: 640 }), 10);
    assert.strictEqual(P.speedOf({ speedVehicleCentreOfGravity: 65535 }), null);
    assert.strictEqual(P.speedOf({}), null);
    assert.strictEqual(P.speedOf(null), null);
});

// ---- la logique ----
function logic() {
    const L = new P.ParkLogic(); L.t = 1000;
    L.at = (stage, kmh, ms) => { L.t += ms || 0; L.gear(stage, L.t); if (kmh !== undefined) L.speed(kmh, L.t); return L.view(L.t); };
    return L;
}
check('arrière : en R, tout de suite, même sans vitesse', () => {
    const L = logic();
    assert.strictEqual(L.at('R'), 'rear');
});
check('arrière : 2 s après avoir quitté R, puis plus rien (P)', () => {
    const L = logic(); L.at('R', 3);
    assert.strictEqual(L.at('P', 0, 100), 'rear');
    assert.strictEqual(L.at('P', 0, 1800), 'rear');
    assert.strictEqual(L.at('P', 0, 200), 'off');
    assert.strictEqual(L.at('P', 0, 5000), 'off');
});
check('arrière : 15 km/h et plus récents l\'éteignent', () => {
    const L = logic(); assert.strictEqual(L.at('R', 14), 'rear'); assert.strictEqual(L.at('R', 15), 'off'); assert.strictEqual(L.at('R', 12, 100), 'rear');
});
check('avant : en D sous 14 km/h, après 400 ms de conditions réunies', () => {
    const L = logic();
    assert.strictEqual(L.at('D', 8), 'off', 'tout de suite');
    assert.strictEqual(L.at('D', 8, 300), 'off');
    assert.strictEqual(L.at('D', 8, 200), 'front');
});
check('avant : jamais à 15 km/h et plus, ni à 14 pour apparaître ; elle reste entre 14 et 15', () => {
    const L = logic();
    assert.strictEqual(L.at('D', 15, 0), 'off'); assert.strictEqual(L.at('D', 15, 1000), 'off'); assert.strictEqual(L.at('D', 14, 1000), 'off'); assert.strictEqual(L.at('D', 14, 1000), 'off');
    assert.strictEqual(L.at('D', 5, 1000), 'off'); assert.strictEqual(L.at('D', 5, 500), 'front');
    assert.strictEqual(L.at('D', 14.5, 100), 'front', 'reste sous 15');
    assert.strictEqual(L.at('D', 15, 100), 'off', 'disparaît à 15 : dans le même tick');
    assert.strictEqual(L.at('D', 14.5, 1000), 'off', 'ne revient pas à 14,5');
});
check('avant : pas en P, N, ni sans rapport, ni sans vitesse, ni avec une vitesse de plus de 5 s', () => {
    const L = logic();
    ['P', 'N', null, undefined].forEach((s) => { assert.strictEqual(L.at(s, 5, 1000), 'off', String(s)); });
    const M = logic(); M.gear('D', M.t); assert.strictEqual(M.view(M.t + 5000), 'off', 'aucune vitesse');
    const S = logic(); S.at('D', 5); S.view(S.t + 600);
    assert.strictEqual(S.view(S.t + 1000), 'front');
    assert.strictEqual(S.view(S.t + 6000), 'off', 'vitesse périmée');
    const U = logic(); U.at('D', null, 1000); assert.strictEqual(U.at('D', null, 1000), 'off', 'vitesse inconnue');
});
check('avant : la vitesse qui monte la coupe dans le même tick, un rapport qui change aussi', () => {
    const L = logic(); L.at('D', 5); L.at('D', 5, 500);
    assert.strictEqual(L.at('D', 5, 10), 'front');
    assert.strictEqual(L.at('D', 20, 10), 'off');
    const M = logic(); M.at('D', 5); M.at('D', 5, 500); assert.strictEqual(M.at('N', 5, 10), 'off');
});
check('de R à D : l\'arrière reste 2 s si on avance sous 15, puis l\'avant prend le relais', () => {
    const L = logic(); L.at('R', 2);
    assert.strictEqual(L.at('D', 2, 100), 'rear');
    assert.strictEqual(L.at('D', 2, 1000), 'rear');
    assert.strictEqual(L.at('D', 2, 1000), 'off', 'l\'avant attend ses 400 ms');
    assert.strictEqual(L.at('D', 2, 500), 'front');
});
check('les deux réglages coupent chaque caméra', () => {
    const L = logic(); L.at('R', 2);
    assert.strictEqual(L.view(L.t, { front: true, rear: false }), 'off');
    const M = logic(); M.at('D', 5); M.at('D', 5, 500);
    assert.strictEqual(M.view(M.t, { front: false, rear: true }), 'off');
    assert.strictEqual(M.view(M.t, { front: true, rear: true }), 'off', 'l\'avant attend de nouveau ses 400 ms');
    assert.strictEqual(M.view(M.t + 500, { front: true, rear: true }), 'front');
});

// ---- l'appli ----
const W = 128, H = 72, FB = W * H * 3 / 2;
function rig(settings) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'));
    const themes = path.join(dir, 'themes'); fs.mkdirSync(themes);
    const R = { t: 100000, seq: { front: 0, rear: 0 }, slot: { front: 0, rear: 0 }, dir, themes, renders: [] };
    R.file = { front: path.join(dir, 'front'), rear: path.join(dir, 'rear') };
    R.cr = () => {
        const c = { layers: {}, next: 1, frames: 0, ready: true, connect() {}, close() { c.closed = true; },
            video(o) { const ref = c.next++; c.layers[ref] = Object.assign({ visible: o.visible !== false }, o); return ref; },
            set(ref, o) { Object.assign(c.layers[ref], o); }, drop(ref) { delete c.layers[ref]; },
            frame(ref, atlas, id) { const l = c.layers[ref]; assert.strictEqual(atlas.length, l.vw * l.vh * 3 / 2, 'taille de l\'image'); c.frames++; c.lastId = id; return true; } };
        R.renders.push(c);
        return c;
    };
    R.app = new ParkApp({ id: 'shakpark', now: () => R.t, setting: (k) => settings[k], makeRender: R.cr, frontPath: R.file.front, rearPath: R.file.rear, themesDir: themes });
    R.write = (cam) => {
        R.seq[cam]++; R.slot[cam] = (R.slot[cam] + 1) % 3;
        const b = Buffer.alloc(64 + 3 * FB, 90);
        [vb.MAGIC, 1, W, H, R.seq[cam], R.slot[cam], 3, 709, 0].forEach((v, i) => b.writeUInt32LE(v, i * 4));
        fs.writeFileSync(R.file[cam], b);
    };
    R.theme = (open, map) => fs.writeFileSync(path.join(themes, 'themes.json'), JSON.stringify({ at: R.t, app: 'ShakTheme', window: { x: 80, y: 167, w: 561, h: 422 }, open: !!open, map: !!map }));
    R.asked = () => fs.existsSync(path.join(themes, 'window-shakpark.json'));
    // `ms` : à chaque pas de 33 ms, les caméras en `cams` écrivent une image, le rapport et la vitesse arrivent, le thème ouvre sa fenêtre une fois demandée
    R.run = (ms, stage, kmh, cams) => {
        for (let i = 0; i < ms; i += 33) {
            R.t += 33;
            (cams || []).forEach((c) => R.write(c));
            if (stage !== undefined) R.app.gear(stage);
            if (kmh !== undefined) R.app.speed(kmh);
            if (R.themeUp !== false) R.theme(R.asked(), R.mapUp === true);
            R.app.tick();
        }
    };
    R.visible = () => R.renders.some((c) => Object.keys(c.layers).some((k) => c.layers[k].visible === true));
    return R;
}
const ON = { frontCam: true, rearCam: true };

check('en marche arrière : demande la fenêtre, puis montre la caméra arrière', () => {
    const R = rig(ON);
    R.run(1500, 'R', 1, ['rear']);
    assert(R.asked(), 'fenêtre non demandée');
    assert(R.visible(), 'aucune image : ' + JSON.stringify(R.app.state));
    assert.strictEqual(R.app.state.view, 'rear');
});
check('en D à 10 km/h : la caméra avant ; la caméra arrière n\'est pas lue', () => {
    const R = rig(ON);
    R.run(1500, 'D', 10, ['front', 'rear']);
    assert(R.visible() && R.app.state.view === 'front', JSON.stringify(R.app.state));
    assert.strictEqual(R.app.feeds.rear.fd, null, 'le fichier arrière est ouvert');
});
check('à 15 km/h : plus rien, dans le même tick, et la fenêtre est rendue au thème', () => {
    const R = rig(ON);
    R.run(1500, 'D', 10, ['front']);
    assert(R.visible());
    R.t += 33; R.app.speed(15); R.app.tick();
    assert(!R.visible(), 'une image à 15 km/h');
    assert(!R.asked(), 'la fenêtre est gardée');
});
check('en P, en N, ou sans vitesse : jamais d\'image, même avec des images qui arrivent', () => {
    ['P', 'N'].forEach((s) => { const R = rig(ON); R.run(2000, s, 0, ['front', 'rear']); assert(!R.visible() && !R.asked(), s); });
    const R = rig(ON); R.run(2000, 'D', undefined, ['front']); assert(!R.visible() && !R.asked(), 'sans vitesse');
});
check('la caméra qui ne donne plus d\'image est cachée après 1,5 s', () => {
    const R = rig(ON);
    R.run(1000, 'R', 0, ['rear']); assert(R.visible());
    R.run(2000, 'R', 0, []);
    assert(!R.visible(), 'image figée');
});
check('PRIORITÉ : les deux caméras s\'affichent devant la carte Waze, dans la classe « alert » au z le plus haut', () => {
    ['front', 'rear'].forEach((cam) => {
        const R = rig(ON); R.mapUp = true;
        R.run(2000, cam === 'front' ? 'D' : 'R', cam === 'front' ? 5 : 0, [cam]);
        assert(R.visible(), cam + ' cachée devant la carte Waze');
        const l = R.renders[0].layers[Object.keys(R.renders[0].layers)[0]];
        assert.strictEqual(l.klass, 'alert', cam + ' : classe ' + l.klass);
        assert.strictEqual(l.z, 1000, cam + ' : z ' + l.z);
    });
});
check('PRIORITÉ : la demande de fenêtre porte priority « camera » (RideTube la lit), fraîche, et disparaît avec la caméra', () => {
    const R = rig(ON);
    R.run(1500, 'R', 0, ['rear']);
    const f = path.join(R.themes, 'window-shakpark.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(j.priority, 'camera'); assert.strictEqual(j.app, 'ShakPark'); assert(Math.abs(R.t - j.t) < 3000, 'périmée');
    R.run(5000, 'P', 0, []);
    assert(!fs.existsSync(f), 'la demande reste');
});
check('PRIORITÉ : RideTube retire son image tant que la caméra est là (video_app.js _cameraOn), et la remet après', () => {
    const { VideoApp } = require('../shared/video_app');
    const R = rig(ON);
    const rt = new VideoApp({ id: 'ridetube_cluster', now: () => R.t, setting: () => true, makeRender: R.cr, videoPath: path.join(R.dir, 'rt'), themesDir: R.themes, moving: () => true });
    assert.strictEqual(rt._cameraOn(), false, 'sans caméra');
    R.run(1500, 'R', 0, ['rear']);
    assert.strictEqual(rt._cameraOn(), true, 'avec la caméra');
    assert.strictEqual(rt._windowBusy(), true, 'RideTube devrait aussi voir la fenêtre occupée');
    R.run(5000, 'P', 0, []);
    assert.strictEqual(rt._cameraOn(), false, 'après la caméra');
    fs.writeFileSync(path.join(R.themes, 'window-shakpark.json'), JSON.stringify({ t: R.t, app: 'x', kind: 'camera', showing: true }));
    assert.strictEqual(rt._cameraOn(), false, 'sans priority « camera » : une autre appli ne prend pas la priorité');
    fs.writeFileSync(path.join(R.themes, 'window-shakpark.json'), JSON.stringify({ t: R.t - 5000, app: 'ShakPark', kind: 'camera', priority: 'camera' }));
    assert.strictEqual(rt._cameraOn(), false, 'une demande périmée');
});
check('la carte Waze du cluster : la caméra le demande à WazeYield (want vrai tant qu\'une vue est voulue, faux sinon)', () => {
    const calls = [];
    const R = rig(ON);
    R.app.d.waze = { want: (on) => calls.push(on) };
    R.run(300, 'P', 0, []); R.run(300, 'R', 0, ['rear']); R.run(5000, 'P', 0, []);
    assert.strictEqual(calls[0], false); assert(calls.indexOf(true) > 0, 'jamais demandé'); assert.strictEqual(calls[calls.length - 1], false);
});
check('sans thème ouvert : rien n\'est dessiné', () => {
    const R = rig(ON); R.themeUp = false;
    R.run(2000, 'R', 0, ['rear']);
    assert(!R.visible());
});
check('de R à D : l\'image change de caméra sans mélange, et au plus 15 images par seconde', () => {
    const R = rig(ON);
    R.run(1500, 'R', 1, ['rear']);
    const frames0 = R.renders[0].frames;
    R.run(1000, 'R', 1, ['rear']);
    const rate = (R.renders[0].frames - frames0);
    assert(rate <= Math.ceil(1000 / FRAME_MS) + 1, rate + ' images en 1 s');
    R.run(5000, 'D', 3, ['front']);
    assert.strictEqual(R.app.state.view, 'front');
    assert(R.visible());
});
check('mode essai : une image de test à la place de la caméra, sans fichier, avec les mêmes règles', () => {
    const R = rig({ frontCam: true, rearCam: true, demo: true });
    R.run(1500, 'R', 0, []);             // aucun fichier d'image écrit
    assert(R.visible() && R.app.state.view === 'rear', 'pas d\'image de test en marche arrière : ' + JSON.stringify(R.app.state));
    const l = R.renders[0].layers[Object.keys(R.renders[0].layers)[0]];
    assert.strictEqual(l.klass, 'alert'); assert.strictEqual(l.z, 1000);
    R.run(5000, 'P', 0, []);
    assert(!R.visible() && !R.asked(), 'l\'image de test reste en P');
    const F = rig({ frontCam: true, rearCam: true, demo: true });
    F.run(1500, 'D', 20, []); assert(!F.visible(), 'l\'image de test à 20 km/h');
    F.run(1500, 'D', 10, []); assert(F.visible() && F.app.state.view === 'front', 'pas d\'image de test en avant');
});
check('l\'image de test : 320 x 180, avant et arrière différentes, la barre blanche bouge, au plus 15 images par seconde', () => {
    const D = require('../shared/park_demo');
    const a = new D.DemoFeed('front'), b = new D.DemoFeed('rear');
    const fa = Buffer.from(a.read(1000)), fb = Buffer.from(b.read(1000));
    assert.strictEqual(fa.length, 320 * 180 * 3 / 2);
    assert(!fa.equals(fb), 'avant et arrière identiques');
    assert.strictEqual(a.read(1010), null, 'plus de 15 images par seconde');
    const fa2 = Buffer.from(a.read(1100));
    assert(!fa.equals(fa2), 'l\'image ne bouge pas');
    assert(a.live(1200) && !a.live(1100 + D.FRAME_MS * 100));
    a.forget(); assert(!a.live(1200));
});
check('les réglages : rearCam à non coupe l\'arrière, frontCam à non coupe l\'avant', () => {
    const R = rig({ frontCam: true, rearCam: false }); R.run(1500, 'R', 0, ['rear']); assert(!R.visible());
    const S = rig({ frontCam: false, rearCam: true }); S.run(1500, 'D', 5, ['front']); assert(!S.visible());
});
check('stop() cache tout et rend la fenêtre', () => {
    const R = rig(ON); R.run(1500, 'R', 0, ['rear']); assert(R.visible());
    R.app.stop();
    assert(!R.visible() && !R.asked());
});

console.log(process.exitCode ? 'ShakPark : ÉCHECS' : 'ShakPark : ' + n + ' vérifications passent');
