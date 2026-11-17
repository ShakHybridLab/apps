'use strict';
const { accentSource } = require('./accent');
/**
 * The HUD's GLSL ES 1.00 fragment shaders for cluster-render "effect" layers, drawn on the
 * car's GPU. Kept as JS strings because the kit's build ships an app's top-level .js files
 * as they are (a data folder becomes a JSON-only pack). hud.js sends the uniforms.
 */
const SHIFTBAR = `// Segmented shift bar for a cluster-render "effect" layer (GLSL ES 1.00).
// v_uv is 0..1 across the layer, (0,0) at the top-left as on the car. Uniforms come from hud.js:
//   u_value   0..1, how much of the bar is lit (rpm / bar max)
//   u_size    layer size in px (w, h), for round corners and gaps in pixels
//   u_segs    segment count
//   u_low, u_mid, u_high   zone colours (rgb 0..1)
//   u_midAt, u_highAt      where the mid and high zones start (0..1 of the bar)
//   u_track   unlit segment colour (rgba, straight alpha)
//   u_flash   1 = at the redline: every lit segment shows the high colour
//   u_skip    driver camera wings: px from the layer's left (from, to) left empty; then u_segs segments on each
//             side, mirrored, filling from the outer ends in towards the gap. to <= from: one bar as usual
// Output is straight alpha. Whether cluster-render blends effect layers as
// straight or premultiplied alpha is not confirmed yet: check the edges on the car.
precision mediump float;
varying vec2 v_uv;
uniform float u_value;
uniform vec2 u_size;
uniform float u_segs;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_high;
uniform float u_midAt;
uniform float u_highAt;
uniform vec4 u_track;
uniform float u_flash;
uniform vec2 u_skip;

void main() {
    float gapPx = 3.0;
    float px = v_uv.x * u_size.x;
    float slot = u_size.x / u_segs;                 // px per segment incl. gap
    float local = px;                               // px from where the fill starts
    if (u_skip.y > u_skip.x) {                      // wings: left from its left end, right mirrored from its right end
        if (px >= u_skip.x && px < u_skip.y) { gl_FragColor = vec4(0.0); return; }
        if (px < u_skip.x) slot = u_skip.x / u_segs;
        else { slot = (u_size.x - u_skip.y) / u_segs; local = u_size.x - px; }
    }
    float idx = floor(local / slot);
    float inSeg = local - idx * slot;               // px into this slot
    float segW = slot - gapPx;
    float py = v_uv.y * u_size.y;           // px from the top

    // rounded-rect coverage for this segment, radius 2px, 1px soft edge
    vec2 hs = vec2(segW, u_size.y) * 0.5;
    vec2 p = vec2(inSeg, py) - hs;
    vec2 q = abs(p) - (hs - vec2(2.0));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 2.0;
    float cover = clamp(0.5 - d, 0.0, 1.0);
    if (inSeg > segW) cover = 0.0;
    if (cover <= 0.0) { gl_FragColor = vec4(0.0); return; }

    float pos = (idx + 0.5) / u_segs;               // segment centre, 0..1
    bool lit = pos <= u_value;
    vec3 c = pos >= u_highAt ? u_high : (pos >= u_midAt ? u_mid : u_low);
    if (u_flash > 0.5) c = u_high;
    gl_FragColor = lit ? vec4(c, cover) : vec4(u_track.rgb, u_track.a * cover);
}
`;

const ARC = `// Thin open arc gauge for a cluster-render "effect" layer (GLSL ES 1.00).
// u_start / u_sweep (radians, clockwise from 12 o'clock; a negative sweep runs anticlockwise), round
// ends, filled from the start. hud.js default: 270 degrees from the lower left, the gap at the bottom.
// Uniforms from hud.js:
//   u_value  0..1 of the sweep
//   u_size   layer size in px (w, h)
//   u_color  lit arc (rgb 0..1)
//   u_track  unlit arc (rgba, straight alpha)
//   u_width  stroke width in px
// Output is straight alpha (same open question as the shift bar shader above).
precision mediump float;
varying vec2 v_uv;
uniform float u_value;
uniform vec2 u_size;
uniform vec3 u_color;
uniform vec4 u_track;
uniform float u_width;
uniform float u_start;
uniform float u_sweep;
uniform float u_peak;    // peak hold 0..1 of the sweep, a bright dot on the stroke (below 0: none)
uniform vec3 u_peakC;

const float PI = 3.14159265359;

// distance from point p (centred, px) to the arc from angle a0 sweeping s, radius r
float arcDist(vec2 p, float r, float a0, float s) {
    float a = atan(p.x, p.y);           // clockwise from 12 o'clock, -PI..PI
    float rel = mod(a - a0 + 4.0 * PI, 2.0 * PI);
    if (rel <= s) return abs(length(p) - r);
    vec2 e0 = r * vec2(sin(a0), cos(a0));
    vec2 e1 = r * vec2(sin(a0 + s), cos(a0 + s));
    return min(length(p - e0), length(p - e1));   // round end caps
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from centre, +y up (v_uv is top-left)
    float start = u_start, sweep = u_sweep;
    if (sweep < 0.0) { p.x = -p.x; start = -start; sweep = -sweep; }   // anticlockwise = mirrored clockwise
    float r = min(u_size.x, u_size.y) * 0.5 - u_width * 0.5 - 1.0;
    float hw = u_width * 0.5;
    float dTrack = arcDist(p, r, start, sweep) - hw;
    float lit = clamp(u_value, 0.0, 1.0) * sweep;
    float dLit = lit > 0.001 ? arcDist(p, r, start, lit) - hw : 1e5;
    float cLit = clamp(0.5 - dLit, 0.0, 1.0);
    float cTrack = clamp(0.5 - dTrack, 0.0, 1.0);
    if (u_peak >= 0.0) {
        float pa = start + clamp(u_peak, 0.0, 1.0) * sweep;
        float dp = length(p - r * vec2(sin(pa), cos(pa))) - hw * 1.35;
        float cp = clamp(0.5 - dp, 0.0, 1.0);
        if (cp > 0.0) { gl_FragColor = vec4(u_peakC, cp); return; }
    }
    if (cLit > 0.0) gl_FragColor = vec4(u_color, cLit);
    else gl_FragColor = vec4(u_track.rgb, u_track.a * cTrack);
}
`;

const REVBAR = `// G20 Live Cockpit style rev bar for a cluster-render "effect" layer (GLSL ES 1.00), after
// cauliflowermossgrape's Redline app (MIT). From the top of the layer: u_top px for the shift-point and
// redline marks, then the bar (u_barH px, slanted: its top edge is u_slant px right of its bottom
// edge), then the scale ticks. The bar fills left to right in 500 rpm segments; each lit segment
// takes the ramp colour of its position up to the shift point (u_from -> u_to), all u_hot from the
// shift point on. Unlit: u_track, and u_hot faint past the redline. A white needle leads the fill;
// a thin slanted line holds the peak. Uniforms (rpm values are rpm, not 0..1):
//   u_size, u_top, u_barH, u_slant   px
//   u_max, u_value, u_shift, u_red, u_peak   rpm
//   u_from, u_to, u_hot   rgb 0..1;  u_track, u_tick, u_fg   rgba (straight alpha)
//   u_shiftNow   1 = at or past the shift point
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_top;
uniform float u_barH;
uniform float u_slant;
uniform float u_max;
uniform float u_value;
uniform float u_shift;
uniform float u_red;
uniform float u_peak;
uniform vec3 u_from;
uniform vec3 u_to;
uniform vec3 u_hot;
uniform vec4 u_track;
uniform vec4 u_tick;
uniform vec4 u_fg;
uniform float u_shiftNow;

vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    float px = v_uv.x * u_size.x;
    float py = v_uv.y * u_size.y;   // px from the top
    float bw = u_size.x - u_slant;            // bar length along the bottom edge
    float perRpm = bw / u_max;
    vec4 c = vec4(0.0);

    // marks above the bar: shift point (amber) and redline (red), at the bar's top edge
    if (py < u_top - 2.0) {
        float ds = abs(px - (u_shift * perRpm + u_slant));
        float dr = abs(px - (u_red * perRpm + u_slant));
        if (ds < 2.0) c = vec4(1.0, 0.76, 0.1, clamp(2.0 - ds, 0.0, 1.0));
        if (dr < 2.0) c = vec4(u_hot, clamp(2.0 - dr, 0.0, 1.0));
        gl_FragColor = c; return;
    }

    float by = py - u_top;                    // px down from the bar's top edge
    if (by <= u_barH) {
        float off = u_slant * (u_barH - by) / u_barH;
        float s = px - off;                   // px along the bar at this height
        float rpm = s / perRpm;
        float inside = clamp(s + 0.5, 0.0, 1.0) * clamp(bw - s + 0.5, 0.0, 1.0)
            * clamp(by + 0.5, 0.0, 1.0) * clamp(u_barH - by + 0.5, 0.0, 1.0);
        // slanted 3 px gap every 500 rpm
        float seg = floor(rpm / 500.0);
        float dGap = abs(s - floor(rpm / 500.0 + 0.5) * 500.0 * perRpm);
        float gap = rpm > 250.0 && rpm < u_max - 250.0 ? clamp(dGap - 1.0, 0.0, 1.0) : 1.0;
        vec4 bar;
        if (rpm <= u_value) {
            float f = clamp((seg * 500.0 + 250.0) / u_shift, 0.0, 1.0);
            vec3 col = u_shiftNow > 0.5 ? u_hot : mix(u_from, u_to, f);
            bar = vec4(col, 1.0);
        } else if (rpm >= u_red) bar = vec4(u_hot, 0.3);
        else bar = u_track;
        c = vec4(bar.rgb, bar.a * inside * gap);
        // peak: a thin slanted line where the rpm last peaked (only above the current rpm)
        if (u_peak > u_value + 60.0) {
            float dp = abs(s - u_peak * perRpm);
            vec3 pc = u_peak >= u_shift ? u_hot : mix(u_from, u_to, clamp(u_peak / u_shift, 0.0, 1.0));
            c = over(vec4(pc, clamp(1.5 - dp, 0.0, 1.0) * inside), c);
        }
        // needle: the bright leading edge of the fill
        if (u_value > 50.0) {
            float dn = abs(s - min(u_value, u_max) * perRpm);
            c = over(vec4(1.0, 1.0, 1.0, clamp(2.5 - dn, 0.0, 1.0) * clamp(by + 2.5, 0.0, 1.0) * clamp(u_barH - by + 2.5, 0.0, 1.0)), c);
        }
        gl_FragColor = c; return;
    }

    // scale ticks under the bar: every 500 rpm, longer every 1000, red from the redline
    float ty = by - u_barH - 4.0;
    if (ty >= 0.0) {
        float rpm = px / perRpm;
        float k = floor(rpm / 500.0 + 0.5);
        float d = abs(px - k * 500.0 * perRpm);
        bool major = mod(k, 2.0) < 0.5;
        float len = major ? 10.0 : 5.0;
        float hw = major ? 1.25 : 0.75;
        float a = clamp(hw + 0.5 - d, 0.0, 1.0) * (ty <= len ? 1.0 : 0.0);
        vec4 tc = k * 500.0 >= u_red ? vec4(u_hot, 1.0) : (major ? u_fg : u_tick);
        c = vec4(tc.rgb, tc.a * a);
    }
    gl_FragColor = c;
}
`;

const LIGHTS = `// Shift lights for a cluster-render "effect" layer (GLSL ES 1.00), after cauliflowermossgrape's Redline
// app (MIT): u_n rounded lights in a row, green -> yellow -> red from left to right. u_lit of them are
// on (they fill from a start rpm up to the shift point); u_strobe 1 = at the shift point: all red.
// The last u_tail lights are blue instead (the GT3 dash look; 0 = none). u_round 1 = round lights.
//   u_size px, u_n count, u_lit count (0..u_n), u_tail count, u_strobe 0/1, u_green/u_yellow/u_red/u_blue rgb,
//   u_off (alpha when off), u_skip driver camera wings: px from the layer's left (from, to) left empty, then u_n
//   lights on each side, mirrored, filling from the outer ends in towards the gap (to <= from: one row as usual)
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_n;
uniform float u_lit;
uniform float u_tail;
uniform float u_round;
uniform float u_strobe;
uniform vec3 u_green;
uniform vec3 u_yellow;
uniform vec3 u_red;
uniform vec3 u_blue;
uniform float u_off;
uniform vec2 u_skip;

void main() {
    float gapPx = 6.0;
    float slot = (u_size.x + gapPx) / u_n;
    float px = v_uv.x * u_size.x;
    float py = v_uv.y * u_size.y;
    float local = px;                               // px from where the fill starts
    if (u_skip.y > u_skip.x) {                      // wings: left from its left end, right mirrored from its right end
        if (px >= u_skip.x && px < u_skip.y) { gl_FragColor = vec4(0.0); return; }
        if (px < u_skip.x) slot = (u_skip.x + gapPx) / u_n;
        else { slot = (u_size.x - u_skip.y + gapPx) / u_n; local = u_size.x - px; }
    }
    float idx = floor(local / slot);
    float inSeg = local - idx * slot;
    float segW = slot - gapPx;
    if (inSeg > segW || idx >= u_n) { gl_FragColor = vec4(0.0); return; }
    vec2 hs = vec2(segW, u_size.y) * 0.5;
    vec2 p = vec2(inSeg, py) - hs;
    float r = u_round > 0.5 ? min(hs.x, hs.y) : min(4.0, hs.y);
    if (u_round > 0.5) hs = vec2(r);
    p = vec2(inSeg, py) - vec2(segW, u_size.y) * 0.5;
    vec2 q = abs(p) - (hs - vec2(r));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    float cover = clamp(0.5 - d, 0.0, 1.0);
    float nMain = max(1.0, u_n - u_tail);
    float f = idx / max(1.0, nMain - 1.0);
    vec3 col = idx >= nMain ? u_blue : (f < 0.42 ? u_green : (f < 0.75 ? u_yellow : u_red));
    bool on = idx < u_lit;
    if (u_strobe > 0.5) { col = u_red; on = true; }
    gl_FragColor = vec4(col, cover * (on ? 1.0 : u_off));
}
`;

const SHIFTLIGHT = `// The stock BMW shift light for a cluster-render "effect" layer (GLSL ES 1.00): u_n slanted lights on each side of
// a solid centre block, mirrored. u_lit lights them from the outer ends in towards the centre (u_n lights on each
// side, then the centre block as the last step, u_n + 1 in all). u_flash 1 = the redline flash: everything lit red.
//   u_size px, u_n lights each side, u_lit 0..u_n+1, u_flash 0/1, u_cw centre block width px, u_gap px between
//   lights, u_skew px a light leans over the layer's height, u_lean +1 = the tops lean in towards the centre ("/ \\"),
//   -1 = out, u_color the lights, u_red the centre block and the flash, u_off alpha of an unlit light
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_n;
uniform float u_lit;
uniform float u_flash;
uniform float u_cw;
uniform float u_gap;
uniform float u_skew;
uniform float u_lean;
uniform vec3 u_color;
uniform vec3 u_red;
uniform float u_off;

float cov(float d) { return clamp(d + 0.5, 0.0, 1.0); }

void main() {
    float W = u_size.x, H = u_size.y;
    float px = v_uv.x * W, py = v_uv.y * H;
    float xs = abs(px - W * 0.5) + u_lean * u_skew * (0.5 - py / H);     // distance from the centre, along the slant
    float vert = cov(min(py, H - py));
    float hw = u_cw * 0.5;
    bool every = u_flash > 0.5;
    if (xs < hw + 0.5) {
        gl_FragColor = vec4(u_red, cov(hw - xs) * vert * ((every || u_lit > u_n + 0.5) ? 1.0 : u_off));
        return;
    }
    float t = xs - hw - u_gap;
    float pitch = (W * 0.5 - u_skew * 0.5 - hw) / u_n;
    float k = floor(t / pitch);
    float within = t - k * pitch;
    float segW = pitch - u_gap;
    if (t < 0.0 || k >= u_n || within > segW + 0.5) { gl_FragColor = vec4(0.0); return; }
    bool on = every || (u_n - 1.0 - k) < u_lit;
    gl_FragColor = vec4(every ? u_red : u_color, cov(min(within, segW - within)) * vert * (on ? 1.0 : u_off));
}
`;

