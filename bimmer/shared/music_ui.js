'use strict';
/**
 * Shak Musique : l'écran (lecture, résultats, récents), la saisie de la recherche et le branchement sur le service de RideTube.
 * La logique (socket, file d'attente, choix du bon résultat) est dans shared/music_ctl.js ; ici on dessine et on relie.
 *
 *   require('./music_ui').start(ctx)      ctx : le contexte du kit (mgu.run start())
 *
 * La saisie ouvre le clavier plein écran de la voiture (le « use case » du HMI, comme le fait l'appli de RideTube) : écrit ici à neuf d'après
 * les faits (identifiant du use case, numéros des paramètres), sans reprendre le code de RideTube (GPL).
 *
 * Written for ShakTheme (MIT, as the rest of shared/).
 */
const fs = require('fs');
const path = require('path');
const M = require('./music_ctl');

const W = 1600, H = 520;
const BG = '#090c12', PANEL = '#121824', LINE = '#26303f', TEXT = '#ffffff', DIM = '#91a0b4', ACCENT = '#1db7ff', GOOD = '#7fd4a0', BAD = '#ff6b6b', WARN = '#ffd166';
const ROW_H = 66, ROWS = 6, LIST_Y = 92;
const RECENTS_MAX = 30;
const IMG_BASE = 0x4d550000;       // 'MU' + n : nos images de pochette, loin de celles du kit
const IMG_MAX = 24;
const SEARCH_TIMEOUT_MS = 25000;

/* ---------------------------------------------------------------- le clavier plein écran de la voiture */
const SPELLER_USE_CASE = '02076b22-d19b-4aef-9e8c-0d7305d8b88c';
const P_TITLE = 4, P_TEXT = 102, P_OK = 105;
const FINAL_STATES = ['ABORTED', 'FAILED', 'COMPLETED'];

/** Ouvre le clavier ; résout avec le texte, ou null si on le quitte sans OK. */
function spell(app, title) {
    const within = (p, ms, what) => new Promise((ok, ko) => {
        const t = setTimeout(() => ko(new Error(what + ' : pas de réponse')), ms);
        Promise.resolve(p).then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); ko(e); });
    });
    return new Promise((resolve, reject) => {
        let uc = null, subId = null, typed = '', over = false;
        const end = (err, value) => {
            if (over) return;
            over = true;
            Promise.resolve().then(() => (uc && subId !== null ? uc.proxy.notify.unsubscribe(subId) : null)).catch(() => {})
                .then(() => (err ? reject(err) : resolve(value)));
        };
        const onNotify = (n) => {
            const p = n && n.interactionParameters;               // une Map, pas toujours celle de ce contexte
            const has = (k) => !!p && typeof p.has === 'function' && p.has(k);
            if (has(P_TEXT)) typed = String(p.get(P_TEXT));
            if (has(P_OK)) end(null, typed);
            else if (n && FINAL_STATES.indexOf(n.interactionState) >= 0) end(null, null);
        };
        within(app.getUseCaseFactory(), 10000, 'clavier')
            .then((factory) => factory.create(SPELLER_USE_CASE))
            .then((u) => { uc = u; return uc.proxy.init(); })
            .then(() => uc.proxy.waitUntilAvailable())
            .then(() => uc.proxy.notify.subscribe(onNotify))
            .then((id) => {
                subId = id === undefined ? null : id;
                return uc.proxy.interactionState.getValue();
            })
            .then((st) => {
                if (over) return null;
                if (st !== 'READY') throw new Error('clavier ' + st + ', pas READY');
                return uc.proxy.start({ token: uc.token, startParameters: new Map([[P_TITLE, String(title).slice(0, 22)]]) });
            })
            .catch((e) => end(e));
    });
}

