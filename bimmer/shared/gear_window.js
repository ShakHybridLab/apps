'use strict';
/**
 * « Trou de la lettre de rapport » (cluster, réglage gearWindow). BMW dessine sa case noire (1406,322)-(1597,440) par-dessus
 * un thème tant qu'un calque en recouvre la lettre de rapport, en bas à droite (x 1392..1448, y 666..702 sur cette voiture,
 * mesuré sur des photos). Deux applis y sont arrivées par le même chemin, sans contourner la case : elles ne recouvrent
 * pas cette lettre, et BMW ne dessine plus la case.
 *  - eroobeeroo (cluster_layouts, « Bottom strip: the car's own ») coupe le rectangle de chaque calque à y 646 ;
 *  - Bimmer Lab (Cluster Themes 0.17.6 à 0.18.1, ticket n° 5) garde le thème plein écran avec un trou en bas à droite :
 *    x 1150..1470 en 0.17.6 (essayé sur une voiture : la case a disparu), 1365..1460 en 0.17.7, 1380..1460 depuis 0.17.8,
 *    toujours y 660..720. Le trou n'est pas un contour : c'est le RECTANGLE des calques qui ne doit pas le toucher.
 * Ici : le thème reste plein écran, mais chaque fond est coupé en trois calques qui ne touchent pas le trou : le haut (jusqu'à
 * y 660) et deux petits morceaux sous 660, de chaque côté du trou. Les trois dessinent la même image (un morceau de la même
 * image, pas un fond écrasé : les shaders lisent u_rect et u_org), et les deux morceaux copient tout ce que fait le calque du
 * haut (hud.js _follow). Aucun texte ni icône ne touche le trou. Quatre tailles de trou à essayer (réglage gearWindow) :
 *   1 : x 1380..1460 (Bimmer Lab 0.17.8, la plus petite)       2 : x 1300..1500
 *   3 : x 1150..1470 (Bimmer Lab 0.17.6, essayée sur voiture)   4 : toute la bande (comme eroobeeroo : BMW garde la sienne)
 * « auto » : la taille 1 pour les quatre thèmes (l'essai d'une taille par thème, 1 / 2 / 3 / 4, a fait disparaître la case dans les quatre).
 */
const WIDTH = 1920;
const HEIGHT = 720;
const TOP = 660;
const VARIANTS = { '1': [1380, 1460], '2': [1300, 1500], '3': [1150, 1470], '4': [0, WIDTH] };
const AUTO = { sport: '1', m: '1', mblade: '1', navi: '1', evo: '1', circuit: '1' };   // essai du 16 nov. 2026 (tailles 1, 2, 3 et 4 : la case noire a disparu dans les quatre thèmes) : la plus petite suffit
const LETTER = [1392, 666, 1448, 702];          // la lettre de rapport de BMW, mesurée sur les photos
const PIECES = { sdash: true, mdash: true, mblade: true, navi: true, evo: true, circuit: true };   // les fonds dont le shader sait dessiner un morceau de l'image (u_rect, u_org)
const NUDGE = 6;                                 // un texte ou une icône qui mord d'au plus 6 px est poussé hors du trou

/** Le trou à utiliser : { id, x, y, w, h } ou null (réglage « off », inconnu, ou un layout qui n'est pas l'un des thèmes). */
function pick(setting, layoutName) {
    if (!AUTO[layoutName]) return null;
    const id = setting === 'auto' || setting === undefined || setting === null ? AUTO[layoutName] : String(setting);
    const v = VARIANTS[id];
    if (!v) return null;
    return { id, x: v[0], y: TOP, w: v[1] - v[0], h: HEIGHT - TOP };
}

function hit(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
/** Le rectangle que le calque occupe vraiment : le "rect" d'un morceau de fond, sinon l'élément lui-même. */
function box(w) { return w.rect || w; }

/**
 * Les éléments du layout rangés autour du trou. isImage(type) dit si un élément est un texte ou une image (sinon c'est un
 * effet). Rend { widgets, dropped, nudged, cropped } : un effet qui touche le trou est coupé à y 660 (retiré s'il commence
 * plus bas), un texte ou une icône qui mord de peu est poussé, sinon retiré ; deux bandes noires pleines sont ajoutées sous
 * 660 (rien pour la taille 4 : BMW garde sa bande). Les éléments d'origine ne sont pas modifiés (copies).
 */
function apply(widgets, win, isImage) {
    const dropped = [], nudged = [], cropped = [], pieces = [];
    let black = false;               // un fond coupé dont le shader ne sait pas dessiner un morceau : une bande noire à la place
    const out = [];
    widgets.forEach((w) => {
        if (!hit(w, win)) { out.push(w); return; }
        if (!isImage(w.type)) {
            if (w.y >= win.y) { dropped.push(w.id); return; }
            // le haut du fond (la hauteur de l'élément reste celle de l'image : seul le rectangle du calque est coupé)
            out.push(Object.assign({}, w, { rect: { x: w.x, y: w.y, w: w.w, h: win.y - w.y } }));
            cropped.push(w.id);
            const bottom = w.y + w.h - win.y;
            if (bottom > 0 && PIECES[w.type]) {
                [['gl', w.x, win.x], ['gr', win.x + win.w, w.x + w.w]].forEach(([suffix, x0, x1]) => {
                    if (x1 > x0) { out.push(Object.assign({}, w, { id: w.id + '_' + suffix, follow: w.id, rect: { x: x0, y: win.y, w: x1 - x0, h: bottom } })); pieces.push(w.id + '_' + suffix); }
                });
            } else if (bottom > 0) black = true;
            return;
        }
        // le plus petit déplacement qui sort du trou : vers le haut (un texte dont le bas dépasse y 660), à droite ou à gauche
        const cand = [];
        if (w.y < win.y) cand.push({ dy: win.y - (w.y + w.h) });
        if (w.x + (win.x + win.w - w.x) + w.w <= WIDTH) cand.push({ dx: win.x + win.w - w.x });
        if (w.x - (w.x + w.w - win.x) >= 0) cand.push({ dx: win.x - (w.x + w.w) });
        const size = (m) => Math.abs(m.dx === undefined ? m.dy : m.dx);
        cand.sort((a, b) => size(a) - size(b));
        const move = cand.length && size(cand[0]) <= NUDGE ? cand[0] : null;
        if (!move) { dropped.push(w.id); return; }
        out.push(Object.assign({}, w, { x: w.x + (move.dx || 0), y: w.y + (move.dy || 0) }));
        nudged.push(w.id);
    });
    if (black) {
        [[0, win.x, 'gw_cover_l'], [win.x + win.w, WIDTH, 'gw_cover_r']].forEach(([x0, x1, id]) => {
            if (x1 > x0) out.push({ id, type: 'fill', z: 1, x: x0, y: win.y, w: x1 - x0, h: win.h, color: [0, 0, 0, 255], fixed: true });
        });
    }
    return { widgets: out, dropped, nudged, cropped, pieces };
}

module.exports = { WIDTH, HEIGHT, TOP, VARIANTS, AUTO, LETTER, pick, hit, box, apply };
