'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * mgvf_writer.js - écrit des images I420 dans un fichier MGVF (le format que bimmer/shared/video_bridge.js lit).
 * En-tête de 64 octets : "MGVF", version, w, h, seq, slot, nslot, matrice, plein écran ; puis `nslot` images I420.
 * L'écrivain remplit l'emplacement (slot + 1) % nslot, PUIS écrit slot, PUIS seq + 1 : le lecteur ne voit jamais une image à moitié écrite.
 */
const fs = require('fs');

const MAGIC = 0x4656474d, HEAD = 64, NSLOT = 3;

class MgvfWriter {
    constructor(file, w, h) {
        this.file = file; this.w = w; this.h = h; this.fb = w * h * 3 / 2;
        this.seq = 0; this.slot = NSLOT - 1;
        this.fd = fs.openSync(file, 'w', 0o644);
        fs.ftruncateSync(this.fd, HEAD + NSLOT * this.fb);
        this._head();
    }

    _head() {
        const b = Buffer.alloc(HEAD);
        [MAGIC, 1, this.w, this.h, this.seq, this.slot, NSLOT, 709, 0].forEach((v, i) => b.writeUInt32LE(v, i * 4));
        fs.writeSync(this.fd, b, 0, HEAD, 0);
    }

    /** `frame` : Buffer I420 de w x h. */
    write(frame) {
        if (frame.length !== this.fb) throw new Error('image de ' + frame.length + ' octets, ' + this.fb + ' attendus');
        const slot = (this.slot + 1) % NSLOT;
        fs.writeSync(this.fd, frame, 0, this.fb, HEAD + slot * this.fb);
        this.slot = slot; this.seq = (this.seq + 1) >>> 0;
        this._head();
    }

    close() { try { fs.closeSync(this.fd); } catch (e) { /* déjà fermé */ } }
}

module.exports = { MgvfWriter, MAGIC, HEAD, NSLOT };