/* ---------------------------------------------------------------- les récents (gardés dans le dossier de données de l'appli) */
class Recents {
    constructor(file) { this.file = file || null; this.items = []; }
    load() {
        try {
            const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            this.items = (Array.isArray(j) ? j : []).filter((t) => t && typeof t.id === 'string').slice(0, RECENTS_MAX)
                .map((t) => ({ id: t.id, title: String(t.title || ''), artist: String(t.artist || ''), channel: String(t.channel || ''), duration_s: Number(t.duration_s) || 0 }));
        } catch (e) { this.items = []; }
        return this;
    }
    add(t) {
        this.items = [{ id: t.id, title: t.title, artist: t.artist, channel: t.channel || '', duration_s: t.duration_s || 0 }]
            .concat(this.items.filter((x) => x.id !== t.id)).slice(0, RECENTS_MAX);
        this.save();
    }
    clear() { this.items = []; this.save(); }
    save() {
        if (!this.file) return;
        try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.items)); fs.renameSync(tmp, this.file); } catch (e) { /* dossier en lecture seule : la liste reste en mémoire */ }
    }
}

/* ---------------------------------------------------------------- les pochettes : une image carrée, au centre de la vignette 16:9 */
function centreSquare(t) {
    const s = t.h, x0 = Math.floor((t.w - s) / 2), out = Buffer.alloc(s * s * 4);
    for (let y = 0; y < s; y++) t.buf.copy(out, y * s * 4, (y * t.w + x0) * 4, (y * t.w + x0 + s) * 4);
    return { w: s, h: s, buf: out };
}
class Art {
    constructor(rec) { this.rec = rec; this.map = new Map(); this.next = 0; }
    /** { id, w } de l'image du morceau, ou null (pas encore de pochette). */
    get(trackId, thumb) {
        if (!thumb) return null;
        let e = this.map.get(trackId);
        if (e && e.thumb === thumb) { this.map.delete(trackId); this.map.set(trackId, e); return e; }
        const sq = centreSquare(thumb), id = e ? e.id : IMG_BASE + (this.next++ % 4096);
        if (this.rec) this.rec.setImage(id, sq.w, sq.h, sq.buf);
        e = { id, w: sq.w, thumb };
        this.map.delete(trackId); this.map.set(trackId, e);
        while (this.map.size > IMG_MAX) this.map.delete(this.map.keys().next().value);
        return e;
    }
}

/* ---------------------------------------------------------------- le dessin */
function fit(cv, s, maxW, size, opts) {
    s = String(s || '');
    if (cv.textWidth(s, size, opts) <= maxW) return s;
    while (s.length > 1 && cv.textWidth(s + '…', size, opts) > maxW) s = s.slice(0, -1);
    return s + '…';
}
function tri(cv, a, b, c, col) {
    if (cv.triangle) return cv.triangle([a, b, c], col);
    return cv.quad([a, b, c, c], col);
}
function button(cv, x, y, w, h, label, active, run, key) {
    cv.roundRect(x, y, w, h, 10, active ? ACCENT : '#ffffff1c');
    const tw = cv.textWidth(label, 18, { font: 'bold' });
    cv.text(label, x + (w - tw) / 2, y + h / 2 + 6, 18, active ? '#04131c' : '#dce4ef', { font: 'bold' });
    if (run) cv.target(x, y, w, h, run, key, 10);
}
function icon(cv, kind, cx, cy, s, col) {
    const h = s / 2;
    if (kind === 'play') tri(cv, [cx - h * 0.7, cy - h], [cx + h, cy], [cx - h * 0.7, cy + h], col);
    else if (kind === 'pause') { cv.roundRect(cx - h * 0.75, cy - h, h * 0.55, s, 3, col); cv.roundRect(cx + h * 0.2, cy - h, h * 0.55, s, 3, col); }
    else if (kind === 'next') { tri(cv, [cx - h, cy - h], [cx + h * 0.5, cy], [cx - h, cy + h], col); cv.roundRect(cx + h * 0.6, cy - h, h * 0.4, s, 2, col); }
    else if (kind === 'prev') { tri(cv, [cx + h, cy - h], [cx - h * 0.5, cy], [cx + h, cy + h], col); cv.roundRect(cx - h, cy - h, h * 0.4, s, 2, col); }
    else if (kind === 'back') { tri(cv, [cx, cy - h], [cx - h, cy], [cx, cy + h], col); tri(cv, [cx + h, cy - h], [cx, cy], [cx + h, cy + h], col); }
    else if (kind === 'fwd') { tri(cv, [cx, cy - h], [cx + h, cy], [cx, cy + h], col); tri(cv, [cx - h, cy - h], [cx, cy], [cx - h, cy + h], col); }
    else if (kind === 'up') tri(cv, [cx - h, cy + h * 0.6], [cx + h, cy + h * 0.6], [cx, cy - h * 0.7], col);
    else if (kind === 'down') tri(cv, [cx - h, cy - h * 0.6], [cx + h, cy - h * 0.6], [cx, cy + h * 0.7], col);
}

