'use strict';
/**
 * bc_button.js - the BC button at the end of the indicator stalk, read from de.bmw.body.Light IndicatorSteeringColumn.
 * On the owner's car (ShakManette, 19 Nov 2026) the value is { operationColumnStalks: 64 } while the button is held and { operationColumnStalks: 0 }
 * when it is let go; the car repeats the value many times a second. A press is the change from "bit 64 off" to "bit 64 on" (the other bits are the
 * indicators and the high beam: a press with an indicator on still counts). Read only. Never throws; Node 8. Written for this fork (MIT).
 */
const BC_BIT = 64;
const AGAIN_MS = 250;           // two presses closer than this are one (a bouncing contact)

class BcButton {
    /** onPress(): called once per press. now(): the clock (tests). */
    constructor(onPress, now) {
        this.onPress = onPress;
        this.now = now || Date.now;
        this.down = null;            // null: no value yet (a button held while the app starts is not a press)
        this.at = -Infinity;
        this.presses = 0;
    }

    /** The number in a value of IndicatorSteeringColumn (a struct with operationColumnStalks, or a bare number), or null. */
    static stalks(v) {
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (!v || typeof v !== 'object') return null;
        const k = Object.keys(v).find((n) => /^operationColumnStalks$/i.test(n));
        const n = k === undefined ? NaN : Number(v[k]);
        return isFinite(n) ? n : null;
    }

    value(v) {
        const n = BcButton.stalks(v);
        if (n === null) return;
        const down = (n & BC_BIT) !== 0, was = this.down;
        this.down = down;
        if (was !== false || !down) return;
        const t = this.now();
        if (t >= this.at && t - this.at < AGAIN_MS) return;          // (a clock set back: t < at, the press counts)
        this.at = t; this.presses++;
        try { this.onPress(); } catch (e) { /* the caller's own trouble */ }
    }
}

module.exports = { BcButton, BC_BIT };
