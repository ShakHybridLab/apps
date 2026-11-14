'use strict';
/**
 * video_now.js - the "now playing" card of RideTube on cluster: what RideTube plays, in words only (title, channel, a progress bar
 * and the times). No picture, ever: this is what may show while the car drives, like a radio's display. It is drawn into one RGBA
 * image (shared/hud_text.js, the fonts np / np_s baked for this app) for a cluster-render image layer.
 *
 * What plays comes from the RideTube service of ridetube-fork/ (0.3.92 and later), which writes /run/jap-ridetube-d/now.json once a
 * second while a video plays or is paused: { t, state: 'playing' | 'paused', title, channel, elapsed_ms, total_ms }.
 *
 * Node 8. MIT.
 */
const fs = require('fs');

const NOW_PATH = process.env.RIDETUBE_NOW || '/run/jap-ridetube-d/now.json';
const NOW_FRESH_MS = 4000;
const BG = [8, 12, 24, 238], FG = [240, 244, 252, 255], DIM = [150, 164, 190, 255], ACCENT = [64, 150, 255, 255], TRACK = [52, 62, 84, 255];   // hud_text wants the alpha

/** now.json at `file`, when fresh and a video plays or is paused: { state, title, channel, elapsed, total } (ms); else null. */
function readNow(file, nowMs) {
    let j;
    try { j = JSON.parse(fs.readFileSync(file || NOW_PATH, 'utf8')); } catch (e) { return null; }
    if (!j || typeof j.t !== 'number' || Math.abs(nowMs - j.t) >= NOW_FRESH_MS) return null;
    if (j.state !== 'playing' && j.state !== 'paused') return null;
    const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
    return { state: j.state, title: typeof j.title === 'string' ? j.title : '', channel: typeof j.channel === 'string' ? j.channel : '',
        elapsed: num(j.elapsed_ms), total: num(j.total_ms) };
}

/** "1:02:03" or "2:03" for ms. */
function clock(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    const two = (n) => (n < 10 ? '0' : '') + n;
    return h > 0 ? h + ':' + two(m) + ':' + two(ss) : m + ':' + two(ss);
}

/** `text` with only characters the font has: an accented letter it lacks loses its accent, anything else it lacks becomes a space. */
function clean(text, glyphs) {
    let out = '';
    Array.from(String(text || '').replace(/\s+/g, ' ')).forEach((ch) => {
        if (glyphs[ch]) { out += ch; return; }
        const base = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : ch;
        out += base.length === 1 && glyphs[base] ? base : ' ';
    });
    return out.replace(/ +/g, ' ').trim();
}

/** `text` cut to at most `maxW` px (measure(text) -> px), with "..." when cut. */
function fit(text, maxW, measure) {
    if (measure(text) <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measure(text.slice(0, mid).replace(/ +$/, '') + '...') <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo).replace(/ +$/, '') + '...' : '';
}

/** `text` on at most two lines of `maxW` px, broken at a space when there is one; the second line is cut. */
function twoLines(text, maxW, measure) {
    if (measure(text) <= maxW) return [text];
    const words = text.split(' ');
    let first = '';
    for (let i = 0; i < words.length; i++) {
        const tryIt = first ? first + ' ' + words[i] : words[i];
        if (measure(tryIt) > maxW) break;
        first = tryIt;
    }
    if (!first) return [fit(text, maxW, measure)];           // one word wider than the card
    return [first, fit(text.slice(first.length).trim(), maxW, measure)];
}

/** The card's size in a room { w, h }: as wide as it allows up to 560; 192 high (two title lines), 144 in a lower room, down to 110
 *  (then without the channel); null when too small. */
function cardSize(room) {
    if (!room || !(room.w >= 220) || !(room.h >= 110)) return null;
    const w = Math.floor(Math.min(room.w, 560) / 2) * 2, h = room.h >= 192 ? 192 : Math.floor(Math.min(room.h, 144) / 2) * 2;
    return { w, h };
}

function fillRect(px, W, x0, y0, w, h, c) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const o = (y * W + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3] === undefined ? 255 : c[3]; }
}

/** Blends a straight-alpha RGBA box (bw x bh) over the opaque card at x, y. */
function blit(px, W, H, box, bw, bh, x0, y0) {
    for (let y = 0; y < bh; y++) {
        const yy = y0 + y;
        if (yy < 0 || yy >= H) continue;
        for (let x = 0; x < bw; x++) {
            const xx = x0 + x;
            if (xx < 0 || xx >= W) continue;
            const s = (y * bw + x) * 4, a = box[s + 3];
            if (!a) continue;
            const d = (yy * W + xx) * 4, k = a / 255;
            px[d] = Math.round(box[s] * k + px[d] * (1 - k)); px[d + 1] = Math.round(box[s + 1] * k + px[d + 1] * (1 - k)); px[d + 2] = Math.round(box[s + 2] * k + px[d + 2] * (1 - k));
        }
    }
}

/**
 * The card as RGBA (w x h, straight alpha) for `now` (readNow's). `text`: shared/hud_text.js ({ drawText, measure, loadFont }).
 * Rows: the title on one or two lines, the channel, the bar, and under it the elapsed time left, "PAUSE" in the middle when
 * paused, the total right.
 */
function card(w, h, now, text) {
    const px = Buffer.alloc(w * h * 4);
    fillRect(px, w, 0, 0, w, h, BG);
    const pad = 18, inner = w - 2 * pad;
    const big = text.loadFont('np').metrics, small = text.loadFont('np_s').metrics;
    const mBig = (s) => text.measure(s, 'np'), mSmall = (s) => text.measure(s, 'np_s');
    const put = (s, font, color, x, y, bw, align) => {
        if (!s) return;
        const cell = font === 'np' ? big.cellHeight : small.cellHeight;
        blit(px, w, h, text.drawText(bw, cell, s, { font, color, align: align || 'left' }), bw, cell, x, y);
    };
    const low = h < 192;                                   // the low card: one title line
    const title = clean(now.title, big.glyphs) || 'RideTube';
    const lines = low ? [fit(title, inner, mBig)] : twoLines(title, inner, mBig);
    let y = low ? 10 : 12;
    lines.forEach((l) => { put(l, 'np', FG, pad, y, inner); y += big.cellHeight + 2; });
    if (h >= 140) put(fit(clean(now.channel, small.glyphs), inner, mSmall), 'np_s', DIM, pad, y, inner);      // under 140: no room for the channel
    const barY = h - small.cellHeight - 26, frac = now.total > 0 ? Math.min(1, now.elapsed / now.total) : 0;
    fillRect(px, w, pad, barY, inner, 6, TRACK);
    if (frac > 0) fillRect(px, w, pad, barY, Math.max(2, Math.round(inner * frac)), 6, ACCENT);
    const ty = barY + 12, third = Math.floor(inner / 3);
    put(clock(now.elapsed), 'np_s', FG, pad, ty, third, 'left');
    if (now.state === 'paused') put('PAUSE', 'np_s', DIM, pad + third, ty, third, 'center');
    if (now.total > 0) put(clock(now.total), 'np_s', DIM, pad + 2 * third, ty, inner - 2 * third, 'right');
    return px;
}

module.exports = { readNow, clock, clean, fit, twoLines, cardSize, card, NOW_PATH, NOW_FRESH_MS };
