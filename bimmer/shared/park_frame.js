'use strict';
/**
 * park_frame.js - ShakPark : met l'image d'une caméra dans TOUTE la fenêtre du cluster, au format que cluster-render prend pour une vidéo.
 *
 * Pourquoi : la fenêtre du thème est presque carrée (561 x 422), la caméra est en 16:9. Une image à sa taille laisserait voir la carte Waze
 * ou le thème au-dessus et au-dessous. Ici la couche vidéo a la taille de la fenêtre et les bandes noires sont DANS l'image : pas de
 * couche en plus (8 vidéos au plus, 2 en même temps à l'écran), pas de mémoire graphique en plus ; cluster-render n'écrit que les tuiles
 * qui changent, donc les bandes noires ne coûtent rien après la première image.
 *
 * Deux façons :
 *   'bars' : toute l'image, centrée, avec des bandes noires (par défaut) ;
 *   'fill' : la fenêtre est remplie, les bords de l'image sont coupés (centrés).
 *
 * Source : I420 planaire (Y, U, V) ; but : l'atlas de cluster-render (Y w x h, puis h/2 rangées avec U et V côte à côte, w/2 chacun).
 * Node 8. MIT.
 */
const vb = require('./video_bridge');

const BLACK_Y = 16, BLACK_C = 128;      // noir vidéo (plage limitée)

/** Le rectangle de la couche pour une fenêtre `room` { x, y, w, h } : x et y pairs, w multiple de 4 (au plus maxW), h pair. null si trop petit. */
function layerRect(room, maxW) {
    if (!room || !(room.w >= 64) || !(room.h >= 36)) return null;
    let w = Math.min(room.w, maxW || room.w), h = room.h;
    if (w < room.w) h = Math.round(h * w / room.w);       // plus étroite que la fenêtre : même proportions
    w = Math.floor(w / 4) * 4; h = Math.floor(h / 2) * 2;
    if (w < 64 || h < 36) return null;
    const x = Math.ceil((room.x + (room.w - w) / 2) / 2) * 2, y = Math.ceil((room.y + (room.h - h) / 2) / 2) * 2;
    return { x, y, w, h };
}

/** La partie de la source qui a la proportion dw:dh, centrée (x, y, w, h pairs) : ce qu'on garde en mode « fill ». */
function cropFor(sw, sh, dw, dh) {
    if (sw * dh > sh * dw) {            // la source est plus large : on coupe les côtés
        const w = Math.max(2, Math.floor(sh * dw / dh / 2) * 2);
        return { x: Math.floor((sw - w) / 2 / 2) * 2, y: 0, w, h: sh };
    }
    const h = Math.max(2, Math.floor(sw * dh / dw / 2) * 2);
    return { x: 0, y: Math.floor((sh - h) / 2 / 2) * 2, w: sw, h };
}

function table(off, sn, dn) {
    const t = new Uint32Array(dn);
    for (let i = 0; i < dn; i++) t[i] = off + Math.min(sn - 1, Math.floor((i + 0.5) * sn / dn));
    return t;
}

/**
 * L'image `src` (I420, sw x sh) dans l'atlas de dw x dh. `mode` : 'bars' | 'fill'. `out` : un Buffer de dw * dh * 3 / 2 à réutiliser, ou null.
 * Retourne l'atlas.
 */
function compose(src, sw, sh, dw, dh, mode, out) {
    const need = dw * dh * 3 / 2;
    const dst = out && out.length === need ? out : Buffer.alloc(need);
    let rect, crop;
    if (mode === 'fill') {
        rect = { x: 0, y: 0, w: dw, h: dh };
        crop = cropFor(sw, sh, dw, dh);
    } else {
        rect = vb.fitRect({ x: 0, y: 0, w: dw, h: dh }, sw, sh, dw) || { x: 0, y: 0, w: dw, h: dh };
        crop = { x: 0, y: 0, w: sw, h: sh };
        // les bandes noires : on remplit tout, l'image vient par-dessus (écrire deux fois la même chose coûte moins cher qu'un test par pixel)
        dst.fill(BLACK_Y, 0, dw * dh);
        dst.fill(BLACK_C, dw * dh);
    }
    const xs = table(crop.x, crop.w, rect.w), ys = table(crop.y, crop.h, rect.h);
    for (let y = 0; y < rect.h; y++) {
        const so = ys[y] * sw, d = (rect.y + y) * dw + rect.x;
        for (let x = 0; x < rect.w; x++) dst[d + x] = src[so + xs[x]];
    }
    // le chroma : plans U et V de la source (sw/2 x sh/2), côte à côte dans l'atlas sous la luma
    const cw = sw >> 1, ch = sh >> 1, rw = rect.w >> 1, rh = rect.h >> 1, hw = dw >> 1;
    const cxs = table(crop.x >> 1, crop.w >> 1, rw), cys = table(crop.y >> 1, crop.h >> 1, rh);
    const uo = sw * sh, vo = uo + cw * ch, base = dw * dh;
    for (let y = 0; y < rh; y++) {
        const su = uo + cys[y] * cw, sv = vo + cys[y] * cw, d = base + ((rect.y >> 1) + y) * dw + (rect.x >> 1);
        for (let x = 0; x < rw; x++) { dst[d + x] = src[su + cxs[x]]; dst[d + hw + x] = src[sv + cxs[x]]; }
    }
    return dst;
}

module.exports = { layerRect, cropFor, compose, BLACK_Y, BLACK_C };