const FILL = `// Solid fill for a cluster-render "effect" layer (GLSL ES 1.00): u_color everywhere, except a
// see-through rounded hole u_hole (x, y, w, h px from the layer's top left; w = 0: no hole), radius u_holeR.
// On the cluster, an opaque fill hides BMW's own gauges under it; the hole lets the map window show.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_color;
uniform vec4 u_hole;
uniform float u_holeR;

void main() {
    vec2 p = vec2(v_uv.x * u_size.x, v_uv.y * u_size.y);
    float a = u_color.a;
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        a *= clamp(d + 0.5, 0.0, 1.0);
    }
    gl_FragColor = vec4(u_color.rgb, a);
}
`;

const BOX = `// Framed box for a cluster-render "effect" layer (GLSL ES 1.00), the race-dash readout box: a rounded
// frame u_border px wide in u_line, filled u_fill, with a header strip u_headH px tall in u_head across the
// top (0 = none). Colours rgba, straight alpha. u_size, u_border, u_headH, u_radius in px.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_fill;
uniform vec4 u_line;
uniform vec4 u_head;
uniform float u_headH;
uniform float u_border;
uniform float u_radius;

void main() {
    vec2 p = vec2(v_uv.x * u_size.x, v_uv.y * u_size.y);
    vec2 hs = u_size * 0.5;
    vec2 q = abs(p - hs) - (hs - vec2(u_radius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;   // < 0 inside
    float outer = clamp(0.5 - d, 0.0, 1.0);
    if (outer <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec4 c = p.y < u_headH ? u_head : u_fill;
    float edge = clamp(d + u_border + 0.5, 0.0, 1.0);                       // 1 within the frame
    vec4 col = mix(c, u_line, edge);
    gl_FragColor = vec4(col.rgb, col.a * outer);
}
`;

const BOXES = `// The GT3 race dash's frame in one cluster-render "effect" layer (GLSL ES 1.00): the background u_bg over the
// whole layer, a see-through rounded hole for BMW's map (u_hole x, y, w, h in layer px, already inset; w 0 = none;
// corner radius u_holeR) and up to 12 framed readout boxes from the layout: each a rounded frame in u_line, filled
// u_fill, with a header strip across its top in u_head (or u_accent). Array uniforms (sent with type vec4):
//   u_box[i]       x, y, w, h in layer px
//   u_boxStyle[i]  header height px, border px, corner radius px, header kind (0 u_head, 1 u_accent)
//   u_n            boxes in use (the rest are skipped). Boxes must not overlap each other or the hole.
// Colours rgba, straight alpha. The loop bound is constant and the arrays are indexed by the loop counter only,
// as GLSL ES 1.00 requires.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_bg;
uniform vec4 u_hole;
uniform float u_holeR;
uniform float u_n;
uniform vec4 u_box[12];
uniform vec4 u_boxStyle[12];
uniform vec4 u_fill;
uniform vec4 u_line;
uniform vec4 u_head;
uniform vec4 u_accent;

// signed distance to the rounded rect r (x, y, w, h), radius rad; < 0 inside
float sdBox(vec2 p, vec4 r, float rad) {
    vec2 hs = r.zw * 0.5;
    vec2 q = abs(p - (r.xy + hs)) - (hs - vec2(rad));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = u_bg;
    if (u_hole.z > 0.0) c.a *= clamp(sdBox(p, u_hole, u_holeR) + 0.5, 0.0, 1.0);
    for (int i = 0; i < 12; i++) {
        if (float(i) >= u_n) break;
        vec4 b = u_box[i];
        vec4 s = u_boxStyle[i];
        if (p.x < b.x - 1.0 || p.x > b.x + b.z + 1.0 || p.y < b.y - 1.0 || p.y > b.y + b.w + 1.0) continue;
        float d = sdBox(p, b, s.z);
        float outer = clamp(0.5 - d, 0.0, 1.0);
        if (outer <= 0.0) continue;
        vec4 inner = p.y < b.y + s.x ? (s.w > 0.5 ? u_accent : u_head) : u_fill;
        float edge = clamp(d + s.y + 0.5, 0.0, 1.0);               // 1 within the frame
        vec4 col = mix(inner, u_line, edge);
        c = over(vec4(col.rgb, col.a * outer), c);
    }
    gl_FragColor = c;
}
`;

const GRID = `// Calibration grid for a cluster-render "effect" layer (GLSL ES 1.00): a line every u_step px, a brighter
// one every u_major steps, a frame round the edge. v_uv (0,0) is the top-left.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_step;
uniform float u_major;
uniform vec4 u_minor;
uniform vec4 u_majorC;

void main() {
    vec2 p = v_uv * u_size;
    vec2 m = mod(p, u_step);
    vec2 big = mod(p, u_step * u_major);
    bool edge = p.x < 2.0 || p.y < 2.0 || p.x > u_size.x - 2.0 || p.y > u_size.y - 2.0;
    if (edge || big.x < 2.0 || big.y < 2.0) gl_FragColor = u_majorC;
    else if (m.x < 1.0 || m.y < 1.0) gl_FragColor = u_minor;
    else gl_FragColor = vec4(0.0);
}
`;

const SEGBAR = `// Segmented level bar for a cluster-render "effect" layer (GLSL ES 1.00): u_segs segments, the first
// u_lit of them lit (brightening left to right), each slanted u_slant px. v_uv (0,0) is the top-left.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_segs;
uniform float u_lit;
uniform vec4 u_on;
uniform vec4 u_offC;
uniform float u_slant;

void main() {
    vec2 p = v_uv * u_size;
    float x = p.x - u_slant * (1.0 - v_uv.y);
    float gap = 8.0;
    float slot = (u_size.x - u_slant + gap) / u_segs;
    float i = floor(x / slot);
    float fx = x - i * slot;
    float a = clamp(fx + 0.5, 0.0, 1.0) * clamp(slot - gap - fx + 0.5, 0.0, 1.0);
    if (i < 0.0 || i >= u_segs || a <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec4 col = i < u_lit ? vec4(u_on.rgb * mix(0.72, 1.0, fx / (slot - gap)), u_on.a) : u_offC;
    gl_FragColor = vec4(col.rgb, col.a * a);
}
`;

