'use strict';
/**
 * Small line icons, drawn here (no image files): straight RGBA for an image layer, w x h, in one colour.
 * Each icon is a distance function in a 0..1 box; coverage is anti-aliased over one pixel.
 *   gauge (engine), shock (chassis), wheel (steering), cog (gearbox), stack (the gear's shift program
 *   lines), therm (coolant), oilcan (oil), fuel (pump), tyre (a wheel seen from the side: ring, hub, tread notches),
 *   oilPour, tempWave, tempOut (ShakHUD's modern oil can, the thermometer with heat waves for the coolant, a plain one for the outside),
 *   battery (a plug-in hybrid's high-voltage battery: the cell with a bolt in it, terminal on top).
 *   fuelBolt (the total range, fuel and electric: the pump's body with the battery's bolt in it).
 *   warn (the car's check control message: a warning triangle), ring (the speed limit sign's ring, also the danger alert's), stopwatch (the 0-100 timer), snow (the ice alert), leaf (the trip's electric share), flag (the launch cue: a chequered flag).
 */
function seg(px, py, ax, ay, bx, by) {
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
    return Math.hypot(pax - bax * h, pay - bay * h);
}
const ring = (px, py, cx, cy, r) => Math.abs(Math.hypot(px - cx, py - cy) - r);
const disc = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
function rect(px, py, cx, cy, hx, hy) {          // signed distance to a box of half sizes hx, hy
    const dx = Math.abs(px - cx) - hx, dy = Math.abs(py - cy) - hy;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
function arc(px, py, cx, cy, r, a0, a1) {          // clockwise from 12 o'clock, radians, a0 < a1
    let a = Math.atan2(px - cx, -(py - cy)); if (a < a0) a += Math.PI * 2;
    if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - r);
    const e = (b) => Math.hypot(px - (cx + r * Math.sin(b)), py - (cy - r * Math.cos(b)));
    return Math.min(e(a0), e(a1));
}

// a cone that grows from a point to a round end (a drop): the signed distance to it
function cone(px, py, ax, ay, ar, bx, by, br) {
    const bax = bx - ax, bay = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * bax + (py - ay) * bay) / (bax * bax + bay * bay)));
    return Math.hypot(px - (ax + bax * t), py - (ay + bay * t)) - (ar + (br - ar) * t);
}
const drop = (px, py) => Math.min(cone(px, py, 0.5, 0.06, 0.0, 0.5, 0.62, 0.3), disc(px, py, 0.5, 0.62, 0.3));
const tube = (px, py) => cone(px, py, 0.36, 0.2, 0.115, 0.36, 0.62, 0.115);
const tubeC = (px, py) => cone(px, py, 0.5, 0.18, 0.12, 0.5, 0.6, 0.12);

