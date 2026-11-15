'use strict';
/**
 * video_bridge.js - the pieces that take a video another app decodes on the head unit (RideTube's ytdec writes I420 frames to an
 * MGVF file in /dev/shm, the format of mgu-render's "Video") to a cluster-render video layer, in a theme's centre window on the
 * instrument cluster or in the HUD's free room. Pure functions and one small reader; no drawing here.
 *
 * THE PICTURE SHOWS ONLY WHILE THE CAR STANDS. `Standing` is the gate: the speed must be known, fresh and zero, for a moment,
 * before a frame goes out, and the first reading that is not (moving, unknown, or older than STALE_MS) hides it at once. Nothing
 * in this file or its callers may bypass it: a moving picture in the driver's instruments is dangerous and, in most countries,
 * illegal. RideTube itself applies the same rule on the centre screen (its README: "a reading older than 5 seconds counts as
 * driving").
 *
 * MGVF (RideTube native/ytdec/src/mgvf.h, GPL-3.0-or-later; only the layout is used here): a 64-byte little-endian header
 * { magic "MGVF", version, w, h, seq, slot, nslot, matrix, full, pad[7] } then nslot frames of w*h*3/2 bytes, planar I420
 * (Y, U, V). The writer fills slot (slot + 1) % nslot, then stores slot, then seq + 1: the stored slot is whole.
 *
 * cluster-render's video frame (PROTOCOL.md, "Frames"): Y (w x h), then h/2 rows of U and V side by side (w/2 each);
 * w a multiple of 4, h even, up to 1920x720.
 *
 * Node 8. MIT, as the rest of shared/.
 */
const fs = require('fs');

const MAGIC = 0x4656474d;       // "MGVF"
const HEAD = 64;
const STALE_MS = 5000;          // a speed reading older than this counts as driving
const STILL_MS = 2000;          // the car must have stood this long before the picture shows
const STILL_KMH = 188;          // at or under this the car stands (the signal's noise floor)

/** The MGVF header in `buf` (at least 64 bytes), or null when it is not one. */
function parseHead(buf) {
    if (!buf || buf.length < HEAD || buf.readUInt32LE(0) !== MAGIC) return null;
    const h = { version: buf.readUInt32LE(4), w: buf.readUInt32LE(8), h: buf.readUInt32LE(12), seq: buf.readUInt32LE(16),
        slot: buf.readUInt32LE(20), nslot: buf.readUInt32LE(24), matrix: buf.readUInt32LE(28), full: buf.readUInt32LE(32) };
    if (h.w < 16 || h.h < 16 || h.w > 2048 || h.h > 2048 || (h.w & 1) || (h.h & 1) || h.nslot < 2 || h.nslot > 8 || h.slot >= h.nslot) return null;
    h.frameBytes = h.w * h.h * 3 / 2;
    return h;
}

/**
 * Reads the newest whole frame of the MGVF file open at `fd` into `into` (a Buffer of at least the frame's size, or null to
 * allocate). Returns { head, frame } or null (no file content yet, a bad header, or the writer lapped us three times).
 * `lastSeq`: skip (return { head, frame: null }) when nothing new was written since.
 */
function readFrame(fd, into, lastSeq) {
    const hb = Buffer.alloc(HEAD);
    for (let attempt = 0; attempt < 3; attempt++) {
        let n;
        try { n = fs.readSync(fd, hb, 0, HEAD, 0); } catch (e) { return null; }
        const head = n === HEAD ? parseHead(hb) : null;
        if (!head) return null;
        if (typeof lastSeq === 'number' && head.seq === lastSeq) return { head, frame: null };
        const frame = into && into.length >= head.frameBytes ? into : Buffer.alloc(head.frameBytes);
        let got;
        try { got = fs.readSync(fd, frame, 0, head.frameBytes, HEAD + head.slot * head.frameBytes); } catch (e) { return null; }
        if (got !== head.frameBytes) return null;
        // the writer is now at most filling (slot + 1): our slot was not touched unless it has moved on two slots
        let after;
        try { after = fs.readSync(fd, hb, 0, HEAD, 0) === HEAD ? parseHead(hb) : null; } catch (e) { return null; }
        if (!after || after.w !== head.w || after.h !== head.h) return null;
        const moved = (after.slot - head.slot + head.nslot) % head.nslot;
        if (moved <= 1 && after.seq - head.seq <= 1) return { head, frame: frame.length === head.frameBytes ? frame : frame.slice(0, head.frameBytes) };
    }
    return null;
}