const MDASH = `// The M theme's whole backdrop in one cluster-render "effect" layer (GLSL ES 1.00), traced off a photo of a current
// M8's cluster (design/photos/ref-m8-cluster.png, warped to 1920x720): black, with a near-black card either side whose
// inner edge follows the rev blade, whose top edge is the photo's curve and whose bottom outer corner is a big round;
// the centre line with its bright end caps, the tyre block's car glyph and dividers (the eight values are text widgets),
// the two side dials over the cards (the photo's thin glass bracket, hatched bezel, red streaks), the tricolour mark
// and the four setup level bars (slanted segments, the one at the level red, the rest grey, as the M8 draws them).
// Positions in target px from the layout (hud.js). v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_rect;   // this layer's size in px (hud.js sets it: u_size for the whole picture, less when the layer holds one rectangle of it: the gear window, shared/gear_window.js)
uniform vec2 u_org;    // that rectangle's top-left in the picture, px
uniform vec4 u_card;      // left card: outer edge x, bottom y, bottom-outer corner radius, top-outer corner rounding (the right card is its mirror)
uniform vec3 u_cardCutR;  // the right card's lower outer corner, cut back on a circle (mirrored frame: cx, cy, r; r 0 = none): the M8's
                          // right card is cut further than its left one, so the oil dial's numbers sit on black
uniform vec3 u_cardTop;   // the left card's top edge, y = a x^2 + b x + c (traced off the M8 photo)
uniform float u_cardFill; // the card's grey level 0..1 (0 = black, outline only)
uniform vec4 u_blade;     // the left rev blade's outer edge: x at the bend, y of the bend, x per y px above / below it
uniform vec2 u_bladeB;    // the bend's roundness px, the card's gap from the blade px
uniform vec4 u_line;      // centre line x0, y, x1, cap length
uniform vec3 u_tyre;      // the tyre block's car glyph: centre x, y, scale (0 = none)
uniform vec4 u_tyreLv;    // its wheels FL, FR, RL, RR: 0 green, 1 yellow (low pressure), 2 red (very low)
uniform vec4 u_gaugeL;    // left gauge centre x, y, radius, value 0..1
uniform vec4 u_gaugeR;    // right gauge
uniform vec3 u_mark;      // tricolour mark x, y, scale (0 = none)
uniform vec3 u_red;
uniform vec4 u_seg0;      // setup level bars x, y, w, h (a height of 0: none)
uniform vec4 u_seg1;
uniform vec4 u_seg2;
uniform vec4 u_seg3;
uniform vec4 u_segLit;    // the level per bar (1-based; 0 = none lit)
uniform vec4 u_segMax;    // segments per bar
uniform float u_segSlant; // px each segment leans
uniform vec4 u_hole;      // the map window x, y, w, h px, already inset (w 0 = none): cut see-through over the map
uniform float u_holeR;    // its corner radius px
uniform vec4 u_plate;     // the plate under the map window (the gear and the speed sit on it) x, y, w, h px; only while the window is cut
uniform float u_split;    // the x of the thin divider between the gear and the speed on that plate
uniform vec2 u_low;       // 1 while the fuel (left dial) / the battery (right dial) is in reserve: the lit glass turns red

const float PI = 3.14159265;

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float k = under.a * (1.0 - top.a), a = top.a + k;
    return vec4((top.rgb * top.a + under.rgb * k) / max(a, 0.0001), a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

float sdRoundBox(vec2 p, vec4 r, float rad) {
    vec2 c = r.xy + r.zw * 0.5;
    vec2 q = abs(p - c) - r.zw * 0.5 + rad;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
float angOf(vec2 d) { float a = atan(d.x, -d.y); return a < 0.0 ? a + 2.0 * PI : a; }
// the left blade's outer edge x at y (mtach's curve)
float bladeX(float y) {
    float dy = y - u_blade.y;
    float k = dy < 0.0 ? u_blade.z : u_blade.w;
    return u_blade.x + k * (sqrt(dy * dy + u_bladeB.x * u_bladeB.x) - u_bladeB.x);
}
// smooth intersection of two signed distances (rounds the corner where they meet)
float smax(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
// the left card as the M8 draws it: a wedge whose top edge is the traced curve, outer edge at u_card.x, bottom at
// u_card.y, inner side along the blade; the bottom-outer corner is a big round (the fuel dial sits over it); < 0 inside
float cardD(vec2 p, float right) {
    float fx = u_cardTop.x * p.x * p.x + u_cardTop.y * p.x + u_cardTop.z;
    float slope = 2.0 * u_cardTop.x * p.x + u_cardTop.y;
    float dTop = (fx - p.y) / sqrt(1.0 + slope * slope);
    float dLeft = u_card.x - p.x;
    float dBot = p.y - u_card.y;
    float d = smax(dTop, dLeft, u_card.w);
    d = max(d, dBot);
    vec2 cc = vec2(u_card.x + u_card.z, u_card.y - u_card.z);
    if (p.x < cc.x && p.y > cc.y) d = max(d, length(p - cc) - u_card.z);
    d = max(d, p.x - (bladeX(p.y) - u_bladeB.y));
    if (right > 0.5 && u_cardCutR.z > 0.0) d = max(d, length(p - u_cardCutR.xy) - u_cardCutR.z);
    return d;
}
// the card: near-black (the panel brightens every dark tint, so the fill stays tiny), a shade lighter and bluer at
// the top, with a faint lighter rim
vec4 card(vec2 p, vec2 dial, float right, vec4 c) {
    float d = cardD(p, right);
    if (d > 2.0) return c;
    float top = u_cardTop.z - u_cardTop.y * u_cardTop.y / (4.0 * u_cardTop.x);   // the curve's lowest y (its vertex)
    float fy = clamp((p.y - top) / max(u_card.y - top, 1.0), 0.0, 1.0);
    float grey = u_cardFill * mix(1.3, 0.75, fy);
    c = over(vec4(vec3(grey, grey, grey * 1.18), cov(d)), c);
    // the rim stops inside the dial's area (as on the M8, where the dial covers the card's edge), so no label sits on it;
    // 118..130 px at the photo's dial size (r 120), scaled with the layout's
    float kd = u_gaugeL.z / 120.0;
    float hide = 1.0 - smoothstep(118.0 * kd, 130.0 * kd, length(p - dial));
    c = over(vec4(0.5, 0.53, 0.58, 0.3 * cov(abs(d + 1.2) - 0.9) * (1.0 - hide)), c);
    return c;
}
// the tyre block: the car seen from above (outline body, four wheels) between the four readouts,
// a divider under each front pair, a tick above and below the car
vec4 tyreBlock(vec2 p, vec4 c) {
    if (u_tyre.z <= 0.0) return c;
    vec2 q = (p - u_tyre.xy) / u_tyre.z;
    if (abs(q.x) > 80.0 || abs(q.y) > 70.0) return c;
    float body = abs(sdRoundBox(q, vec4(-11.0, -20.0, 22.0, 40.0), 7.0)) - 1.1;
    vec2 a = vec2(abs(q.x) - 13.5, abs(q.y) - 11.0);
    float wheel = max(abs(a.x) - 2.2, abs(a.y) - 4.5);
    float hl = min(segD(q, vec2(-68.0, 0.0), vec2(-28.0, 0.0)), segD(q, vec2(28.0, 0.0), vec2(68.0, 0.0))) - 0.9;
    float vt = min(segD(q, vec2(0.0, -62.0), vec2(0.0, -42.0)), segD(q, vec2(0.0, 42.0), vec2(0.0, 62.0))) - 0.9;
    c = over(vec4(0.72, 0.76, 0.82, cov(min(body, min(hl, vt)) * u_tyre.z)), c);
    float lv = q.y < 0.0 ? (q.x < 0.0 ? u_tyreLv.x : u_tyreLv.y) : (q.x < 0.0 ? u_tyreLv.z : u_tyreLv.w);
    c = over(vec4(mix(mix(vec3(0.36, 0.78, 0.42), vec3(1.0, 0.76, 0.1), clamp(lv, 0.0, 1.0)), vec3(1.0, 0.2, 0.24), clamp(lv - 1.0, 0.0, 1.0)), cov(wheel * u_tyre.z)), c);
    return c;
}
// a setup level bar: s.y segments slanted, number lit (1-based) red, the rest grey
vec4 segbar(vec2 p, vec4 b, vec2 s, vec4 c) {
    if (b.w <= 0.0 || p.y < b.y - 1.0 || p.y > b.y + b.w + 1.0 || p.x < b.x - 1.0 || p.x > b.x + b.z + 1.0) return c;
    float fy = (p.y - b.y) / b.w;
    float x = p.x - b.x - u_segSlant * (1.0 - fy);
    float gap = 10.0;
    float slot = (b.z - u_segSlant + gap) / s.y;
    float i = floor(x / slot);
    float fx = x - i * slot;
    float a = clamp(fx + 0.5, 0.0, 1.0) * clamp(slot - gap - fx + 0.5, 0.0, 1.0) * clamp(p.y - b.y + 0.5, 0.0, 1.0) * clamp(b.y + b.w - p.y + 0.5, 0.0, 1.0);
    if (i < 0.0 || i >= s.y || a <= 0.0) return c;
    bool on = abs(i + 1.0 - s.x) < 0.5;
    vec3 col = on ? u_red * mix(0.85, 1.0, fx / (slot - gap)) : vec3(0.5, 0.53, 0.58);
    return over(vec4(col, (on ? 1.0 : 0.8) * a), c);
}

// a side dial as the M8 draws it, traced off the photo: not a round gauge but a tall thin bracket cut from big
// circles. The glass lies inside a circle of radius 120 round the anchor g.xy and outside one of radius 180 round
// (57, -68), so it is ~20 px wide at the top and widens to ~50 at the bottom; a hatched chrome bezel (an arc between
// radii 113 and 124 round (-13, 11)) runs down its outer side. The level reads by height: the glass is lit from the
// bottom up to the level, dark above it (a thin bright line along its outer edge), and a horizontal red streak runs in
// from the outer edge at the level. Fixed streaks mark the end zones (zones 0, fuel: the reserve at the bottom; 1, oil:
// blue at the cold bottom end, red at the hot top end). Units are the photo's px with g.z = 120 there.
// Drawn in the left frame; the right dial comes through the mirror.
vec4 streak(vec2 q, float py, float len, vec3 col, float k, vec4 c) {
    float xo = -sqrt(max(14400.0 - py * py, 0.0)) - 3.0;                         // the glass's outer edge at that height
    float dx = q.x - (xo + len * 0.5), dy = abs(q.y - py);
    float taper = 1.0 - clamp(abs(dx) / (len * 0.5), 0.0, 1.0);
    float sd = (max(abs(dx) - len * 0.5, dy - (1.2 + 2.3 * taper))) * k;
    c = over(vec4(col, 0.3 * exp(-max(sd, 0.0) / (5.0 * k))), c);
    return over(vec4(mix(col, vec3(1.0, 0.55, 0.5), 0.25 * taper), cov(sd)), c);
}
vec4 gauge(vec2 p, vec4 g, float zones, float low, vec4 c) {
    float k = g.z / 120.0;
    vec2 q = (p - g.xy) / k;
    if (q.x < -140.0 || q.x > 70.0 || q.y < -22.0 || q.y > 140.0) return c;
    float v = clamp(g.w, 0.0, 1.0);
    // the bezel: double-edged and hatched, from its top end down round to its bottom end
    vec2 qb = q - vec2(-13.0, 11.0);
    float rb = length(qb);
    if (q.y > -16.0 && q.x < -30.0 && rb > 111.0 && rb < 126.0) {
        float ab = atan(qb.y, qb.x);
        float hatch = step(0.5, fract(ab * 30.0));
        float edge = max(cov((abs(rb - 112.5)) * k - 0.8), cov((abs(rb - 124.0)) * k - 0.8));
        float body = (rb > 112.5 && rb < 124.0) ? 0.4 + 0.35 * hatch : 0.0;
        c = over(vec4(0.8, 0.82, 0.88, min(1.0, body + 0.7 * edge)), c);
    }
    // the glass
    float dOut = 120.0 - length(q);
    float dIn = length(q - vec2(57.0, -68.0)) - 180.0;
    float inside = min(min(dOut, dIn), min(q.y + 10.0, 14.0 - q.x));
    if (zones > 0.5) inside = min(min(inside, 104.0 - q.y), -30.0 - q.x);       // the oil glass ends higher and shorter (photo: y 564, x 1686)
    if (inside > -1.5) {
        float f = clamp(dOut / max(dOut + max(dIn, 0.0), 1.0), 0.0, 1.0);        // 0 at the outer edge, 1 at the inner
        float yv = zones > 0.5 ? mix(97.0, 7.0, v) : mix(100.0, 2.0, v);
        float lit = smoothstep(yv - 2.0, yv + 4.0, q.y);
        vec4 dark = vec4(0.85, 0.87, 0.92, 0.75 * (1.0 - smoothstep(0.0, 6.0, dOut)));
        vec4 bright = vec4(mix(mix(vec3(0.96, 0.97, 0.99), vec3(0.55, 0.57, 0.63), f), vec3(1.0, 0.2, 0.22) * mix(1.0, 0.7, f), low), mix(1.0, 0.55, f));
        vec4 glass = mix(dark, bright, lit);
        c = over(vec4(glass.rgb, glass.a * cov(-inside * k)), c);
        c = over(vec4(1.0, 1.0, 1.0, 0.7 * cov(abs(inside * k) - 0.6) * (1.0 - lit) * step(dOut, 3.0)), c);
    }
    float yv = zones > 0.5 ? mix(97.0, 7.0, v) : mix(100.0, 2.0, v);
    if (zones > 0.5) {
        c = streak(q, -8.0, 44.0, u_red, k, c);                                    // hot end, above the top label as the photo
        c = streak(q, 101.0, 34.0, vec3(0.3, 0.55, 1.0), k, c);                    // cold end, along the glass's bottom
    } else {
        c = streak(q, 112.0, 50.0, u_red, k, c);                                   // reserve
    }
    c = streak(q, yv, 38.0, u_red, k, c);                                          // the level, across the glass only
    return c;
}

void main() {
    vec2 p = v_uv * u_rect + u_org;
    vec2 pm = vec2(u_size.x - p.x, p.y);        // the right half, mirrored into the left frame
    vec4 c = vec4(0.0, 0.0, 0.0, 1.0);           // black, as the M8

    // the two cards: the left one as laid out, the right one its mirror
    c = card(p, u_gaugeL.xy, 0.0, c);
    c = card(pm, vec2(u_size.x - u_gaugeR.x, u_gaugeR.y), 1.0, c);

    // centre line, bright caps at both ends
    if (abs(p.y - u_line.y) < 6.0) {
        c = over(vec4(0.62, 0.66, 0.73, 0.8 * cov(segD(p, u_line.xy, u_line.zy) - 1.6)), c);
        float l = segD(p, u_line.xy + vec2(6.0, 0.0), u_line.xy + vec2(u_line.w, 0.0)) - 2.0 - 1.2 * clamp((p.x - u_line.x) / u_line.w, 0.0, 1.0);
        float r = segD(p, u_line.zy - vec2(u_line.w, 0.0), u_line.zy - vec2(6.0, 0.0)) - 2.0 - 1.2 * clamp((u_line.z - p.x) / u_line.w, 0.0, 1.0);
        c = over(vec4(0.95, 0.96, 0.98, cov(min(l, r))), c);
    }

    c = tyreBlock(p, c);

    // the side dials, traced off the M8 photo: the glass crescent, the fuel one as laid out, the oil one its mirror
    c = gauge(p, u_gaugeL, 0.0, u_low.x, c);
    c = gauge(pm, vec4(u_size.x - u_gaugeR.x, u_gaugeR.yzw), 0.0, u_low.y, c);   // the battery: the same as the fuel dial (level streak, reserve streak at the bottom); the photo's oil dial (hot / cold ends) is no longer drawn

    c = segbar(p, u_seg0, vec2(u_segLit.x, u_segMax.x), c);
    c = segbar(p, u_seg1, vec2(u_segLit.y, u_segMax.y), c);
    c = segbar(p, u_seg2, vec2(u_segLit.z, u_segMax.z), c);
    c = segbar(p, u_seg3, vec2(u_segLit.w, u_segMax.w), c);

    // the map window between the rev blades ("Show Waze map inside the theme"): a rounded see-through hole
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float hd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        // a silver hairline just outside the glass, then the cut; the plate under it: an outline card like the side ones with a thin divider
        float pd = sdRoundBox(p, u_plate, 20.0);
        float dv = max(abs(p.x - u_split) - 0.8, abs(p.y - u_plate.y - u_plate.w * 0.5) - u_plate.w * 0.5 + 18.0);
        c = over(vec4(0.74, 0.78, 0.86, max(0.85 * cov(abs(hd - 2.2) - 0.9), u_plate.z > 0.0 ? max(0.3 * cov(abs(pd + 1.0) - 0.9), 0.75 * cov(dv)) : 0.0)), c);
        c.a *= clamp(hd + 0.5, 0.0, 1.0);
    }

    // tricolour mark: three slanted bars
    if (u_mark.z > 0.0) {
        vec2 m = (p - u_mark.xy) / u_mark.z;
        if (m.y > -1.0 && m.y < 21.0 && m.x > -2.0 && m.x < 60.0) {
            float lx = m.x - 7.0 * (1.0 - m.y / 20.0);
            float i = floor(lx / 16.0);
            float fx = lx - i * 16.0;
            float inside = cov((max(abs(fx - 6.5) - 6.5, abs(m.y - 10.0) - 10.0)) * u_mark.z);
            vec3 mc = i < 0.5 ? vec3(0.31, 0.71, 1.0) : (i < 1.5 ? vec3(0.17, 0.29, 0.78) : vec3(0.9, 0.13, 0.17));
            if (i >= 0.0 && i <= 2.0) c = over(vec4(mc, inside), c);
        }
    }
    gl_FragColor = c;
}
`;
const MTACH = `// The M theme's rev bar (GLSL ES 1.00), after the M8's: a bowed glass blade (the curve bends at u_geoA.z with a
// large roundness, so it reads as one arc), wide at 0 rpm and narrow at the top, with a bright silver outer
// edge and bright ticks running in from it every 1000 rpm. The part below the rpm is lit dim grey, a glowing
// block rides the blade at the rpm (the M8's marker, white; orange, then red in the zone), an outlined grey foot block fills the bottom 20 px, orange dashes sit before
// the redline and a solid red line past it. Drawn as the left bar; u_side 1 mirrors it. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_side;
uniform vec4 u_geoA;      // y at 0 rpm, y at max, y of the bend, outer-edge x at the bend (layer px, left frame)
uniform vec3 u_geoB;      // slope above the bend, slope below it, bend roundness px
uniform vec3 u_wid;       // blade width at 0 rpm, at max, extra at the bend
uniform float u_ticks;    // max / 1000
uniform float u_value;    // 0..1
uniform float u_orange;   // 0..1, yellow dashes from here
uniform float u_redFrom;  // 0..1, red dashes from here (the redline)
uniform float u_zone;     // 0 = white, 2 = the red zone, a fade between (no orange run-up): the lit glass and the marker take its colour
uniform float u_peak;     // the held peak 0..1 (0 = none): a thin tick above the marker
uniform vec3 u_red;

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float k = under.a * (1.0 - top.a), a = top.a + k;
    return vec4((top.rgb * top.a + under.rgb * k) / max(a, 0.0001), a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

void main() {
    vec2 p = v_uv * u_size;
    if (u_side > 0.0) p.x = u_size.x - p.x;
    float y0 = u_geoA.x, y8 = u_geoA.y, ym = u_geoA.z, xm = u_geoA.w;
    float dy = p.y - ym;
    float k = dy < 0.0 ? u_geoB.x : u_geoB.y;
    float sq = sqrt(dy * dy + u_geoB.z * u_geoB.z);
    float xo = xm + k * (sq - u_geoB.z);
    float slope = k * dy / sq;
    float d = (p.x - xo) / sqrt(1.0 + slope * slope);      // + = into the blade, towards the middle
    float t = (y0 - p.y) / (y0 - y8);
    float w = mix(u_wid.x, u_wid.y, clamp(t, 0.0, 1.0)) + u_wid.z * exp(-dy * dy / 22000.0);
    vec4 c = vec4(0.0);
    if (t >= 0.0 && t <= 1.0) {
        float inBand = clamp(d + 0.5, 0.0, 1.0) * clamp(w - d + 0.5, 0.0, 1.0);
        float across = clamp(d / w, 0.0, 1.0);
        float yn = y0 - u_value * (y0 - y8);
        vec4 g = vec4(0.62, 0.67, 0.74, mix(0.42, 0.06, across));          // empty glass (bright at the outer edge, as the M8's)
        vec3 zc = mix(vec3(1.0), u_red, clamp(u_zone * 0.5, 0.0, 1.0));       // the colour of the zone: white to red, eased (no orange run-up here)
        if (p.y > yn) g = mix(vec4(mix(vec3(0.86, 0.88, 0.92), vec3(0.6, 0.63, 0.68), across), mix(0.34, 0.22, across)), vec4(zc * 0.85, 0.6), clamp(u_zone * 0.5, 0.0, 1.0));
        // the foot: the bottom 20 px as an outlined grey block, as the M8 draws it
        if (p.y > y0 - 20.0) g = over(vec4(0.7, 0.72, 0.78, 0.22), g);
        g = over(vec4(0.9, 0.92, 0.95, 0.7 * cov(min(abs(p.y - (y0 - 19.0)), abs(p.y - (y0 - 1.5))) - 0.8)), g);
        // the marker: a red block at the rpm with a glow either side of it
        float dm = abs(p.y - yn);
        g = over(vec4(zc, 0.5 * exp(-dm / 26.0)), g);
        g = over(vec4(mix(zc, vec3(1.0), 0.35 * cov(dm - 5.0)), cov(dm - 14.0)), g);
        if (u_peak > u_value + 0.02) g = over(vec4(1.0, 1.0, 1.0, 0.75 * cov(abs(p.y - y0 + u_peak * (y0 - y8)) - 0.9)), g);       // the held peak: a thin tick
        c = vec4(g.rgb, g.a * inBand);
        c = over(vec4(0.93, 0.95, 0.98, cov(abs(d) - 1.6)), c);               // outer edge
        c = over(vec4(1.0, 1.0, 1.0, 0.3 * cov(abs(d - 4.0) - 0.6)), c);       // its bevel
        c = over(vec4(0.66, 0.7, 0.76, 0.75 * cov(abs(d - w) - 0.8)), c);      // inner edge
        // BMW's marks: a solid red line from the redline, a few yellow dashes in the run-up to it (the same on every theme)
        bool redM = t >= u_redFrom && d > 6.0 && d < 11.0;
        bool orM = t >= u_orange && t < u_redFrom - 0.01 && d > 6.0 && d < 11.0 && mod(p.y, 20.0) < 7.0;
        if (redM || orM) {
            c = over(vec4(redM ? u_red : vec3(1.0, 0.85, 0.1), 0.95), c);
        }
    }
    // ticks every 1000 rpm: bright, from the outer edge 24 px into the glass, as the M8 draws them
    float kk = floor(t * u_ticks + 0.5);
    float yk = y0 - kk / u_ticks * (y0 - y8);
    if (kk >= 0.0 && kk <= u_ticks && d > -2.0 && d < 24.0) {
        float ty = abs(p.y - yk) - 1.5;
        c = over(vec4(0.93, 0.95, 0.98, cov(ty)), c);
    }
    gl_FragColor = c;
}
`;
const FACETS = `// BMW draws a solid black box over our panel at its gear slot (1406,322)-(1597,440), the same zone as shared/visible.js (photos of Nov 15 2026:
// the box is about 117 px high, not 77: it bit the top of the oil strip's "150" and half of the M theme's steering row). It cannot be
// removed, and eroobeeroo's Cluster Layouts hides it the same way we do now: by leaving plain black round it (its "Background: pure black"), so
// the box's black window disappears into the backdrop. slot() is 0 inside a rounded window 4 px bigger all round (the box, whose edges are
// only measured to a few px, hides inside it), then the backdrop comes back with a smooth start over fall px: no step and no rim, so no
// rectangle to see (the earlier window with a pale rim and a 45 % shadow drew the eye to it).
float slotD(vec2 p) {
    vec2 q = abs(p - vec2(1501.5, 381.0)) - (vec2(99.5, 63.0) - vec2(16.0));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 16.0;
}
float slotOf(float d, float fall) { return clamp(d + 0.5, 0.0, 1.0) * smoothstep(0.0, fall, d); }
// the same for BMW's gear letter at the bottom right and the small black box after it (x 1392..1448, y 666..702 + margin): a window
// (1386,662)-(1454,708), with a shorter fade
float gearD(vec2 p) {
    vec2 q = abs(p - vec2(1420.0, 685.0)) - (vec2(34.0, 23.0) - vec2(10.0));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 10.0;
}
uniform float u_slotOff;   // 1: BMW's bottom strip is left clear (setting stripClear), the KOMBI draws no black box: no window
float slot(vec2 p) { return u_slotOff > 0.5 ? 1.0 : min(slotOf(slotD(p), 72.0), slotOf(gearD(p), 36.0)); }
// (kept for the callers: no rim any more, it made the black box read as an insert the theme meant to have, which is what the owner did not want)
vec3 slotRim(vec2 p) {
    return vec3(0.0);
}
float hash2(vec2 i) { return fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453); }
// the facets of the Sport view's backdrop, in the left frame (the right one is mirrored): lozenges between two families of
// slanted lines, each in one of three shades (0, 0.55, 1), and a thin lit edge on the lines. x: the shade, y: the edge.
vec2 facets(vec2 q) {
    float u1 = (q.x + 0.62 * q.y) / 190.0;
    float u2 = (q.x - 0.34 * q.y + 60.0) / 230.0;
    float h = hash2(vec2(floor(u1), floor(u2)));
    float shade = h < 0.3 ? 0.0 : (h < 0.62 ? 0.5 : 1.0);
    float d1 = min(fract(u1), 1.0 - fract(u1)) * 190.0 * 0.85;
    float d2 = min(fract(u2), 1.0 - fract(u2)) * 230.0 * 0.95;
    return vec2(shade, max(cov(d1 - 0.9), cov(d2 - 0.9)));
}
`;
// The navy backdrop of the M Blade and Navi themes, the Sport view's over the whole panel: a dark blue with a soft glow round the
// middle and the facets (mirrored on the right, fading out over the middle where the readouts are). Needs cov() and FACETS above it.
// amount 0..1 is the facets' strength (the setting "sportFacets"; 0 = the plain navy). The result is multiplied by u_tint (the setting
// "sportTint", 0 = pure black).
const NAVY = `vec3 navyFacets(vec2 p, vec2 size, float amount) {
    vec2 pm = vec2(size.x - p.x, p.y);
    float gx = (p.x - size.x * 0.5) / 440.0, gy = (p.y - 330.0) / 230.0;
    vec3 navy = mix(vec3(0.016, 0.05, 0.125), vec3(0.026, 0.08, 0.19), exp(-gx * gx - gy * gy));
    float side = clamp((abs(p.x - size.x * 0.5) - 60.0) / 200.0, 0.0, 1.0);
    vec2 fc = facets(p.x < size.x * 0.5 ? p : pm);
    return (navy + (vec3(0.014, 0.045, 0.11) * fc.x + vec3(0.03, 0.08, 0.17) * fc.y * 0.55) * side * amount) * slot(p) + slotRim(p);
}
`;
// The Waze map window's frame (Sport, M Blade, Navi): hd is the distance outside the window's edge. bezel() draws, outside it, a
// dark gap against the glass and a bright silver rim (lighter on top, y 0..1 down the panel); glass() then shades the map's own edge a little, drawn
// after the window has been cut out, so the map looks set into the panel. Thin enough to fit between the Sport brackets' lines and the window.
const BEZEL = `vec4 bezel(float hd, float y, vec4 c) {
    float ga = 0.9 * cov(abs(hd - 0.6) - 0.9), ra = 0.95 * cov(abs(hd - 2.4) - 1.0);
    return over(vec4(ra > ga ? mix(vec3(0.93, 0.96, 1.0), vec3(0.5, 0.55, 0.67), y) : vec3(0.0, 0.01, 0.03), max(ga, ra)), c);
}
vec4 glass(float hd, vec4 c) {
    return hd < 0.0 ? vec4(0.0, 0.0, 0.0, max(c.a, 0.55 * exp(hd * 0.5))) : c;
}
`;
const SDASH = `// The Sport theme in one cluster-render "effect" layer (GLSL ES 1.00), after BMW's Live Cockpit Sport view:
// a blue speed bracket left and a red rev bracket right (the left one mirrored). Each is a thin bright outer
// line, a band that fills from the bottom (white marker at the value), a dark gap and a thin inner line round a
// black middle: plain black, or the map through a see-through rounded hole (u_hole; only the bottom strip draws
// over it, the fuel and oil bars are off while it is open). Two-tone fuel and oil bars inside the brackets, a blue / red strip at the bottom. v_uv (0,0) is
// the top-left. The backdrop is BMW's own deep navy, as on the car's Sport view (a photo of it, Nov 14 2026): a darker navy
// everywhere, a lighter one between the brackets with a glow in the middle and a faceted pattern of lozenges (two families of
// slanted lines, three shades, a thin lit edge; mirrored on the right), all scaled by u_tint (0 = pure black).
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_rect;   // this layer's size in px (hud.js sets it: u_size for the whole picture, less when the layer holds one rectangle of it: the gear window, shared/gear_window.js)
uniform vec2 u_org;    // that rectangle's top-left in the picture, px
uniform vec4 u_geo;       // outer line: y at the top, y at the bend, y at the bottom, x at the bend (left side)
uniform vec3 u_k;         // x per y px above the bend, below it, bend roundness px
uniform float u_w;        // band width
uniform float u_inner;    // the inner line's distance from the outer line
uniform vec2 u_scale;     // y of the scale's 0 and of its top mark
uniform vec2 u_ticks;     // marks left (speed), right (rpm)
uniform float u_speed;    // 0..1 along the scale
uniform float u_rpm;      // 0..1
uniform float u_redFrom;  // 0..1 (the redline)
uniform float u_orange;   // 0..1, yellow marks from here to the redline
uniform vec2 u_low;       // 1 while the fuel bar / the right bar (the battery, when it shows it) is in reserve: red
uniform float u_fuel;     // 0..1
uniform float u_oil;      // 0..1
uniform float u_ozone;    // 1: the oil bar (red at its top, blue at its foot); 2: the battery (blue foot only, a full battery is not an alarm)
uniform vec4 u_hy;        // the hybrid rev counter: the colour (rgb) that fills the rev bracket in place of the engine's colours, a = 1 (0 = the engine's rpm)
uniform vec2 u_zone;      // the speed bracket's and the rev bracket's zone: 0 = white fill, 2 = red, a fade between (the layout has no orange run-up)
uniform float u_peak;     // the rev bracket's held peak 0..1 (0 = none): a thin tick above the lit part
uniform vec4 u_fuelSeg;   // full end x, y, empty end x, y
uniform vec4 u_oilSeg;
uniform vec4 u_hole;      // map window x, y, w, h, already inset (w 0 = none)
uniform float u_holeR;    // the hole's corner radius px
uniform vec4 u_strip;     // bottom strip: left end x, top y, height, slant px
uniform float u_topEnd;   // the top lines run from the bracket to this x (left; mirrored on the right)
uniform float u_facets;   // the facets' strength 0..1 (0 = plain navy)
uniform float u_tint;     // 0..: the blue of the middle (1 = the car's own, from a photo of its Sport view); 0 = black

const vec3 BLUE_LINE = vec3(0.36, 0.62, 1.0);
const vec3 BLUE_BAND = vec3(0.13, 0.3, 0.78);
const vec3 BLUE_LIT = vec3(0.62, 0.86, 1.0);
const vec3 BLUE_IN = vec3(0.2, 0.45, 0.98);
const vec3 RED_LINE = vec3(0.95, 0.12, 0.16);
const vec3 RED_BAND = vec3(0.33, 0.06, 0.1);
const vec3 RED_LIT = vec3(0.93, 0.1, 0.15);
const vec3 RED_IN = vec3(0.86, 0.08, 0.13);
const vec3 ZONE_WHITE = vec3(0.97, 0.98, 1.0);
vec3 zoneLit(float z) { return mix(ZONE_WHITE, RED_LIT, clamp(z * 0.5, 0.0, 1.0)); }       // white to red, eased: Sport has no orange run-up

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float k = under.a * (1.0 - top.a), a = top.a + k;
    return vec4((top.rgb * top.a + under.rgb * k) / max(a, 0.0001), a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float segH(vec2 p, vec2 a, vec2 b) { vec2 ba = b - a; return clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0); }
${FACETS}
float outerX(float y) {
    float dy = y - u_geo.y;
    float k = dy < 0.0 ? u_k.x : u_k.y;
    return u_geo.w + k * (sqrt(dy * dy + u_k.z * u_k.z) - u_k.z);
}
float outerSlope(float y) {
    float dy = y - u_geo.y;
    float k = dy < 0.0 ? u_k.x : u_k.y;
    return k * dy / sqrt(dy * dy + u_k.z * u_k.z);
}
// px from the outer line, inwards (perpendicular)
float dIn(vec2 q) { return (q.x - outerX(q.y)) / sqrt(1.0 + outerSlope(q.y) * outerSlope(q.y)); }

// one bracket in the left frame (q mirrored for the right one)
vec4 bracket(vec2 q, float val, float pk, float redFrom, float orange, float ticks, vec3 line, vec3 band, vec3 lit, vec3 inner, vec4 c) {
    float d = dIn(q);
    float yTopI = u_geo.x + 8.0;                              // the inner line's top run
    float t = (u_scale.x - q.y) / (u_scale.x - u_scale.y);    // 0 at the scale's 0
    bool inY = q.y > u_geo.x + 5.0 && q.y < u_geo.z - 4.0;
    // the band: lit up to the value, white marker on top
    float inB = (inY ? 1.0 : 0.0) * cov(-(d - 5.0)) * cov(d - 5.0 - u_w);
    if (inB > 0.0) {
        vec3 col = band;
        float a = 0.96;
        if (t <= val) col = mix(lit, mix(lit, vec3(1.0), 0.25), clamp((d - 5.0) / u_w, 0.0, 1.0)) * mix(0.8, 1.0, clamp(t / max(val, 0.01), 0.0, 1.0));
        c = over(vec4(col, a * inB), c);
        float yv = u_scale.x - val * (u_scale.x - u_scale.y);
        if (val > 0.002) c = over(vec4(1.0, 1.0, 1.0, inB * cov(abs(q.y - yv) - 2.0)), c);
        if (pk > val + 0.02) c = over(vec4(1.0, 1.0, 1.0, 0.8 * inB * cov(abs(q.y - u_scale.x + pk * (u_scale.x - u_scale.y)) - 1.1)), c);       // the held peak: a thin tick
        // marks at every label, on the band's outer half
        float kk = floor(t * ticks + 0.5);
        float yk = u_scale.x - kk / ticks * (u_scale.x - u_scale.y);
        if (kk >= 0.0 && kk <= ticks && d > 7.0 && d < 19.0) c = over(vec4(line, 0.9 * cov(abs(q.y - yk) - 1.2)), c);
        // redline: yellow dashes, then a solid red line, on the outer edge of the band
        if (redFrom < 1.5 && d > 8.0 && d < 13.0) {
            if (t >= redFrom && t <= 1.02) c = over(vec4(1.0, 0.2, 0.2, 1.0), c);
            else if (t >= orange && t < redFrom && mod(q.y, 16.0) < 7.0) c = over(vec4(1.0, 0.85, 0.1, 1.0), c);
        }
    }
    // the outer line, its top run and its bottom run
    float o = inY || abs(q.y - u_geo.x) < 6.0 || abs(q.y - u_geo.z) < 6.0 ? cov(abs(d - 1.0) - 1.8) : 0.0;
    vec2 tl = vec2(outerX(u_geo.x), u_geo.x), bl = vec2(outerX(u_geo.z), u_geo.z);
    o = max(o, cov(segD(q, tl, vec2(u_topEnd, u_geo.x)) - 2.2));
    o = max(o, cov(segD(q, bl, bl + vec2(u_inner + 40.0, 0.0)) - 2.2));
    c = over(vec4(line, 0.35 * exp(-abs(d) / 5.0) * (inY ? 1.0 : 0.0) * step(d, 0.0)), c);
    c = over(vec4(line, o), c);
    // the inner line: down the bracket from its top run to the bottom
    float il = (q.y > yTopI && q.y < u_geo.z - 6.0) ? cov(abs(d - u_inner) - 1.6) : 0.0;
    float xi = outerX(yTopI) + u_inner * sqrt(1.0 + outerSlope(yTopI) * outerSlope(yTopI));
    il = max(il, cov(segD(q, vec2(xi, yTopI), vec2(u_topEnd - 14.0, yTopI)) - 1.6));
    c = over(vec4(inner, 0.95 * il), c);
    return c;
}

// a two-tone slanted bar from the empty end b to the full end a, with a thin rail beside it
vec4 bar(vec2 p, vec4 s, float val, float zones, float low, vec4 c) {
    vec2 a = s.xy, b = s.zw;
    float h = 1.0 - segH(p, a, b);
    vec2 dir = normalize(a - b), nrm = vec2(-dir.y, dir.x);
    float side = dot(p - b, nrm);
    float along = segD(p, a, b);
    if (along > 26.0) return c;
    float body = cov(abs(side) - 7.0) * cov(segD(p, a, b) - 7.5);
    vec3 col = vec3(0.92, 0.94, 0.97);
    if (zones > 0.5 && zones < 1.5 && h > 0.88) col = vec3(1.0, 0.2, 0.22);
    if (zones > 0.5 && zones < 1.5 && h < 0.1) col = vec3(0.25, 0.5, 1.0);   // the oil's cold end (blue); the battery bar (2) is the fuel bar's twin: white, all red in reserve
    col = mix(col, vec3(1.0, 0.2, 0.22), low);                    // in reserve: all of it red
    c = over(vec4(0.36, 0.38, 0.44, 0.9 * body), c);
    c = over(vec4(col, body * step(h, val) * step(0.001, val)), c);
    c = over(vec4(0.5, 0.52, 0.58, 0.8 * cov(abs(side + 12.0) - 1.0) * cov(segD(p, a, b) - 13.0)), c);
    return c;
}

${BEZEL}
void main() {
    vec2 p = v_uv * u_rect + u_org;
    vec2 pm = vec2(u_size.x - p.x, p.y);
    vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
    if (u_tint > 0.0) {
        // everywhere a dark navy (no black round the brackets and under the scale numbers); inside both inner lines, between the top
        // run and the bottom line, a lighter deep blue with a glow round the middle and the facets
        c.rgb = vec3(0.012, 0.036, 0.09) * u_tint;
        float yIn = step(u_geo.x + 10.0, p.y) * step(p.y, u_geo.z - 8.0);
        float il = clamp(dIn(p) - u_inner - 2.0, 0.0, 1.0), ir = clamp(dIn(pm) - u_inner - 2.0, 0.0, 1.0);
        float gx = (p.x - u_size.x * 0.5) / 440.0, gy = (p.y - (u_geo.y + 30.0)) / 190.0;
        vec3 navy = mix(vec3(0.03, 0.09, 0.19), vec3(0.04, 0.12, 0.24), exp(-gx * gx - gy * gy));
        // two panels as on the photo: the facets fade out towards the middle, where the navy stays plain
        float side = clamp((abs(p.x - u_size.x * 0.5) - 60.0) / 200.0, 0.0, 1.0);
        vec2 fc = facets(p.x < u_size.x * 0.5 ? p : pm);
        navy += (vec3(0.02, 0.07, 0.16) * fc.x + vec3(0.07, 0.2, 0.38) * fc.y * 0.6) * side * u_facets;
        c.rgb = mix(c.rgb, navy * u_tint, il * ir * yIn);
        c.rgb = c.rgb * slot(p) + slotRim(p);
    }

    // the fills are white, orange in the run-up to a zone and red in it; the hybrid's electric power and charge keep their blue and green
    c = bracket(p, u_speed, 0.0, 2.0, 2.0, u_ticks.x, BLUE_LINE, BLUE_BAND, zoneLit(u_zone.x), BLUE_IN, c);
    c = bracket(pm, u_rpm, u_peak, u_redFrom, u_orange, u_ticks.y, RED_LINE, mix(RED_BAND, u_hy.rgb * 0.25, u_hy.a), mix(zoneLit(u_zone.y), u_hy.rgb, u_hy.a), RED_IN, c);
    // the map window: a rounded hole cut out of the backdrop and brackets, so the map shows clean; the fuel and
    // oil bars come off while it is open (they ran across the map, car photos Nov 7 2026), the bottom strip stays
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float hd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        c = bezel(hd, p.y / 720.0, c);                                              // the frame just outside the window
        c.a *= clamp(hd + 0.5, 0.0, 1.0);
        c = glass(hd, c);
    } else {
        c = bar(p, u_fuelSeg, u_fuel, 0.0, u_low.x, c);
        c = bar(p, u_oilSeg, u_oil, u_ozone, u_low.y, c);
    }
    // the bottom line between the brackets
    if (abs(p.y - u_geo.z) < 3.0 && abs(p.x - u_size.x * 0.5) < u_size.x * 0.5 - outerX(u_geo.z))
        c = over(vec4(mix(BLUE_LINE, RED_LINE, step(u_size.x * 0.5, p.x)) * 0.8, cov(abs(p.y - u_geo.z) - 1.2)), c);

    // bottom strip: slanted ends, blue left of the middle, red right, thin dividers
    float sy = p.y - u_strip.y;
    if (sy > -2.0 && sy < u_strip.z + 2.0) {
        float xl = u_strip.x + (u_strip.z - sy) / u_strip.z * u_strip.w;     // left end leans in at the top
        float dx = abs(p.x - u_size.x * 0.5), xe = u_size.x * 0.5 - xl;
        float inside = cov(dx - xe) * cov(-sy) * cov(sy - u_strip.z);
        float f = dx / xe;
        vec3 sc = p.x < u_size.x * 0.5 ? mix(vec3(0.06, 0.2, 0.62), vec3(0.15, 0.36, 0.92), f) : mix(vec3(0.4, 0.05, 0.1), vec3(0.85, 0.1, 0.16), f);
        c = over(vec4(sc, 0.95 * inside), c);
        float div = cov(abs(mod(p.x - (u_strip.z - sy) * 0.45, 150.0) - 75.0) - 73.8);
        c = over(vec4(0.02, 0.03, 0.08, 0.5 * inside * div), c);
        c = over(vec4(1.0, 1.0, 1.0, 0.25 * inside * cov(abs(sy) - 1.0)), c);
    }
    gl_FragColor = c;
}
`;

