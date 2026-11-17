'use strict';
/**
 * waze_yield.js - ShakPark : la caméra passe avant la carte Waze du cluster.
 *
 * Pourquoi : l'autoradio ne tient les tampons que de 2 vidéos à la fois (cluster-render, PROTOCOL.md « Video layers »). Waze on cluster en
 * prend déjà deux quand sa carte est sur le cluster ET sur le HUD ; la caméra (une troisième) serait refusée (« too many video buffers
 * on the display »). Tant que la caméra est voulue, on éteint donc la carte Waze du CLUSTER (le HUD n'est pas touché) ; la caméra partie,
 * on la rallume.
 *
 * Comment : le socket de contrôle de waze-on-cluster, {"cmd":"cluster","on":"0"|"1"} (sa source, src/control.h, GPL-3.0). Comme
 * shared/waze.js : on ne s'y connecte que le temps d'une commande ; le socket n'a qu'un propriétaire (l'appli Waze, tant que sa page est
 * ouverte) : « busy », on réessaie toutes les 5 s. On ne rallume QUE ce qu'on a éteint, et on garde un fichier-témoin
 * (/dev/shm/shakpark-waze-yielded) : si l'appli s'arrête avec la carte éteinte, le prochain démarrage la rallume.
 * L'état se lit dans /run/waze-on-cluster/status.json ; sans fichier récent (l'outil n'est pas là), on ne touche à rien.
 *
 * Tout ce qui est extérieur passe par `opts` : tools/test_waze_yield.js le pilote avec un vrai socket dans un dossier temporaire.
 * Node 8. MIT (le protocole est celui de waze-on-cluster).
 */
const fs = require('fs');
const net = require('net');

const STATUS_PATH = '/run/waze-on-cluster/status.json';
const CONTROL_PATH = '/dev/shm/waze-on-cluster/ctl.sock';
const FLAG_PATH = '/dev/shm/shakpark-waze-yielded';
const POLL_MS = 1000;
const STALE_MS = 10000;          // un fichier d'état plus vieux : l'outil ne tourne pas
const RETRY_MS = 5000;           // entre deux envois (« busy », erreur, ou l'état n'a pas encore suivi)
const CONFIRM_MS = 3000;         // après un envoi, l'état doit avoir suivi avant ce temps, sinon on renvoie
const LINGER_MS = 800;           // le temps qu'on reste connecté après la commande (sa réponse, puis on ferme)
const RELEASE_MS = 3000;         // la carte revient ce temps après que la caméra a fini (R, puis D, puis R : pas de va-et-vient)

class WazeYield {
    constructor(opts) {
        const o = opts || {};
        this.now = o.now || Date.now;
        this.log = o.log;
        this.statusPath = o.statusPath || STATUS_PATH;
        this.ctlPath = o.ctlPath || CONTROL_PATH;
        this.flagPath = o.flagPath || FLAG_PATH;
        this.enabled = typeof o.enabled === 'function' ? o.enabled : () => true;      // le réglage « la caméra prend la place de la carte Waze »
        this.wanted = false; this.offSince = null;
        this.yielded = false;            // c'est NOUS qui avons éteint la carte
        this.cluster = null;             // true / false d'après l'état de l'outil, null : inconnu ou fichier périmé
        this.sentAt = -Infinity; this.sending = false;
        this.timer = null;
        this.warned = {};
    }

    _warn(k, m) { if (this.log && !this.warned[k]) { this.warned[k] = true; this.log.warn(m); } }

    /** true tant que la caméra est voulue (ParkApp : une vue avant ou arrière est demandée). */
    want(on) {
        if (on) { this.wanted = true; this.offSince = null; }
        else if (this.wanted) { this.wanted = false; this.offSince = this.now(); }
    }

