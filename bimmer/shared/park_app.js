'use strict';
/**
 * park_app.js - ShakPark : montre la caméra avant ou arrière dans la fenêtre centrale d'un thème du cluster, d'après les règles de
 * shared/park.js (avant : en D sous 15 km/h ; arrière : en R). L'image vient de fichiers d'images que l'outil de capture écrit dans
 * /dev/shm (un par caméra, format MGVF de shared/video_bridge.js). Sans fichier ou sans image récente : rien n'est dessiné.
 *
 * Ce n'est PAS le verrou de video_app.js (voiture à l'arrêt) : ici la voiture roule ou recule, lentement, par construction.
 * La porte est ParkLogic.view(), évaluée à chaque tick avant toute lecture d'image ; dès qu'elle dit « off » tout est caché dans
 * le même tick et la fenêtre est rendue au thème.
 *
 * Dans la fenêtre du thème (même protocole que video_app.js) : on la demande par /dev/shm/cluster-themes/window-<id>.json et on
 * attend que le thème dise qu'elle est ouverte (themes.json). Sans thème ouvert, rien n'est dessiné sur le cluster de BMW.
 *
 * PRIORITÉ : la caméra, puis Waze, puis RideTube. La caméra ne s'écarte devant personne : son image est dans la classe « alert » (le haut
 * de la pile de cluster-render), au-dessus de la carte Waze, de Cluster Centre et de Cluster Info ; la demande de fenêtre porte
 * priority « camera », que RideTube lit (video_app.js _cameraOn) pour retirer son image ; et la carte Waze du CLUSTER est éteinte tant que
 * la caméra est voulue (shared/waze_yield.js : l'autoradio ne tient que 2 vidéos, Waze en prend déjà deux), puis rallumée.
 *
 * Tout ce qui est extérieur (l'horloge, les fichiers, cluster-render) passe par `deps` : tools/test_park.js la pilote sans voiture.
 * Node 8. MIT.
 */
const fs = require('fs');
const path = require('path');
const vb = require('./video_bridge');
const { ParkLogic } = require('./park');
const { DemoFeed } = require('./park_demo');
const pf = require('./park_frame');

const REQUEST_PATH = process.env.SHAKPARK_REQUEST || '/dev/shm/shakpark-capture/request.json';
const REQUEST_MS = 500;       // la demande est renouvelée à ce rythme : l'outil la tient pour périmée après 2 s
const FRONT_PATH = process.env.SHAKPARK_FRONT || '/dev/shm/shakpark-front';
const REAR_PATH = process.env.SHAKPARK_REAR || '/dev/shm/shakpark-rear';
const THEMES_DIR = process.env.CLUSTER_THEMES_DIR || '/dev/shm/cluster-themes';
const FRESH_MS = 3000;          // themes.json plus vieux que ça : l'appli qui l'écrivait n'est plus là
const LIVE_MS = 1500;           // aucune nouvelle image depuis ce temps : la caméra ne donne plus rien, on cache
const FRAME_MS = 66;            // 15 images par seconde au plus
const ASK_MS = 500;
const MAX_W = 640;              // la plus large image envoyée (coût du transfert)
const INSET = 6;                // px gardés libres au bord de la fenêtre

class Feed {
    constructor(file) { this.file = file; this.fd = null; this.fdAt = 0; this.seq = null; this.seqAt = 0; this.head = null; this.src = null; }

    close() { if (this.fd !== null) { try { fs.closeSync(this.fd); } catch (e) { /* parti */ } this.fd = null; } }

    /** La dernière image entière quand il y en a une nouvelle (la première après l'ouverture ne compte pas : c'est un reste). */
    read(now) {
        if (this.fd === null && now - this.fdAt >= 1000) {
            this.fdAt = now;
            try { this.fd = fs.openSync(this.file, 'r'); } catch (e) { this.fd = null; }
        }
        if (this.fd === null) return null;
        const r = vb.readFrame(this.fd, this.src, this.seq === null ? undefined : this.seq);
        if (!r) { this.close(); this.seq = null; return null; }
        this.head = r.head;
        if (!r.frame) return null;
        const first = this.seq === null;
        this.seq = r.head.seq; this.src = r.frame;
        if (first) return null;
        this.seqAt = now;
        return r.frame;
    }