const MBLADE = `// The M Blade theme in one cluster-render "effect" layer (GLSL ES 1.00), traced off a photo of a BMW M cluster (Nov 14 2026,
// measured on the photo warped to the 1920x720 panel): a near black navy backdrop with faint hexagon outlines; the speed scale
// on the left as a cyan line with a knee, a tick at each label and a white marker at the speed; a blue hexagon cut into panels
// by dark gaps, with a void across it for the speed (the photo's gear); the rev blade on the right (maroon body, bright red
// right edge, red ticks, a white line and a bright red foot, the part under the rpm lit; blue on the electric power, and the foot filling green while the battery charges); three slanted segmented strips (the fuel
// on the left, the oil temperature and the hybrid battery on the right); and four blue tabs with a cyan and a red swoosh under the hexagon. The
// hexagon and the backdrop are cut see-through over the map window (u_hole). v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_rect;   // this layer's size in px (hud.js sets it: u_size for the whole picture, less when the layer holds one rectangle of it: the gear window, shared/gear_window.js)
uniform vec2 u_org;    // that rectangle's top-left in the picture, px
uniform vec4 u_hex;       // the hexagon: where its design point (612, 167) lands on the panel x, y; the scale (0 = none); the share it is narrower than the photo's (0 = as is)
uniform vec4 u_sp;        // speed line: x, y of the top cap's left end, x, y of the knee
uniform vec4 u_sq;        // speed line: x, y of the bottom end, the top cap's length (0 = no speed line)
uniform vec4 u_sy;        // speed line: y of the 0 label, of the knee's label, of the top label, the knee's share along the scale
uniform float u_speed;    // speed 0..1 along the scale
uniform vec4 u_bl;        // blade body: top y, bottom y, left edge x at the top, its slope (x per y px)
uniform vec4 u_br;        // blade: right edge x at the top (outer side), its slope, its thickness, the maroon body's width
uniform vec4 u_bx;        // blade: scale, x of the top line's left end, x of the base line's left end
uniform vec2 u_sc;        // y of the scale's top mark (max rpm), y of its 0
uniform vec4 u_g0;        // fuel strip: left edge x at the top, top y, bottom y, slope
uniform float u_fh;       // 1 = the fuel strip lies flat: u_g0 is then in a frame turned a quarter (x' = y, y' = panel width - x)
uniform vec4 u_g1;        // oil temperature strip
uniform vec4 u_g2;        // hybrid battery strip
uniform vec3 u_gv;        // the strips' levels 0..1: fuel, oil, battery
uniform vec2 u_low;       // 1 while the fuel / the battery strip is in reserve: red
uniform vec3 u_oc;        // the oil strip's lit colour (blue cold, green warm, red in alert)
uniform float u_ticks;    // marks: max rpm / 1000
uniform float u_value;    // rpm 0..1
uniform float u_orange;   // 0..1, yellow dashes from here to the redline
uniform float u_redFrom;  // 0..1
uniform vec2 u_zone;      // the speed line's and the rev blade's zone: 0 = white, 2 = red, a fade between (no orange run-up)
uniform float u_peak;     // the rev blade's held peak 0..1 (0 = none): a thin tick above the lit part
uniform vec4 u_red;       // the lit blade's colour (white, orange, red on the rpm; blue on the electric power), then the charge 0..1 filling the foot green
uniform float u_deco;     // 1 = the tabs and the swoosh under the hexagon
uniform vec4 u_hole;      // map window x, y, w, h, already inset (w 0 = none)
uniform float u_holeR;
uniform float u_tint;     // the backdrop's strength 0..1.4 (0 = pure black)
uniform float u_facets;   // the faint hexagon outlines' strength 0..1

const vec3 RED_Z = vec3(1.0, 0.2, 0.22), WHITE_Z = vec3(0.96, 0.98, 1.0), STRIP_W = vec3(0.94, 0.96, 1.0);
float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 t, vec4 u) {
    float k = u.a * (1.0 - t.a), a = t.a + k;
    return vec4((t.rgb * t.a + u.rgb * k) / max(a, 0.0001), a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float smax(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
// the distance (px, positive inside) to the nearest border of a honeycomb of flat-topped hexagons of circumradius r
float honey(vec2 p, float r) {
    vec2 s = vec2(3.0 * r, 1.7320508 * r);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
    return r * 0.8660254 - max(g.y, dot(g, vec2(0.8660254, 0.5)));
}
// signed distance (positive outside) to the line through a and b, for a polygon walked clockwise on screen
float ed(vec2 g, vec2 a, vec2 b) { vec2 e = b - a; return dot(g - a, vec2(e.y, -e.x)) / length(e); }
float poly4(vec2 g, vec2 a, vec2 b, vec2 c, vec2 d) { return max(max(ed(g, a, b), ed(g, b, c)), max(ed(g, c, d), ed(g, d, a))); }
float poly5(vec2 g, vec2 a, vec2 b, vec2 c, vec2 d, vec2 e) { return max(max(max(ed(g, a, b), ed(g, b, c)), max(ed(g, c, d), ed(g, d, e))), ed(g, e, a)); }
// the x of the speed line at y
float lineX(float y) {
    return y >= u_sp.w ? u_sp.z + (u_sq.x - u_sp.z) * (y - u_sp.w) / (u_sq.y - u_sp.w) : u_sp.z + (u_sp.x - u_sp.z) * (u_sp.w - y) / (u_sp.w - u_sp.y);
}
// one slanted strip of five segments (never an empty one: g.z > g.y): g = left edge x at the top, top y, bottom y, slope; the outer line is on the left when the
// strip leans right, on the right when it leans left; the part under the level is lit white
vec4 strip(vec2 p, vec4 g, float lvl, vec3 lit, float low, vec4 c) {
    float len = g.z - g.y;
    float xl = g.x + g.w * (p.y - g.y);
    float cs = 1.0 / sqrt(1.0 + g.w * g.w);
    float W = 27.0, ow = 5.0;
    float u = p.x - xl;
    bool mir = g.w < 0.0;
    float uo = mir ? W - u : u;
    float f = (g.z - p.y) / len;
    float inside = cov(max(-u, u - W) * cs) * cov(max(g.y - p.y, p.y - g.z));
    if (inside <= 0.0) return c;
    vec3 col;
    float a = 1.0;
    if (uo < ow) {
        col = mix(WHITE_Z, RED_Z, low);
        if (mir) col = f < 0.12 ? vec3(0.36, 0.86, 1.0) : (f > 0.9 ? vec3(1.0, 0.55, 0.78) : col);
    } else if (uo < ow + 2.5) {
        a = 0.0;
    } else {
        float sep = min(min(abs(f - 0.2), abs(f - 0.4)), min(abs(f - 0.6), abs(f - 0.8))) * len;
        col = f <= lvl ? mix(lit, RED_Z, low) : mix(vec3(0.56, 0.64, 0.9), vec3(0.5, 0.58, 0.84), f);
        a = 1.0 - 0.9 * cov(sep - 0.9);
    }
    return over(vec4(col, a * inside), c);
}

${BEZEL}
void main() {
    vec2 p = v_uv * u_rect + u_org;
    // a deep blue (the colour the backdrop lost when it was darkened to hide BMW's black box, which is gone), with the photo's faint hexagon
    // outlines; no gradient on purpose: this shader is 9 tokens under the 8748 that hold on the car (tools/shader_budget.js)
    vec4 c = vec4(vec3(0.03, 0.07, 0.19) * u_tint, 1.0);
    if (u_tint > 0.0) c = over(vec4(0.45, 0.6, 1.0, 0.07 * u_facets * cov(abs(honey(p, 150.0)) - 0.7)), c);

    // ---- the hexagon: five panels cut by dark gaps (design coordinates of the photo, scaled), the void for the speed between ----
    if (u_hex.z > 0.0) {
        float s = u_hex.z;
        vec2 g = (p - u_hex.xy) / vec2(s - s * u_hex.w, s) + vec2(612.0, 167.0);
        float gy = clamp((g.y - 167.0) / 422.0, 0.0, 1.0);
        float dS = poly4(g, vec2(743.0, 167.0), vec2(788.0, 167.0), vec2(642.0, 425.0), vec2(612.0, 392.0)) * s;
        float dT = poly5(g, vec2(795.0, 167.0), vec2(1079.0, 169.0), vec2(1110.0, 230.0), vec2(1097.0, 272.0), vec2(737.0, 272.0)) * s;
        float dL = poly5(g, vec2(650.0, 408.0), vec2(1006.0, 408.0), vec2(906.0, 589.0), vec2(735.0, 589.0), vec2(641.0, 430.0)) * s;
        float dR = poly4(g, vec2(1114.0, 241.0), vec2(1179.0, 352.0), vec2(1018.0, 588.0), vec2(913.0, 589.0)) * s;
        c = over(vec4(vec3(0.09, 0.31, 0.7), cov(dS)), c);
        c = over(vec4(mix(vec3(0.085, 0.34, 0.79), vec3(0.075, 0.31, 0.72), (g.y - 167.0) / 105.0), cov(dT)), c);
        c = over(vec4(mix(vec3(0.07, 0.275, 0.66), vec3(0.08, 0.31, 0.74), clamp((g.x - 640.0) / 360.0, 0.0, 1.0)), cov(dL)), c);
        c = over(vec4(mix(vec3(0.075, 0.28, 0.68), vec3(0.095, 0.32, 0.76), gy), cov(dR)), c);
        // the thin lighter facet lines the photo shows on the panels
        float f1 = segD(g, vec2(775.0, 408.0), vec2(699.0, 537.0)) * s;
        float f3 = segD(g, vec2(1043.0, 162.0), vec2(1102.0, 245.0)) * s;
        float f4 = segD(g, vec2(1105.0, 262.0), vec2(1050.0, 352.0)) * s;
        c = over(vec4(0.5, 0.7, 1.0, 0.38 * cov(f1 - 0.6) * cov(dL + 1.0)), c);
        c = over(vec4(0.5, 0.7, 1.0, 0.3 * cov(f3 - 0.6)), c);
        c = over(vec4(0.5, 0.7, 1.0, 0.25 * cov(f4 - 0.6) * cov(dR + 1.0)), c);
        // the lighter strip along the bottom of the right panel
        c = over(vec4(0.4, 0.62, 1.0, 0.22 * cov(abs(g.y - 551.0) * s - 0.7) * step(981.0, g.x) * step(g.x, 1056.0) * cov(dR + 1.0)), c);
        if (u_deco > 0.5) {
            // four blue tabs under it, a cyan swoosh to the left and a red glow to the right
            float dTab = poly4(g, vec2(806.0, 651.0), vec2(1154.0, 651.0), vec2(1185.0, 708.0), vec2(777.0, 708.0)) * s;
            float sd = min(min(segD(g, vec2(866.0, 651.0), vec2(895.0, 708.0)), segD(g, vec2(979.0, 651.0), vec2(952.0, 708.0))), segD(g, vec2(1081.0, 651.0), vec2(1056.0, 707.0))) * s;
            float gl = poly4(g, vec2(700.0, 649.0), vec2(806.0, 649.0), vec2(790.0, 676.0), vec2(688.0, 676.0)) * s;
            float gr = poly4(g, vec2(1154.0, 649.0), vec2(1203.0, 649.0), vec2(1222.0, 676.0), vec2(1172.0, 676.0)) * s;
            c = over(vec4(0.12, 0.3, 0.62, 0.55 * cov(gl) * (1.0 - clamp((g.y - 649.0) / 27.0, 0.0, 1.0))), c);
            c = over(vec4(0.62, 0.05, 0.16, 0.65 * cov(gr) * (1.0 - clamp((g.y - 649.0) / 27.0, 0.0, 1.0))), c);
            c = over(vec4(mix(vec3(0.12, 0.34, 0.7), vec3(0.1, 0.3, 0.66), clamp((g.y - 651.0) / 57.0, 0.0, 1.0)), cov(dTab)), c);
            c = over(vec4(0.02, 0.03, 0.09, cov(sd - 1.6) * cov(dTab + 0.5)), c);
            float sw = min(min(segD(g, vec2(693.0, 608.0), vec2(700.0, 621.0)), segD(g, vec2(700.0, 621.0), vec2(714.0, 630.0))), segD(g, vec2(714.0, 630.0), vec2(797.0, 632.0))) * s;
            c = over(vec4(0.3, 0.78, 1.0, 0.3 * exp(-sw * 0.2)), c);
            c = over(vec4(0.3, 0.78, 1.0, cov(sw - 3.6)), c);
        }
    }
    // the map window: cut out of the hexagon and the backdrop
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 qq = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float hd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - u_holeR;
        c = bezel(hd, p.y / 720.0, c);                                              // the frame just outside the window
        c.a *= clamp(hd + 0.5, 0.0, 1.0);
        c = glass(hd, c);
    }

    // ---- the speed scale: a cyan line (cap, a long slant up to the knee, a long slant down), a tick at each label, a marker ----
    if (u_sq.z > 0.0) {
        vec2 a = u_sp.xy, k = u_sp.zw, b = u_sq.xy;
        float d = min(segD(p, a, a + vec2(u_sq.z, 0.0)), min(segD(p, a, k), segD(p, k, b)));
        // the line is white, orange in the run-up to the speed zone, red in it
        vec3 sz = mix(WHITE_Z, RED_Z, clamp(u_zone.x * 0.5, 0.0, 1.0));
        c = over(vec4(sz, 0.2 * exp(-d * 0.2)), c);
        c = over(vec4(sz, cov(d - 1.9)), c);
        float tl = clamp(floor((u_sy.x - p.y) / (u_sy.x - u_sy.y) * 5.0 + 0.5), 0.0, 5.0);
        float tu = clamp(floor((u_sy.y - p.y) / (u_sy.y - u_sy.z) * 3.0 + 0.5), 0.0, 3.0);
        float ty = p.y >= u_sy.y - 4.0 ? u_sy.x + (u_sy.y - u_sy.x) * tl / 5.0 : u_sy.y + (u_sy.z - u_sy.y) * tu / 3.0;
        float lx = lineX(ty);
        c = over(vec4(0.8, 0.93, 1.0, 0.9 * cov(max(abs(p.y - ty) - 1.5, max(lx + 3.0 - p.x, p.x - lx - 15.0)))), c);
        float f = clamp(u_speed, 0.0, 1.0);
        float my = f <= u_sy.w ? u_sy.x + (u_sy.y - u_sy.x) * f / u_sy.w : u_sy.y + (u_sy.z - u_sy.y) * (f - u_sy.w) / (1.0 - u_sy.w);
        float mx = lineX(my);
        float dm = max(abs(p.x - (mx + 18.0)) - 15.0, abs(p.y - my) - 2.4);
        c = over(vec4(mix(sz, vec3(1.0), 0.4), 0.3 * exp(-max(dm, 0.0) * 0.3)), c);
        c = over(vec4(mix(sz, vec3(1.0), 0.75), cov(dm)), c);
    }

    // ---- the rev blade ----
    float s = u_bx.x;
    float yT = u_bl.x, yB = u_bl.y;
    float xl = u_bl.z + u_bl.w * (p.y - yT);
    float xr = u_br.x + u_br.y * (p.y - yT);
    float cl = 1.0 / sqrt(1.0 + u_bl.w * u_bl.w), cr = 1.0 / sqrt(1.0 + u_br.y * u_br.y);
    float thick = u_br.z, mw = u_br.w;
    float t = (u_sc.y - p.y) / (u_sc.y - u_sc.x);                 // 0 at the bottom of the scale, 1 at its top mark
    float yn = u_sc.y - u_value * (u_sc.y - u_sc.x);
    float yL = yT - 8.0 * s;                                      // the top line
    float yF0 = yB + 14.0 * s, yF1 = yB + 68.0 * s;               // the foot
    // the maroon body, bright red under the rpm
    float inM = cov(max(max(xl - p.x, p.x - xl - mw) * cl, max(yT - p.y, p.y - yB)));
    if (inM > 0.0) {
        vec3 dark = mix(vec3(0.4, 0.15, 0.27), vec3(0.34, 0.12, 0.23), clamp((p.y - yT) / (yB - yT), 0.0, 1.0));
        vec3 lit = mix(u_red.rgb, u_red.rgb * 0.78, clamp((p.y - yn) / 220.0, 0.0, 1.0));
        c = over(vec4(p.y > yn ? lit : dark, inM), c);
        if (u_value > 0.003) c = over(vec4(1.0, 0.96, 0.97, 0.85 * cov(abs(p.y - yn) - 1.2 * s) * inM), c);
        if (u_peak > u_value + 0.02) c = over(vec4(1.0, 0.96, 0.97, 0.7 * cov(abs(p.y - u_sc.y + u_peak * (u_sc.y - u_sc.x)) - s) * inM), c);
    }
    // the left edge (thin, pink), the top line with its overhang, the thick bright right edge
    float dlE = (p.x - xl) * cl;
    c = over(vec4(1.0, 0.58, 0.64, 0.95 * cov(abs(dlE - 1.0) - 1.2) * step(yL, p.y) * step(p.y, yF0)), c);
    c = over(vec4(1.0, 0.25, 0.35, cov(max(abs(p.y - yL) - 1.3 * s, max(u_bx.y - p.x, p.x - xr - 1.0)))), c);
    float drE = (xr - p.x) * cr;
    float inE = cov(max(max(-drE, drE - thick * cr), max(yL - p.y, p.y - yF0)));
    vec3 ecol = vec3(1.0, 0.2, 0.33);
    float tt = clamp(t, 0.0, 1.2);
    if (tt >= u_redFrom && tt <= 1.02) ecol = vec3(1.0, 0.1, 0.12);
    else if (tt >= u_orange && tt < u_redFrom && mod(p.y, 20.0) < 8.0) ecol = vec3(1.0, 0.85, 0.1);
    c = over(vec4(ecol, inE), c);
    c = over(vec4(1.0, 0.62, 0.7, 0.55 * cov(abs(drE - 1.5) - 0.9) * inE), c);
    // red ticks every 1000 rpm, just inside the right edge
    float kk = floor(t * u_ticks + 0.5);
    float yk = u_sc.y - kk / u_ticks * (u_sc.y - u_sc.x);
    float xk = u_br.x + u_br.y * (yk - yT) - thick - 1.0 * s;
    if (kk >= 1.0 && kk <= u_ticks) c = over(vec4(1.0, 0.26, 0.36, 0.9 * cov(max(abs(p.y - yk) - 2.0 * s, max(xk - 27.0 * s - p.x, p.x - xk)))), c);
    // the white line and the bright red foot, then the thin red base running left from it
    float xW0 = u_bl.z + u_bl.w * (yB + 6.0 * s - yT) - 10.0 * s, xW1 = u_br.x + u_br.y * (yB + 6.0 * s - yT) + 8.0 * s;
    c = over(vec4(1.0, 1.0, 1.0, cov(max(abs(p.y - (yB + 6.0 * s)) - 2.7 * s, max(xW0 - p.x, p.x - xW1)))), c);
    float dF = smax(smax((xl - p.x) * cl, (p.x - xr) * cr, 8.0 * s), smax(yF0 - p.y, p.y - yF1, 14.0 * s), 12.0 * s);
    float ft = clamp((p.y - yF0) / (yF1 - yF0), 0.0, 1.0);
    c = over(vec4(ft < u_red.a ? vec3(0.2, 0.85, 0.5) : mix(vec3(0.99, 0.2, 0.34), vec3(0.9, 0.1, 0.26), ft), cov(dF)), c);
    float xb1 = u_bl.z + u_bl.w * (yF1 - yT) + 12.0 * s;
    c = over(vec4(0.97, 0.16, 0.3, cov(max(abs(p.y - (yF1 - 2.0 * s)) - 1.7 * s, max(u_bx.z - p.x, p.x - xb1))) * smoothstep(u_bx.z, u_bx.z + 140.0 * s, p.x)), c);


    // ---- the two strips ----
    c = strip(u_fh > 0.5 ? vec2(p.y, u_size.x - p.x) : p, u_g0, u_gv.x, STRIP_W, u_low.x, c);
    c = strip(p, u_g1, u_gv.y, u_oc, 0.0, c);
    c = strip(p, u_g2, u_gv.z, STRIP_W, u_low.y, c);
    gl_FragColor = c;
}
`;
const NAVI = `// The Navi theme in one cluster-render "effect" layer (GLSL ES 1.00), after a photo of a BMW map view: a wide diagonal
// speed band on the left (an outer white line, a textured blue stripe that is the speed with a white marker across it at the speed,
// a thin white divider, a purple stripe that fades in from black and is the rev counter: lit up to the rpm, a marker and eight
// ticks, and a thin pale edge), the big rounded map window, the white
// line under the map that steps up at the right, and two thin bars along the bottom (fuel left, battery right). The
// window is cut see-through while u_hole is set (Waze, Cluster Centre, Cluster Info); the band is drawn over it.
// v_uv (0,0) is the top-left. Outside the shapes the backdrop is the Sport view's navy with facets (u_tint 0 = pure black).
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_rect;   // this layer's size in px (hud.js sets it: u_size for the whole picture, less when the layer holds one rectangle of it: the gear window, shared/gear_window.js)
uniform vec2 u_org;    // that rectangle's top-left in the picture, px
uniform vec4 u_L;         // the band's outer-left line: x of the tip, y of the tip, dy per dx, y of the bottom line
uniform vec4 u_W;         // divider offset (px right of the outer line) at y 300 and its change per y px, edge offset at y 300 and its change
uniform float u_top;      // y where the purple stripe begins
uniform vec2 u_sc;        // y of the scale's top mark and of its 0
uniform float u_speed;    // 0..1 along the scale
uniform float u_rev;      // the rev counter, 0..1 along the same scale
uniform vec4 u_hy;        // the hybrid rev counter: the lit colour while the battery drives or charges (a = 1), else a = 0
uniform vec2 u_zone;      // the speed band's and the rev stripe's zone: 0 = white, 2 = red, a fade between (no orange run-up)
uniform float u_redFrom;  // 0..1 (the redline; 2 = none): a solid red line along the rev stripe's edge from here
uniform float u_orange;   // 0..1, yellow dashes from here to the redline
uniform float u_peak;     // the rev stripe's held peak 0..1 (0 = none): a thin tick above the lit part
uniform vec4 u_ln;        // the white line under the map: x of its start, y, x where it steps up, x where it is back level
uniform vec3 u_ln2;       // y of the upper level, x where the upper level fades out, x where it ends
uniform vec4 u_barL;      // left bar: x, y, width, level 0..1
uniform vec2 u_low;       // 1 while the fuel (left bar) / the battery (right bar) is in reserve: red
uniform vec4 u_barR;
uniform vec4 u_hole;      // map window x, y, w, h, already inset (w 0 = none)
uniform float u_holeR;
uniform float u_tint;     // the navy backdrop's strength 0..1.4 (0 = pure black)
uniform float u_facets;   // the facets' strength 0..1 (0 = plain navy)

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
${FACETS}
${NAVY}
vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float k = under.a * (1.0 - top.a), a = top.a + k;
    return vec4((top.rgb * top.a + under.rgb * k) / max(a, 0.0001), a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// a thin bar with end ticks and a brighter, thicker part up to the level; u_ = (x, y, width, level)
vec4 bar(vec2 p, vec4 b, vec3 glowA, vec3 glowB, float low, vec4 c) {
    float f = (p.x - b.x) / b.z;
    if (f < -0.03 || f > 1.03 || abs(p.y - b.y) > 14.0) return c;
    vec3 g = mix(mix(glowA, glowB, clamp(f, 0.0, 1.0)), vec3(1.0, 0.2, 0.22), low);
    c = over(vec4(g, 0.5 * exp(-abs(p.y - b.y - 8.0) / 5.0) * cov(abs(f - 0.5) * b.z - b.z * 0.5)), c);
    float on = step(f, b.w);
    float th = mix(0.8, 2.0, on);
    c = over(vec4(mix(vec3(0.95, 0.97, 1.0), vec3(1.0, 0.2, 0.22), low) * mix(0.55, 1.0, on), cov(abs(p.y - b.y) - th) * cov(abs(f - 0.5) * b.z - b.z * 0.5)), c);
    float tk = cov(abs(mod(p.x - b.x + 12.5, 25.0) - 12.5) - 0.6) * cov(abs(p.y - b.y) - 5.0) * 0.4;
    c = over(vec4(0.9, 0.95, 1.0, tk * cov(abs(f - 0.5) * b.z - b.z * 0.5)), c);
    c = over(vec4(0.95, 0.97, 1.0, cov(min(abs(p.x - b.x), abs(p.x - b.x - b.z)) - 1.0) * cov(abs(p.y - b.y) - 6.0)), c);
    return c;
}

${BEZEL}
void main() {
    vec2 p = v_uv * u_rect + u_org;
    vec4 c = vec4(u_tint > 0.0 ? navyFacets(p, u_size, u_facets) * u_tint : vec3(0.0), 1.0);
    // the map window: cut out of the backdrop, with a thin pale outline just outside it
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float hd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        c = bezel(hd, p.y / 720.0, c);                                              // the frame just outside the window
        c.a *= clamp(hd + 0.5, 0.0, 1.0);
        c = glass(hd, c);
    }
    // the line under the map
    float lw = 1.7;
    float L1 = segD(p, vec2(u_ln.x, u_ln.y), vec2(u_ln.z, u_ln.y));
    float L2 = segD(p, vec2(u_ln.z, u_ln.y), vec2(u_ln.w, u_ln2.x));
    float L3 = segD(p, vec2(u_ln.w, u_ln2.x), vec2(u_ln2.z, u_ln2.x));
    float fade = 1.0 - clamp((p.x - u_ln2.y) / (u_ln2.z - u_ln2.y), 0.0, 1.0);
    c = over(vec4(0.62, 0.72, 0.95, 0.3 * exp(-L1 / 4.0)), c);
    c = over(vec4(0.96, 0.97, 1.0, max(cov(L1 - lw), max(cov(L2 - lw), cov(L3 - lw * (0.6 + 0.4 * fade)) * fade))), c);

    // the speed band
    float xl = u_L.x + (p.y - u_L.y) / u_L.z;
    float s = p.x - xl;
    float kk = u_L.z / sqrt(1.0 + u_L.z * u_L.z);
    float sep = u_W.x + u_W.y * (p.y - 300.0), edge = u_W.z + u_W.w * (p.y - 300.0);
    if (p.y >= u_L.y - 1.0 && p.y <= u_L.w + 1.0 && s > -3.0 && s < edge + 4.0) {
        float down = cov(p.y - u_L.w);
        // the textured blue stripe
        float bl = cov(-(s - 7.0) * kk) * cov((s - (sep - 4.0)) * kk);
        float tex = 0.9 + 0.1 * sin((p.x + p.y) * 0.45) * sin((p.x - p.y) * 0.3);
        // the speed: the stripe is lit white from the bottom up to the marker (orange in the run-up to the speed zone, red in it), blue above
        float ym = u_sc.y - u_speed * (u_sc.y - u_sc.x);
        vec3 sz = mix(vec3(0.93, 0.95, 1.0), vec3(0.95, 0.12, 0.18), clamp(u_zone.x * 0.5, 0.0, 1.0));
        vec3 sc = mix(vec3(0.1, 0.18, 0.84), sz * (0.82 + 0.18 * smoothstep(ym, u_sc.y, p.y)), step(ym, p.y) * step(0.003, u_speed));
        c = over(vec4(sc * tex, 0.96 * bl * down), c);
        // the purple stripe: black at its left, then violet, brightest at the pale edge and low down
        float pu = clamp((s - sep - 5.0) / (edge - sep - 5.0), 0.0, 1.0);
        vec3 pc = mix(vec3(0.02, 0.0, 0.05), mix(vec3(0.3, 0.07, 0.52), vec3(0.56, 0.26, 0.9), pu), smoothstep(0.0, 0.55, pu));
        pc *= 0.35 + 0.65 * smoothstep(u_top, u_top + 260.0, p.y);
        float yr = u_sc.y - u_rev * (u_sc.y - u_sc.x);
        // the rev counter is lit white (orange in the run-up to the redline, red in the zone); the hybrid's power and charge keep blue and green
        vec3 rz = mix(vec3(0.97, 0.97, 1.0), vec3(1.0, 0.18, 0.24), clamp(u_zone.y * 0.5, 0.0, 1.0));
        pc = mix(pc * 0.2, mix(rz * (0.5 + 0.5 * pu), u_hy.rgb * (0.45 + 0.55 * pu), u_hy.a), step(yr, p.y));
        c = over(vec4(pc, cov(-(s - sep - 5.0) * kk) * cov((s - edge) * kk) * step(u_top, p.y) * down), c);
        // the outer white line, the divider, the pale edge
        c = over(vec4(0.97, 0.98, 1.0, cov(abs(s - 5.0) * kk - 3.6) * down), c);
        c = over(vec4(0.92, 0.95, 1.0, 0.95 * cov(abs(s - sep) * kk - 0.9) * down), c);
        c = over(vec4(0.95, 0.82, 1.0, 0.9 * cov(abs(s - edge) * kk - 0.9) * step(u_top, p.y) * down), c);
        // BMW's marks inside the pale edge: yellow dashes in the run-up to the redline, then a solid red line from it (the same on every theme)
        float tm = (u_sc.y - p.y) / (u_sc.y - u_sc.x);
        float rm = step(u_redFrom, tm) * step(tm, 1.02), om = step(u_orange, tm) * step(tm, u_redFrom - 0.01) * step(mod(p.y, 16.0), 7.0);
        c = over(vec4(rm > 0.5 ? vec3(1.0, 0.2, 0.2) : vec3(1.0, 0.85, 0.1), max(rm, om) * 0.95 * cov((edge - 9.0 - s) * kk) * cov((s - edge + 3.0) * kk) * step(u_top, p.y) * down), c);
        // the marker across the blue stripe at the speed, the one across the purple stripe at the rpm, and a tick at each of the eight marks
        float mk = cov(abs(p.y - ym) - 2.2) * cov(-(s - 2.0) * kk) * cov((s - sep) * kk);
        c = over(vec4(1.0, 1.0, 1.0, 0.95 * mk * down), c);
        float mr = cov(abs(p.y - yr) - 1.6) * cov(-(s - sep - 5.0) * kk) * cov((s - edge) * kk);
        float mp = u_peak > u_rev + 0.02 ? cov(abs(p.y - u_sc.y + u_peak * (u_sc.y - u_sc.x)) - 1.2) * cov(-(s - sep - 5.0) * kk) * cov((s - edge) * kk) : 0.0;
        float k7 = clamp(floor((u_sc.y - p.y) / (u_sc.y - u_sc.x) * 7.0 + 0.5), 0.0, 7.0);
        float tk = cov(abs(p.y - u_sc.y + k7 * (u_sc.y - u_sc.x) / 7.0) - 0.9) * cov(-(s - edge + 14.0) * kk) * cov((s - edge) * kk);
        c = over(vec4(1.0, 1.0, 1.0, (0.9 * mr + 0.7 * tk + 0.6 * mp) * step(u_top, p.y) * down), c);
    }
    // the bars along the bottom
    c = bar(p, u_barL, vec3(0.15, 0.3, 1.0), vec3(0.15, 0.3, 1.0), u_low.x, c);
    c = bar(p, u_barR, vec3(0.95, 0.15, 0.2), vec3(0.2, 0.4, 1.0), u_low.y, c);
    gl_FragColor = c;
}
`;

