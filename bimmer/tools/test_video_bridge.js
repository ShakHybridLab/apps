'use strict';
// shared/video_bridge.js: the MGVF reader, the scaler to cluster-render's video atlas, the window fit and, above all, the gate
// that lets a picture out only while the car stands. Run: node tools/test_video_bridge.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vb = require('../shared/video_bridge');

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

function mgvf(w, h, nslot, slot, seq, fill) {
    const fb = w * h * 3 / 2, b = Buffer.alloc(64 + nslot * fb);
    [vb.MAGIC, 1, w, h, seq, slot, nslot, 709, 0].forEach((v, i) => b.writeUInt32LE(v, i * 4));
    for (let s = 0; s < nslot; s++) b.fill(fill(s), 64 + s * fb, 64 + (s + 1) * fb);
    return b;
}

check('the gate: shut until the car has stood for STILL_MS on fresh readings', () => {
    const g = new vb.Standing();
    assert(!g.ok(0), 'open with no reading');
    g.feed(0, 1000);
    assert(!g.ok(1000) && !g.ok(1000 + vb.STILL_MS - 1), 'open too early');
    g.feed(0, 2000); g.feed(0.3, 3000);
    assert(g.ok(3000 + 100), 'shut though standing for 2 s');
});
check('the gate: any movement, an unknown or a missing speed shuts it at once, and it needs a full STILL_MS again', () => {
    [3, 0.6, -2, null, undefined, NaN, '0', Infinity].forEach((bad) => {
        const g = new vb.Standing();
        g.feed(0, 0); g.feed(0, 3000);
        assert(g.ok(3100), 'not open before');
        g.feed(bad, 3200);
        assert(!g.ok(3200) && !g.ok(9000), 'open with speed ' + String(bad));
        g.feed(0, 3300);
        assert(!g.ok(3300 + vb.STILL_MS - 1), 'open again too early after ' + String(bad));
        g.feed(0, 3300 + vb.STILL_MS);
        assert(g.ok(3300 + vb.STILL_MS), 'never opens again after ' + String(bad));
    });
});
check('the gate: a reading older than STALE_MS counts as driving; a clock that jumps back shuts it', () => {
    const g = new vb.Standing();
    g.feed(0, 0); g.feed(0, 3000);
    assert(g.ok(3000 + vb.STALE_MS - 1));
    assert(!g.ok(3000 + vb.STALE_MS), 'open on a stale reading');
    assert(!g.ok(2000), 'open with now before the reading');
    assert(vb.STALE_MS <= 5000 && vb.STILL_KMH <= 1 && vb.STILL_MS >= 1000, 'the limits were loosened');
});
check('MGVF header: read, and refused when it is not one', () => {
    const h = vb.parseHead(mgvf(64, 36, 3, 1, 7, () => 0));
    assert(h && h.w === 64 && h.h === 36 && h.slot === 1 && h.seq === 7 && h.nslot === 3 && h.frameBytes === 64 * 36 * 1.5);
    assert.strictEqual(vb.parseHead(Buffer.alloc(64)), null);
    assert.strictEqual(vb.parseHead(Buffer.alloc(10)), null);
    assert.strictEqual(vb.parseHead(mgvf(63, 36, 3, 0, 0, () => 0)), null, 'odd width');
    assert.strictEqual(vb.parseHead(mgvf(64, 36, 3, 3, 0, () => 0)), null, 'slot past nslot');
    assert.strictEqual(vb.parseHead(mgvf(4096, 36, 3, 0, 0, () => 0)), null, 'too wide');
});
check('MGVF reader: the stored slot\'s frame, nothing when the seq has not moved, null on a short or missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-')), f = path.join(dir, 'v');
    fs.writeFileSync(f, mgvf(64, 36, 3, 2, 5, (s) => 10 + s));
    const fd = fs.openSync(f, 'r');
    const r = vb.readFrame(fd, null);
    assert(r && r.frame.length === 64 * 36 * 1.5 && r.frame[0] === 12 && r.frame[r.frame.length - 1] === 12, 'not slot 2');
    const again = vb.readFrame(fd, r.frame, 5);
    assert(again && again.frame === null && again.head.seq === 5, 'read the same frame twice');
    fs.closeSync(fd);
    fs.writeFileSync(f, mgvf(64, 36, 3, 2, 5, () => 0).slice(0, 500));
    const fd2 = fs.openSync(f, 'r');
    assert.strictEqual(vb.readFrame(fd2, null), null, 'a cut file gave a frame');
    fs.closeSync(fd2);
    assert.strictEqual(vb.readFrame(9999, null), null, 'a bad fd threw');
});
check('the atlas: Y as is, then U and V side by side in each chroma row; scaled by nearest sample', () => {
    const sw = 8, sh = 4, src = Buffer.alloc(sw * sh * 1.5);
    for (let i = 0; i < sw * sh; i++) src[i] = i;
    for (let i = 0; i < 8; i++) { src[32 + i] = 100 + i; src[40 + i] = 200 + i; }
    const a = vb.toAtlas(src, sw, sh, sw, sh, null);
    assert.strictEqual(a.length, 48);
    assert.deepStrictEqual(Array.from(a.slice(0, 32)), Array.from(src.slice(0, 32)), 'Y changed');
    assert.deepStrictEqual(Array.from(a.slice(32, 40)), [100, 101, 102, 103, 200, 201, 202, 203], 'first chroma row');
    assert.deepStrictEqual(Array.from(a.slice(40, 48)), [104, 105, 106, 107, 204, 205, 206, 207], 'second chroma row');
    const half = vb.toAtlas(src, sw, sh, 4, 2, null);
    assert.strictEqual(half.length, 12);
    assert.deepStrictEqual(Array.from(half.slice(0, 4)), [9, 11, 13, 15], 'Y not sampled at the pixel centres');
    const reuse = Buffer.alloc(12);
    assert.strictEqual(vb.toAtlas(src, sw, sh, 4, 2, reuse), reuse, 'the given buffer is not reused');
});
check('the fit: 16:9 centred in the room, w a multiple of 4, h and the corner even, never outside, capped, null when too small', () => {
    [{ x: 80, y: 167, w: 561, h: 422 }, { x: 534, y: 120, w: 852, h: 480 }, { x: 711, y: 171, w: 498, h: 263 }, { x: 121, y: 101, w: 559, h: 279 }].forEach((room) => {
        const r = vb.fitRect(room, 16, 9, 640);
        assert(r, 'no fit in ' + JSON.stringify(room));
        assert(r.w % 4 === 0 && r.h % 2 === 0 && r.x % 2 === 0 && r.y % 2 === 0, 'not on cluster-render\'s grid: ' + JSON.stringify(r));
        assert(r.x >= room.x && r.y >= room.y && r.x + r.w <= room.x + room.w && r.y + r.h <= room.y + room.h, 'outside the room: ' + JSON.stringify(r));
        assert(r.w <= 640 && Math.abs(r.w / r.h - 16 / 9) < 0.03, 'not 16:9 or over the cap: ' + JSON.stringify(r));
    });
    assert.strictEqual(vb.fitRect({ x: 0, y: 0, w: 40, h: 30 }, 16, 9), null);
    assert.strictEqual(vb.fitRect(null, 16, 9), null);
});
console.log('video_bridge: ' + n + ' checks' + (process.exitCode ? ' (some failed)' : ' pass'));