/** Distance (in box units) from (x, y) to the icon's ink; < 0 or < stroke half-width = ink. */
const ICONS = {
    gauge: (x, y) => Math.min(arc(x, y, 0.5, 0.55, 0.36, -0.75 * Math.PI, 0.75 * Math.PI) - 0.045, seg(x, y, 0.5, 0.55, 0.7, 0.36) - 0.045, disc(x, y, 0.5, 0.55, 0.07)),
    shock: (x, y) => Math.min(seg(x, y, 0.24, 0.78, 0.5, 0.52) - 0.11, seg(x, y, 0.5, 0.52, 0.78, 0.24) - 0.035, seg(x, y, 0.14, 0.88, 0.2, 0.82) - 0.05, seg(x, y, 0.8, 0.22, 0.86, 0.16) - 0.05),
    wheel: (x, y) => Math.min(ring(x, y, 0.5, 0.5, 0.38) - 0.055, disc(x, y, 0.5, 0.55, 0.1), seg(x, y, 0.14, 0.5, 0.42, 0.55) - 0.05, seg(x, y, 0.58, 0.55, 0.86, 0.5) - 0.05, seg(x, y, 0.5, 0.62, 0.5, 0.86) - 0.05),
    cog: (x, y) => {
        let d = Math.min(ring(x, y, 0.5, 0.5, 0.27) - 0.06, ring(x, y, 0.5, 0.5, 0.1) - 0.04);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; d = Math.min(d, seg(x, y, 0.5 + 0.3 * Math.sin(a), 0.5 - 0.3 * Math.cos(a), 0.5 + 0.42 * Math.sin(a), 0.5 - 0.42 * Math.cos(a)) - 0.06); }
        return d;
    },
    stack: (x, y) => Math.min(seg(x, y, 0.1, 0.22, 0.62, 0.22) - 0.055, seg(x, y, 0.1, 0.5, 0.78, 0.5) - 0.06, seg(x, y, 0.1, 0.8, 0.92, 0.8) - 0.075),
    // ShakHUD's modern oil can with its drop, and a thermometer with two heat waves
    oilPour: (x, y) => Math.min(rect(x, y, 0.4, 0.64, 0.25, 0.12) - 0.07,                                    // the can's low body
        seg(x, y, 0.2, 0.56, 0.06, 0.4) - 0.05, seg(x, y, 0.06, 0.4, 0.06, 0.3) - 0.05,                      // the handle, up behind
        seg(x, y, 0.3, 0.5, 0.3, 0.36) - 0.04, seg(x, y, 0.18, 0.34, 0.42, 0.34) - 0.045,                    // the filler neck and its cap
        seg(x, y, 0.62, 0.56, 0.9, 0.3) - 0.05,                                                              // the long spout
        Math.min(cone(x, y, 0.93, 0.5, 0.0, 0.93, 0.76, 0.09), disc(x, y, 0.93, 0.76, 0.09))),              // the drop falling from it
    tempOut: (x, y) => Math.min(Math.abs(tubeC(x, y)) - 0.04, disc(x, y, 0.5, 0.76, 0.19), seg(x, y, 0.5, 0.4, 0.5, 0.7) - 0.045),      // a plain thermometer (the outside temperature)
    tempWave: (x, y) => {
        let d = Math.min(Math.abs(tube(x, y)) - 0.04, disc(x, y, 0.36, 0.76, 0.19), seg(x, y, 0.36, 0.4, 0.36, 0.7) - 0.045);
        [0.26, 0.5].forEach((yy) => { d = Math.min(d, seg(x, y, 0.62, yy, 0.7, yy - 0.07) - 0.035, seg(x, y, 0.7, yy - 0.07, 0.78, yy) - 0.035, seg(x, y, 0.78, yy, 0.86, yy - 0.07) - 0.035); });
        return d;
    },
    // ShakHUD's modern battery (a rounded cell, its terminal, a bolt) and fuel pump (a rounded body with a window, the hose)
    battBolt: (x, y) => Math.min(Math.abs(rect(x, y, 0.5, 0.58, 0.25, 0.33) - 0.06) - 0.04, rect(x, y, 0.5, 0.12, 0.1, 0.045) - 0.02,
        seg(x, y, 0.57, 0.34, 0.42, 0.6) - 0.045, seg(x, y, 0.42, 0.6, 0.58, 0.6) - 0.045, seg(x, y, 0.58, 0.6, 0.43, 0.84) - 0.045),
    fuelPump: (x, y) => Math.min(Math.abs(rect(x, y, 0.37, 0.55, 0.2, 0.34) - 0.05) - 0.04, rect(x, y, 0.37, 0.34, 0.12, 0.07) - 0.02,
        rect(x, y, 0.37, 0.92, 0.3, 0.025) - 0.02, seg(x, y, 0.62, 0.3, 0.82, 0.45) - 0.04, seg(x, y, 0.82, 0.45, 0.82, 0.74) - 0.04, disc(x, y, 0.82, 0.78, 0.06)),
    // the combined range (fuel and electric): the pump's body with the battery's bolt in it
    fuelBolt: (x, y) => Math.min(Math.abs(rect(x, y, 0.37, 0.55, 0.23, 0.34) - 0.05) - 0.04, rect(x, y, 0.37, 0.92, 0.33, 0.025) - 0.02,
        seg(x, y, 0.65, 0.3, 0.85, 0.45) - 0.04, seg(x, y, 0.85, 0.45, 0.85, 0.74) - 0.04, disc(x, y, 0.85, 0.78, 0.06),
        seg(x, y, 0.44, 0.36, 0.32, 0.58) - 0.032, seg(x, y, 0.32, 0.58, 0.44, 0.58) - 0.032, seg(x, y, 0.44, 0.58, 0.32, 0.8) - 0.032),
    therm: (x, y) => Math.min(seg(x, y, 0.42, 0.14, 0.42, 0.6) - 0.07, disc(x, y, 0.42, 0.74, 0.14), seg(x, y, 0.6, 0.24, 0.76, 0.24) - 0.035, seg(x, y, 0.6, 0.4, 0.76, 0.4) - 0.035),
    fuel: (x, y) => Math.min(Math.max(Math.abs(x - 0.38) - 0.18, Math.abs(y - 0.55) - 0.33, -Math.max(Math.abs(x - 0.38) - 0.1, Math.abs(y - 0.36) - 0.08)), seg(x, y, 0.12, 0.9, 0.64, 0.9) - 0.04, seg(x, y, 0.56, 0.36, 0.76, 0.48) - 0.04, seg(x, y, 0.76, 0.48, 0.76, 0.78) - 0.04, seg(x, y, 0.76, 0.78, 0.66, 0.84) - 0.04),
    tyre: (x, y) => {
        let d = Math.min(ring(x, y, 0.5, 0.5, 0.4) - 0.075, ring(x, y, 0.5, 0.5, 0.17) - 0.04);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; d = Math.min(d, seg(x, y, 0.5 + 0.42 * Math.sin(a), 0.5 - 0.42 * Math.cos(a), 0.5 + 0.49 * Math.sin(a), 0.5 - 0.49 * Math.cos(a)) - 0.04); }
        return d;
    },
    battery: (x, y) => Math.min(Math.abs(rect(x, y, 0.5, 0.57, 0.27, 0.33)) - 0.04, rect(x, y, 0.5, 0.13, 0.1, 0.05), seg(x, y, 0.57, 0.3, 0.42, 0.58) - 0.035, seg(x, y, 0.42, 0.58, 0.58, 0.58) - 0.035, seg(x, y, 0.58, 0.58, 0.43, 0.84) - 0.035),
    // a speed camera on its pole (ShakTheme' "danger zone" alert): the box with its lens, the pole and its foot
    cam: (x, y) => Math.min(Math.abs(rect(x, y, 0.44, 0.36, 0.34, 0.2)) - 0.045, ring(x, y, 0.34, 0.36, 0.1) - 0.04, disc(x, y, 0.34, 0.36, 0.04), seg(x, y, 0.7, 0.3, 0.74, 0.3) - 0.03, seg(x, y, 0.5, 0.56, 0.5, 0.92) - 0.055, seg(x, y, 0.3, 0.93, 0.7, 0.93) - 0.045),
    // the round outline of a speed-limit sign (the number sits inside it as text)
    ring: (x, y) => ring(x, y, 0.5, 0.5, 0.435) - 0.065,
    signDisc: (x, y) => disc(x, y, 0.5, 0.5, 0.44),     // the white inside of the speed limit sign, under its ring (hud.js _paintLimitSign)
    signRing: (x, y) => ring(x, y, 0.5, 0.5, 0.45) - 0.05,   // the sign's red ring: a tenth of its width, as a road sign's (the plain "ring" is thicker)
    // the ice alert: a snowflake (three arms through the middle, a V on each end)
    snow: (x, y) => {
        let d = 9;
        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
            d = Math.min(d, seg(x, y, 0.5 - 0.42 * ux, 0.5 - 0.42 * uy, 0.5 + 0.42 * ux, 0.5 + 0.42 * uy) - 0.04);
            [-1, 1].forEach((sg) => {
                const bx = 0.5 + 0.27 * sg * ux, by = 0.5 + 0.27 * sg * uy, out = a + (sg > 0 ? 0 : Math.PI);
                [-0.9, 0.9].forEach((t) => { d = Math.min(d, seg(x, y, bx, by, bx + 0.15 * Math.cos(out + t), by + 0.15 * Math.sin(out + t)) - 0.035); });
            });
        }
        return d;
    },
    // a check control message of the car showing: the warning triangle with its exclamation mark
    warn: (x, y) => Math.min(
        seg(x, y, 0.5, 0.1, 0.07, 0.86) - 0.05, seg(x, y, 0.5, 0.1, 0.93, 0.86) - 0.05, seg(x, y, 0.07, 0.86, 0.93, 0.86) - 0.05,
        seg(x, y, 0.5, 0.38, 0.5, 0.6) - 0.045, disc(x, y, 0.5, 0.73, 0.055)),
    // the share of the trip driven on electricity: a leaf (an outline lens with its vein and stem)
    leaf: (x, y) => Math.min(Math.abs(Math.max(disc(x, y, 0.288, 0.288, 0.59), disc(x, y, 0.712, 0.712, 0.59))) - 0.04,
        seg(x, y, 0.2, 0.8, 0.62, 0.38) - 0.03, seg(x, y, 0.14, 0.86, 0.06, 0.94) - 0.04),
    // the 0-100 timer: a stopwatch, its crown on top and its hand
    stopwatch: (x, y) => Math.min(ring(x, y, 0.5, 0.58, 0.34) - 0.05, seg(x, y, 0.5, 0.16, 0.5, 0.24) - 0.05, seg(x, y, 0.4, 0.1, 0.6, 0.1) - 0.04,
        seg(x, y, 0.5, 0.58, 0.63, 0.4) - 0.045, disc(x, y, 0.5, 0.58, 0.06), seg(x, y, 0.8, 0.28, 0.86, 0.22) - 0.04),
    // the launch cue: a chequered flag on its pole (a frame of 4 x 3 squares, every other one filled)
    flag: (x, y) => {
        const fx = 0.2, fy = 0.1, cw = 0.1875, ch = 0.2, fw = 4 * cw, fh = 3 * ch;
        let d = Math.min(seg(x, y, 0.13, 0.06, 0.13, 0.96) - 0.04, Math.abs(Math.max(Math.abs(x - fx - fw / 2) - fw / 2, Math.abs(y - fy - fh / 2) - fh / 2)) - 0.025);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) d = Math.min(d, Math.max(Math.abs(x - fx - (i + 0.5) * cw) - cw / 2, Math.abs(y - fy - (j + 0.5) * ch) - ch / 2));
        return d;
    },
    oilcan: (x, y) => Math.min(seg(x, y, 0.2, 0.62, 0.6, 0.62) - 0.12, seg(x, y, 0.6, 0.58, 0.9, 0.44) - 0.04, disc(x, y, 0.92, 0.66, 0.05), seg(x, y, 0.3, 0.46, 0.3, 0.34) - 0.035, seg(x, y, 0.22, 0.34, 0.38, 0.34) - 0.04),
};

function paintIcon(name, w, h, color) {
    const f = ICONS[name], out = Buffer.alloc(w * h * 4, 0);
    if (!f) return out;
    const s = Math.min(w, h), ox = (w - s) / 2, oy = (h - s) / 2, aa = 1 / s;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = f((x + 0.5 - ox) / s, (y + 0.5 - oy) / s);
            const a = Math.max(0, Math.min(1, 0.5 - d / aa));
            if (a <= 0) continue;
            const o = (y * w + x) * 4;
            out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = Math.round(a * (color[3] === undefined ? 255 : color[3]));
        }
    }
    return out;
}

module.exports = { paintIcon, ICONS };
