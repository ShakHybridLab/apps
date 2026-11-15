'use strict';
/**
 * « Laisser libre la bande du bas de BMW » (cluster, réglage stripClear). La bande de BMW (portée, heure, rue, mode de
 * conduite et rapport, température extérieure, portée électrique) occupe le bas de l'écran. Quand le thème s'arrête
 * au-dessus d'elle, à y 646, le KOMBI ne dessine plus ses cases noires par-dessus (l'appli d'origine, eroobeeroo
 * cluster_layouts : réglage « Bottom strip : the car's own », trouvé et essayé sur des voitures à mode « Electric
 * Individual », 660 touchait déjà le haut du mode de conduite ; photos du 15 nov. 2026 : à 662 les cases restent).
 * Sous la limite, une bande noire cache le bord des cadrans de BMW et le filet qu'il trace au-dessus de sa bande ; elle
 * s'arrête plus haut (y 658) devant le mode de conduite et le rapport (x 1196..1424) pour ne pas en couper le haut.
 * hud.js comprime tout le thème à TOP / 720 de sa hauteur ; ce fichier donne la limite, la bande noire (trois
 * couches pleines que la compression ne touche pas) et les lignes du bas que la bande de BMW redit déjà.
 */
const TOP = 646;
const BAND_BOTTOM = 662;
const NOTCH = [1196, 1424];
const NOTCH_BOTTOM = 658;
const WIDTH = 1920;

/** Les trois couches de la bande noire : { id, type: 'fill', x, y, w, h, color, fixed } (fixed : pas comprimée). */
function band() {
    return [[0, NOTCH[0], BAND_BOTTOM], [NOTCH[0], NOTCH[1], NOTCH_BOTTOM], [NOTCH[1], WIDTH, BAND_BOTTOM]].map(([x0, x1, y1], i) =>
        ({ id: 'strip_band' + i, type: 'fill', z: 1, x: x0, y: TOP, w: x1 - x0, h: y1 - TOP, color: [0, 0, 0, 255], fixed: true }));
}

// ce que la bande de BMW montre déjà : portée (carburant), heure, température extérieure, portée électrique, mode de conduite
// et rapport ; avec la vue Waze de M Blade les mêmes lignes ont le préfixe o_
const DUP = /^(o_)?(time|ampm|range|range_icon|range_unit|fuel_icon|outside|outside_unit|ev_range|ev_range_unit|ev_icon|drive_mode|batt_icon)$/;
/** Faut-il retirer cet élément quand la bande de BMW est libre (elle le dit déjà) ? */
function duplicates(id) { return DUP.test(String(id)); }

module.exports = { TOP, BAND_BOTTOM, NOTCH, NOTCH_BOTTOM, band, duplicates };