const ATEXT = `// Atlas text for a cluster-render "effect" layer (GLSL ES 1.00): u_cells equal cells across the layer, each
// showing one glyph of the R8 glyph atlas bound to u_font (u_grid.x columns by u_grid.y rows of cells), picked
// by the codes in u_text (32 codes, 4 to a vec4; below 0 = empty). A new value is one uniform message, no
// pixels. After robertnisipeanu/idrive-apps js/showcase.js (TEXT_FS). v_uv (0,0) is the top-left.
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_font;
uniform vec4 u_text[8];
uniform float u_cells;
uniform vec2 u_grid;
uniform vec4 u_color;

float code(float cell) {
    float slot = floor(cell / 4.0), lane = cell - slot * 4.0;
    vec4 v = u_text[0];
    for (int i = 1; i < 8; i++) if (float(i) == slot) v = u_text[i];
    return lane < 0.5 ? v.x : lane < 1.5 ? v.y : lane < 2.5 ? v.z : v.w;
}

void main() {
    float x = v_uv.x * u_cells;
    float c = code(floor(x));
    float col = mod(c, u_grid.x), row = floor(c / u_grid.x);
    vec2 uv = vec2((col + fract(x)) / u_grid.x, (row + v_uv.y) / u_grid.y);
    float ink = c < 0.0 ? 0.0 : texture2D(u_font, uv).r;
    gl_FragColor = vec4(u_color.rgb, u_color.a * ink);
}
`;

