'use strict';
/**
 * park.js - ShakPark : quelle caméra montrer dans le cluster. Fonctions et une classe, sans accès à la voiture (testable seule :
 * tools/test_park.js).
 *
 * Règles du propriétaire (17 novembre 2026), sans réglage pour les changer :
 *   - caméra AVANT : seulement en avançant (rapport D) et sous 15 km/h ; la vitesse doit être connue et récente ;
 *   - caméra ARRIÈRE : seulement en marche arrière (rapport R) ; elle reste 2 s après avoir quitté R, puis s'éteint ;
 *   - toute autre situation (P, N, vitesse inconnue ou périmée, 15 km/h et plus) : aucune image.
 * La caméra avant n'apparaît qu'à moins de 14 km/h et disparaît dès 15 km/h : 1 km/h d'écart pour qu'elle ne clignote pas autour de la limite.
 *
 * Node 8. MIT.
 */

const FRONT_MAX_KMH = 15;        // à 15 km/h et plus, plus de caméra avant
const FRONT_ENTER_KMH = 14;      // elle n'apparaît qu'en dessous de cette vitesse
const REAR_MAX_KMH = 15;         // en marche arrière, au-delà : plus d'image (la voiture ne recule pas si vite, c'est un signal douteux)
const REAR_HOLD_MS = 2000;       // l'arrière reste ce temps après avoir quitté R
const FRONT_DELAY_MS = 400;      // la caméra avant attend ce temps de conditions réunies avant d'apparaître
const SPEED_STALE_MS = 5000;     // une vitesse plus vieille que ça compte pour inconnue

/**
 * La position du sélecteur : statusGearboxDrive.statusActualStageDrive (P = 1, R = 2, N = 3, D = 4, ou les noms),
 * ou DataPowerTrain2.statusGearSelectionDrive (N = 1, R = 2, P = 3, NP = 4, _1 à _9 = 5 à 13 : un rapport engagé, donc D).
 * Mêmes tables que kit/runtime/car.js. Retourne 'P' | 'R' | 'N' | 'D' | undefined (inconnu, ou N ou P sans distinction).
 */
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
function stageOfStatus(x) { return STAGES[x]; }
function stageOfSelection(x) {
    const n = typeof x === 'number' ? x : { N: 1, R: 2, P: 3, NP: 4 }[x] || (/^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : undefined);
    if (n === 1) return 'N';
    if (n === 2) return 'R';
    if (n === 3) return 'P';
    if (n >= 5 && n <= 13) return 'D';
    return undefined;
}

/** La vitesse en km/h d'une lecture de Vehicle2.statusCarSpeed2 (échelle 1/64), ou null (65535 = « invalide »). */
function speedOf(v) {
    const k = v && v.speedVehicleCentreOfGravity;
    return typeof k === 'number' && isFinite(k) && k !== 65535 ? Math.abs(k * 0.015625) : null;
}

class ParkLogic {
    constructor() {
        this.stage = null;               // 'P' | 'R' | 'N' | 'D' | null (inconnu)
        this.kmh = null; this.kmhAt = null;
        this.rearUntil = 0;              // jusqu'à quand l'arrière reste après avoir quitté R
        this.frontSince = null;
        this.shown = 'off';
    }

    /** Une position du sélecteur (undefined / null : inconnue). */
    gear(stage, now) {
        const s = stage === 'P' || stage === 'R' || stage === 'N' || stage === 'D' ? stage : null;
        if (this.stage === 'R' && s !== 'R') this.rearUntil = now + REAR_HOLD_MS;
        if (s === 'R') this.rearUntil = 0;
        this.stage = s;
    }

    /** Une vitesse en km/h (null : la voiture n'en donne pas). */
    speed(kmh, now) {
        this.kmh = typeof kmh === 'number' && isFinite(kmh) ? Math.abs(kmh) : null;
        this.kmhAt = now;
    }

    _fresh(now) { return this.kmh !== null && this.kmhAt !== null && now >= this.kmhAt && now - this.kmhAt < SPEED_STALE_MS; }

    /**
     * Ce qu'il faut montrer maintenant : 'rear' | 'front' | 'off'. `want` : { front, rear } (les deux réglages de l'appli).
     */
    view(now, want) {
        const fresh = this._fresh(now);
        const wantFront = !want || want.front !== false, wantRear = !want || want.rear !== false;
        // l'arrière : en R, ou dans les 2 s qui suivent. Une vitesse récente de 15 km/h et plus l'éteint ; une vitesse inconnue ne l'éteint pas (R suffit)
        const rear = wantRear && (this.stage === 'R' || (this.rearUntil > now && this.stage !== null)) && !(fresh && this.kmh >= REAR_MAX_KMH);
        if (rear) { this.frontSince = null; return (this.shown = 'rear'); }
        // l'avant : rapport D, vitesse connue, récente et sous la limite (14 pour apparaître, 15 pour rester)
        const limit = this.shown === 'front' ? FRONT_MAX_KMH : FRONT_ENTER_KMH;
        const front = wantFront && this.stage === 'D' && fresh && this.kmh < limit;
        if (!front) { this.frontSince = null; return (this.shown = 'off'); }
        if (this.shown === 'front') return 'front';
        if (this.frontSince === null) this.frontSince = now;
        return (this.shown = now - this.frontSince >= FRONT_DELAY_MS ? 'front' : 'off');
    }
}

module.exports = { ParkLogic, stageOfStatus, stageOfSelection, speedOf,
    FRONT_MAX_KMH, FRONT_ENTER_KMH, REAR_MAX_KMH, REAR_HOLD_MS, FRONT_DELAY_MS, SPEED_STALE_MS };
