'use strict';
/**
 * accent.js - the colour a theme takes from the drive mode: blue in the electric / eco mode, green in Hybrid, red in Sport.
 *
 * Only the theme's own blues change (the speed bracket, the hexagon, the backdrop's tint, the speed scale numbers); the hybrid's blue
 * (the battery drives) and green (it charges), the cold oil's blue, the fuel and battery bars and every warning keep theirs. The shaders
 * are the same source each time: the listed blue literals (shaders.js ACCENT_LITERALS) are rewritten to the mode's hue when the layer is
 * made, so no shader token is added (the M Blade layer has 11 to spare). Blue is the identity: nothing changes for it.
 * Plain Node 8 (the car's 8.16.2). Written for this fork (MIT).
 */
const HUES = ['blue', 'green', 'red'];

/** The hue for a drive mode ('eco' = Electric Eco Pro | 'hybrid' | 'sport'); blue until the car has said. */
function hueOfMode(mode) {
    return mode === 'sport' ? 'red' : mode === 'hybrid' ? 'green' : 'blue';
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A blue-family colour (r, g, b in 0..1, the blue strongest) in the hue: [r, g, b], each clamped to 0..1. Blue returns it as it is. */
function mapRgb(r, g, b, hue) {
    if (hue !== 'green' && hue !== 'red') return [r, g, b];
    let o = hue === 'green'
        ? [0.5 * g + 0.2 * r, 0.82 * b, 0.55 * g + 0.1 * r]
        : [b, 0.2 * g + 0.05 * r, 0.3 * r + 0.05 * g];
    // the darkest colours (a backdrop) keep the blue's brightness: a green or red of the same numbers would look much brighter or darker
    const li = lum(r, g, b), lo = lum(o[0], o[1], o[2]);
    const w = Math.max(0, Math.min(1, (0.12 - li) / 0.07));
    // (a red backdrop of the same brightness still looks much stronger than a blue one: 35 % less)
    if (w > 0 && lo > 0) { const k = (1 + (li / lo - 1) * w) * (hue === 'red' ? 1 - 0.35 * w : 1); o = o.map((v) => v * k); }
    return o.map((v) => Math.max(0, Math.min(1, v)));
}

/** The same for an [r, g, b, a] colour in 0..255 (a theme role). */
function mapRole(c, hue) {
    if (!Array.isArray(c) || c.length < 3) return c;
    const o = mapRgb(c[0] / 255, c[1] / 255, c[2] / 255, hue).map((v) => Math.round(v * 255));
    return c.length > 3 ? o.concat(c.slice(3)) : o;
}

const num = (v) => { const s = String(Math.round(v * 1000) / 1000); return s.indexOf('.') >= 0 ? s : s + '.0'; };

/**
 * `src` with every "r, g, b" literal of `triples` (strings as they are written in the shader, "0.36, 0.62, 1.0") rewritten to the hue.
 * Throws when a triple isn't in the source (the shader was edited and the list wasn't).
 */
function accentSource(src, triples, hue) {
    if (hue !== 'green' && hue !== 'red') return src;
    let out = src;
    triples.forEach((t) => {
        const v = t.split(',').map(Number);
        if (out.indexOf(t) < 0) throw new Error('accent: "' + t + '" is not in the shader');
        const o = mapRgb(v[0], v[1], v[2], hue).map(num).join(', ');
        out = out.split(t).join('\u0000' + o + '\u0001');     // marked, so a rewritten triple is never rewritten again
    });
    return out.split('\u0000').join('').split('\u0001').join('');
}

/** The theme with its blue roles (`roles`, names) in the hue; the same object for blue. */
function accentTheme(theme, roles, hue) {
    if ((hue !== 'green' && hue !== 'red') || !roles || !roles.length) return theme;
    const t = Object.assign({}, theme);
    roles.forEach((r) => { if (t[r]) t[r] = mapRole(t[r], hue); });
    return t;
}

module.exports = { HUES, hueOfMode, mapRgb, mapRole, accentSource, accentTheme };