const DIAL = `// A classic round gauge for a cluster-render "effect" layer (GLSL ES 1.00), the Roadster theme's: a black face, a
// chrome ring (u_ring at the top fading to u_ring2 at the bottom), major and minor ticks round u_sweep from u_start
// (radians, clockwise from 12 o'clock), a red band from u_redFrom (0..1 of the sweep; above 1: none), and a needle
// with a short tail and a centre cap. The numbers are text widgets round it. u_value 0..1 of the sweep.
// u_hot 1: the ring turns the shift red (at the shift point). v_uv (0,0) is the top-left; the dial fills the
// smaller side of the layer.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_value;
uniform float u_start;
uniform float u_sweep;
uniform float u_ticks;    // major steps over the sweep (8: 9 marks)
uniform float u_minor;    // minor steps per major step
uniform float u_redFrom;
uniform float u_ringW;    // chrome ring width px
uniform vec3 u_ring;
uniform vec3 u_ring2;
uniform vec3 u_tick;
uniform vec3 u_needle;
uniform vec3 u_red;
uniform vec3 u_face;
uniform float u_hot;

const float PI = 3.14159265359;

// distance from p to the segment a..b
float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from the centre, +y up
    float R = min(u_size.x, u_size.y) * 0.5 - 1.0;
    float d = length(p);
    if (d > R + 0.5) { gl_FragColor = vec4(0.0); return; }
    float edge = clamp(R + 0.5 - d, 0.0, 1.0);
    vec3 col = u_face;
    // the chrome ring, a bright lip on its inner edge
    float rin = R - u_ringW;
    if (d > rin) {
        float t = clamp(0.5 - p.y / (2.0 * R), 0.0, 1.0);
        vec3 ring = mix(u_ring, u_ring2, t);
        if (u_hot > 0.5) ring = mix(ring, u_red, 0.75);
        float lip = clamp(1.0 - (d - rin) / 3.0, 0.0, 1.0);
        col = mix(ring, vec3(1.0), lip * 0.35);
        gl_FragColor = vec4(col, edge);
        return;
    }
    float a = atan(p.x, p.y);
    float rel = mod(a - u_start + 4.0 * PI, 2.0 * PI);
    float inSweep = rel <= u_sweep + 0.02 ? 1.0 : 0.0;
    float tr = rin - 8.0;                          // the ticks' outer end
    // the red band just inside the ticks
    float frac = rel / u_sweep;
    if (inSweep > 0.5 && u_redFrom <= 1.0 && frac >= u_redFrom && d < tr - 2.0 && d > tr - 12.0) col = u_red;
    // ticks: the nearest minor step
    float steps = u_ticks * u_minor;
    float k = floor(frac * steps + 0.5);
    if (k >= 0.0 && k <= steps && inSweep > 0.5) {
        float ta = u_start + k / steps * u_sweep;
        vec2 dir = vec2(sin(ta), cos(ta));
        bool major = mod(k, u_minor) < 0.5;
        float len = major ? 26.0 : 13.0, wid = major ? 2.4 : 1.2;
        float dd = seg(p, dir * (tr - len), dir * tr) - wid;
        float c = clamp(0.5 - dd, 0.0, 1.0);
        vec3 tc = u_redFrom <= 1.0 && k / steps >= u_redFrom - 0.001 ? u_red : u_tick;
        col = mix(col, tc, c);
    }
    // the needle: tapering from the cap to near the ticks, a short tail
    float na = u_start + clamp(u_value, 0.0, 1.0) * u_sweep;
    vec2 nd = vec2(sin(na), cos(na));
    vec2 q = vec2(dot(p, vec2(nd.y, -nd.x)), dot(p, nd));    // across, along the needle
    float L = tr - 4.0;
    if (q.y > -0.18 * L && q.y < L) {
        float hwid = mix(4.5, 1.5, clamp(q.y / L, 0.0, 1.0));
        float c = clamp(hwid + 0.5 - abs(q.x), 0.0, 1.0);
        col = mix(col, u_needle, c);
    }
    // the cap
    if (d < 20.0) col = mix(vec3(0.16), vec3(0.42), clamp((20.0 - d) / 6.0, 0.0, 1.0) * clamp(0.5 + p.y / 40.0, 0.0, 1.0));
    if (d < 20.0 && d > 17.5) col = u_ring2;
    gl_FragColor = vec4(col, edge);
}
`;