    live(now) { return this.seq !== null && this.seqAt > 0 && now - this.seqAt < LIVE_MS; }

    forget() { this.close(); this.seq = null; this.seqAt = 0; this.head = null; this.src = null; }
}

class ParkApp {
    /**
     * deps: { id, log, now(), setting(key), makeRender(target) -> { video, set, drop, frame, connect, close }, frontPath, rearPath, themesDir,
     * waze: { want(bool) } (WazeYield, facultatif) }.
     * Le rapport et la vitesse arrivent par gear(stage) et speed(kmh).
     */
    constructor(deps) {
        this.d = deps;
        this.id = deps.id || 'shakpark';
        this.now = deps.now || Date.now;
        this.themesDir = deps.themesDir || THEMES_DIR;
        this.requestPath = deps.requestPath || REQUEST_PATH;
        this.reqAt = 0; this.reqCam = null;
        this.logic = new ParkLogic();
        this.feeds = { front: new Feed(deps.frontPath || FRONT_PATH), rear: new Feed(deps.rearPath || REAR_PATH) };
        this.demos = { front: new DemoFeed('front'), rear: new DemoFeed('rear') };      // le mode essai : une image de test à la place de la caméra
        this.t = { cr: null, ref: 0, rect: null, atlas: null, sentAt: 0, shown: false, lastCam: null };
        this.askAt = 0; this.asking = false;
        this.timer = null;
        this.state = { view: 'off', panel: 'off', live: false };
    }

