'use strict';
// shared/video_app.js ("RideTube on cluster") driven without a car: a fake clock, a fake cluster-render, a real MGVF file in a
// temporary folder. The point of most checks: no picture unless the car stands. Run: node tools/test_video_app.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vb = require('../shared/video_bridge');
const { VideoApp, FRAME_MS, PLAYING_MS, MAX_W } = require('../shared/video_app');

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
            frame(ref, atlas, id) { const l = c.layers[ref]; assert.strictEqual(atlas.length, l.vw * l.vh * 3 / 2, 'atlas size'); c.frames++; c.lastId = id; return true; } };
        R.renders[target] = c;
        return c;
    };
    R.app = new VideoApp({ id: 'ridetube_cluster', now: () => R.t, setting: (k) => settings[k], makeRender: R.cr, videoPath: video, themesDir: themes });
    R.writeFrame = () => {
        R.seq++; R.slot = (R.slot + 1) % 3;
        const b = Buffer.alloc(64 + 3 * FB, 90);
        [vb.MAGIC, 1, W, H, R.seq, R.slot, 3, 709, 0].forEach((v, i) => b.writeUInt32LE(v, i * 4));
        fs.writeFileSync(video, b);
    };
    R.theme = (open) => fs.writeFileSync(path.join(themes, 'themes.json'), JSON.stringify({ at: R.t, app: 'ShakTheme', window: { x: 80, y: 167, w: 561, h: 422 }, open }));
    R.hudRoom = (panel) => fs.writeFileSync(path.join(themes, 'hud-layout.json'), JSON.stringify({ at: R.t, app: 'HUD Widgets', panel }));
    R.asked = () => fs.existsSync(path.join(themes, 'window-ridetube_cluster.json'));
    // `ms` of playing: a frame, a speed reading and a tick every 33 ms; the theme opens its window once asked
    R.run = (ms, speed, playing) => {
        for (let i = 0; i < ms; i += 33) {
            R.t += 33;
            if (playing !== false) R.writeFrame();
            if (speed !== undefined) R.app.speed(speed);
            if (R.themeUp !== false) R.theme(R.asked());
            R.app.tick();
        }
    };
    R.visible = (target) => { const c = R.renders[target]; return !!c && Object.keys(c.layers).some((k) => c.layers[k].visible === true); };
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
check('the gate cannot be configured away: video_app.js has no setting, option or environment switch around Standing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'video_app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const tick = src.slice(src.indexOf('    tick() {'));
    assert(/const standing = this\.gate\.ok\(now\);[\s\S]*?if \(!standing\) \{ this\._hideAll\(\);[^}]*return; \}/.test(tick), 'tick() does not start with the gate');
    assert(tick.indexOf('this.gate.ok') < tick.indexOf('this._read()'), 'a frame is read before the gate');
    assert(!/parkedOnly|whileDriving|allowMoving|process\.env\.[A-Z_]*(GATE|PARK|MOVING|SPEED)/.test(src), 'a switch around the gate');
});
console.log('video_app: ' + n + ' checks' + (process.exitCode ? ' (some failed)' : ' pass'));