/** L'écran, d'après l'état (pur : le dessin ne touche à rien, il rend la liste des gestes). */
class Screen {
    /** actions : { search(), play(list, i), toggle(), prev(), next(), seekBy(ms), seekTo(frac), recentsClear() } */
    constructor(player, recents, art, actions, now) {
        this.p = player; this.recents = recents; this.art = art; this.act = actions; this.now = now || Date.now;
        this.view = 'now';            // now | results | recents
        this.top = { results: 0, recents: 0 };
    }
    list() { return this.view === 'results' ? this.p.results : this.recents.items; }
    show(v) { this.view = v; this.p.rev++; }
    /** Une signature de ce qui est à l'écran : si elle ne change pas, on ne redessine pas. */
    signature() {
        const p = this.p;
        return [p.rev, this.view, this.top.results, this.top.recents, Math.floor(p.elapsed / 1000), this.recents.items.length].join('|');
    }
    scroll(d) {
        const n = this.list().length, v = this.view;
        if (v === 'now') return;
        this.top[v] = Math.max(0, Math.min(Math.max(0, n - ROWS), this.top[v] + d));
        this.p.rev++;
    }
    draw(cv) {
        const p = this.p;
        cv.clear(BG);
        cv.text('SHAK MUSIQUE', 40, 52, 28, TEXT, { font: 'bold' });
        const tabs = [['now', 'Lecture'], ['results', 'Résultats'], ['recents', 'Récents']];
        tabs.forEach((t, k) => button(cv, 330 + k * 150, 22, 136, 44, t[1], this.view === t[0], () => this.show(t[0]), 'tab_' + t[0]));
        button(cv, 1400, 22, 160, 44, 'Chercher', false, () => this.act.search(), 'search');
        if (!p.connected) cv.text('Le service de RideTube ne répond pas : installe "RideTube service" depuis le Store, et ferme RideTube si elle est ouverte.', 40, 500, 15, BAD);
        if (this.view === 'now') this.drawNow(cv); else this.drawList(cv);
    }
    drawNow(cv) {
        const p = this.p, t = p.cur;
        const e = t ? this.art.get(t.id, p.thumbs[t.id]) : null;
        if (t && !e) p.wantThumb(t.id);
        const S = 300, x0 = 50, y0 = 112;
        cv.roundRect(x0, y0, S, S, 14, PANEL);
        if (e && cv.image) cv.image(e.id, x0, y0, S, S);
        else {                                           // une note, sans police (le symbole n'y est peut-être pas)
            const nx = x0 + S / 2, ny = y0 + S / 2;
            cv.circle(nx - 22, ny + 38, 22, LINE); cv.line(nx - 2, ny + 38, nx - 2, ny - 70, 9, LINE); cv.line(nx - 2, ny - 70, nx + 48, ny - 40, 9, LINE);
        }
        const tx = 400, tw = 1140;
        if (!t) {
            cv.text('Rien en lecture', tx, 190, 38, TEXT, { font: 'bold' });
            cv.text('Touche Chercher et tape un titre ou un artiste, ou ouvre Récents.', tx, 232, 20, DIM);
            return;
        }
        cv.text(fit(cv, t.title, tw, 38, { font: 'bold' }), tx, 170, 38, TEXT, { font: 'bold' });
        cv.text(fit(cv, t.artist || t.channel, tw, 24), tx, 208, 24, DIM);
        let st = '', col = DIM;
        if (p.state === 'preparing') { st = 'Préparation… ' + Math.round(p.pct || 0) + ' %' + (p.retrying ? ' · nouvel essai ' + p.retrying : ''); col = WARN; }
        else if (p.state === 'paused') { st = 'En pause'; col = WARN; }
        else if (p.state === 'error') { st = 'Illisible : ' + (p.error || 'erreur'); col = BAD; }
        else if (p.state === 'ended') st = 'Terminé';
        else if (p.state === 'playing') { st = 'En lecture'; col = GOOD; }
        cv.text(fit(cv, st + (p.queue.length > 1 ? '   ·   ' + (p.index + 1) + ' sur ' + p.queue.length : ''), tw, 18), tx, 246, 18, col);
        // la barre de progression : un appui dessus va à cet endroit du morceau
        const bx = tx, bw = tw, by = 296, frac = p.total > 0 ? Math.max(0, Math.min(1, p.elapsed / p.total)) : 0;
        cv.roundRect(bx, by, bw, 10, 5, LINE);
        if (frac > 0) cv.roundRect(bx, by, Math.max(10, bw * frac), 10, 5, ACCENT);
        cv.circle(bx + bw * frac, by + 5, 11, TEXT);
        // (pas de zone tactile ici : un appui sur la barre arrive par ctx.onTap, qui n'est appelé que là où aucune zone ne répond)
        this.bar = { x: bx, w: bw, y: by - 24, h: 58 };
        cv.text(M.clock(p.elapsed), bx, by + 40, 18, DIM);
        const tt = p.total > 0 ? M.clock(p.total) : t.duration_s ? M.clock(t.duration_s * 1000) : '';
        cv.text(tt, bx + bw - cv.textWidth(tt, 18), by + 40, 18, DIM);
        // les boutons : précédent, -10 s, lecture/pause, +10 s, suivant
        const cy = 392, cx = tx + tw / 2, play = p.state === 'playing' || (p.state === 'preparing');
        const btn = (dx, kind, size, r, run, key, hot) => {
            cv.circle(cx + dx, cy, r, hot ? ACCENT : '#ffffff1c');
            icon(cv, kind, cx + dx, cy, size, hot ? '#04131c' : TEXT);
            cv.target(cx + dx - r, cy - r, r * 2, r * 2, run, key, r);
        };
        btn(-300, 'prev', 28, 44, () => this.act.prev(), 'prev');
        btn(-170, 'back', 26, 40, () => this.act.seekBy(-10000), 'back');
        btn(0, play ? 'pause' : 'play', 40, 58, () => this.act.toggle(), 'toggle', true);
        btn(170, 'fwd', 26, 40, () => this.act.seekBy(10000), 'fwd');
        btn(300, 'next', 28, 44, () => this.act.next(), 'next');
        cv.text('-10 s', cx - 170 - 20, cy + 66, 14, DIM);
        cv.text('+10 s', cx + 170 - 20, cy + 66, 14, DIM);
    }
    drawList(cv) {
        const p = this.p, v = this.view, items = this.list(), top = this.top[v];
        const head = v === 'results'
            ? (p.searching ? 'Recherche de "' + p.q + '"…' : p.searchError ? p.searchError : p.q ? 'Résultats pour ' + p.q : 'Touche Chercher')
            : items.length ? 'Les derniers morceaux joués' : 'Rien de joué pour le moment';
        cv.text(fit(cv, head, 1100, 18), 40, 86, 18, p.searchError && v === 'results' ? BAD : DIM);
        if (v === 'recents' && items.length) button(cv, 1400, 66, 160, 30, 'Effacer', false, () => this.act.recentsClear(), 'clear');
        items.slice(top, top + ROWS).forEach((t, k) => {
            const y = LIST_Y + 14 + k * ROW_H, i = top + k, here = p.cur && p.cur.id === t.id;
            cv.roundRect(40, y, 1400, ROW_H - 8, 10, here ? '#1db7ff26' : PANEL);
            const e = this.art.get(t.id, p.thumbs[t.id]);
            if (e && cv.image) cv.image(e.id, 48, y + 4, ROW_H - 16, ROW_H - 16);
            else cv.roundRect(48, y + 4, ROW_H - 16, ROW_H - 16, 6, LINE);
            if (!e) p.wantThumb(t.id);
            cv.text(fit(cv, t.title, 1000, 22, { font: 'bold' }), 48 + ROW_H, y + 25, 22, here ? ACCENT : TEXT, { font: 'bold' });
            cv.text(fit(cv, t.artist || t.channel, 1000, 16), 48 + ROW_H, y + 46, 16, DIM);
            const d = t.duration_s ? M.clock(t.duration_s * 1000) : '';
            cv.text(d, 1420 - cv.textWidth(d, 18), y + 34, 18, DIM);
            cv.target(40, y, 1400, ROW_H - 8, () => this.act.play(items, i), 'row' + k, 10);
        });
        if (!items.length && !(v === 'results' && p.searching)) cv.text(v === 'results' ? 'Aucun résultat à montrer.' : 'Les morceaux que tu joues apparaîtront ici.', 48, 200, 20, DIM);
        const more = items.length > ROWS;
        if (more) {
            const up = top > 0, down = top + ROWS < items.length;
            cv.roundRect(1470, 130, 90, 90, 14, '#ffffff1c'); icon(cv, 'up', 1515, 175, 34, up ? TEXT : LINE);
            cv.roundRect(1470, 260, 90, 90, 14, '#ffffff1c'); icon(cv, 'down', 1515, 305, 34, down ? TEXT : LINE);
            cv.target(1470, 130, 90, 90, () => this.scroll(-ROWS), 'up', 14);
            cv.target(1470, 260, 90, 90, () => this.scroll(ROWS), 'down', 14);
            cv.text((top + 1) + '-' + Math.min(items.length, top + ROWS) + ' / ' + items.length, 1470, 376, 16, DIM);
        }
    }
}

