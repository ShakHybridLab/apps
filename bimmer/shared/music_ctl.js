'use strict';
/**
 * Shak Musique : le client du service de RideTube (jap-ridetube-d) et le modèle de lecture (file d'attente, suivant, précédent).
 *
 * Le service (Store, GPL, ridetube/service) fait tout le réseau de la voiture et envoie le son dans le lecteur multimédia de la voiture :
 * cette appli ne fait que lui parler sur son socket, des lignes JSON (le protocole est décrit en tête de ridetube/apps/jap_ridetube/yt.js).
 * Rien du code de RideTube n'est repris ici : ce fichier est écrit à neuf, comme le reste de shared/ (MIT).
 *
 * Ce que le service garde : rien. Il efface chaque morceau une fois joué (réglage keep: 0 dans ytd.js) ; cette appli n'écrit pas de son.
 *
 *   Ctl     le socket : reconnexion, une seule appli à la fois (le service remplace l'ancien client par le nouveau).
 *   Player  ce que l'écran montre : résultats, pochettes, file d'attente, état, temps ; les commandes que les boutons envoient.
 *   splitTrack / pickBest / musicQuery   du texte de YouTube à « artiste, titre », et le bon résultat parmi ceux d'une recherche.
 *
 * Written for ShakTheme (MIT, as the rest of shared/).
 */
const net = require('net');

const SOCKET = '/run/jap-ridetube-d/ctl.sock';
const MAX_LINE = 1 << 20;            // une pochette 320x180 fait 307 ko en base64
const RECT = '320x180';              // la taille d'image demandée au service (le son seul est joué : la vidéo est coupée)
const QUALITY = 360;                 // la plus basse que le service accepte (360, 480 ou 720)
const THUMB_SIZES = ['160x90', '320x180'];
const MAX_RESULTS = 20;
const SKIP_ERRORS = 3;               // morceaux illisibles de suite avant d'arrêter la file
const ACTIVE = ['preparing', 'playing', 'paused'];

/** 83000 -> "1:23", 3723000 -> "1:02:03" */
function clock(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
    const p = (n) => (n < 10 ? '0' : '') + n;
    return h ? h + ':' + p(m) + ':' + p(ss) : m + ':' + p(ss);
}

/** "Élise Atelier" -> "elise atelier" : ce qu'une comparaison de noms regarde. */
function fold(t) {
    let s = String(t || '');
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* un Node sans ICU : accents gardés */ }
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Le texte d'un titre de YouTube sans ses étiquettes ("(Official Video)", "[HD]", "Lyrics"...). */
function stripTags(t) {
    return String(t || '')
        .replace(/[([](?:[^)\]]*?(?:official|audio|video|lyric|clip|hd|4k|visuali[sz]er|remaster|explicit|paroles|version)[^)\]]*?)[)\]]/gi, ' ')
        .replace(/\s+(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|clip(?:\s+officiel)?)\s*$/i, '')
        .replace(/\s{2,}/g, ' ').trim();
}

/**
 * Artiste et titre d'un résultat de YouTube : « Artiste - Topic » + « Titre » (les pistes de YouTube Music), ou « Artiste - Titre » dans le titre,
 * sinon le titre entier et la chaîne.
 */
function splitTrack(title, channel) {
    const ch = String(channel || '').trim(), t = stripTags(title);
    const topic = /^(.*?)\s*-\s*topic$/i.exec(ch);
    if (topic) return { artist: topic[1].trim(), title: t };
    const m = /^(.{1,60}?)\s+[-–—]\s+(.{1,120})$/.exec(t);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    return { artist: ch.replace(/\s*VEVO$/i, '').trim(), title: t };
}

