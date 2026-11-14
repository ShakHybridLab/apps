'use strict';
// shared/video_app.js ("RideTube on cluster") driven without a car: a fake clock, a fake cluster-render, a real MGVF file in a
// temporary folder. The point of most checks: no picture unless the car stands. Run: node tools/test_video_app.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vb = require('../shared/video_bridge');
const { VideoApp, FRAME_MS, PLAYING_MS, MAX_W } = require('../shared/video_app');
// shared/hud_text.js reads the app's fonts through hud_data.js (the kit's pack on the car): here, straight from the app's folder
const HUD_DATA = path.join(__dirname, '..', 'shared', 'hud_data.js');
require.cache[HUD_DATA] = { id: HUD_DATA, filename: HUD_DATA, loaded: true, exports: { json: (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'ridetube_cluster', 'hud', rel), 'utf8')) } };
const text = require('../shared/hud_text');
const vn = require('../shared/video_now');

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e.stack || e.message)); process.exitCode = 1; } }

const W = 128, H = 72, FB = W * H * 3 / 2;
function rig(settings) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-'));
    const themes = path.join(dir, 'themes'); fs.mkdirSync(themes);
    const video = path.join(dir, 'video');
    const R = { t: 100000, seq: 0, slot: 0, renders: {}, dir, themes, video };
    R.cr = (target) => {
        const c = { target, layers: {}, next: 1, frames: 0, log: [], ready: true,
            connect() {}, close() { c.closed = true; },
            video(o) { const ref = c.next++; c.layers[ref] = Object.assign({ visible: o.visible !== false }, o); c.log.push('video'); return ref; },
            set(ref, o) { Object.assign(c.layers[ref], o); c.log.push('set ' + JSON.stringify(o)); },
            drop(ref) { delete c.layers[ref]; c.log.push('drop'); },
            image(o) { const ref = c.next++; c.layers[ref] = Object.assign({ visible: o.visible !== false, card: true }, o); return ref; },
            pixels(ref, rects, px) { const l = c.layers[ref]; assert.strictEqual(px.length, l.iw * l.ih * 4, 'card size'); l.px = px; c.cards = (c.cards || 0) + 1; return true; },
            frame(ref, atlas, id) { const l = c.layers[ref]; assert.strictEqual(atlas.length, l.vw * l.vh * 3 / 2, 'atlas size'); c.frames++; c.lastId = id; return true; } };
        R.renders[target] = c;
        return c;
    };
    R.app = new VideoApp({ id: 'ridetube_cluster', now: () => R.t, setting: (k) => settings[k], makeRender: R.cr, videoPath: video, themesDir: themes, nowPath: path.join(dir, 'now.json'), text });
    R.now = (o) => fs.writeFileSync(path.join(dir, 'now.json'), JSON.stringify(Object.assign({ t: R.t, state: 'playing', title: 'Essai du BMW X3 30e : 300 km en électrique ?', channel: 'Chaîne Auto', elapsed_ms: 754000, total_ms: 1503000 }, o || {})));
    R.writeFrame = () => {
        R.seq++; R.slot = (R.slot + 1) % 3;
        const b = Buffer.alloc(64 + 3 * FB, 90);
        [vb.MAGIC, 1, W, H, R.seq, R.slot, 3, 709, 0].forEach((v, i) => b.writeUInt32LE(v, i * 4));
        fs.writeFileSync(video, b);
    };
    R.theme = (open, map) => fs.writeFileSync(path.join(themes, 'themes.json'), JSON.stringify({ at: R.t, app: 'ShakTheme', window: { x: 80, y: 167, w: 561, h: 422 }, open: open || !!map, map: !!map }));
    R.hudRoom = (panel) => fs.writeFileSync(path.join(themes, 'hud-layout.json'), JSON.stringify({ at: R.t, app: 'HUD Widgets', panel }));
    R.asked = () => fs.existsSync(path.join(themes, 'window-ridetube_cluster.json'));
    // `ms` of playing: a frame, a speed reading and a tick every 33 ms; the theme opens its window once asked
    R.run = (ms, speed, playing) => {
        for (let i = 0; i < ms; i += 33) {
            R.t += 33;
            if (playing !== false) R.writeFrame();
            if (speed !== undefined) R.app.speed(speed);
            if (R.playingNow) R.now(R.playingNow === true ? null : R.playingNow);
            if (R.themeUp !== false) R.theme(R.asked(), R.mapUp === true);
            R.app.tick();
        }
    };
    R.visible = (target) => { const c = R.renders[target]; return !!c && Object.keys(c.layers).some((k) => c.layers[k].visible === true && !c.layers[k].card); };
    R.card = (target) => { const c = R.renders[target]; const k = c && Object.keys(c.layers).filter((x) => c.layers[x].card && c.layers[x].visible === true)[0]; return k ? c.layers[k] : null; };
    return R;
}