    start() {
        if (this.timer) return;
        try { if (fs.existsSync(this.flagPath)) this.yielded = true; } catch (e) { /* pas de témoin */ }    // un arrêt avec la carte éteinte : on la rallume
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { this._warn('tick', 'waze_yield : ' + (e && e.message || e)); } }, POLL_MS);
        if (this.timer.unref) this.timer.unref();
    }

    stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

    /** La carte Waze est-elle sur le cluster ? true / false, ou null (pas d'outil, fichier périmé ou illisible). */
    _readStatus() {
        let j;
        try {
            const st = fs.statSync(this.statusPath);
            if (this.now() - st.mtimeMs > STALE_MS && !this.yielded) { this.cluster = null; return; }
            j = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
        } catch (e) { this.cluster = null; return; }
        if (!j || typeof j !== 'object') { this.cluster = null; return; }
        if (j.cluster === 1 || j.cluster === '1') this.cluster = true;
        else if (j.cluster === 0 || j.cluster === '0') this.cluster = false;
        else this.cluster = null;      // un fichier sans ce champ : on ne devine pas
    }

    _flag(on) {
        try { if (on) fs.writeFileSync(this.flagPath, 'carte Waze du cluster éteinte par ShakPark\n', { mode: 0o644 }); else fs.unlinkSync(this.flagPath); } catch (e) { /* tmpfs absent ou déjà parti */ }
    }

    /** Envoie une commande ; cb(true) quand le socket l'a prise (pas « busy »), cb(false) sinon. Une commande à la fois. */
    _send(cmd, cb) {
        if (this.sending) return;
        this.sending = true; this.sentAt = this.now();
        let done = false, answer = '';
        const finish = (ok) => { if (done) return; done = true; this.sending = false; try { sock.destroy(); } catch (e) { /* fermé */ } cb(ok); };
        const sock = net.createConnection(this.ctlPath);
        const t = setTimeout(() => finish(!/busy/i.test(answer)), LINGER_MS);
        if (t.unref) t.unref();
        sock.on('connect', () => { try { sock.write(JSON.stringify(cmd) + '\n'); } catch (e) { clearTimeout(t); finish(false); } });
        // la première réponse décide : « busy » (un autre propriétaire tient le socket) ou le reste (l'état de l'outil) = la commande est partie
        sock.on('data', (d) => { answer += d.toString('utf8'); clearTimeout(t); finish(!/busy/i.test(answer)); });
        sock.on('error', (e) => { clearTimeout(t); this._warn('sock', 'waze_yield : socket de Waze on cluster : ' + (e && e.code || e)); finish(false); });
        sock.on('close', () => { clearTimeout(t); finish(!/busy/i.test(answer)); });
    }

    tick() {
        const t = this.now();
        this._readStatus();
        const holding = this.enabled() === true && (this.wanted || (this.offSince !== null && t - this.offSince < RELEASE_MS));
        if (this.sending) return;
        if (holding) {
            // on éteint seulement une carte qu'on SAIT sur le cluster ; déjà éteinte (par quelqu'un d'autre) : on n'y touche pas, et on ne la rallumera pas
            if (this.yielded && this.cluster === true && t - this.sentAt >= CONFIRM_MS && t - this.sentAt >= RETRY_MS) this.yielded = false;      // l'état n'a pas suivi : on recommence
            if (!this.yielded && this.cluster === true && t - this.sentAt >= RETRY_MS) {
                this._send({ cmd: 'cluster', on: '0' }, (ok) => {
                    if (ok) { this.yielded = true; this._flag(true); if (this.log) this.log.info('carte Waze du cluster éteinte : la caméra est affichée'); }
                });
            }
            return;
        }
        if (this.yielded && t - this.sentAt >= RETRY_MS) {
            // la caméra a fini (ou le réglage a été coupé) : la carte revient ; l'état « allumée » (ou inconnu) confirme
            if (this.cluster === true) { this.yielded = false; this._flag(false); return; }      // quelqu'un l'a déjà rallumée
            this._send({ cmd: 'cluster', on: '1' }, (ok) => {
                if (ok) { this.yielded = false; this._flag(false); if (this.log) this.log.info('carte Waze du cluster rallumée'); }
            });
        }
    }
}

module.exports = { WazeYield, STATUS_PATH, CONTROL_PATH, FLAG_PATH, RELEASE_MS, RETRY_MS };