/** Ce qu'on tape dans la recherche pour retrouver un morceau (« artiste titre »). */
function musicQuery(artist, title) {
    return [artist, title].map((x) => String(x || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/**
 * Le meilleur résultat d'une recherche pour un morceau voulu { artist, title, duration_s } : la piste « Topic » ou le son officiel, la bonne durée,
 * pas de live, de reprise, de version accélérée ni de clip de cinq minutes de plus. null si rien ne ressemble (aucun mot du titre).
 */
function pickBest(items, want) {
    const wt = fold(want.title), wa = fold(want.artist), words = wt.split(' ').filter((w) => w.length > 1);
    let best = null, bestScore = 0;
    (items || []).forEach((r, k) => {
        if (!r || typeof r.id !== 'string') return;
        const rt = fold(r.title), rc = fold(r.channel);
        const hit = words.filter((w) => rt.indexOf(w) >= 0).length;
        if (!words.length || hit < Math.ceil(words.length * 0.7)) return;      // ce n'est pas ce morceau
        let s = 10 + 4 * hit / words.length - k * 0.15;
        if (/-\s*topic$/i.test(String(r.channel || ''))) s += 5;               // la piste de YouTube Music : le son du disque
        if (wa && (rc.indexOf(wa) >= 0 || rt.indexOf(wa) >= 0)) s += 4;
        if (/\b(official audio|audio officiel|provided to youtube)\b/.test(rt)) s += 1;
        // une version qu'on n'a pas demandée : « live », reprise, accélérée... (sauf si le titre voulu la nomme déjà)
        (rt.match(/\b(live|concert|cover|reprise|karaoke|remix|sped up|slowed|nightcore|reverb|8d|instrumental|reaction|tutorial|lesson)\b/g) || [])
            .forEach((w) => { if (wt.indexOf(w) < 0) s -= 6; });
        if (want.duration_s > 0 && r.duration_s > 0) {
            const d = Math.abs(r.duration_s - want.duration_s);
            s += d <= 4 ? 4 : d <= 12 ? 2 : d > 60 ? -5 : d > 30 ? -2 : 0;
        }
        if (s > bestScore) { bestScore = s; best = r; }
    });
    return best;
}

/** Le socket du service : des lignes JSON, une reconnexion (plus lente si le service nous a remplacés par une autre appli). */
class Ctl {
    constructor(path, log, io) {
        this.path = path || SOCKET;
        this.log = log || { info() {}, warn() {}, error() {} };
        this.net = io || net;
        this.sock = null; this.up = false; this.buf = ''; this.closed = false; this.retry = null;
        this.attempts = 0; this.connectedAt = 0; this.yielded = false; this.errLogged = false; this.yieldAfterMs = 5000;
        this.handlers = { msg: [], up: [], down: [] };
    }
    on(ev, fn) { this.handlers[ev].push(fn); return this; }
    _emit(ev, a) { this.handlers[ev].forEach((fn) => { try { fn(a); } catch (e) { this.log.error('music ' + ev, e); } }); }
    /** Se connecter (tout de suite, même si on avait cédé la place : l'écran vient de s'ouvrir ou on veut jouer). */
    connect() {
        if (this.closed || this.sock) return this;
        clearTimeout(this.retry); this.retry = null; this.yielded = false;
        const s = this.sock = this.net.createConnection(this.path);
        s.setEncoding('utf8');
        s.on('connect', () => { this.up = true; this.buf = ''; this.connectedAt = Date.now(); this.attempts = 0; this.errLogged = false; this.log.info('music: connecté au service'); this._emit('up'); });
        s.on('data', (d) => this._data(d));
        s.on('error', (e) => { if (!this.errLogged) { this.errLogged = true; this.log.warn('music: ' + e.message); } });
        s.on('close', () => {
            const was = this.up, held = Date.now() - this.connectedAt;
            this.up = false; this.sock = null;
            if (was) { this.log.warn('music: connexion fermée'); this._emit('down'); }
            if (this.closed) return;
            // fermée par le service après un bon moment : une autre appli (RideTube) l'a prise. On ne se bat pas pour la reprendre.
            if (was && held > this.yieldAfterMs) { this.yielded = true; this.log.warn('music: le service parle à une autre appli, on attend'); return; }
            this.retry = setTimeout(() => { this.retry = null; this.connect(); }, Math.min(30000, 2000 * Math.pow(2, Math.min(this.attempts++, 4))));
        });
        return this;
    }
    _data(d) {
        this.buf += d;
        if (this.buf.length > MAX_LINE && this.buf.indexOf('\n') < 0) { this.log.warn('music: ligne trop longue, jetée'); this.buf = ''; return; }
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i);
            this.buf = this.buf.slice(i + 1);
            if (!line.trim()) continue;
            let m;
            try { m = JSON.parse(line); } catch (e) { this.log.warn('music: ligne illisible'); continue; }
            if (m && typeof m.ev === 'string') this._emit('msg', m);
        }
    }
    /** false si on n'est pas connecté (la commande est perdue : l'écran dit que le service manque). */
    send(obj) {
        if (!this.up || !this.sock) return false;
        this.sock.write(JSON.stringify(obj) + '\n');
        return true;
    }
    close() {
        this.closed = true; clearTimeout(this.retry);
        if (this.sock) this.sock.destroy();
    }
}

/** Un résultat du service en morceau { id, title, artist, channel, duration_s }. */
function toTrack(r) {
    const sp = splitTrack(r.title, r.channel);
    return { id: r.id, title: sp.title || String(r.title || ''), artist: sp.artist, channel: String(r.channel || ''), duration_s: Number(r.duration_s) > 0 ? Number(r.duration_s) : 0 };
}
const valid = (items, n) => (Array.isArray(items) ? items : []).filter((r) => r && typeof r.id === 'string' && /^[\w-]{6,20}$/.test(r.id)).slice(0, n || MAX_RESULTS);

/** Ce que l'écran montre, d'après les messages du service ; les commandes que les boutons envoient. Sans écran ni minuterie : testable. */
class Player {
    /** send(obj) : Ctl.send ; now() : l'heure (injectable) */
    constructor(send, now) {
        this.send = send; this.now = now || Date.now;
        this.connected = false;
        this.q = null; this.searching = false; this.searchError = null; this.searchT = 0;
        this.results = [];
        this.thumbs = {}; this.pending = new Set();
        this.state = 'idle'; this.pct = 0; this.cur = null; this.elapsed = 0; this.total = 0; this.error = null; this.retrying = 0;
        this.queue = []; this.index = -1;
        this.failed = 0;                     // morceaux illisibles de suite
        this.videoOff = false;
        this.rev = 0;                        // augmente à chaque changement que l'écran montre
        this.onTrack = null;                 // fn(track) : un morceau commence à jouer (la liste des récents)
    }
    _changed() { this.rev++; }
    active() { return ACTIVE.indexOf(this.state) >= 0; }

    setConnected(on) {
        this.connected = on;
        if (on) { this.videoOff = false; this.send({ cmd: 'status' }); this._noVideo(); } else {
            this.searching = false; this.state = 'idle'; this.pending.clear();
        }
        this._changed();
    }
    /** Le son seul : on dit au service de ne pas décoder l'image (il la décode par défaut au début de chaque morceau). */
    _noVideo() { if (this.connected && !this.videoOff && this.send({ cmd: 'video', on: false })) this.videoOff = true; }

    onMsg(m) {
        if (m.ev === 'results') {
            if (this.q !== null && m.q !== undefined && m.q !== this.q) return;       // la réponse d'une recherche plus ancienne
            this.searching = false; this.searchError = null;
            this.results = valid(m.items).map(toTrack);
            this._prune();
        } else if (m.ev === 'thumb') {
            if (typeof m.rgba !== 'string' || !this._known(m.id)) return;
            const w = m.w === undefined ? 160 : m.w, h = m.h === undefined ? 90 : m.h, buf = Buffer.from(m.rgba, 'base64');
            if (THUMB_SIZES.indexOf(w + 'x' + h) < 0 || buf.length !== w * h * 4) return;
            this.pending.delete(m.id);
            this.thumbs[m.id] = { w, h, buf };
        } else if (m.ev === 'state') {
            const was = this.state;
            this.state = String(m.state || 'idle');
            if (typeof m.pct === 'number') this.pct = m.pct;
            if (m.id && (!this.cur || this.cur.id !== m.id)) {                         // un autre morceau que celui demandé (le service reprend un morceau après un redémarrage de l'appli)
                const r = this.item(m.id);
                this.cur = r || toTrack({ id: m.id, title: m.title || m.id, channel: '' });
            } else if (m.title && this.cur && m.title !== this.cur.id && (!this.cur.title || this.cur.title === this.cur.id)) {
                this.cur.title = splitTrack(m.title, this.cur.channel).title;
            }
            if (this.state !== 'error') this.error = null;
            if (this.state !== 'preparing') this.retrying = 0;
            if (this.state === 'idle' || (was !== 'preparing' && this.state === 'preparing')) { this.elapsed = 0; this.total = 0; }
            if (this.state === 'playing' && was !== 'playing' && was !== 'paused') {
                this.videoOff = false; this._noVideo(); this.failed = 0;
                if (this.onTrack && this.cur) { try { this.onTrack(this.cur); } catch (e) { /* la liste des récents est un confort */ } }
            }
            if (this.state === 'ended' && was !== 'ended') this._advance(true);
        } else if (m.ev === 'time') {
            if (typeof m.elapsed === 'number') this.elapsed = m.elapsed;
            if (typeof m.total === 'number') this.total = m.total;
        } else if (m.ev === 'retry') {
            if (this.cur && m.id === this.cur.id) this.retrying = Number(m.n) || 1;
        } else if (m.ev === 'error') {
            this.error = String(m.msg || 'erreur');
            if (this.searching) { this.searching = false; this.searchError = this.error; }
        } else return;
        if (this.state === 'error') this._failed();
        this._changed();
    }

    /** Le morceau est illisible (retiré, privé, pays) : le suivant ; après SKIP_ERRORS de suite on s'arrête sur l'erreur. */
    _failed() {
        if (this._failedFor === (this.cur && this.cur.id)) return;
        this._failedFor = this.cur && this.cur.id;
        this.failed++;
        if (this.failed < SKIP_ERRORS && this.index >= 0 && this.index + 1 < this.queue.length) this.playAt(this.index + 1);
    }
    _advance(auto) {
        if (this.index >= 0 && this.index + 1 < this.queue.length) this.playAt(this.index + 1);
        else if (auto) { this.index = -1; }
    }

    /* ---- la file d'attente */
    _items() { return this.results.concat(this.queue, this.cur ? [this.cur] : []); }
    _known(id) { return this._items().some((r) => r.id === id); }
    item(id) { return this._items().find((r) => r.id === id) || null; }
    _prune() {
        const ids = new Set(this._items().map((r) => r.id));
        Object.keys(this.thumbs).forEach((id) => { if (!ids.has(id)) delete this.thumbs[id]; });
        this.pending.forEach((id) => { if (!ids.has(id)) this.pending.delete(id); });
    }
    /** La pochette d'un morceau qu'un écran dessine : demandée une fois ; vrai si demandée maintenant. */
    wantThumb(id) {
        if (this.thumbs[id] || this.pending.has(id) || !this.connected || !this._known(id)) return false;
        if (!this.send({ cmd: 'thumb', id })) return false;
        this.pending.add(id);
        return true;
    }
    /** Jouer la liste `tracks` à partir du rang i : la file devient cette liste. */
    playList(tracks, i) {
        const list = (tracks || []).filter((t) => t && t.id);
        if (!list.length) return false;
        this.queue = list.slice(); this.failed = 0; this._failedFor = null;
        return this.playAt(Math.max(0, Math.min(list.length - 1, i | 0)));
    }
    playAt(i) {
        const t = this.queue[i];
        if (!t) return false;
        this.index = i; this.cur = t; this.state = 'preparing'; this.pct = 0; this.elapsed = 0; this.total = 0; this.error = null; this.retrying = 0;
        this._changed();
        return this.send({ cmd: 'play', id: t.id, rect: RECT, fill: false, quality: QUALITY });
    }
    next() { return this.index + 1 < this.queue.length ? this.playAt(this.index + 1) : false; }
    /** Précédent : au début du morceau (moins de 4 s) le précédent de la file, sinon le même morceau depuis le début. */
    prev() {
        if (this.index < 0) return false;
        if (this.elapsed > 4000 || this.index === 0) return this.seek(0);
        return this.playAt(this.index - 1);
    }
    toggle() {
        if (this.state === 'playing') return this.send({ cmd: 'pause' });
        if (this.state === 'paused') return this.send({ cmd: 'resume' });
        if (this.state === 'ended' || this.state === 'idle' || this.state === 'error') return this.index >= 0 ? this.playAt(this.index) : false;
        return false;
    }
    /** Aller à ms (dans le morceau). */
    seek(ms) {
        if (this.state !== 'playing' && this.state !== 'paused') return false;
        ms = Math.max(0, Math.round(ms));
        if (this.total > 0) ms = Math.min(ms, Math.max(0, this.total - 1000));
        this.elapsed = ms; this._changed();
        return this.send({ cmd: 'seek', ms });
    }
    seekBy(delta) { return this.seek(this.elapsed + delta); }
    stop() { this.queue = []; this.index = -1; return this.active() ? this.send({ cmd: 'stop' }) : false; }

    /* ---- la recherche */
    search(q) {
        q = String(q || '').trim();
        if (!q) return false;
        this.q = q; this.searching = true; this.searchError = null; this.searchT = this.now();
        this._changed();
        if (this.send({ cmd: 'search', q })) return true;
        this.searching = false; this.searchError = 'Le service de RideTube (jap-ridetube-d) ne tourne pas';
        return false;
    }
    /** Une recherche sans réponse après ms : une erreur, jamais un écran qui attend sans fin. */
    checkSearch(ms) {
        if (!this.searching || this.now() - this.searchT < ms) return false;
        this.searching = false; this.searchError = 'Pas de réponse du service de RideTube';
        this._changed();
        return true;
    }
}

module.exports = { Ctl, Player, SOCKET, RECT, QUALITY, SKIP_ERRORS, clock, fold, stripTags, splitTrack, musicQuery, pickBest, toTrack };