const METER = `// A segmented bar meter for a cluster-render "effect" layer (GLSL ES 1.00): u_segs segments along the layer's
// width (or its height when u_vertical is 1, filling upward), the first u_value of the way lit. A lit segment takes
// u_c1 below u_at.x of the bar, u_c2 up to u_at.y, u_c3 from there (the retro green / amber / red, or warm-up blue /
// white / red); unlit ones u_track. u_peak 0..1 lights the segment it falls in u_peakC (below 0: none). u_gap px
// between segments. v_uv (0,0) is the top-left.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_value;
uniform float u_segs;
uniform float u_gap;
uniform float u_vertical;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_at;
uniform vec4 u_track;
uniform float u_peak;
uniform vec3 u_peakC;

void main() {
    vec2 p = v_uv * u_size;
    float len = u_vertical > 0.5 ? u_size.y : u_size.x;
    float x = u_vertical > 0.5 ? u_size.y - p.y : p.x;
    float slot = (len + u_gap) / u_segs;
    float i = floor(x / slot);
    float fx = x - i * slot;
    float a = clamp(fx + 0.5, 0.0, 1.0) * clamp(slot - u_gap - fx + 0.5, 0.0, 1.0);
    if (i < 0.0 || i >= u_segs || a <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float f = (i + 0.5) / u_segs;
    vec3 c = f < u_at.x ? u_c1 : (f < u_at.y ? u_c2 : u_c3);
    float lit = (i + 0.5) / u_segs <= u_value + 0.5 / u_segs ? 1.0 : 0.0;
    if (u_value <= 0.0) lit = 0.0;
    if (u_peak >= 0.0 && i == floor(min(u_peak, 0.9999) * u_segs) && lit < 0.5) { gl_FragColor = vec4(u_peakC, a); return; }
    if (lit > 0.5) gl_FragColor = vec4(c, a);
    else gl_FragColor = vec4(u_track.rgb, u_track.a * a);
}
`;

const GMETER = `// A G-meter for a cluster-render "effect" layer (GLSL ES 1.00): a bezel with ticks every 30 degrees, rings every
// u_step g out to u_max (each 0.5 g a little brighter), a crosshair, the grip envelope (the furthest g reached in
// each of 48 directions, as an outline round a faint fill), a fading trail of the last moments, and the dot,
// white, then amber from u_at.x g, then red from u_at.y g (pinned to the bezel past u_max). Positions in g as
// drawn: + x right, + y down (hud.js maps the car's signs). Array uniforms (sent with type vec4):
//   u_trail[i]  two trail points (x, y, x, y), newest first; u_trailN points in use (0..16)
//   u_env[i]    four envelope radii in g, sector k centred on k * 7.5 degrees counter-clockwise from + x
// The loops have constant bounds and the arrays are indexed by the loop counter only, as GLSL ES 1.00 requires.
// The dial fills the smaller side of the layer. v_uv (0,0) is the top-left.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_g;
uniform float u_max;
uniform float u_step;
uniform vec4 u_line;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_at;
uniform vec3 u_envC;
uniform float u_envOn;
uniform vec4 u_trail[8];
uniform float u_trailN;
uniform vec4 u_env[12];

const float TAU = 6.2831853;

float envAt(float k) {
    float slot = floor(k / 4.0), lane = k - slot * 4.0;
    vec4 v = u_env[0];
    for (int i = 1; i < 12; i++) if (float(i) == slot) v = u_env[i];
    return lane < 0.5 ? v.x : lane < 1.5 ? v.y : lane < 2.5 ? v.z : v.w;
}
vec2 trailAt(float j) {
    float slot = floor(j / 2.0);
    vec4 v = u_trail[0];
    for (int i = 1; i < 8; i++) if (float(i) == slot) v = u_trail[i];
    return j - slot * 2.0 < 0.5 ? v.xy : v.zw;
}
vec3 heat(float g) {
    vec3 c = mix(u_c1, u_c2, smoothstep(u_at.x - 0.1, u_at.x, g));
    return mix(c, u_c3, smoothstep(u_at.y - 0.08, u_at.y, g));
}
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from the centre, +y up
    float R = min(u_size.x, u_size.y) * 0.5 - 2.0;
    float d = length(p);
    if (d > R + 1.5) { gl_FragColor = vec4(0.0); return; }
    float k = (R - 5.0) / u_max;                           // px per g (the scale ends inside the bezel)
    vec4 col = vec4(0.0);
    // the bezel and its ticks (longer at 12, 3, 6 and 9 o'clock)
    float bez = clamp(1.8 - abs(d - (R - 1.0)), 0.0, 1.0);
    float ang = atan(p.y, p.x);
    float t30 = abs(fract(ang / (TAU / 12.0) + 0.5) - 0.5) * (TAU / 12.0) * d;   // px from the nearest tick line
    float t90 = abs(fract(ang / (TAU / 4.0) + 0.5) - 0.5) * (TAU / 4.0) * d;
    float tick = d > R - 9.0 ? clamp(1.3 - t30, 0.0, 1.0) * 0.8 : 0.0;
    if (d > R - 15.0) tick = max(tick, clamp(1.6 - t90, 0.0, 1.0));
    col = vec4(u_line.rgb, u_line.a * max(bez, tick));
    // rings every u_step g; the 0.5 g ones brighter
    for (int i = 1; i <= 10; i++) {
        float g = float(i) * u_step;
        if (g > u_max - 0.01) break;
        float half_ = abs(fract(g / 0.5 + 0.5) - 0.5) < 0.01 ? 1.0 : 0.0;
        float c = clamp(1.0 - abs(d - g * k), 0.0, 1.0) * (half_ > 0.5 ? 0.7 : 0.38);
        col = max(col, vec4(u_line.rgb, u_line.a * c));
    }
    // the crosshair, with a gap round the centre
    float cx = clamp(1.2 - abs(p.x), 0.0, 1.0), cy = clamp(1.2 - abs(p.y), 0.0, 1.0);
    if (d > 6.0) col = max(col, vec4(u_line.rgb, u_line.a * 0.4 * max(cx, cy)));
    // the grip envelope: radius between the two nearest sectors
    if (u_envOn > 0.5) {
        float f = fract(ang / TAU + 1.0) * 48.0;
        float k0 = floor(f), k1 = k0 + 1.0;
        if (k1 > 47.5) k1 = 0.0;
        float r0 = min(envAt(k0), u_max), r1 = min(envAt(k1), u_max);
        if (r0 > 0.04 || r1 > 0.04) {
            // a direction not reached yet is 0 g, so the outline runs in towards the centre there (a radar
            // chart); the distance is divided by the slope so the steep parts keep their width
            float re = mix(r0, r1, f - k0) * k;
            float slope = (r1 - r0) * k * 48.0 / TAU / max(d, 1.0);
            float dist = abs(d - re) / sqrt(1.0 + slope * slope);
            float edge = clamp(1.4 - dist, 0.0, 1.0) * 0.9;
            float fill = clamp(re - d + 0.5, 0.0, 1.0) * 0.10;
            col = over(vec4(u_envC, max(edge, fill)), col);
        }
    }
    // the trail: fading, thinning segments from the dot back
    float tA = 0.0;
    for (int j = 0; j < 15; j++) {
        float fj = float(j);
        if (fj + 1.0 >= u_trailN) break;
        vec2 a = clamp(trailAt(fj), vec2(-u_max), vec2(u_max)) * vec2(k, -k);
        vec2 b = clamp(trailAt(fj + 1.0), vec2(-u_max), vec2(u_max)) * vec2(k, -k);
        vec2 ab = b - a;
        float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.001), 0.0, 1.0);
        float dd = length(p - a - ab * h);
        float age = (fj + h) / 15.0;
        float wdt = mix(3.2, 0.8, age);
        tA = max(tA, clamp(wdt - dd, 0.0, 1.0) * mix(0.85, 0.08, age));
    }
    vec2 g = u_g;
    float gm = length(g);
    if (tA > 0.0) col = over(vec4(heat(gm), tA), col);
    // the dot with a soft glow, pinned to the bezel past u_max
    if (gm > u_max) g = g * (u_max / gm);
    vec2 dp = g * vec2(k, -k);
    float dd = length(p - dp);
    vec3 dc = heat(gm);
    float glow = clamp(1.0 - (dd - 7.0) / 13.0, 0.0, 1.0) * 0.4;
    float dt = clamp(8.0 - dd, 0.0, 1.0);
    col = over(vec4(dc, glow), col);
    col = over(vec4(mix(dc, vec3(1.0), clamp(3.5 - dd, 0.0, 1.0) * 0.6), dt), col);
    gl_FragColor = col;
}
`;

