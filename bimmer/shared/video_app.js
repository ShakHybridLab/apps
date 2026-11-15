'use strict';
/**
 * video_app.js - "RideTube on cluster": shows the video RideTube plays (its decoder's frame file, video_bridge.js) in a cluster
 * theme's centre window and in the HUD's free room, through cluster-render video layers. ONLY WHILE THE CAR STANDS: the gate is
 * video_bridge.Standing (speed known, fresh, zero for 2 s) AND RideTube's own parked check (deps.moving); the first reading that is not hides every picture in the same tick and
 * gives the theme its window back. There is no setting that changes that, and none may be added.
 *
 * On the instrument cluster it draws only inside a theme's window: it asks for it like Cluster Centre does
 * (/dev/shm/cluster-themes/window-<id>.json, cluster_info.js) and waits until the theme says it is open (themes.json). With no
 * theme up, nothing is drawn on BMW's own cluster. On the HUD it uses the room HUD Widgets publishes (hud-layout.json), else a
 * fixed corner clear of BMW's own HUD items (visible.js).
 *
 * In the theme's window it stays away while Waze's map or another app's page (Cluster Centre, Cluster Info) is in it.
 *
 * Everything outside (the clock, files, cluster-render, the speed) comes in through `deps`, so tools/test_video_app.js drives it
 * without a car. Node 8. MIT.
 */
const fs = require('fs');
const path = require('path');
const vb = require('./video_bridge');
const visible = require('./visible');

const VIDEO_PATH = process.env.RIDETUBE_VIDEO || '/dev/shm/mgu-video-ridetube';
const THEMES_DIR = process.env.CLUSTER_THEMES_DIR || '/dev/shm/cluster-themes';
const FRESH_MS = 3000;          // themes.json / hud-layout.json older than this: the app that wrote it is gone
const PLAYING_MS = 1500;        // no new frame for this long: paused or stopped, the picture goes
const FRAME_MS = 66;            // at most 15 frames a second leave for the cluster (the head unit also decodes the video)
const ASK_MS = 500;
const MAX_W = 640;              // the widest picture sent (upload cost), whatever the room
const INSET = 6;                // px kept free inside the room's edge
// with no HUD Widgets layout: the right part of the visible HUD, clear of BMW's own speed and sign (HUD_BMW)
const HUD_FALLBACK = { x: visible.HUD_BMW[2] + 10, y: visible.HUD_WINDOW.y, w: visible.HUD_WINDOW.x + visible.HUD_WINDOW.w - visible.HUD_BMW[2] - 10, h: visible.HUD_WINDOW.h };

class VideoApp {
    /**
     * deps: { id, log, now(), setting(key), makeRender(target) -> a ClusterRender-like { video, set, drop, frame, connect, close,
     * ready, image, pixels }, videoPath, themesDir, moving() -> true while the car drives (RideTube's own check) }. Speed readings come in
     * through speed(kmh).
     */
    constructor(deps) {
        this.d = deps;
        this.id = deps.id || 'ridetube_cluster';
        this.now = deps.now || Date.now;
        this.videoPath = deps.videoPath || VIDEO_PATH;
        this.themesDir = deps.themesDir || THEMES_DIR;
        this.gate = new vb.Standing();
        this.fd = null; this.fdAt = 0;
        this.seq = null; this.seqAt = 0; this.head = null;
        this.src = null;
        this.targets = { panel: this._target('panel'), hud: this._target('hud') };
        this.askAt = 0; this.asking = false;
        this.timer = null;
        this.state = { standing: false, playing: false, panel: 'off', hud: 'off' };
    }

    _target(name) { return { name, cr: null, ref: 0, rect: null, atlas: null, sentAt: 0, shown: false }; }