/* ---------------------------------------------------------------- le branchement */
function start(ctx, opts) {
    opts = opts || {};
    const log = ctx.log;
    const recents = new Recents(ctx.dataDir ? path.join(ctx.dataDir, 'recents.json') : null).load();
    let rec = null;
    try { rec = require('./kit/record'); } catch (e) { rec = null; }
    const art = new Art(opts.rec !== undefined ? opts.rec : rec);
    const ctl = new M.Ctl(opts.socket, log, opts.net);
    const player = new M.Player((o) => ctl.send(o));
    player.onTrack = (t) => { recents.add(t); };
    let loop = null, speaking = false;
    const kick = () => { try { if (loop && loop.kick) loop.kick(); } catch (e) { /* au prochain tour */ } };
    ctl.on('up', () => { player.setConnected(true); kick(); })
        .on('down', () => { player.setConnected(false); kick(); })
        .on('msg', (m) => { player.onMsg(m); kick(); });

    const actions = {
        search() {
            if (speaking) return;
            speaking = true;
            ctl.connect();
            const open = opts.spell || spell;
            open(ctx.app, 'Chercher').then((text) => {
                speaking = false;
                if (text && text.trim()) { screen.show('results'); screen.top.results = 0; player.search(text); kick(); }
            }).catch((e) => { speaking = false; player.error = 'clavier : ' + (e && e.message || e); log.warn('Shak Musique ' + player.error); player.rev++; kick(); });
        },
        play(list, i) { ctl.connect(); if (player.playList(list, i)) screen.show('now'); kick(); },
        toggle() { ctl.connect(); player.toggle(); kick(); },
        prev() { player.prev(); kick(); },
        next() { player.next(); kick(); },
        seekBy(ms) { player.seekBy(ms); kick(); },
        recentsClear() { recents.clear(); screen.top.recents = 0; player.rev++; kick(); },
    };
    const screen = new Screen(player, recents, art, actions);
    // un appui sur la barre de progression : on va à cet endroit du morceau
    if (ctx.onTap) ctx.onTap((x, y) => {
        const b = screen.bar;
        if (screen.view === 'now' && b && x >= b.x - 10 && x <= b.x + b.w + 10 && y >= b.y && y <= b.y + b.h && player.total > 0) {
            player.seek(Math.max(0, Math.min(1, (x - b.x) / b.w)) * player.total); kick();
        }
    });
    let last = '';
    const render = () => {
        player.checkSearch(SEARCH_TIMEOUT_MS);
        const sig = screen.signature();
        if (sig === last && !opts.always) return 'idle';
        last = sig;
        const cv = ctx.canvas(W, H);
        screen.draw(cv);
        return ctx.ui.image('MAIN_GFX', cv);
    };
    loop = ctx.loop('MAIN', 10, render);
    if (ctx.ui && ctx.ui.onVisible) ctx.ui.onVisible((name, v) => { if (name === 'MAIN' && v) { ctl.connect(); kick(); } });
    ctl.connect();
    render();
    return { player, ctl, screen, recents, art, actions };
}

module.exports = { start, spell, Screen, Recents, Art, centreSquare, W, H, ROWS };
