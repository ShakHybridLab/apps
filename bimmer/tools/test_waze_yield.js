'use strict';
// shared/waze_yield.js : la carte Waze du cluster cède sa place à la caméra, avec un vrai socket (comme celui de waze-on-cluster) et un
// faux fichier d'état dans un dossier temporaire. Lancer : node tools/test_waze_yield.js
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { WazeYield, RETRY_MS, RELEASE_MS } = require('../shared/waze_yield');

let n = 0;
const tests = [];
function check(name, fn) { tests.push([name, fn]); }

function rig(opts) {
    const o = opts || {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-'));
    const R = { t: 1000000, dir, cmds: [], busy: false, status: path.join(dir, 'status.json'), ctl: path.join(dir, 'ctl.sock'), flag: path.join(dir, 'flag') };
    R.setStatus = (j) => { fs.writeFileSync(R.status, JSON.stringify(j)); const s = new Date(R.t); fs.utimesSync(R.status, s, s); };
    R.server = net.createServer((c) => {
        if (R.busy) { c.end('{"ev":"busy"}\n'); return; }
        let buf = '';
        c.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); R.cmds.push(m); if (R.follow !== false && m.cmd === 'cluster') R.setStatus({ state: 'showing', cluster: Number(m.on) }); } catch (e) { /* ligne incomplète */ } } });
        c.write('{"ev":"status"}\n');
    });
    R.warns = [];
    R.y = new WazeYield({ now: () => R.t, statusPath: R.status, ctlPath: R.ctl, flagPath: R.flag, enabled: o.enabled, log: { info() {}, warn: (m) => R.warns.push(m) } });
    R.listen = () => new Promise((res) => R.server.listen(R.ctl, res));
    R.close = () => { R.server.close(); };
    // avance de `ms` ms par pas d'une seconde, en laissant le temps réel aux sockets
    // (le vrai fichier d'état est réécrit chaque seconde par l'outil : on le rafraîchit à chaque pas, sauf `R.frozen`)
    R.run = async (ms) => {
        for (let i = 0; i < ms; i += 1000) {
            R.t += 1000;
            if (!R.frozen) { try { const d = new Date(R.t); fs.utimesSync(R.status, d, d); } catch (e) { /* pas de fichier */ } }
            R.y.tick(); await new Promise((r) => setTimeout(r, 80));
        }
    };
    return R;
}