check('standing and playing: asks the theme for its window, then shows the video inside it, at most 15 frames a second', () => {
    const R = rig({ videoCluster: true, videoHud: false });
    R.run(1500, 0);
    assert(!R.visible('panel') && !R.asked(), 'shown before the car stood for 2 s');
    R.run(3000, 0);
    assert(R.asked(), 'never asked for the window');
    assert(R.visible('panel'), 'no picture: ' + JSON.stringify(R.app.state));
    const c = R.renders.panel, l = c.layers[Object.keys(c.layers)[0]];
    assert(l.klass === 'overlay' && l.w === l.vw && l.h === l.vh && l.w % 4 === 0 && l.h % 2 === 0 && l.x % 2 === 0 && l.y % 2 === 0, 'layer off cluster-render\'s grid');
    assert(l.x >= 80 && l.y >= 167 && l.x + l.w <= 641 && l.y + l.h <= 589 && l.w <= MAX_W, 'outside the theme\'s window');
    assert(Math.abs(l.w / l.h - 16 / 9) < 0.03, 'not the video\'s aspect');
    const before = c.frames; R.run(1000, 0);
    const fps = c.frames - before;
    assert(fps >= 8 && fps <= Math.ceil(1000 / FRAME_MS) + 1, fps + ' frames in a second');
    assert(!R.renders.hud, 'drew on the HUD with its setting off');
});
check('the car moves: the picture is gone in the same tick, the window is given back, and no frame leaves while it drives', () => {
    const R = rig({ videoCluster: true, videoHud: true });
    R.run(4000, 0);
    assert(R.visible('panel') && R.visible('hud'), 'not showing before');
    const fp = R.renders.panel.frames, fh = R.renders.hud.frames;
    R.t += 33; R.writeFrame(); R.app.speed(4); R.app.tick();
    assert(!R.visible('panel') && !R.visible('hud'), 'still visible one tick after moving');
    assert(!R.asked(), 'still holds the theme\'s window');
    R.run(20000, 50);
    assert(!R.visible('panel') && !R.visible('hud') && R.renders.panel.frames === fp && R.renders.hud.frames === fh, 'frames sent while driving');
    R.run(1500, 0);
    assert(!R.visible('panel'), 'back before standing 2 s again');
    R.run(2500, 0);
    assert(R.visible('panel') && R.visible('hud'), 'never comes back once parked again');
});
check('no speed at all, an unknown speed, or readings that stop: never a picture', () => {
    let R = rig({ videoCluster: true, videoHud: true });
    R.run(8000, undefined);
    assert(!R.visible('panel') && !R.visible('hud') && !R.asked(), 'shown with no speed reading');
    R = rig({ videoCluster: true, videoHud: true });
    R.run(8000, null);
    assert(!R.visible('panel') && !R.visible('hud'), 'shown with an unknown speed');
    R = rig({ videoCluster: true, videoHud: true });
    R.run(4000, 0);
    assert(R.visible('panel'));
    R.run(vb.STALE_MS + 200, undefined);
    assert(!R.visible('panel') && !R.visible('hud') && !R.asked(), 'still shown ' + vb.STALE_MS + ' ms after the last speed reading');
});
check('both settings off (the default), nothing playing, or a paused video: nothing shown, the window not asked for', () => {
    let R = rig({});
    R.run(5000, 0);
    assert(!R.renders.panel && !R.renders.hud && !R.asked(), 'drew with the settings off');
    R = rig({ videoCluster: true, videoHud: true });
    R.run(5000, 0, false);
    assert(!R.visible('panel') && !R.asked(), 'drew with no video file');
    R.run(3000, 0);
    assert(R.visible('panel'));
    R.run(PLAYING_MS + 300, 0, false);
    assert(!R.visible('panel') && !R.visible('hud') && !R.asked(), 'a paused video keeps the window');
});
check('the cluster: only inside an open theme window (nothing on BMW\'s own cluster); the HUD: HUD Widgets\' room, or none when it leaves none', () => {
    let R = rig({ videoCluster: true, videoHud: true });
    R.themeUp = false;
    R.run(5000, 0);
    assert(!R.visible('panel'), 'drew on the cluster with no theme');
    assert(R.visible('hud'), 'the HUD fallback corner is not used');
    const h = R.renders.hud.layers[Object.keys(R.renders.hud.layers)[0]];
    assert(h.x >= 350 && h.x + h.w <= 680 && h.y >= 100 && h.y + h.h <= 380, 'HUD picture outside the visible window or on BMW\'s speed: ' + JSON.stringify(h));
    R = rig({ videoCluster: false, videoHud: true });
    for (let i = 0; i < 150; i++) { R.t += 33; R.writeFrame(); R.app.speed(0); R.hudRoom(null); R.app.tick(); }
    assert(!R.visible('hud'), 'drew on a HUD layout that leaves no room');
    for (let i = 0; i < 60; i++) { R.t += 33; R.writeFrame(); R.app.speed(0); R.hudRoom({ x: 400, y: 120, w: 260, h: 160 }); R.app.tick(); }
    const c = R.renders.hud, l = c.layers[Object.keys(c.layers)[0]];
    assert(R.visible('hud') && l.x >= 400 && l.x + l.w <= 660 && l.y >= 120 && l.y + l.h <= 280, 'not in HUD Widgets\' room');
});
check('stop(): everything hidden, the window given back, the connections closed', () => {
    const R = rig({ videoCluster: true, videoHud: true });
    R.run(4000, 0);
    R.app.stop();
    assert(!R.visible('panel') && !R.visible('hud') && !R.asked() && R.renders.panel.closed && R.renders.hud.closed);
});
check('the gate cannot be configured away: the pictures have no setting, option or environment switch around Standing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'video_app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const a = src.indexOf('    _videos(now) {'), b = src.indexOf('    tick() {');
    assert(a > 0 && b > a, '_videos / tick not found');
    const vids = src.slice(a, b), rest = src.slice(0, a) + src.slice(b);
    assert(/const standing = this\.gate\.ok\(now\);[\s\S]*?if \(!standing\) \{ this\._hideVideos\(\);[^}]*return \{ panel: false, hud: false \}; \}/.test(vids), '_videos() does not start with the gate');
    assert(vids.indexOf('this.gate.ok') < vids.indexOf('this._read()'), 'a frame is read before the gate');
    assert(!/this\._read\(\)|this\._draw\(/.test(rest), 'a frame is read or drawn outside _videos()');
    const c0 = src.indexOf('    _card(t, np) {'), c1 = src.indexOf('    _room(name) {');
    assert(c0 > 0 && c1 > c0, '_card / _room not found');
    const card = src.slice(c0, c1);
    assert(!/\.frame\(|\.video\(|this\.src|toAtlas/.test(card), 'the card touches the picture');
    assert(!/parkedOnly|whileDriving|allowMoving|privateRoad|process\.env\.[A-Z_]*(GATE|PARK|MOVING|SPEED)/.test(src), 'a switch around the gate');
});
check('driving, now playing on: the card (words only) in the theme\'s window and on the HUD, never a picture, and no frame is read', () => {
    const R = rig({ videoCluster: true, videoHud: true, nowCluster: true, nowHud: true });
    R.playingNow = true;
    R.run(4000, 80);
    assert(!R.visible('panel') && !R.visible('hud'), 'a picture while driving');
    assert(R.renders.panel.frames === 0 && R.renders.hud.frames === 0, 'frames sent while driving');
    const c = R.card('panel'), h = R.card('hud');
    assert(c && h, 'no card: ' + JSON.stringify(R.app.state));
    assert(R.asked(), 'the card did not ask for the window');
    assert(c.x >= 80 && c.y >= 167 && c.x + c.w <= 641 && c.y + c.h <= 589 && c.x % 2 === 0 && c.y % 2 === 0, 'card outside the window');
    assert(h.x >= 350 && h.x + h.w <= 680 && h.y >= 100 && h.y + h.h <= 380, 'HUD card outside its corner: ' + JSON.stringify({ x: h.x, y: h.y, w: h.w, h: h.h }));
    const n = R.renders.panel.cards; R.run(3000, 80);
    assert(R.renders.panel.cards - n <= 1, 'the card is redrawn though nothing changed');
    R.playingNow = { elapsed_ms: 760000 }; R.run(700, 80);
    assert(R.renders.panel.cards > n, 'the card does not follow the position');
});
check('the card: gone when RideTube stops (now.json stale or missing), off by default, and it gives the window back', () => {
    const R = rig({ videoCluster: false, videoHud: false, nowCluster: true, nowHud: true });
    R.playingNow = true; R.run(2000, 60);
    assert(R.card('panel'));
    R.playingNow = false; R.run(vn.NOW_FRESH_MS + 800, 60);
    assert(!R.card('panel') && !R.card('hud') && !R.asked(), 'the card stays after RideTube stopped');
    const D = rig({});
    D.playingNow = true; D.run(3000, 60);
    assert(!D.renders.panel && !D.renders.hud && !D.asked(), 'a card with the settings off');
});
check('the card stays off the cluster while Waze\'s map or another app\'s page is in the window', () => {
    const R = rig({ nowCluster: true });
    R.playingNow = true; R.mapUp = true; R.run(3000, 60);
    assert(!R.card('panel') && !R.asked(), 'the card covers Waze\'s map');
    R.mapUp = false; R.run(1500, 60);
    assert(R.card('panel'), 'the card does not come once the map is gone');
    for (let i = 0; i < 60; i++) { R.t += 33; R.now(); fs.writeFileSync(path.join(R.themes, 'window-cluster_centre.json'), JSON.stringify({ t: R.t, app: 'Cluster Centre', kind: 'pages', showing: true })); R.theme(true); R.app.tick(); }
    assert(!R.card('panel') && !R.asked(), 'the card covers Cluster Centre\'s page');
});
check('parked: the picture takes the card\'s place where its setting is on, and the card comes back when the car moves', () => {
    const R = rig({ videoCluster: true, videoHud: false, nowCluster: true, nowHud: true });
    R.playingNow = true; R.run(4000, 0);
    assert(R.visible('panel') && !R.card('panel'), 'picture and card together on the cluster');
    assert(R.card('hud') && !R.visible('hud'), 'the HUD (picture off) has no card');
    R.t += 33; R.writeFrame(); R.now(); R.app.speed(12); R.theme(true); R.app.tick();
    assert(!R.visible('panel'), 'picture after moving');
    R.run(600, 12);
    assert(R.card('panel') && R.asked(), 'no card after the car moved');
});
check('the card\'s text: unknown characters replaced, long titles on two lines then cut, times as m:ss / h:mm:ss, a card for odd input', () => {
    const g = text.loadFont('np').metrics.glyphs, m = (s) => text.measure(s, 'np');
    assert.strictEqual(vn.clean('Обзор  BMW\tX3 🚗 30e', g), 'BMW X3 30e');
    assert.strictEqual(vn.clean('Ça roule à l\'été', g), 'Ça roule à l\'été');
    assert.strictEqual(vn.clean('Đà Nẵng', g).length > 0, true);
    const two = vn.twoLines('Un titre vraiment très long pour une vidéo qui ne tient pas sur une seule ligne de la carte du cluster', 520, m);
    assert(two.length === 2 && m(two[0]) <= 520 && m(two[1]) <= 520 && /\.\.\.$/.test(two[1]), JSON.stringify(two));
    assert(m(vn.fit('M'.repeat(80), 300, m)) <= 300);
    assert.strictEqual(vn.clock(754000), '12:34'); assert.strictEqual(vn.clock(3723000), '1:02:03'); assert.strictEqual(vn.clock(0), '0:00');
    [{ state: 'paused', title: '', channel: '', elapsed: 0, total: 0 }, { state: 'playing', title: 'x'.repeat(500), channel: '😀', elapsed: 9e9, total: 1000 }].forEach((np) => {
        [[560, 192], [300, 144], [220, 110]].forEach(([w, h]) => assert.strictEqual(vn.card(w, h, np, text).length, w * h * 4));
    });
    // the words are really drawn: bright pixels in the title's rows, in the channel's row and in the times' row
    const W = 548, H = 192, px = vn.card(W, H, { state: 'paused', title: 'Essai du BMW X3', channel: 'Chaîne Auto', elapsed: 754000, total: 1503000 }, text);
    const bright = (y0, y1) => { let c = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4] > 120) c++; return c; };
    assert(bright(10, 50) > 300, 'no title on the card'); assert(bright(52, 90) > 100, 'no channel on the card'); assert(bright(H - 44, H - 6) > 200, 'no times on the card');
    assert.strictEqual(vn.cardSize({ w: 100, h: 300 }), null);
    assert.strictEqual(vn.readNow('/nonexistent/now.json', 0), null);
});
console.log('video_app: ' + n + ' checks' + (process.exitCode ? ' (some failed)' : ' pass'));