const REVARC = `// A segmented rev arc for a cluster-render "effect" layer (GLSL ES 1.00), the Rally theme's: a band from u_r - u_w
// to u_r round u_center (layer px, y down), from u_start sweeping u_sweep (radians, clockwise from 12 o'clock), in
// u_segs segments, the first u_value of it lit: u_low below u_midAt, u_mid up to u_highAt, u_high past it;
// unlit u_track. u_flash 1: everything lit flashes white (at the redline). v_uv (0,0) is the top-left.
// u_wing > 0: driver camera wings: the middle 2 x u_wing radians stay empty and u_segs segments sit on each side,
// mirrored, filling from the two ends in towards the middle.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_center;
uniform float u_r;
uniform float u_w;
uniform float u_start;
uniform float u_sweep;
uniform float u_segs;
uniform float u_value;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_high;
uniform float u_midAt;
uniform float u_highAt;
uniform vec4 u_track;
uniform float u_flash;
uniform float u_wing;

const float PI = 3.14159265359;

void main() {
    vec2 d = v_uv * u_size - u_center;
    float rr = length(d);
    float inner = u_r - u_w;
    float edge = clamp(rr - inner + 0.5, 0.0, 1.0) * clamp(u_r - rr + 0.5, 0.0, 1.0);
    if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float a = atan(d.x, -d.y);                      // clockwise from 12 o'clock
    float rel = mod(a - u_start + 4.0 * PI, 2.0 * PI);
    if (rel > u_sweep) { gl_FragColor = vec4(0.0); return; }
    float slot = u_sweep / u_segs;
    if (u_wing > 0.0) {
        float mid = u_sweep * 0.5;
        if (abs(rel - mid) < u_wing) { gl_FragColor = vec4(0.0); return; }
        if (rel > mid) rel = u_sweep - rel;         // the right wing, mirrored
        slot = (mid - u_wing) / u_segs;
    }
    float i = floor(rel / slot);
    float gap = 5.0 / rr;                           // a 5 px gap between segments at this radius
    float fx = rel - i * slot;
    float a1 = clamp((fx) * rr + 0.5, 0.0, 1.0) * clamp((slot - gap - fx) * rr + 0.5, 0.0, 1.0);
    float fc = (i + 0.5) / u_segs;
    vec3 c = fc < u_midAt ? u_low : (fc < u_highAt ? u_mid : u_high);
    bool lit = u_value > 0.0 && fc <= u_value + 0.5 / u_segs;
    if (lit && u_flash > 0.5) c = vec3(1.0);
    if (lit) gl_FragColor = vec4(c, edge * a1);
    else gl_FragColor = vec4(u_track.rgb, u_track.a * edge * a1);
}
`;

const TILES = `// The Dyno theme's tiles in one cluster-render "effect" layer (GLSL ES 1.00): the background u_bg and up to 14
// rounded readout tiles, each filled u_fill (u_warn while its readout is over its warning limit), framed u_line,
// with a thin u_accent strip along the top and an optional bar along the bottom: track u_track, lit from the left
// to the tile's value, coloured by where along the bar it is (u_c1 below u_at.x, u_c2 to u_at.y, u_c3 past it) or
// all u_c1 for a plain bar. Array uniforms (sent with type vec4):
//   u_tile[i]   x, y, w, h in layer px
//   u_tileV[i]  bar value 0..1 (< 0: no bar), warning (0 / 1), zoned bar (0 / 1), unused
//   u_n         tiles in use. u_geo: corner radius, border px, accent strip px, bar height px.
// Colours rgba (fills) or rgb, straight alpha. The loop bound is constant and the arrays are indexed by the loop
// counter only, as GLSL ES 1.00 requires. v_uv (0,0) is the top-left.
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_bg;
uniform float u_n;
uniform vec4 u_tile[14];
uniform vec4 u_tileV[14];
uniform vec4 u_geo;
uniform vec4 u_fill;
uniform vec4 u_warn;
uniform vec4 u_line;
uniform vec4 u_track;
uniform vec3 u_accent;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_at;

float sdBox(vec2 p, vec4 r, float rad) {
    vec2 hs = r.zw * 0.5;
    vec2 q = abs(p - (r.xy + hs)) - (hs - vec2(rad));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = u_bg;
    for (int i = 0; i < 14; i++) {
        if (float(i) >= u_n) break;
        vec4 b = u_tile[i];
        if (p.x < b.x - 1.0 || p.x > b.x + b.z + 1.0 || p.y < b.y - 1.0 || p.y > b.y + b.w + 1.0) continue;
        vec4 v = u_tileV[i];
        float d = sdBox(p, b, u_geo.x);
        float outer = clamp(0.5 - d, 0.0, 1.0);
        if (outer <= 0.0) continue;
        vec4 col = v.y > 0.5 ? u_warn : u_fill;
        // the accent strip along the top, inside the frame
        if (p.y < b.y + u_geo.z + u_geo.y) col = vec4(v.y > 0.5 ? vec3(1.0) : u_accent, 1.0);
        // the bar: inset 16 px a side, its bottom 12 px over the tile's
        if (v.x >= 0.0) {
            float bx0 = b.x + 16.0, bw = b.z - 32.0, by1 = b.y + b.w - 12.0, by0 = by1 - u_geo.w;
            if (p.x >= bx0 && p.x <= bx0 + bw && p.y >= by0 && p.y <= by1) {
                float f = (p.x - bx0) / bw;
                vec3 lit = v.z > 0.5 ? (f < u_at.x ? u_c1 : (f < u_at.y ? u_c2 : u_c3)) : u_c1;
                if (v.y > 0.5) lit = vec3(1.0);
                col = f <= v.x ? vec4(lit, 1.0) : over(u_track, col);
            }
        }
        float edge = clamp(d + u_geo.y + 0.5, 0.0, 1.0);
        col = mix(col, v.y > 0.5 ? vec4(1.0, 1.0, 1.0, 0.85) : u_line, edge);
        c = over(vec4(col.rgb, col.a * outer), c);
    }
    gl_FragColor = c;
}
`;

const SLANTBAR = `// A slanted level bar for a cluster-render "effect" layer (GLSL ES 1.00): ShakHUD's battery bar. A parallelogram (the top edge
// shifted right by u_slant px, as the M Style rev bar leans), a 2 px outline in the colour u_on, lit from the left up to u_value
// (0..1), the rest see-through u_track, cut by three thin slanted gaps (quarters). v_uv (0,0) is the top-left.
//   u_size px, u_slant px, u_value 0..1, u_on rgba (outline and fill), u_track rgba (the unlit part)
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_slant;
uniform float u_value;
uniform vec4 u_on;
uniform vec4 u_track;

void main() {
    vec2 p = v_uv * u_size;
    float x = p.x - u_slant * (1.0 - v_uv.y);
    float w = u_size.x - u_slant;
    float e = min(min(x, w - x), min(p.y, u_size.y - p.y));
    float inside = clamp(e + 0.5, 0.0, 1.0);
    if (inside <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float ring = 1.0 - clamp(e - 1.5, 0.0, 1.0);
    float lit = clamp(w * u_value - x + 0.5, 0.0, 1.0);
    float gap = 1.0 - clamp(abs(x - w * 0.25) - 1.0, 0.0, 1.0);
    gap = max(gap, 1.0 - clamp(abs(x - w * 0.5) - 1.0, 0.0, 1.0));
    gap = max(gap, 1.0 - clamp(abs(x - w * 0.75) - 1.0, 0.0, 1.0));
    float ba = mix(u_track.a, u_on.a, lit) * (1.0 - gap);
    float a = max(ring * u_on.a, (1.0 - ring) * ba) * inside;
    gl_FragColor = vec4(mix(u_track.rgb, u_on.rgb, max(lit, ring)), a);
}
`;

const MSTYLE = `// M Style HUD rev counter for a cluster-render "effect" layer (GLSL ES 1.00): a bent bar, a rising slant then a level run, with
// ticks under it. The rpm (0..1 of u_g.z thousand) fills the bar from its first end; the part from u_g.w on is the red zone.
// Uniforms (px in the layer):
//   u_size
//   u_A    P0 (the bar's start) and P1 (the bend), x0 y0 x1 y1
//   u_B    P2 (the bar's end)
//   u_g    bar width, the share of the scale at the bend (0..1), ticks (thousands of rpm on the scale), where the red zone starts (0..1)
//   u_v    value 0..1, the held peak 0..1 (0 = none), the zone (0 = the bar is white, 1 = orange in the run-up to the redline, 2 = red), spare
//   u_hy   rgb the lit colour while the battery drives or charges, a = 1 then (0 = the engine's rpm, lit white, orange, u_hot by the zone)
//   u_hot rgb;  u_fg, u_track rgba (straight alpha)
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_A;
uniform vec2 u_B;
uniform vec4 u_g;
uniform vec4 u_v;
uniform vec4 u_hy;
uniform vec3 u_hot;
uniform vec4 u_fg;
uniform vec4 u_track;

vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float k = under.a * (1.0 - top.a), a = top.a + k;
    return vec4((top.rgb * top.a + under.rgb * k) / max(a, 0.0001), a);
}

float seg(vec2 p, vec2 a, vec2 b, out float t) {
    vec2 ab = b - a;
    t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - a - ab * t);
}

void main() {
    vec2 p = v_uv * u_size;
    vec2 a = u_A.xy, b = u_A.zw, c = u_B;
    float t1, t2;
    float d1 = seg(p, a, b, t1), d2 = seg(p, b, c, t2);
    float l1 = length(b - a), l2 = length(c - b);
    bool first = d1 < d2;
    float d = first ? d1 : d2;
    float f = first ? t1 * u_g.y : u_g.y + t2 * (1.0 - u_g.y);
    float s = first ? t1 * l1 : l1 + t2 * l2;
    float hw = u_g.x * 0.5;
    vec3 lit = u_hy.a > 0.5 ? u_hy.rgb : mix(mix(vec3(1.0), vec3(1.0, 0.68, 0.1), clamp(u_v.z, 0.0, 1.0)), u_hot, clamp(u_v.z - 1.0, 0.0, 1.0));
    vec4 fill = f <= u_v.x ? vec4(lit, 1.0) : (f >= u_g.w ? vec4(u_hot, 0.45) : u_track);
    vec4 col = vec4(fill.rgb, fill.a * clamp(hw + 0.5 - d, 0.0, 1.0));
    // the outline, 2 px at the bar's edge
    col = over(vec4(u_fg.rgb, clamp(2.0 - abs(d - hw + 1.0), 0.0, 1.0)), col);
    // the needle: the bright edge of the fill, a little wider than the bar
    float sv = u_v.x <= u_g.y ? u_v.x / u_g.y * l1 : l1 + (u_v.x - u_g.y) / (1.0 - u_g.y) * l2;
    if (u_v.x > 0.01) col = over(vec4(1.0, 1.0, 1.0, clamp(2.5 - abs(s - sv), 0.0, 1.0) * clamp(hw + 3.5 - d, 0.0, 1.0)), col);
    // the held peak (u_v.y, 0 = none): a thin tick across the bar above the lit part
    float sq = u_v.y <= u_g.y ? u_v.y / u_g.y * l1 : l1 + (u_v.y - u_g.y) / (1.0 - u_g.y) * l2;
    if (u_v.y > u_v.x + 0.02) col = over(vec4(1.0, 1.0, 1.0, 0.8 * clamp(1.8 - abs(s - sq), 0.0, 1.0) * clamp(hw + 3.5 - d, 0.0, 1.0)), col);
    // ticks under the bar, longer on the even thousands
    for (int i = 0; i < 9; i++) {
        float fi = float(i);
        if (fi <= u_g.z) {
            float fr = fi / u_g.z;
            bool in1 = fr <= u_g.y;
            vec2 dir = abs(fr - u_g.y) < 0.001 ? normalize(normalize(b - a) + normalize(c - b)) : (in1 ? normalize(b - a) : normalize(c - b));
            vec2 tp = in1 ? mix(a, b, fr / u_g.y) : mix(b, c, (fr - u_g.y) / (1.0 - u_g.y));
            vec2 n = vec2(-dir.y, dir.x);
            bool even = mod(fi, 2.0) < 0.5;
            vec2 s0 = tp + n * (hw + 3.0), s1 = s0 + n * (even ? 10.0 : 5.0);
            vec2 q = s1 - s0;
            float u = clamp(dot(p - s0, q) / dot(q, q), 0.0, 1.0);
            float dt = length(p - s0 - q * u);
            vec3 tc = fr >= u_g.w - 0.001 ? u_hot : u_fg.rgb;
            col = over(vec4(tc, clamp((even ? 1.9 : 1.3) - dt, 0.0, 1.0)), col);
        }
    }
    gl_FragColor = col;
}
`;

// The blue literals of the three blue themes that follow the drive mode (accent.js): the speed bracket, the hexagon and its tabs, the
// backdrop's tint and facets, the speed stripe. The hybrid's blue, the cold oil's, the fuel and battery bars stay blue.
const ACCENT_LITERALS = {
    sdash: ['0.36, 0.62, 1.0', '0.13, 0.3, 0.78', '0.62, 0.86, 1.0', '0.2, 0.45, 0.98', '0.012, 0.036, 0.09', '0.03, 0.09, 0.19', '0.04, 0.12, 0.24',
        '0.02, 0.07, 0.16', '0.07, 0.2, 0.38', '0.06, 0.2, 0.62', '0.15, 0.36, 0.92'],
    mblade: ['0.03, 0.07, 0.19', '0.09, 0.31, 0.7', '0.085, 0.34, 0.79', '0.075, 0.31, 0.72', '0.07, 0.275, 0.66', '0.08, 0.31, 0.74', '0.075, 0.28, 0.68',
        '0.095, 0.32, 0.76', '0.45, 0.6, 1.0', '0.5, 0.7, 1.0', '0.4, 0.62, 1.0', '0.12, 0.3, 0.62', '0.12, 0.34, 0.7', '0.1, 0.3, 0.66', '0.3, 0.78, 1.0'],
    navi: ['0.016, 0.05, 0.125', '0.026, 0.08, 0.19', '0.014, 0.045, 0.11', '0.03, 0.08, 0.17', '0.1, 0.18, 0.84'],
};
const _accented = {};
/** The shader `type` in the drive mode's hue ('blue' = as it is; 'green' | 'red'): the same source with the listed blues rewritten (cached). */
function accented(type, hue) {
    const base = module.exports[type];
    if (hue !== 'green' && hue !== 'red') return base;
    if (!ACCENT_LITERALS[type]) return base;
    const key = type + '/' + hue;
    if (!_accented[key]) _accented[key] = accentSource(base, ACCENT_LITERALS[type], hue);
    return _accented[key];
}
module.exports = { slantbar: SLANTBAR, mstyle: MSTYLE, shiftbar: SHIFTBAR, arc: ARC, revbar: REVBAR, lights: LIGHTS, shiftlight: SHIFTLIGHT, fill: FILL, box: BOX, grid: GRID, segbar: SEGBAR, mdash: MDASH, mtach: MTACH, sdash: SDASH, mblade: MBLADE, navi: NAVI, boxes: BOXES, atext: ATEXT, dial: DIAL, meter: METER, gmeter: GMETER, revarc: REVARC, tiles: TILES, accented, ACCENT_LITERALS };