    /** A speed reading in km/h (null = the car gave none). */
    speed(kmh) { this.gate.feed(kmh, this.now()); }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { this._hideAll(); if (this.d.log) this.d.log.error('video: ' + (e && e.stack || e)); } }, 33);
    }

    stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        this._hideAll();
        Object.keys(this.targets).forEach((k) => { const t = this.targets[k]; if (t.cr) { try { t.cr.close(); } catch (e) { /* closing */ } t.cr = null; } });
        this._closeFile();
    }

    _closeFile() { if (this.fd !== null) { try { fs.closeSync(this.fd); } catch (e) { /* gone */ } this.fd = null; } }

    _json(name) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(this.themesDir, name), 'utf8'));
            return j && typeof j.at === 'number' && Math.abs(this.now() - j.at) < FRESH_MS ? j : null;
        } catch (e) { return null; }
    }

    /** Asks the theme for its window (or stops asking). */
    _ask(want) {
        const f = path.join(this.themesDir, 'window-' + this.id + '.json');
        if (!want) {
            if (this.asking) { this.asking = false; try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
            return;
        }
        const t = this.now();
        if (this.asking && t - this.askAt < ASK_MS) return;
        this.askAt = t;
        try {
            try { fs.mkdirSync(this.themesDir); } catch (e) { /* there */ }
            fs.writeFileSync(f + '.tmp', JSON.stringify({ t, app: 'RideTube', kind: 'video', showing: true }), { mode: 0o644 });
            fs.renameSync(f + '.tmp', f);
            this.asking = true;
        } catch (e) { /* no folder: no theme to ask */ }
    }

    /** The newest frame, when there is a new one. Keeps this.playing up to date. */
    _read() {
        const t = this.now();
        if (this.fd === null && t - this.fdAt >= 1000) {
            this.fdAt = t;
            try { this.fd = fs.openSync(this.videoPath, 'r'); } catch (e) { this.fd = null; }
        }
        if (this.fd === null) return null;
        const r = vb.readFrame(this.fd, this.src, this.seq === null ? undefined : this.seq);
        if (!r) { this._closeFile(); this.seq = null; return null; }      // replaced or cut: open it again
        this.head = r.head;
        if (!r.frame) return null;
        // the first frame after opening is whatever was left in the file: it only counts once the seq moves
        const first = this.seq === null;
        this.seq = r.head.seq; this.src = r.frame;
        if (first) return null;
        this.seqAt = t;
        return r.frame;
    }

    _hide(t) {
        if (t.shown && t.cr && t.ref) { try { t.cr.set(t.ref, { visible: false }); } catch (e) { /* gone */ } }
        t.shown = false;
    }

    /** Every picture off. */
    _hideVideos() {
        Object.keys(this.targets).forEach((k) => this._hide(this.targets[k]));
        this.state.panel = this.state.hud = 'off';
    }

    _hideAll() {
        this._hideVideos();
        this._ask(false);
    }

    /** Waze's map, or another app's page (Cluster Centre, Cluster Info), is in the theme's window: the picture stays away. */
    _windowBusy() {
        const th = this._json('themes.json');
        if (th && th.map === true) return true;
        let names = [];
        try { names = fs.readdirSync(this.themesDir); } catch (e) { return false; }
        const now = this.now();
        return names.some((n) => {
            if (!/^window-[\w.-]+\.json$/.test(n) || n === 'window-' + this.id + '.json') return false;
            try { const j = JSON.parse(fs.readFileSync(path.join(this.themesDir, n), 'utf8')); return !!j && typeof j.t === 'number' && Math.abs(now - j.t) < FRESH_MS; } catch (e) { return false; }
        });
    }

    _room(name) {
        if (name === 'panel') {
            const th = this._json('themes.json');
            if (!th || !th.window || th.open !== true) return null;
            return th.window;
        }
        const hl = this._json('hud-layout.json');
        return hl ? hl.panel : HUD_FALLBACK;        // HUD Widgets up with no room (panel null): nothing
    }

    _draw(t, frame, force) {
        const now = this.now();
        const raw = this._room(t.name);
        const room = raw ? { x: raw.x + INSET, y: raw.y + INSET, w: raw.w - 2 * INSET, h: raw.h - 2 * INSET } : null;
        const rect = room && this.head ? vb.fitRect(room, this.head.w, this.head.h, MAX_W) : null;
        if (!rect) { this._hide(t); return 'no room'; }
        if (!t.cr) { t.cr = this.d.makeRender(t.name); t.cr.connect(); }
        if (!t.rect || ['x', 'y', 'w', 'h'].some((k) => t.rect[k] !== rect[k])) {
            if (t.ref) { try { t.cr.drop(t.ref); } catch (e) { /* gone */ } }
            t.ref = t.cr.video({ target: t.name, klass: 'overlay', z: 1, x: rect.x, y: rect.y, w: rect.w, h: rect.h, vw: rect.w, vh: rect.h, visible: false });
            t.rect = rect; t.shown = false; t.atlas = null; force = true;
        }
        if (!t.ref) return 'refused';
        if ((frame || force) && this.src && now - t.sentAt >= FRAME_MS) {
            t.atlas = vb.toAtlas(this.src, this.head.w, this.head.h, rect.w, rect.h, t.atlas);
            if (t.cr.frame(t.ref, t.atlas, this.seq)) {
                t.sentAt = now;
                if (!t.shown) { t.cr.set(t.ref, { visible: true }); t.shown = true; }
            }
        }
        return t.shown ? 'shown' : 'waiting';
    }

    /**
     * The pictures. Returns which targets show (or wait to show) one: { panel, hud }.
     */
    _videos(now) {
        // THE GATE FIRST: not standing = no picture anywhere, whatever else is true
        // two independent checks, both must say "parked": this app's own (Standing) and RideTube's original (kit/parked.js, strict);
        // with no second check wired, the car counts as moving
        const standing = this.gate.ok(now) && typeof this.d.moving === 'function' && this.d.moving() === true;
        this.state.standing = standing;
        if (!standing) { this._hideVideos(); this.state.playing = false; return { panel: false, hud: false }; }
        const frame = this._read();
        const playing = this.seq !== null && this.seqAt > 0 && now - this.seqAt < PLAYING_MS;
        this.state.playing = playing;
        const onPanel = playing && this.d.setting('videoCluster') === true && !this._windowBusy();
        const onHud = playing && this.d.setting('videoHud') === true;
        if (onPanel) { this._ask(true); this.state.panel = this._draw(this.targets.panel, frame, false); } else { this._hide(this.targets.panel); this.state.panel = 'off'; }
        if (onHud) this.state.hud = this._draw(this.targets.hud, frame, false); else { this._hide(this.targets.hud); this.state.hud = 'off'; }
        return { panel: onPanel, hud: onHud };
    }

    tick() {
        const v = this._videos(this.now());
        if (!v.panel) this._ask(false);
    }
}

module.exports = { VideoApp, VIDEO_PATH, FRAME_MS, PLAYING_MS, HUD_FALLBACK, MAX_W };
