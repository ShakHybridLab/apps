'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * capture.js - le service root de ShakPark : lance le décodeur de la caméra demandée, et seulement celle-là.
 *
 *   l'appli (ShakPark) écrit /dev/shm/shakpark-capture/request.json  { t, cam: 'front' | 'rear' | 'off' }  (renouvelé toutes les 500 ms)
 *   ce service lit la demande ; si elle est fraîche et que cam != 'off', il lance  <décodeur> <cam> /dev/shm/shakpark-<cam>
 *   le décodeur écrit des images I420 dans ce fichier MGVF ; l'appli les lit.
 *   demande périmée (appli arrêtée ou plantée) ou 'off' : le décodeur est arrêté après GRACE_MS et le fichier supprimé.
 *
 * Une seule caméra à la fois (le flux AVB de la caméra n'est ouvert que si on la regarde). Le service ne touche pas à la voiture tant
 * que rien n'est demandé. Status : /dev/shm/shakpark-capture/status.json.
 * Node 8 (celui de la voiture), sans dépendance.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const STALE_MS = 2000;     // une demande plus vieille est ignorée
const GRACE_MS = 3000;     // « off » : on garde le décodeur ce temps (un feu rouge, un changement de rapport) avant de l'arrêter
const POLL_MS = 250;
const RESTART_MS = 2000;   // un décodeur qui meurt est relancé au plus toutes les 2 s
const MAX_FAILS = 5;       // puis on s'arrête là jusqu'à la prochaine demande différente (status 'failed')

class Capture {
    /** opts : { dir, outDir, decoder: [cmd, ...args], now, spawn, log } */
    constructor(opts) {
        this.dir = opts.dir; this.outDir = opts.outDir || '/dev/shm';
        this.decoder = opts.decoder; this.now = opts.now || Date.now; this.spawn = opts.spawn || cp.spawn;
        this.log = opts.log || (() => {});
        this.child = null; this.cam = null; this.offSince = null; this.fails = 0; this.lastStart = -Infinity; this.state = 'idle';
        this.timer = null;
    }

    file(cam) { return path.join(this.outDir, 'shakpark-' + cam); }

    wanted() {
        let j;
        try { j = JSON.parse(fs.readFileSync(path.join(this.dir, 'request.json'), 'utf8')); } catch (e) { return 'off'; }
        if (!j || typeof j.t !== 'number' || Math.abs(this.now() - j.t) > STALE_MS) return 'off';
        return j.cam === 'front' || j.cam === 'rear' ? j.cam : 'off';
    }

    start() {
        try { fs.mkdirSync(this.dir); } catch (e) { /* déjà là */ }
        try { fs.chmodSync(this.dir, 0o1777); } catch (e) { /* l'appli (autre utilisateur) doit pouvoir y écrire */ }
        this.timer = setInterval(() => this.tick(), POLL_MS);
        this.tick();
    }

    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this._kill(); this._status(); }

    tick() {
        const now = this.now(), want = this.wanted();
        if (want === 'off') {
            if (!this.child && !this.cam) { this.state = 'idle'; this._status(); return; }
            if (this.offSince === null) this.offSince = now;
            if (now - this.offSince >= GRACE_MS) { this._kill(); this.cam = null; this.fails = 0; this.state = 'idle'; }
        } else {
            this.offSince = null;
            if (this.cam !== want) { this._kill(); this.cam = want; this.fails = 0; this.lastStart = -Infinity; }      // changer de caméra n'est pas une relance
            if (!this.child && this.fails < MAX_FAILS && now - this.lastStart >= RESTART_MS) this._run(want);
        }
        this._status();
    }

    _run(cam) {
        const f = this.file(cam), cmd = this.decoder[0], args = this.decoder.slice(1).concat([cam, f]);
        this.lastStart = this.now();
        let c;
        try { c = this.spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { this._died(null, e.message); return; }
        this.child = c; this.state = 'running';
        let err = '';
        if (c.stderr) c.stderr.on('data', (d) => { err = (err + d).slice(-400); });
        c.on('error', (e) => { if (this.child === c) this._died(c, e.message); });
        c.on('exit', (code, sig) => { if (this.child === c) this._died(c, 'code ' + code + (sig ? ' signal ' + sig : '') + (err ? ' : ' + err.trim() : '')); });
        this.log('décodeur ' + cam + ' lancé');
    }

    _died(c, why) {
        this.child = null; this.fails++;
        this.state = this.fails >= MAX_FAILS ? 'failed' : 'restarting';
        try { fs.unlinkSync(this.file(this.cam || 'front')); } catch (e) { /* pas de fichier */ }
        this.log('décodeur arrêté (' + why + ') ; échecs de suite : ' + this.fails);
    }

    _kill() {
        const c = this.child; this.child = null;
        if (c) { try { c.kill('SIGTERM'); } catch (e) { /* déjà parti */ } }
        ['front', 'rear'].forEach((cam) => { try { fs.unlinkSync(this.file(cam)); } catch (e) { /* pas de fichier */ } });
        this.offSince = null;
    }

    _status() {
        const s = JSON.stringify({ t: this.now(), state: this.state, cam: this.cam, fails: this.fails });
        if (s === this._last && this.now() - (this._lastAt || 0) < 1000) return;
        this._last = s; this._lastAt = this.now();
        try { fs.writeFileSync(path.join(this.dir, 'status.json.tmp'), s, { mode: 0o644 }); fs.renameSync(path.join(this.dir, 'status.json.tmp'), path.join(this.dir, 'status.json')); } catch (e) { /* tant pis */ }
    }
}

module.exports = { Capture, STALE_MS, GRACE_MS, RESTART_MS, MAX_FAILS };

if (require.main === module) {
    // Le vrai décodeur natif n'existe pas encore : sans lui le service reste en vie (état 'failed' après 5 essais), il ne plante pas.
    const here = __dirname;
    const dec = process.env.SHAKPARK_DECODER ? [process.env.SHAKPARK_DECODER] : [path.join(here, 'shakpark-decode')];
    const c = new Capture({ dir: process.env.SHAKPARK_CAPTURE_DIR || '/dev/shm/shakpark-capture', decoder: dec, log: (m) => process.stdout.write(m + '\n') });
    c.start();
    const bye = () => { c.stop(); process.exit(0); };
    process.on('SIGTERM', bye); process.on('SIGINT', bye);
}
