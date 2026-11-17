'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * fake_decoder.js - un décodeur de TEST : écrit une image de test dans le fichier MGVF, comme le vrai décodeur le fera.
 * Usage : node fake_decoder.js <front|rear> <fichier> ; s'arrête sur SIGTERM.
 * Le vrai décodeur (natif : flux AVB de la caméra -> H.264 -> Intel Media SDK -> I420) a la MÊME ligne de commande : voir README.md.
 */
const { MgvfWriter } = require('./mgvf_writer');

const cam = process.argv[2], file = process.argv[3];
if ((cam !== 'front' && cam !== 'rear') || !file) { process.stderr.write('usage : fake_decoder.js front|rear fichier\n'); process.exit(2); }

const W = 320, H = 180, w = new MgvfWriter(file, W, H), buf = Buffer.alloc(W * H * 3 / 2);
let n = 0;
const timer = setInterval(() => {
    buf.fill(cam === 'front' ? 80 : 110, 0, W * H);
    const x = (n * 4) % W; for (let y = 0; y < H; y++) buf[y * W + x] = 235;
    buf.fill(cam === 'front' ? 200 : 90, W * H, W * H + W * H / 4);          // U
    buf.fill(cam === 'front' ? 90 : 210, W * H + W * H / 4);                  // V
    w.write(buf); n++;
}, 66);
function bye() { clearInterval(timer); w.close(); process.exit(0); }
process.on('SIGTERM', bye); process.on('SIGINT', bye);