check('caméra voulue, carte Waze sur le cluster : la carte est éteinte (une fois), le témoin est écrit', async () => {
    const R = rig(); await R.listen(); R.setStatus({ state: 'showing', cluster: 1, hud: 1 });
    R.y.want(true);
    await R.run(3000);
    assert.deepStrictEqual(R.cmds, [{ cmd: 'cluster', on: '0' }]);
    assert(fs.existsSync(R.flag), 'pas de témoin');
    await R.run(8000);
    assert.strictEqual(R.cmds.length, 1, 'renvoyé : ' + JSON.stringify(R.cmds));
    R.close();
});
check('caméra partie : la carte revient après RELEASE_MS, le témoin part ; jamais « hud »', async () => {
    const R = rig(); await R.listen(); R.setStatus({ state: 'showing', cluster: 1 });
    R.y.want(true); await R.run(3000);
    R.y.want(false);
    await R.run(RELEASE_MS - 1000);
    assert.strictEqual(R.cmds.length, 1, 'rallumée trop tôt');
    await R.run(RETRY_MS + 2000);
    assert.deepStrictEqual(R.cmds[1], { cmd: 'cluster', on: '1' });
    assert(!fs.existsSync(R.flag), 'le témoin reste');
    assert(R.cmds.every((c) => c.cmd === 'cluster'), 'une autre commande');
    R.close();
});
check('R, puis D, puis R en moins de 3 s : la carte ne fait pas le va-et-vient', async () => {
    const R = rig(); await R.listen(); R.setStatus({ state: 'showing', cluster: 1 });
    R.y.want(true); await R.run(3000);
    R.y.want(false); await R.run(1000); R.y.want(true); await R.run(8000);
    assert.strictEqual(R.cmds.length, 1, JSON.stringify(R.cmds));
    R.close();
});
check('carte déjà éteinte par quelqu\'un d\'autre : on n\'y touche pas, ni pour l\'éteindre ni pour la rallumer', async () => {
    const R = rig(); await R.listen(); R.setStatus({ state: 'showing', cluster: 0 });
    R.y.want(true); await R.run(4000); R.y.want(false); await R.run(RELEASE_MS + 8000);
    assert.strictEqual(R.cmds.length, 0, JSON.stringify(R.cmds));
    R.close();
});
check('pas d\'outil (pas de fichier d\'état), état sans le champ, ou fichier périmé : rien n\'est envoyé', async () => {
    const A = rig(); await A.listen(); A.y.want(true); await A.run(4000); assert.strictEqual(A.cmds.length, 0, 'sans fichier'); A.close();
    const B = rig(); await B.listen(); B.setStatus({ state: 'showing' }); B.y.want(true); await B.run(4000); assert.strictEqual(B.cmds.length, 0, 'sans champ'); B.close();
    const C = rig(); await C.listen(); C.setStatus({ state: 'showing', cluster: 1 }); C.frozen = true; C.t += 60000; C.y.want(true); await C.run(4000); assert.strictEqual(C.cmds.length, 0, 'périmé'); C.close();
});
check('le socket est occupé (« busy », l\'appli Waze est ouverte) : on réessaie toutes les 5 s, jusqu\'à ce que ça passe', async () => {
    const R = rig(); await R.listen(); R.setStatus({ state: 'showing', cluster: 1 }); R.busy = true;
    R.y.want(true); await R.run(6000);
    assert.strictEqual(R.cmds.length, 0); assert(!fs.existsSync(R.flag), 'témoin sans carte éteinte');
    R.busy = false; await R.run(6000);
    assert.deepStrictEqual(R.cmds, [{ cmd: 'cluster', on: '0' }]);
    R.close();
});
check('pas de socket du tout : pas de plantage, un seul avertissement', async () => {
    const R = rig(); R.setStatus({ state: 'showing', cluster: 1 });
    R.y.want(true); await R.run(12000);
    assert(R.warns.length === 1, R.warns.length + ' avertissements');
});
check('le réglage coupé : la carte n\'est pas touchée ; coupé pendant que la caméra est là, elle revient', async () => {
    let on = false;
    const R = rig({ enabled: () => on }); await R.listen(); R.setStatus({ state: 'showing', cluster: 1 });
    R.y.want(true); await R.run(4000); assert.strictEqual(R.cmds.length, 0, 'réglage coupé');
    on = true; await R.run(3000); assert.strictEqual(R.cmds.length, 1);
    on = false; await R.run(RETRY_MS + 2000); assert.deepStrictEqual(R.cmds[1], { cmd: 'cluster', on: '1' });
    R.close();
});
check('arrêt avec la carte éteinte : au démarrage suivant le témoin fait rallumer la carte', async () => {
    const R = rig(); await R.listen(); R.setStatus({ state: 'showing', cluster: 0 });
    fs.writeFileSync(R.flag, 'x');
    R.y.start(); R.y.stop();            // start lit le témoin
    await R.run(2000);
    assert.deepStrictEqual(R.cmds, [{ cmd: 'cluster', on: '1' }]);
    assert(!fs.existsSync(R.flag));
    R.close();
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e.stack || e.message)); process.exitCode = 1; }
    }
    console.log(process.exitCode ? 'WazeYield : ÉCHECS' : 'WazeYield : ' + n + ' vérifications passent');
    process.exit(process.exitCode || 0);      // un essai raté laisse son faux socket ouvert : on sort quand même
})();