    gear(stage) { this.logic.gear(stage, this.now()); }
    speed(kmh) { this.logic.speed(kmh, this.now()); }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { this._hide(); this._ask(false); if (this.d.log) this.d.log.error('park: ' + (e && e.stack || e)); } }, 33);
    }

    stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        this._hide(); this._ask(false); this._request('off', true);
        if (this.t.cr) { try { this.t.cr.close(); } catch (e) { /* fermeture */ } this.t.cr = null; }
        this.feeds.front.close(); this.feeds.rear.close();
    }

    _json(name) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(this.themesDir, name), 'utf8'));
            return j && typeof j.at === 'number' && Math.abs(this.now() - j.at) < FRESH_MS ? j : null;
        } catch (e) { return null; }
    }

    _ask(want) {
        const f = path.join(this.themesDir, 'window-' + this.id + '.json');
        if (!want) {
            if (this.asking) { this.asking = false; try { fs.unlinkSync(f); } catch (e) { /* parti */ } }
            return;
        }
        const t = this.now();
        if (this.asking && t - this.askAt < ASK_MS) return;
        this.askAt = t;
        try {
            try { fs.mkdirSync(this.themesDir); } catch (e) { /* déjà là */ }
            fs.writeFileSync(f + '.tmp', JSON.stringify({ t, app: 'ShakPark', kind: 'camera', priority: 'camera', showing: true }), { mode: 0o644 });
            fs.renameSync(f + '.tmp', f);
            this.asking = true;
        } catch (e) { /* pas de dossier : pas de thème à qui demander */ }
    }

    _room() {
        const th = this._json('themes.json');
        return th && th.window && th.open === true ? th.window : null;
    }

    _hide() {
        const t = this.t;
        if (t.shown && t.cr && t.ref) { try { t.cr.set(t.ref, { visible: false }); } catch (e) { /* parti */ } }
        t.shown = false;
        this.state.panel = 'off';
    }

    _draw(feed, frame) {
        const t = this.t, now = this.now();
        const raw = this._room();
        const room = raw ? { x: raw.x + INSET, y: raw.y + INSET, w: raw.w - 2 * INSET, h: raw.h - 2 * INSET } : null;
        // la couche couvre TOUTE la fenêtre ; l'image y est centrée avec des bandes noires, ou remplit la fenêtre (park_frame.js)
        const rect = room && feed.head ? pf.layerRect(room, MAX_W) : null;
        const mode = this.d.setting('fillWindow') === true ? 'fill' : 'bars';
        if (!rect) { this._hide(); return 'no room'; }
        if (!t.cr) { t.cr = this.d.makeRender('panel'); t.cr.connect(); }
        let force = false;
        if (!t.rect || ['x', 'y', 'w', 'h'].some((k) => t.rect[k] !== rect[k])) {
            if (t.ref) { try { t.cr.drop(t.ref); } catch (e) { /* parti */ } }
            t.ref = t.cr.video({ target: 'panel', klass: 'alert', z: 1000, x: rect.x, y: rect.y, w: rect.w, h: rect.h, vw: rect.w, vh: rect.h, visible: false });
            t.rect = rect; t.shown = false; t.atlas = null; force = true;
        }
        if (!t.ref) return 'refused';
        if (t.mode !== mode) { t.mode = mode; force = true; }
        if ((frame || force) && feed.src && now - t.sentAt >= FRAME_MS) {
            t.atlas = pf.compose(feed.src, feed.head.w, feed.head.h, rect.w, rect.h, mode, t.atlas);
            if (t.cr.frame(t.ref, t.atlas, feed.seq)) {
                t.sentAt = now;
                if (!t.shown) { t.cr.set(t.ref, { visible: true }); t.shown = true; }
            }
        }
        return t.shown ? 'shown' : 'waiting';
    }

    /** Dit à l'outil de capture (service root) quelle caméra il doit décoder : 'front', 'rear' ou 'off'. Jamais bloquant, jamais une erreur. */
    _request(cam, force) {
        const now = this.now();
        if (!force && cam === this.reqCam && now - this.reqAt < REQUEST_MS) return;
        this.reqCam = cam; this.reqAt = now;
        try {
            fs.writeFileSync(this.requestPath + '.tmp', JSON.stringify({ t: now, cam }), { mode: 0o644 });
            fs.renameSync(this.requestPath + '.tmp', this.requestPath);
        } catch (e) { /* le dossier n'existe pas tant que l'outil n'est pas installé : rien à faire */ }
    }

    tick() {
        const now = this.now();
        // LA PORTE D'ABORD : ParkLogic dit quelle caméra, ou aucune. Rien n'est lu ni dessiné avant.
        const view = this.logic.view(now, { front: this.d.setting('frontCam') === true, rear: this.d.setting('rearCam') === true });
        this.state.view = view;
        this._request(this.d.setting('demo') === true ? 'off' : view);      // l'outil de capture n'ouvre que la caméra voulue (rien en mode essai)
        if (this.d.waze) this.d.waze.want(view !== 'off');      // la carte Waze du cluster cède sa place vidéo tant que la caméra est voulue
        if (view === 'off') {
            this._hide(); this._ask(false); this.state.live = false;
            this.feeds.front.forget(); this.feeds.rear.forget(); this.demos.front.forget(); this.demos.rear.forget();      // pas de fichier gardé ouvert, pas d'image d'hier au prochain départ
            this.t.lastCam = null;
            return;
        }
        const demo = this.d.setting('demo') === true;
        const other = view === 'front' ? this.feeds.rear : this.feeds.front;
        other.forget();
        (view === 'front' ? this.demos.rear : this.demos.front).forget();
        if (this.t.lastCam !== view) { this._hide(); this.t.lastCam = view; }    // changement de caméra : on repart d'une fenêtre vide
        const feed = demo ? this.demos[view] : this.feeds[view];      // mode essai : l'image de test, mêmes règles
        const frame = feed.read(now);
        this.state.live = feed.live(now);
        if (!this.state.live) { this._hide(); this._ask(false); return; }
        this._ask(true);
        this.state.panel = this._draw(feed, frame);
    }
}

module.exports = { ParkApp, FRONT_PATH, REAR_PATH, FRAME_MS, LIVE_MS, MAX_W };