/**
 * The biggest w x h picture of aspect `aw:ah` inside `room` { x, y, w, h }, centred, as cluster-render takes a video: w a multiple
 * of 4, h even, x and y even, at most `maxW` wide (the upload cost grows with the pixels). null when the room is too small.
 */
function fitRect(room, aw, ah, maxW) {
    if (!room || !(room.w >= 64) || !(room.h >= 36) || !(aw > 0) || !(ah > 0)) return null;
    let w = Math.min(room.w, maxW || room.w), h = w * ah / aw;
    if (h > room.h) { h = room.h; w = h * aw / ah; }
    w = Math.floor(w / 4) * 4; h = Math.floor(h / 2) * 2;
    if (w < 64 || h < 36) return null;
    const x = Math.floor((room.x + (room.w - w) / 2) / 2) * 2, y = Math.floor((room.y + (room.h - h) / 2) / 2) * 2;
    return { x: Math.max(x, Math.ceil(room.x / 2) * 2), y: Math.max(y, Math.ceil(room.y / 2) * 2), w, h };
}

/** Lookup tables for scaling sw -> dw by nearest sample. */
function table(sn, dn) {
    const t = new Uint32Array(dn);
    for (let i = 0; i < dn; i++) t[i] = Math.min(sn - 1, Math.floor((i + 0.5) * sn / dn));
    return t;
}

/**
 * An I420 frame (sw x sh) as cluster-render's atlas of dw x dh (nearest sample; the source's aspect is the caller's business:
 * fitRect gives a dw x dh of the same aspect). `out`: a Buffer of dw * dh * 3 / 2 to reuse, or null. Returns the atlas.
 */
function toAtlas(src, sw, sh, dw, dh, out) {
    const need = dw * dh * 3 / 2;
    const dst = out && out.length === need ? out : Buffer.alloc(need);
    const xs = table(sw, dw), ys = table(sh, dh);
    for (let y = 0; y < dh; y++) {
        const so = ys[y] * sw, d = y * dw;
        for (let x = 0; x < dw; x++) dst[d + x] = src[so + xs[x]];
    }
    const cw = sw >> 1, ch = sh >> 1, hw = dw >> 1, hh = dh >> 1;
    const cx = table(cw, hw), cy = table(ch, hh);
    const uo = sw * sh, vo = uo + cw * ch, base = dw * dh;
    for (let y = 0; y < hh; y++) {
        const su = uo + cy[y] * cw, sv = vo + cy[y] * cw, d = base + y * dw;
        for (let x = 0; x < hw; x++) { dst[d + x] = src[su + cx[x]]; dst[d + hw + x] = src[sv + cx[x]]; }
    }
    return dst;
}

/**
 * The gate. feed(speedKmh, readAtMs) with every speed reading (null = unknown); ok(nowMs) is true only while the newest reading
 * is fresh (younger than STALE_MS), a number at or under STILL_KMH, and every reading for the last STILL_MS was too.
 */
class Standing {
    constructor() { this.since = null; this.last = null; this.lastAt = null; }

    feed(speed, at) {
        const still = typeof speed === 'number' && isFinite(speed) && Math.abs(speed) <= STILL_KMH;
        this.last = still; this.lastAt = at;
        if (!still) this.since = null;
        else if (this.since === null) this.since = at;
    }

    ok(now) {
        if (this.last !== true || this.lastAt === null || this.since === null) return false;
        if (now - this.lastAt >= STALE_MS || now < this.lastAt) return false;
        return now - this.since >= STILL_MS;
    }
}

module.exports = { parseHead, readFrame, fitRect, toAtlas, Standing, MAGIC, HEAD, STALE_MS, STILL_MS, STILL_KMH };
