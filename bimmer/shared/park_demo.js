'use strict';
/**
 * park_demo.js - ShakPark, mode essai : une image de test à la place de la caméra, pour essayer à la voiture tout ce qui n'est PAS la
 * capture (les règles de rapport et de vitesse, la fenêtre du cluster, la priorité sur Waze et RideTube) avant que l'outil de capture
 * existe. Même interface que le lecteur de fichier de park_app.js (read, live, forget, close ; head, src, seq) : ParkApp ne voit pas la différence.
 *
 * L'image : 320 x 180, I420 ; avant en bleu (« AVANT »), arrière en rouge (« ARRIERE »), des rayures en biais et une barre blanche qui
 * se déplace (on voit qu'elle bouge). Le fond est dessiné une fois ; chaque image copie le fond et ajoute la barre.
 * Node 8. MIT.
 */
const W = 320, H = 180;
const FRAME_MS = 66;             // 15 images par seconde, comme le plus que ParkApp envoie
const LIVE_MS = 1500;

// police 5 x 7 des seules lettres utilisées (un bit par point, 5 colonnes par rangée)
const GLYPH = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};
const COLOURS = { front: { y: 85, u: 175, v: 110 }, rear: { y: 80, u: 105, v: 190 } };    // bleu, rouge (BT.709, plage limitée)
const LABELS = { front: 'AVANT', rear: 'ARRIERE' };

function setPix(buf, x, y, Y, U, V) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    buf[y * W + x] = Y;
    const ci = (y >> 1) * (W >> 1) + (x >> 1);
    buf[W * H + ci] = U; buf[W * H + (W * H >> 2) + ci] = V;
}

/** Le fond d'une caméra : couleur, rayures en biais, le texte au milieu (échelle 6). */
function background(cam) {
    const c = COLOURS[cam], buf = Buffer.alloc(W * H * 3 / 2);
    buf.fill(c.y, 0, W * H); buf.fill(c.u, W * H, W * H + (W * H >> 2)); buf.fill(c.v, W * H + (W * H >> 2));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x + y) >> 4) % 2 === 0) buf[y * W + x] = Math.min(235, c.y + 18);
    const text = LABELS[cam], S = 6, cw = 6 * S, x0 = Math.floor((W - text.length * cw + S) / 2), y0 = Math.floor((H - 7 * S) / 2);
    // bande sombre derrière le texte, pour qu'on le lise
    for (let y = y0 - 8; y < y0 + 7 * S + 8; y++) for (let x = 0; x < W; x++) setPix(buf, x, y, 30, 128, 128);
    for (let i = 0; i < text.length; i++) {
        const g = GLYPH[text[i]];
        for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '1') {
            for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) setPix(buf, x0 + i * cw + q * S + dx, y0 + r * S + dy, 235, 128, 128);
        }
    }
    return buf;
}

class DemoFeed {
    constructor(cam) {
        this.cam = cam;
        this.base = background(cam);
        this.head = { w: W, h: H, frameBytes: W * H * 3 / 2 };
        this.src = Buffer.alloc(this.base.length);
        this.seq = null; this.seqAt = 0; this.n = 0; this.lastAt = -Infinity;
    }

    /** Une nouvelle image au plus toutes les FRAME_MS (la première compte, elle n'est pas un reste d'un fichier). */
    read(now) {
        if (now - this.lastAt < FRAME_MS) return null;
        this.lastAt = now;
        this.n++;
        this.base.copy(this.src);
        const x = (this.n * 6) % (W - 12);      // la barre blanche, 12 px, de gauche à droite
        for (let y = 8; y < 24; y++) for (let k = 0; k < 12; k++) setPix(this.src, x + k, y, 235, 128, 128);
        this.seq = this.n; this.seqAt = now;
        return this.src;
    }

    live(now) { return this.seq !== null && this.seqAt > 0 && now >= this.seqAt && now - this.seqAt < LIVE_MS; }
    forget() { this.seq = null; this.seqAt = 0; this.lastAt = -Infinity; }
    close() {}
}

module.exports = { DemoFeed, background, W, H, FRAME_MS };
