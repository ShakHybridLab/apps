'use strict';
/**
 * The drawing engine, shared by every app here that draws through cluster-render
 * (native/cluster-render): it connects, builds the active layout's layers in
 * the active theme (one effect layer per shader widget, the image widgets packed into sheets, below), and
 * keeps live widgets updated from the kit's car.js.
 * Started by an app's main.js with the kit's ctx (settings, signals, log, spec, dataDir).
 * It lives in the repo's shared/ folder; app.json "shared" ships it with each app.
 *
 * Which display: app.json config.target, "hud" (800x480, the windshield HUD; the default) or
 * "panel" (1920x720, the whole instrument cluster, drawn over BMW's own gauges).
 * config.statusName names it on the status row ("HUD", "Cluster").
 * Which layout: with the "byMode" setting on and the car's drive mode known (FES
 * statusFESVehicleDynamicSwitchHMI), the "inHybrid" / "inSport" / "inEco" setting; otherwise "hudLayout".
 * The layout name "off" draws nothing, so BMW's own HUD or cluster shows (and the other app can have the
 * shared scene: cluster-render never shows the HUD and the cluster panel at once). The two apps tell each other
 * what they show (screen.js): when the driver gives the screen to the other one (page.js asks first), this one
 * draws nothing until a theme or layout is picked on its own page again.
 * The colour theme is the layout's own "theme" when it has one (the cluster themes), else the "hudTheme"
 * setting (auto = Night after sunset).
 *
 * Effect shaders: cluster-render's v_uv has (0,0) at the TOP-left (PROTOCOL.md; confirmed on the car,
 * Nov 4 2026, when a box's header strip drew at the bottom). The bench draws the same way.
 *
 * Layer packing (Nov 5 2026): cluster-render draws at most 8 layers per client connection (its
 * CompositorLimits.per_client; 32 across all clients; a 9th is refused with "too many layers"), which the car
 * photos showed as a theme's shaders plus the first few text widgets. So the image widgets (text, scale, stripe, badge, gridlabels, icon, swatchimg) are
 * packed into SHEETS, one image layer per sheet, instead of one layer each. Widgets are grouped by
 * (class, z) and placed in file order: a widget goes into the first sheet of its group opened after every
 * earlier layer or widget its rect intersects (so an image widget never clobbers one it overlaps, and
 * file order still decides what is on top) AND whose union box with it stays within the sheet size limit,
 * else a new sheet is opened. A sheet's rect is the union box of its members (iw/ih that size). On create
 * every member is painted into a local buffer and the sheet is sent whole once (a 1920x720 RGBA whole write
 * is 5,529,600 bytes, under the 5,529,664 message limit; the client keeps its own whole copy); after that
 * every member update is a dirty rect of the sheet, translated by the sheet's offset (_blit; gridlabels
 * keeps its small-rects path). Effect widgets are one layer each, as before. An image widget with
 * "own": true gets its own layer as before (the calibration probes use it to count how many layers the car
 * draws).
 * Sheet size vs layer count: a rebuild re-sends every sheet whole, through the car's upload budget (floor
 * 2000 KB/s, ceiling 5500, the HUD gets at most half), so sheets are kept small: the limit starts at a
 * quarter of the target area (345,600 px on the panel, 96,000 on the HUD). If that needs more than
 * LAYER_BUDGET (8) layers in all (effects + own + sheets), the limit is doubled and the layout re-planned,
 * up to unlimited; if even unlimited needs more than 8, a warning says so and the layout is drawn anyway.
 * The rebuild log line names the layout, widget and layer counts, the limit used and the bytes of the
 * whole-sheet writes; the status row names the layer count, not the widget count; and two seconds after a
 * rebuild cluster-render's own status text is asked for and logged.
 *
 * Widget types (hud/layouts/*.json, or <data>/layouts/ overrides, see layouts.js):
 *   text      image layer; template tokens below, a font from hud/fonts, colour role
 *   scale     image layer; the shift bar's rpm numbers (0 .. bar max / 1000), evenly spread
 *   stripe    image layer; the M tricolour stripe
 *   shiftbar  effect layer; shaders.js shiftbar, lit by rpm, zones from the redline
 *   arc       effect layer; shaders.js arc, lit by a signal between min and max
 *   revbar    effect layer; shaders.js revbar, the G20-style slanted rev bar (Redline layout):
 *             "barH" bar height, "top" room for the marks above it, "slant" px, "over" rpm past the
 *             redline's thousand the scale runs to (1000: a 7000 redline gives 0..8)
 *   slantbar  effect layer (shaders.js slantbar): ShakHUD's battery bar, a slanted parallelogram with an outline and quarter gaps, lit from the
 *             left by "signal" (hvSoc) between "min" (0) and "max" (100); "slant" px (10); light blue, green while the battery charges
 *             (hybrid_tach.js), red while the charge is in reserve (the setting "reservePct")
 *   lights    effect layer; shaders.js lights, shift lights filling from "from" rpm (3000) up to the shift point
 *   badge     image layer; a rounded tag with text: "tone" verdict (the last shift's grade colour) or cold
 *   fill      effect layer; a solid colour (role "color", default "bg") over the whole widget, with an
 *             optional see-through "hole": [x, y, w, h] in target px, cut only while the bool setting
 *             "holeWhen" is on (true: always; the cluster's map window), shrunk by "holeInset" px on every side (6) with
 *             "holeRadius" px corners (28), so BMW's own cluster doesn't peek out at the window's corners.
 *             Opaque fill hides BMW's gauges under it.
 *   box       effect layer; a framed box: "fill" and "line" roles, "border" px, "radius" px, and a
 *             header strip "head" px tall in role "headColor" (its label is a text widget on top)
 *   mdash     effect layer; the M theme's whole backdrop (shaders.js mdash): "card" [x, yBottom, rBottom, rTop] (the
 *             left card, traced off the M8 photo: outer edge x, bottom y, the big round at the bottom outer corner, the
 *             rounding where the top curve meets the outer edge; the right card is its mirror), "cardTop" [a, b, c] (the
 *             card's top edge, y = a x^2 + b x + c), "cardCutR" [cx, cy, r] (the right card's lower outer corner cut on
 *             that circle, in the mirrored left frame), "cardFill" 0..1 (grey level, 0 = black: outline only), "blade" { xm, ym,
 *             kTop, kBot, round } (the left rev blade's outer edge, as mtach; the card ends "bladeGap" px before it),
 *             "line" [x0, y, x1, cap], "tyres" [cx, cy, scale] (the tyre block's car glyph and dividers; the eight
 *             readouts are text widgets with {{tyreP:FL}} .. {{tyreT:RR}} and {{u:pressure}}), "gaugeL" / "gaugeR" { cx, cy, r, (a dial as the M8's: a thin glass bracket whose outer edge is the circle cx, cy, r, lit from the bottom up to the value, drawn over the card; the right one is the left one's mirror)
 *             signal, min, max }, "mark" [x, y, scale], "segbars" [{ x, y, w, h, max, signal } x up to 4] (the
 *             setup level bars, "segSlant" px; the segment at round(signal) is red), "plate" [x, y, w, h, splitX] (the card under the
 *             map window that holds the gear and the speed, with a thin divider at splitX; drawn only while "hole" is cut; a silver
 *             hairline then also runs round the window). Positions in target px.
 *   mtach     effect layer; the M rev bar: "side" left|right, "max" rpm, and in target px for the LEFT bar
 *             "y0" (0 rpm), "y8" (max), "ym" (the bend), "xm" (outer edge x at the bend; the right bar gives
 *             its own, mirrored), "kTop" / "kBot" (x per y px above / below the bend), "round", "wBot" / "wTop" / "wBend"
 *   sdash     effect layer; the whole Sport theme (shaders.js sdash): "geo" [yTop, yBend, yBottom, xBend] and
 *             "k" [above, below, round] for the left bracket's outer line (the right one is mirrored), "band"
 *             width, "inner" (the inner line's distance from the outer one), "scale" [y of 0, y of the top mark],
 *             "ticks" [speed, rpm], "rpmMax" (speed follows SPEED_SCALE), "fuelSeg" / "oilSeg" [fullX, fullY,
 *             emptyX, emptyY] (the oil bar shows the "oilSignal" instead, with "oilMin" / "oilMax": hvSoc 0 / 100 for the battery), "strip" [left end x, y, h, slant], "topEnd" x; the middle is deep blue with a lighter glow (the setting "sportTint", % of the car's own blue, 0 = black), and the map
 *             window is cut see-through while "holeWhen" is on ("hole", "holeInset", "holeRadius" as fill)
 *   mblade    effect layer; the M Blade theme (shaders.js mblade), traced off a photo of a BMW M cluster: the blue hexagon "hex" [x, y where its
 *             design point (612, 167) lands, scale, the share it is narrower than the photo's (0 = as is; the map view, same height)] (none without it), the speed line "sp" [x, y of the top cap's left end, x, y of the knee]
 *             and "sq" [x, y of the bottom end, cap length] with "sy" [y of the 0 label, the knee's label, the top label] (a marker rides it on
 *             the M_SCALE speed scale), the rev blade "bl" [top y, bottom y, left edge x at the top, its slope], "br" [right edge x at the top,
 *             its slope, its thickness, the maroon body's width], "bx" [scale, x of the top line's left end, x of the red base line's left end],
 *             "scale" [y of the max mark, y of 0], "rpmMax" (7000); three slanted strips "g0" (fuel), "g1" (the oil temperature, lit blue / green / red) and "g2"
 *             (the hybrid battery, 0..100 %): [left edge x at the top, top y, bottom y, slope]; "deco" draws the four tabs and the cyan swoosh under the hexagon; "hybridTach" true makes the blade (mblade) or the rev bracket (sdash, with "chgOnBar" true: it also shows the charge) a hybrid rev counter (see hybrid_tach.js; tokens {{tachUnit}}, {{chargeNote}}); "fuelH" true lays the first strip flat: "g0" is then [top y, panel width - right end x, panel width - left end x, 0] (the bar runs from x left to x right, empty at its left); "hole", "holeWhen",
 *             "holeInset", "holeRadius" as fill (the hexagon and the backdrop are cut over the map window); "mapPlace": true on a layer with a
 *             "holeWhen" "mapUp" hole also has Waze on cluster (0.9.107+, map_window.js) draw the map right in that window while it shows
 *   mpanel    effect layer; M Blade's view panel (shaders.js mpanel), as BMW M's own cluster opens its views on the left: a blue band whose two
 *             sides are "<", "shape" [x, y of the left point, the sides' slope (x per y px), the band's width] in panel px; up to four level bars
 *             across it, "bar" [left x, right x] and "rows" [{ y (the bar's middle), signal, min, max, red (where the red end starts, 0..1),
 *             tone: "temp" | "boost" | "ice" | none }], "div" the marks (2: the ends and the middle)
 *   navi      effect layer; the Navi theme (shaders.js navi): the speed band on the left "band" { tip [x, y], slope (dy per dx), bottom (y),
 *             sep [px, per y] and edge [px, per y] (offsets right of the outer line at y 300), top (y where the purple stripe begins) },
 *             "scale" [y of the top mark, y of 0] (SPEED_SCALE, the marker rides it), the line under the map "line" [x0, y, x of the
 *             step up, x where it is back level] and "line2" [upper y, x where it starts to fade, x where it ends], the two bottom bars
 *             "barL" (fuel) and "barR" (hybrid battery) [x, y, width]; the window is cut with "hole" / "holeWhen" as fill
 *   segbar    effect layer; "max" segments, the first round(signal) lit (e.g. "setupLevel:engine"), "slant" px
 *   emblem    image layer; lettering baked by tools/bake_emblems.py (hud/emblems/<name>.json), painted in a light blue / dark blue /
 *             red gradient (emblems.js); "setting" names the choice setting that picks which (off = none; hidden while the Waze map is up,
 *             unless the widget says "keepWithMap": true, for a theme that keeps it clear of the map window)
 *   icon      image layer; a line icon from icons.js ("icon": gauge, shock, wheel, cog, stack, therm, oilcan, fuel, oilPour, tempWave, battBolt, fuelPump);
 *             "lowWhen": "fuel" | "battery" (an icon or a text) turns it the shift red while the fuel range is at or under "reserveKm" (90) / the charge at or under "reservePct" (10);
 *             "tempBy": "oil" | "coolant" paints it in the colour of that temperature's number (blue cold, green warm, flashing red over the limit)
 *   arc also takes "start" and "sweep" in degrees (clockwise from 12 o'clock; negative = anticlockwise)
 *   grid      calibration: effect layer of lines every "step" px (brighter every "major" steps)
 *   gridlabels  calibration: image layer, "x/y" at every "step" px (only the labels are uploaded)
 *   swatch    calibration: effect layer (calibration.js SWATCH), "steps" (11) grey steps 0..1 over the top
 *             half, four dark test colours over the bottom half
 *   swatchimg calibration: image layer, the identical picture painted into pixels (calibration.js
 *             swatchImage), so a photo of the two strips shows how the effect and image paths differ
 *   atext     effect layer (shaders.js atext): text drawn by the GPU from a glyph atlas, the probe for the path
 *             that needs no pixel writes. The font's glyphs go up once per connection as an R8 asset (one byte a
 *             pixel, not a layer, shared by every atext widget on that font); the widget is "cells" equal cells
 *             across its width ("w" / cells wide each; the glyphs keep their shape when w = cells x the font's
 *             widest advance and h = its cell height, logged at creation), and a new value is one uniform
 *             message of glyph codes. "text" tokens as text, "font", "color" role, "align" left | right | center.
 *             Up to 32 cells; only the characters the font has.
 *   dial      effect layer (shaders.js dial): a classic round gauge, the Roadster's: "measure" speed | rpm | signal ("signal",
 *             "max", "ticks"); speed reads 0..160 mph / 0..240 km/h (DIAL_SPEED, labels {{dial:speed:<i>}}), rpm 0.."max"
 *             (8000) with the red band from the redline (_redMarks) and the ring in the shift red at the shift point;
 *             "start" / "sweep" degrees (225 / 270), "minor" ticks per step (4), "ringW" px (14), roles "ring" (line)
 *             fading to "ring2" (dim), "tick" (fg), "needle" (hot), "face" (bg). The numbers are text widgets.
 *   meter     effect layer (shaders.js meter): a segmented bar, "signal" between "min" and "max" (raw units: km/h, C,
 *             bar, rpm), "segments" (20), "gap" px (4), "vertical": true fills upward; "colors" [3 roles] lit below
 *             "at"[0] / up to "at"[1] / past it (fractions of the bar; "max": "evRangeFull" runs a bar of the evRange signal to the
 *             full battery's range, the evRangeFull setting), "trackColor" (track); "peak": ms (true = 3 s)
 *             holds the highest segment lit in "peakColor" (fg). arc takes "peak" too: a dot on the stroke.
 *   gmeter    effect layer (shaders.js gmeter): a G-meter: a bezel, rings every 0.25 g (0.5 g past 1.2 g) out to the
 *             setting "gRange" (1.2 g; the layout's "max" only when the setting is missing), the grip envelope (the
 *             furthest g this drive in 48 directions, role "envColor", fg), a trail of the last "gTrail" seconds (2;
 *             0 = none) and the dot: role "dot" (fg) under 0.5 g, amber to 0.8 g, the shift red past it; roles "line"
 *             (dim), "lineAlpha" 0-255 (150; 255 on the HUD, where see-through is faint). The dot moves the way the
 *             car accelerates (into the turn, up when speeding up), as a G-meter usually draws it; the
 *             settings "gFlipLat" (the car's left / right the other way round) / "gFlipLong" (brake on top) swap the
 *             drawing, a layout's "flipX" / "flipY" swap again. g is averaged over 150 ms and a sample over 3 g is
 *             dropped (also for the tokens). The envelope and the bests (tokens, the page's G-meter tab) last until
 *             resetG(), the app's restart or the switch between demo and car data.
 *   mstyle    effect layer (shaders.js mstyle): ShakHUD's M Style rev counter, a bent bar: "pts" [[x0, y0], [x1, y1], [x2, y2]] in target px (the
 *             start, the bend, the end: a rising slant, then a level run), "bar" its width in px, "corner" (2000) the rpm at the bend, "rpmMax" (7000,
 *             the scale's end, ticks every 1000); lit in the red from the engine's rpm, in light blue (power) while the battery alone drives
 *             and in green while it charges ("hybridTach": true, the setting "hybridRev"; "chgOnBar": true shows the charge); the red zone
 *             starts at the redline setting. The numbers are text widgets (tokens {{tachUnit}}, {{chargeNote}}).
 *   revarc    effect layer (shaders.js revarc): a segmented rev arc, the Rally theme's: centre "center" [x, y] (layer px, may
 *             sit below the layer), outer radius "r", "band" px (40), "start" / "sweep" degrees clockwise from 12 o'clock,
 *             "segments" (30); colours, flash and scale as the shiftbar.
 *   tiles     effect layer (shaders.js tiles): the Dyno theme's readout tiles in ONE layer: the background (role "color",
 *             bg) and up to 14 rounded tiles "tiles": [{ id, x, y, w, h (target px), slot, bar (false: none), toggle }],
 *             each with a thin "accent" strip on top and a bar along the bottom for its slot's sensor (TILE_BAR; zoned
 *             ones run "colors" [bar1, bar2, hot] split at "at" [0.6, 0.85], the rest all bar1). A tile turns role
 *             "warn" while its oil / coolant / boost reading is over the warning limit (put "warnFlash": false on
 *             its texts). Roles "fill" (panel), "line", "trackColor" (track); "radius" (8), "border" (1.5), "strip"
 *             (3), "barH" (6) px. The labels and values are text widgets on top.
 * Any image widget: "own": true gives it its own image layer instead of a place in a packed sheet (above).
 * Any widget: "conn": 0..3 puts its layer (or its sheet) on that connection to cluster-render. The 8-layer limit
 *   is per connection, so a second socket from the same app gets another 8 (DukeAPenguin saw 28 layers over four
 *   sockets on his car, Nov 5 2026; the calibration grids probe it here: L5..L16 on connections 2..4). 0 (the
 *   default) is the app's own connection; a layout never asks for more than it needs, each extra one is opened
 *   on first use and named <app id>_<n>. Sheets never span connections.
 * Pixel memory: cluster-render has 16 MiB for every app's images together and counts each image twice
 *   (Compositor::add_image; a layer past it is refused with "the service's pixel memory is full"), so every
 *   image layer costs w*h*8 bytes. The rebuild log and the status row say what a layout costs.
 * Text and badge updates send only the one rectangle around the pixels that changed since the last paint
 *   (changes() below, after PenguinDukeYDAuto/idrive7-EVAHUD's eva_canvas.js, MIT): a 3-digit readout
 *   that goes 123 -> 124 sends its last digit, not the widget.
 *   boxes     effect layer; the GT3 dash's frame in ONE layer (shaders.js boxes; the car draws only a few effect
 *             layers): the background (role "color", default "bg") with the optional map "hole" as fill, and up to
 *             12 framed boxes "boxes": [{ id, x, y, w, h (target px), head (header strip px), border (2), radius
 *             (0), headColor "accent" (else the "head" role), toggle }]. Roles "fill" (panel), "line", "head",
 *             "accent" for all of them; the labels are text widgets on top. Sent as array uniforms (vec4 x 12).
 * Any widget: "toggle": "<bool setting>" hides it when that setting is off, "!<setting>" when it is on,
 * "<choice setting>=<value>" shows it only while that choice is picked (also with "!");
 * "mapUp" (toggle or holeWhen) is not a saved setting: on while the Waze map shows inside the theme (waze.js; the
 * "mapInTheme" setting); the map is a content z 0 layer, so a frame meant to sit over it is content z 1 or more.
 * "themes": [...] shows it only in those themes. Text "color2": a second role, the colour at the bottom
 * of the box (a top-to-bottom gradient, the chrome look). Text: "hotWhen": "now" turns it the shift red
 * at the shift point; "coldWhen": "cold" turns it blue while the cold guard lowers the shift point.
 * scale: "over" as revbar; "redFrom": true draws the numbers from the redline on in red.
 * shiftlight  effect layer (shaders.js shiftlight): the stock BMW shift light, the M and Sport themes': "segments" (5) slanted
 *   lights on each side of a solid red centre block ("center" px wide, "gap" px, "skew" px lean, "lean": "in" tops lean to the
 *   centre, "out"). The orange lights fill from the outer ends in as the rpm climbs from "from" (3000); the red block comes on
 *   at the red zone's start (the setting "shiftLightRed", 4500 rpm on the X3 30e, else "red": the shift point) and everything
 *   flashes red at 8 Hz from the zone's end ("shiftLightFlash", 5500, else "flash": the redline). "off": alpha of an unlit
 *   light (0.14).
 * lights: "count" (12), "from" rpm (3000) where the first light comes on, "tail" (0): the last "tail" lights are blue
 *   (the GT3 look); "round": true for dots;
 * "off" the alpha of an unlit light (0.14).
 * Text "warnFlash": false: no flash over the warning limit (a tile that turns red itself).
 * Text "colorBy": "verdict" colours it by the last shift's grade. Text "near": ["speed" | "rpm", i] turns it
 * "nearColor" (fg) while scale label i is the one the needle has reached (the highest label at or under it: it lights as the needle gets to it
 * and goes out when it falls back; BMW lights up the label by the needle); "mspeed" is the M Blade's scale.
 *   The zoom of the scale numbers: with "nearFont" (a bigger bake of the font, tools/bake_fonts.py *_z) that label is drawn larger, in the
 *   orange (run-up) or the shift red (zone; the layout's "zoneRed": false makes it yellow, "runUp": false skips the orange), while its bar is in its zone: "speed"/"mspeed" labels follow the speed bar (setting "speedZone"),
 *   "rpm" labels the rev counter ("rpmMax": the scale's top; orange the 700 rpm before the redline, red from it or the shift point; none
 *   on the hybrid's electric power or charge). The rev label under the needle (from label 1) takes the shift red (yellow with "zoneRed": false),
 *   light blue while the bar shows the battery driving and green while it charges, as the bar. "grow" [left, top, right, bottom]: the box is already grown by these px for the larger digits
 *   (tools/zoom_labels.py). "zoomColor": false: the number only grows, it keeps its colour (it sits on the bar's own fill).
 *
 * rpm is smoothed (a 120 ms filter, and the readout moves in 50 rpm steps only when it changes by 40 or
 * more), so idle wobble doesn't show, as on BMW's own tach. Shift scoring uses the raw rpm.
 * Boost: FES displayBoostPressure while it's valid, else (app.json config.dme) the engine unit over
 * read-only UDS, absolute pressure minus outside air pressure, as the kit's car vitals do.
 *
 * Text tokens: {{speed}} {{u:speed}} {{oil}} {{coolant}} {{boost}} {{u:boost}} {{rpm}}
 * {{gear}} (P / R / N, D3 / S3 / M3 by the shifter programme, or just 3 when the selector position is unknown), {{gearnum}} (3, or P / R / N)
 * {{spd:<i>}} (speed scale label i of SPEED_SCALE: 0..200 mph, 0..320 km/h) {{range}} {{rangeTotal}} (fuel + electric range) {{u:distLc}} (mi, km) {{u:dist}} (MI, KM) {{ambient}} (outside, signed: +75) {{u:speedLc}} (mph, km/h) {{ampmLc}} (am, pm) {{torque}} {{u:torque}} (lb-ft, Nm) {{torquePct}} {{powerPct}} (% of config.engine's peak) {{boostHi}} {{boostMid}}
 * (gauge labels for 1.4 / 0.7 bar in the display unit) {{stage}} (P R N, D / S / M by the shifter programme) {{gearInD}} (gear number while in D) {{mode}} (COMFORT, SPORT, SPORT PLUS, SPORT INDIVIDUAL, ECO PRO, ...) {{modeName}} (the same in mixed case for the small drive-mode text: Hybrid, Hybrid Eco Pro, Sport Plus)
 * {{temp:<deg C>}} (that temperature in the display unit, °F rounded to 10, for gauge labels) {{setup:engine|chassis|steering|gearbox}} (what that part is set to in the drive mode now)
 * {{time}} {{ampm}} {{u:temp}} (°F / °C) {{gLat}} {{gLong}} (g, 2 decimals) {{gSide}} ("0.42 L", "0.42 R")
 * {{gFwd}} ("0.31 ACC", "0.31 BRK") {{gBest}} (the most g this drive) {{gMax}} (the G-meter's range, "1.2") {{signal:<car.data() key>}} (raw, 1 decimal).
 * Redline (shift_score.js): {{rpm10}} (rpm to 10) {{shiftAt}} {{lastShift}} {{lastGears}} (4 > 5)
 * {{verdict}} {{shiftPrompt}} (SHIFT at the shift point) {{coldNote}} (only while the oil is cold).
 * Units follow the "units" setting: us = mph, °F, psi; metric = km/h, °C, bar.
 * {{intake}} (intake air, from the engine unit: app.json config.dme.intake) {{boostPeak}} (the highest boost since the last
 * 0-60 run started) {{avgSpeed}} (average moving speed this drive, from its first minute) {{run}} (the 0-60 clock running, else the last time, s) {{runBest}} {{runState}} (READY / GO / DONE)
 * {{runLabel}} (0-60 MPH, 0-100 KM/H): runs.js. {{warm}}: WARMING UP while the oil is under 80 C, then ENGINE WARM.
 * {{badge}}: the model picked on the Badge tab (badges.js), "BMW X3 M40i" with the lettering on, '' for none.
 * Warnings: a text showing oil, coolant or boost (a {{oil}} / {{coolant}} / {{boost}} token, or a readout slot with that
 * sensor) flashes in the shift red while the value is over "warnOil" / "warnCoolant" (C) / "warnBoost" (bar); 0 = off.
 * Text "tyreBy": "FL" | "FR" | "RL" | "RR" (with {{tyreP:..}}): yellow while that tyre's pressure is under "tyreLow" (bar, 0 = never; 2.0), red 0.4 bar under it.
 * The ice alert (cluster only, the setting "iceBelow" in C, 0 = never; 3 by default): "iceBy": true on the "snow" icon (blank until the outside
 * temperature is at or under it; flashes 8 s, then lit, in the cold blue) and on the outside temperature's text (cold blue meanwhile).
 * The electric share of the drive (the setting "evShare"): {{evShare}} in %, {{evShareUnit}} a "%" (both blank without a battery or under 0.3 km),
 * "evShareBy": true on the "leaf" icon (blank when there is no share).
 * Colour by drive mode (cluster only, the setting "accentByMode"): Sport, M Blade and Navi take blue in Hybrid Eco Pro, green in Hybrid, red in Sport
 * "accentBy": true on a text (the drive mode's name) takes the mode's colour as well, the Sport theme's bright blue in its hue.
 * (accent.js: the shaders' listed blues and the theme's "sblue" role are rewritten when the layout is built; the layout is rebuilt when the mode changes).
 * The speed limit ring (cluster only; speedlimit.js, the setting "limitRing"): {{limit}} is the limit in the unit shown ('' without one) and "limitBy": true on its text, or on the "ring" icon, makes them red while the speed is over it; the icon is
 * blank without a limit. The 0-100 km/h timer (0-60 mph; the setting "launchTimer"): {{launch}} is its time (0.1 s live, 0.01 s held 12 s once
 * it has finished), {{launchUnit}} an "s" while it shows, "launchBy": true on a text or on the "stopwatch" icon (blank otherwise; green for a new best time).
 * The launch cue (cluster and HUD; the settings "launchReady" and "launchRpm"): in the Sport drive mode, once the car has stood still with the engine at the speed set, a chequered flag ("readyBy": true on the "flag" icon)
 * and {{launchReady}} ("Launch Control Ready", or {{launchReady1}} / {{launchReady2}} in two lines; "readyBy": true makes a text green, "plain" keeps its own colour; "readyHides": true on a text or an icon blanks it while the cue is up) wait in green,
 * at the bottom centre (over the drive mode's name on M Blade; the car's own launch control can't be
 * read: it is the timer that is ready). Only the layouts with a
 * "readyBy" widget have it (the four cluster themes and the HUD).
 * The next speed limit (the car's camera; the setting "nextLimit"): {{nextLimit}} is the limit coming up in the unit shown ('' without one, or when it is the present limit),
 * "nextBy": true on the small ring icon blanks it likewise. The car's own warning (check control message, the setting "carAlert", off by default): "alertBy": true on the "warn" icon
 * (blank without a message, yellow with one).
 * The lane assist (the setting "carLane", off by default): "laneBy": true on the "wheel" icon (blank unless the car says the symbol is on; in the car's own colour, red for a lane departure warning).
 * Text "tempBy": "oil" | "coolant" (with the same token): blue while the reading is under "oilCold" / "coolantCold" (C; 0 = never
 * blue), green once it is warm (three white flashes when it gets there while the app runs), and over the warning limit it flashes between the
 * shift red and a dark red.
 * Shift-light test (testShift(), the page's Alerts tab): for about 4 s the rpm every widget sees climbs from 1500 to just
 * past the shift point and holds there; only while the car stands. Shift scoring keeps the car's own rpm.
 * Night colours (ShakTheme "nightDim" on Auto): after sunset (sun.js, at _sunPlace(): the time zone's middle) a layout's own theme is
 * built with its whites and greys at 60 %; the minute timer rebuilds at sunset and sunrise.
 *
 * Boost is a PUSH signal, not a diagnostic poll: tracing the kit's
 * car_vitals showed its boost reading is de.bmw.infotainment.drivingexcitement.FES /
 * statusSwitchDriveDynamicSport2.displayBoostPressure, factor 0.01, offset 0,
 * invalid 255. car_vitals itself treats that field as unreliable on some cars, so
 * whether this X3 fills it is checked on the first drive. Reported here in bar.
 *
 * Never throws out of a timer or event: the kit turns an uncaught exception into an
 * app exit, and on the car a second unexpected exit uninstalls the app.
 */
const fs = require('fs');
const path = require('path');
const sensors = require('./sensors');
const { ClusterRender, DEFAULT_PATH } = require('./cluster_render_client.js');
const Layouts = require('./layouts');
const { THEMES, M_STRIPE, LIGHTS, VERDICT, color } = require('./hud_themes');
const ShiftScore = require('./shift_score');
const visible = require('./visible');
const sun = require('./sun');
const textRaster = require('./hud_text');
const { paintIcon } = require('./icons');
const { paintEmblem } = require('./emblems');
const hudData = require('./hud_data');
const shaders = require('./shaders');
const calibration = require('./calibration');
const Car = require('./kit/car');
const Waze = require('./waze');
const Screen = require('./screen');
const { ClusterInfo } = require('./cluster_info');
const { MapWindow } = require('./map_window');
const hybridTach = require('./hybrid_tach');
const { Danger, formatDistance, formatLimit } = require('./danger');
const { freeRect } = require('./free_rect');
const { shiftLightState } = require('./shift_light');
const badges = require('./badges');
const Runs = require('./runs');
const { SpeedLimit, decodeSign } = require('./speedlimit');
const { Probes, PROBES, GUIDE, guidanceOf } = require('./probes');
const extras = require('./car_extras');
const bottomStrip = require('./bottom_strip');
const gearWindow = require('./gear_window');
const { hueOfMode, accentTheme, mapRole } = require('./accent');
const ACCENT_BRIGHT = [92, 158, 255, 255];   // the Sport theme's brightest blue (0.36, 0.62, 1.0), whose hue the drive mode's name takes
const tz = require('./tz');
// sharing the HUD with other kit apps (Redline, issue #4): kit/runtime/hud_claim.js, from cauliflowermossgrape's kit
// (MIT). HUD Widgets is a "standing" app, like Cluster functions: it gives way while another app holds a fresh
// claim, and says it is on so that app hands the HUD back at the car's switch-off.
const { HudClaim } = require('./kit/hud_claim');
const CLAIM_ID = 'idrive_hud_widgets';
const CLAIM_MS = 1000;

const BOOST_SCALE = { factor: 0.01, offset: 0, invalid: 255 }; // see header comment
// the widget types drawn as pixels (image layers, packed into sheets unless "own": true); the rest are shaders
// the effect layers the views' readings sit on: M Blade's panel, Navi's card, Sport's round gauges (the same rows, the same tyres' view)
const VIEW_PANEL = { mpanel: true, vcard: true, sring: true, nline: true, mblades: true };
const BACKDROP_TYPES = { sdash: true, mdash: true, mblade: true, navi: true };   // the shaders that read u_rect / u_org (a piece of the picture)
const IMAGE_TYPES = { text: true, scale: true, stripe: true, badge: true, gridlabels: true, icon: true, emblem: true, swatchimg: true };
const STATUS_ASK_MS = 2000;      // after a rebuild: ask cluster-render for its own status text
// an image layer is "stalled" until its first pixels reach cluster-render, which after a rebuild takes a second or two
// through the upload budget: normal. Only one still stalled this long is logged as a problem (and its recovery)
const STALL_WARN_MS = 5000;
const LAYER_BUDGET = 8;          // cluster-render's limit per client connection (CompositorLimits.per_client; confirmed on the car Nov 5 2026)
const MAX_CONN = 4;              // connections a layout may ask for ("conn"): 32 layers service-wide / 8 per connection
const PIXEL_BYTES = 16 * 1024 * 1024;   // cluster-render's pixel memory for every app's images together (CompositorLimits.pixel_bytes)
const SHEET_AREA_FRAC = 4;       // the first sheet size limit: 1/4 of the target area (see the header)
const REFUSED_RETRY_MS = [5000, 15000, 45000];   // after cluster-render refused a layer: the layout is made again after these waits, then left (see _retryRefused)
const POWER_HOLD_MS = 60000;      // the battery's power, once shared, keeps its place this long after the sharing stops (see _powerHeld)
const REBUILD_MIN_MS = 400;      // two rebuilds of the layout are at least this far apart (see _rebuild)
const FAULT_WHOLE = 3;           // an error caught by _guard is logged with its stack this many times for each place...
const FAULT_QUIET_MS = 10000;    // ...then one line at most this often
const TICK_MS = 20;              // 50 Hz: shift bar and gauges (20 Hz moved in visible steps, 40 Hz until 0.21.24; owner, Nov 18 2026: "a few more fps"; a frame costs under 1 ms and unchanged uniforms are not sent)
const PERF_WINDOW_MS = 5000;   // the window the Signals tab's loop timing is counted over
const CDS_IFACE = 'de.bmw.infotainment.vehicle.CDS';
/**
 * The engine's speed in DisplayDataServer.functionalLibraryData (member "rpm", whole rpm: 900 at idle on the owner's car, 19 Nov 2026), or null: not a
 * number, the invalid values (0xFFFF and up) or out of an engine's range.
 */
function rpmAltOf(v) {
    if (!v || typeof v !== 'object') return null;
    const k = Object.keys(v).find((n) => /^rpm$/i.test(n));
    const n = k === undefined ? NaN : Number(v[k]);
    return isFinite(n) && n >= 0 && n <= 12000 ? n : null;
}
// The cluster's power meter was read every 2 s (as eroobeeroo's apps do): the hybrid rev bar then jumped up and fell away in one step, "pas fluide"
// on the owner's car (19 Nov 2026). Read as often as the rev counter, the bar follows the pedal.
const REL_POLL_MS = 250;
const RPM_POLL_MS = 250;           // how often the rev counter is read on top of the car's own notifications
// the electric power estimated from the speed (setting "estPower", the rev bar in electric when nobody gives the real power): the X3 xDrive30e's
// own figures, rounded. mass kg with a driver, drag = half rho Cd A in N per (m/s)^2, rolling resistance, the drive and recuperation efficiencies,
// the motor's power in kW (the most it can show), the most it can recover, and the filters of the speed and of the acceleration (ms)
const EST = { massKg: 2150, drag: 0.5, roll: 0.010, etaDrive: 0.85, etaRegen: 0.6, maxKw: 80, maxRegenKw: 60, minRegenKw: 2, speedMs: 250, accelMs: 300 };
const SPEED_FILTER_MS = 90;      // the speed bars' own smoothing (the car sends the speed a few times a second): the bars glide, the digits stay the car's own
const ZOOM_MS = 60;              // the scale numbers that grow or change colour re-draw this often while they ease
const TEXT_MS = 200;             // text re-draws at most 5 times a second (what BMW's own readouts do)
const TARGET_SIZES = { hud: [800, 480], panel: [1920, 720] };
// X3 30e (plug-in hybrid): three modes, Hybrid / Hybrid Eco Pro / Sport, no Comfort (a Comfort number, if the car
// ever sends one, counts as Hybrid). There is no "Electric Eco Pro" (the owner, Nov 16 2026): its Eco Pro is the Hybrid Eco Pro; every
// Eco Pro or Electric number from the car is that one slot ('eco').
const MODE_KEY = { hybrid: 'inHybrid', electric: 'inEco', eco: 'inEco', sport: 'inSport', comfort: 'inHybrid' };
const TYRE_CORNERS = ['FL', 'FR', 'RL', 'RR'];
// the Roadster's speed dial: 0..160 mph or 0..240 km/h in 8 steps (labels {{dial:speed:<i>}})
const DIAL_SPEED = { us: { max: 160, ticks: 8 }, metric: { max: 240, ticks: 8 } };
// the HUD's place (the page's Position tab): settings that move / scale the layers already there, no rebuild
const PLACE_KEYS = ['hudX', 'hudY', 'hudScale'];
// "Leave BMW's bottom strip clear" (cluster, issues #5 / #1): BMW's own strip (range, clock, belt light, P) starts at
// y 662. A theme that stops at 646 (shared/bottom_strip.js) makes the KOMBI draw no black boxes over it: the original app's
// "Bottom strip: the car's own", found on cars; at 662 the owner's photos of Nov 15 2026 still showed them.
// cluster-render has no clip, so the switch squeezes every layer to 646 / 720 of its height about the panel's top; the rows of the
// bottom the strip already shows are left out, a black band covers the stock dials' edge, and the backdrops lose the window and rim
// they dug round the box (u_slotOff).
const STRIP_TOP = bottomStrip.TOP;
// settings that only change what a text shows (the next tick paints it), no rebuild
const LIVE_KEYS = ['iceBelow', 'evShare', 'launchReady', 'launchRpm', 'warnOil', 'warnCoolant', 'warnBoost', 'oilCold', 'coolantCold', 'tyreLow', 'badge', 'badgeBMW', 'gFlipLat', 'gFlipLong', 'gRange', 'gTrail'];
// g (the idea of a G-meter app, no code): a sample over G_BAD is a bad reading, not a corner;
// the rest are averaged over G_AVG_MS so kerbs and potholes don't throw the dot about
const G_BAD = 3;
const G_AVG_MS = 150;
// the G-meter's grip envelope: G_SECTORS directions, a reading also lifts the G_SPREAD sectors either side of it
// (by the cosine), so the outline closes up between nearby readings; the trail holds G_TRAIL points
const G_AMBER = [255, 176, 40];         // the dot between 0.5 and 0.8 g
const G_SECTORS = 48, G_SPREAD = 3, G_TRAIL = 16;
// warnings (page.js Alerts): a readout of oil / coolant / boost over its limit flashes in the shift red
const WARN = { oil: 'warnOil', coolant: 'warnCoolant', boost: 'warnBoost' };
// a temperature text with "tempBy" is blue below this setting (C), green above it, and flashes red over its warning limit
const COLD_BELOW = { oil: 'oilCold', coolant: 'coolantCold' };
const ACCENT_ROLES = { sportdash: ['sblue'] };   // the theme roles that take the drive mode's colour (the shaders' blues: shaders.js ACCENT_LITERALS)
const LAUNCH_RPM = 2000, LAUNCH_RPM_HYST = 400;   // the launch cue: the engine speed that means a foot on the throttle, and its hysteresis
const ICE_BLINK_MS = 8000;       // the snowflake flashes this long when the ice alert comes on
const WARM_PULSE_MS = 2400, WARM_FLASH_MS = 400;   // a temperature that reaches its warm value flashes white three times in this long, this fast
const TYRE_RED_BAR = 0.4;               // a tyre pressure this far under the setting "tyreLow" is red (yellow from the setting)
const WARN_DIM = [120, 16, 22, 255];   // the dark red a temperature flashes from, up to the shift red, while over its warning limit
const WARN_FLASH_MS = 300;
// the sensors a slanted bar can show ("sensor"): the colour of the boost's bar (the oil's and the coolant's follow their temperature)
const SENSOR_BAR = { oil: true, coolant: true, boost: [79, 180, 255, 255] };
// The views a theme shows one at a time in place of its empty slot ("viewSel=<name>" in a widget's toggle; the setting "viewSel" picks one by hand, and the
// button behind the steering wheel steps through them, nextView()): in the order they come, and the last press goes back to none (the theme as it was).
const VIEW_ORDER = ['gauges', 'tyres', 'drive', 'electric', 'conso', 'media'];
/** The views of `widgets` (those whose toggle has "viewSel=<name>"), in VIEW_ORDER. */
const viewsOf = (widgets) => {
    const seen = {};
    widgets.forEach((w) => { const m = /(?:^|&)viewSel=([a-z]+)/.exec(w.toggle || ''); if (m) seen[m[1]] = true; });
    return VIEW_ORDER.filter((v) => seen[v]);
};
// The hybrid rev counter of M Blade and Sport (widget key "hybridTach"; the decision is in hybrid_tach.js): rpm while the engine runs, the battery's
// power in blue while it alone drives (10 kW per mark), the charge in green (M Blade's foot under the 0, Sport's bracket).
// a tile's bar (the Dyno theme's "tiles") per sensor (sensors.js id): the raw reading (hud _raw) between min and
// max, "z" for a zoned bar (blue, dark blue, red past u_at); a sensor not here has no bar. rpm runs to the bar max.
const TILE_BAR = {
    rpm: { raw: 'rpm', min: 0, max: 'rpm', z: 1 }, speed: { raw: 'speed', min: 0, max: 260 },
    boost: { raw: 'boost', min: 0, max: 1.6, z: 1 }, torque: { raw: 'torquePct', min: 0, max: 100, z: 1 },
    power: { raw: 'powerPct', min: 0, max: 100, z: 1 }, torquePct: { raw: 'torquePct', min: 0, max: 100, z: 1 },
    powerPct: { raw: 'powerPct', min: 0, max: 100, z: 1 }, oil: { raw: 'oil', min: 40, max: 150, z: 1 },
    coolant: { raw: 'coolant', min: 40, max: 130, z: 1 }, intake: { raw: 'intake', min: 0, max: 80, z: 1 },
    ambient: { raw: 'ambient', min: -20, max: 45 }, gLat: { raw: 'gLat', min: 0, max: 1.2, z: 1, abs: true },
    gLong: { raw: 'gLong', min: 0, max: 1.2, z: 1, abs: true }, fuel: { raw: 'fuel', min: 0, max: 1 },
    range: { raw: 'range', min: 0, max: 700 }, hvSoc: { raw: 'hvSoc', min: 0, max: 100 },
    evRange: { raw: 'evRange', min: 0, max: 'evRangeFull' },     // a full bar is a full battery's range (the evRangeFull setting)
};
const TILE_MAX = 14;       // half a flash: red, then the normal colour
// the shift-light test (page.js Alerts): rpm climbs from TEST_FROM to just past the shift point, then holds
const TEST_FROM = 1500, TEST_CLIMB_MS = 2500, TEST_HOLD_MS = 1200;
// night colours (ShakTheme "nightDim"): after sunset the theme's whites and greys go to this brightness
const NIGHT_DIM = 0.6;
// the car's display units (Vehicle statusNewCurrentUnitsStatusExt, as BMW's own x_call reads them; car_vitals, MIT)
const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F' };
const PRESS_TO_BAR = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 };
const unitName = (map, v) => map[v] || (Object.values(map).indexOf(v) >= 0 ? v : null);
// MDrive dataDisplayGearbox.displayProgramGearbox: the programme the cluster shows next to the gear (car_vitals, MIT)
const PROGRAMS = { S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 1: 'S', 2: 'M' };
const MODE_NAME = { hybrid: 'Hybrid', electric: 'Electric', eco: 'Hybrid Eco Pro', sport: 'Sport', comfort: 'Hybrid' };
const FRESH_MS = 3000;
const TZ_AUTO = -9999;           // the "timeZone" setting's Automatic: the head unit's own time zone
// A plug-in hybrid's high-voltage battery charge: read-only UDS 22 DDBC from its battery unit (SME, 0x07), 0.1 %.
// The read Redline 2.0 and eDrive use (the MGU kit's Redline and eDrive apps, MIT).
// Asked every HV_EVERY_MS only while a shown readout uses it; a car that doesn't answer is asked once a minute.
// Not checked on a car by us (no hybrid here, Nov 10 2026).
const HV_SOC = { ecu: 0x07, did: 'DDBC', bytes: 2, at: 0, factor: 0.1, offset: 0, min: 0, max: 100, timeoutMs: 1000 };
// The fuel level as a % from the engine unit: standard OBD-II PID 2F ("fuel tank level input", A x 100 / 255), as
// the kit's Live Data lists it (MIT). A % needs no tank size; the car's own fuel
// signal is litres only. Whether BMW engine units answer it is not known yet (Nov 11 2026): without an answer the
// gauge falls back to litres / the "tankLitres" setting.
const FUEL_OBD = { obd: '2F', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100, timeoutMs: 1000 };
const FUEL_EVERY_MS = 10000, FUEL_RETRY_MS = 300000, FUEL_STALE_MS = 60000;
const HV_EVERY_MS = 5000, HV_RETRY_MS = 60000, HV_STALE_MS = 20000;
const WINDOW_HOLD_MS = 6000;            // the centre window stays open this long after the last app that asked for it stopped asking
const CAR_ERANGE_MS = 10 * 60 * 1000;   // the car's own electric range counts for this long after it last said (it changes slowly)
const EV_RANGE_NONE = 4093;   // the electric range the cluster sends for "none" (4093 on the owner's car; 0xFFFE and up too): not a range
// the zone colours of the rev and speed bars: white at first, orange in the run-up to the zone, then the theme's red
const ZONE_RGB = [[0.97, 0.98, 1.0], [1.0, 0.68, 0.1], [1.0, 0.18, 0.24]];
const SWEEP_MS = 1600;                  // the start-up sweep: the bars climb to the top and come back down in this long (half each way)
const SWEEP_WAIT_MS = 1500;             // ... starting this long after the layout is built, so its layers have reached cluster-render
const PEAK_HOLD_MS = 1500;              // the rev counter's peak tick stays this long where the rpm topped out, then eases down onto the rpm
const PEAK_FALL = 0.001;                // ... at this much of the scale per ms (0.9 to 0.3 in 0.6 s)
const HY_BLUE = [77, 191, 255, 255], HY_GREEN = [51, 217, 128, 255];   // the hybrid rev bar's blue (the battery drives) and green (it charges), for the scale numbers
const ZONE_EASE_MS = 140;               // the zone colours and the zoom of the numbers ease to their target over about this long: a soft change, no jump
// BMW's speed scale: even steps to 120 mph (180 km/h), then wider ones to 200 mph (320 km/h)
const SPEED_SCALE = { us: [0, 20, 40, 60, 80, 100, 120, 160, 200], metric: [0, 30, 60, 90, 120, 150, 180, 250, 320] };
// the M Blade theme's own speed scale (the photo it follows): 0..330 km/h, the knee at 150
const M_SCALE = { us: [0, 20, 40, 60, 80, 100, 130, 170, 205], metric: [0, 30, 60, 90, 120, 150, 210, 270, 330] };
/** speed (display unit) -> 0..1 along a scale of evenly spaced labels */
function scaleFrac(v, marks) {
    if (!(v > 0)) return 0;
    for (let i = 1; i < marks.length; i++) if (v <= marks[i]) return (i - 1 + (v - marks[i - 1]) / (marks[i] - marks[i - 1])) / (marks.length - 1);
    return 1;
}           // a boost reading older than this is not used

/**
 * The drive mode from FES statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience: names or wire
 * numbers (the kit's live_data signals, MIT): 1 Sport, 2 Sport+, 3 Sport individual,
 * 4 Comfort, 5 Comfort+, 6 Comfort individual, 7 Eco Pro, 8 Eco Pro+, 9 Eco Pro individual, 10 Adaptive.
 */
/** The mode's variant: 'plus' (Sport+ / Comfort+ / Eco Pro+: wire 2, 5, 8, or PLUS / EXPERT in the name), 'individual'
 *  (wire 3, 6, 9, or INDIVID in the name), else null. */
function driveVariantOf(raw) {
    const v = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    // 23 = PHEV Sport Plus; 16 / 21 = PHEV Sport / Electric individual (the kit's ambient_config, MIT)
    if (typeof v === 'number') return v === 2 || v === 5 || v === 8 || v === 23 ? 'plus' : v === 3 || v === 6 || v === 9 || v === 16 || v === 21 ? 'individual' : null;
    if (typeof v !== 'string') return null;
    return /PLUS|EXPERT/i.test(v) ? 'plus' : /INDIVID/i.test(v) ? 'individual' : null;
}

/** The M theme's setup rows: what each part is set to in a drive mode (they follow the mode buttons). */
const SETUP = {
    eco:       { engine: 'ELECTRIC', chassis: 'COMFORT', steering: 'COMFORT', gearbox: 'EFFICIENT' },
    comfort:   { engine: 'COMFORT', chassis: 'COMFORT', steering: 'COMFORT', gearbox: 'COMFORT' },
    hybrid:    { engine: 'HYBRID', chassis: 'COMFORT', steering: 'COMFORT', gearbox: 'COMFORT' },
    electric:  { engine: 'ELECTRIC', chassis: 'COMFORT', steering: 'COMFORT', gearbox: 'EFFICIENT' },
    sport:     { engine: 'SPORT', chassis: 'SPORT', steering: 'SPORT', gearbox: 'SPORT' },
    sportplus: { engine: 'SPORT PLUS', chassis: 'SPORT', steering: 'SPORT', gearbox: 'SPORT PLUS' },
    // the car reports only that an Individual setup is on, not what each part is set to (no signal found yet)
    individual: { engine: 'INDIVIDUAL', chassis: 'INDIVIDUAL', steering: 'INDIVIDUAL', gearbox: 'INDIVIDUAL' },
};
// the same in French, in capitals without accents (the labels' fonts have the capitals only): the owner's apps are in French
const SETUP_FR = { ELECTRIC: 'ELECTRIQUE', COMFORT: 'CONFORT', HYBRID: 'HYBRIDE', EFFICIENT: 'EFFICIENT', SPORT: 'SPORT', 'SPORT PLUS': 'SPORT PLUS', INDIVIDUAL: 'INDIVIDUEL' };
const SETUP_LEVEL = { EFFICIENT: 1, COMFORT: 1, HYBRID: 1, ELECTRIC: 1, SPORT: 2, 'SPORT PLUS': 3, INDIVIDUAL: 0 };

function driveModeOf(raw) {
    let v = raw;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim());
    if (typeof v === 'number') {
        if ((v >= 1 && v <= 3) || v === 15 || v === 16 || v === 23 || v === 28) return 'sport';     // 15 / 16 / 23: PHEV Sport, Sport individual, Sport Plus; 28 Boost
        if ((v >= 7 && v <= 9) || v === 18) return 'eco';                                           // 18: PHEV Hybrid Eco (Eco Pro)
        if (v === 20 || v === 21) return 'eco';                                                     // PHEV Electric, Electric individual: this car's Hybrid Eco Pro
        if ((v >= 4 && v <= 6) || v === 10 || v === 17 || v === 19 || v === 22) return 'hybrid';   // no Comfort on a plug-in hybrid: Hybrid; 22: PHEV Battery Control (the Cluster Centre FES table)
        return null;
    }
    if (typeof v !== 'string') return null;
    const u = v.trim().toUpperCase();
    if (/BATTERY|BATTERIE/.test(u)) return 'hybrid';
    if (/ELECTRIC|ELEKTR/.test(u)) return 'eco';
    if (/ECO|EFFICIEN/.test(u)) return 'eco';
    if (/SPORT|BOOST/.test(u)) return 'sport';
    if (/HYBRID|COMFORT|ADAPTIVE/.test(u)) return 'hybrid';
    return null;
}

/**
 * The drive mode as the car's screens name it, for the small text in every theme ({{modeName}}): the X3 30e's
 * Hybrid, Electric, Hybrid Eco Pro, Electric Individual, Sport, Sport Individual, Sport Plus and XtraBoost.
 * Wire numbers from the kit's ambient_config (MIT): 15 Sport, 16 Sport individual, 17 Hybrid, 18 Hybrid
 * Eco (this car calls it Hybrid Eco Pro), 19 Hybrid comfort, 20 Electric, 21 Electric individual, 22 Battery Control, 23 Sport Plus,
 * 28 Boost. A number or word that is not known gives null (the group's own name is used then).
 */
const DRIVE_NAMES = { 1: 'Sport', 2: 'Sport Plus', 3: 'Sport Individual', 4: 'Hybrid', 5: 'Hybrid', 6: 'Hybrid', 7: 'Hybrid Eco Pro',
    8: 'Hybrid Eco Pro', 9: 'Hybrid Eco Pro', 10: 'Hybrid', 15: 'Sport', 16: 'Sport Individual', 17: 'Hybrid', 18: 'Hybrid Eco Pro',
    19: 'Hybrid', 20: 'Electric', 21: 'Electric Individual', 22: 'Battery Control', 23: 'Sport Plus', 28: 'Xtraboost' };
function driveNameOf(raw) {
    let v = raw;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim());
    if (typeof v === 'number') return DRIVE_NAMES[v] || null;
    if (typeof v !== 'string') return null;
    const u = v.trim().toUpperCase(), ind = /INDIVID/.test(u);
    if (/XTRA|BOOST/.test(u)) return 'Xtraboost';
    if (/BATTERY|BATTERIE/.test(u)) return 'Battery Control';
    if (/ELECTRIC|ELEKTR/.test(u)) return /ECO/.test(u) ? 'Hybrid Eco Pro' : ind ? 'Electric Individual' : 'Electric';
    if (/ECO|EFFICIEN/.test(u)) return 'Hybrid Eco Pro';
    if (/SPORT/.test(u)) return /PLUS|EXPERT/.test(u) ? 'Sport Plus' : ind ? 'Sport Individual' : 'Sport';
    if (/HYBRID|COMFORT|ADAPTIVE/.test(u)) return 'Hybrid';
    return null;
}

/**
 * The panel's and the HUD's scene ids from cluster-render's status text ("target panel: slot 0x203 scene 0x10004f8
 * 1920x720: ..."), as numbers in hex; null when either line is missing (an older service, the bench).
 */
function sceneIdsOf(text) {
    const id = (t) => { const m = String(text).match(new RegExp('target ' + t + ':[^\\n]*?scene (0x[0-9a-fA-F]+)')); return m ? '0x' + parseInt(m[1], 16).toString(16) : null; };
    const panel = id('panel'), hud = id('hud');
    return panel && hud ? { panel, hud } : null;
}

function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }

/**
 * The one rectangle around what differs between two RGBA images of the same size, with its pixels, or null
 * when they are the same (after idrive7-EVAHUD's eva_canvas.js, MIT). The link is what is short, not the CPU:
 * comparing a widget costs about a tenth of painting it.
 */
function changes(was, now, w, h) {
    const row = w * 4;
    const sameRow = (y) => now.compare(was, y * row, (y + 1) * row, y * row, (y + 1) * row) === 0;
    const samePx = (o) => now[o] === was[o] && now[o + 1] === was[o + 1] && now[o + 2] === was[o + 2] && now[o + 3] === was[o + 3];
    let top = 0;
    while (top < h && sameRow(top)) top++;
    if (top === h) return null;
    let bottom = h - 1;
    while (sameRow(bottom)) bottom--;
    let left = w, right = -1;
    for (let y = top; y <= bottom; y++) {
        if (sameRow(y)) continue;
        const o = y * row;
        for (let x = 0; x < left; x++) if (!samePx(o + x * 4)) { left = x; break; }
        for (let x = w - 1; x > right; x--) if (!samePx(o + x * 4)) { right = x; break; }
    }
    const rect = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    const px = Buffer.allocUnsafe(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) now.copy(px, y * rect.w * 4, (top + y) * row + left * 4, (top + y) * row + (right + 1) * 4);
    return { rect, px };
}
function rgba(c) { return [c[0] / 255, c[1] / 255, c[2] / 255, (c[3] === undefined ? 255 : c[3]) / 255]; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

class HudApp {
    constructor(ctx) {
        this.ctx = ctx;
        this.log = ctx.log;
        this.config = (ctx.spec && ctx.spec.config) || {};
        // HUD_CLUSTER_SOCKET: the Mac bench's fake cluster-render; never set on the car
        this.socketPath = process.env.HUD_CLUSTER_SOCKET || this.config.socketPath || DEFAULT_PATH;
        this.clients = [];               // the connections to cluster-render: [0] the app's own, more for "conn" widgets
        this.started = false;
        this.layerStates = new Map();    // "<conn>:<ref>" -> { state, reason, since, long } from cluster-render
        this.stallTimers = new Map();    // "<conn>:<ref>" -> timer: warns if the layer is still stalled after STALL_WARN_MS
        this.client = this._clientAt(0);
        this.target = TARGET_SIZES[this.config.target] ? this.config.target : 'hud';
        this.size = TARGET_SIZES[this.target];
        this.label = this.config.statusName || 'HUD';
        this.layoutTheme = null;         // the active layout's own theme, if it has one
        this.gearWin = null; this._avoid = null;   // the hole over BMW's gear letter (shared/gear_window.js), set at each rebuild
        this.sweepAt = null; this.sweptName = null;   // the start-up sweep: when it starts (Date.now()), and the layout it last ran for
        this.runUp = true;               // the orange run-up before a zone (the layout's "runUp": false leaves it out: white, then red)
        this.zoneRed = true;             // the zoom numbers end in red (the layout's "zoneRed": false: yellow, the M theme; the bars stay red)
        this.layouts = new Layouts(ctx.dataDir, this.log, this.size);
        this.widgets = new Map();        // widget.id -> { w, ref, sheet | null, last, lastPaint }
        this.sheets = [];                // the packed image layers: { ref, klass, z, x, y, w, h, members, buf }
        this.boostFes = null; this.boostFesAt = 0;    // bar, from the sport display signal
        this.boostDme = null; this.boostDmeAt = 0;    // bar, from the engine unit (fallback)
        this.needsBoost = false;         // a shown widget uses boost (the engine unit is only asked then)
        this.intakeDme = null; this.intakeDmeAt = 0;  // C, intake air from the engine unit (config.dme.intake)
        this.needsIntake = false;        // a shown widget uses the intake temperature
        this.hvSoc = null; this.hvSocAt = 0;  // %, a plug-in hybrid's battery charge (HV_SOC)
        this.needsHv = false;            // a shown widget uses it
        this.hasReady = false;           // the layout has the launch cue ("readyBy")
        this.fuelObd = null; this.fuelObdAt = 0;  // %, the fuel level from the engine unit (FUEL_OBD)
        this.needsFuel = false;          // a shown widget uses the fuel level
        this.boostPeak = null;           // bar, the highest boost since the last 0-60 run started ({{boostPeak}})
        this.runs = new Runs(ctx.dataDir, this.log);   // the 0-60 timer (runs.js)
        this.runs.onStart = () => { this.boostPeak = null; };
        this.evKm = 0;                   // of it, km driven with the engine off (a plug-in hybrid): {{evShare}}
        this.tripKm = 0;                 // this drive (since the app started with the car): km driven and
        this.tripMs = 0;                 // ms moving, for {{avgSpeed}}
        this.tripT = 0;
        this.driveMode = null;           // 'hybrid' | 'electric' | 'eco' | 'sport', once the car has said
        this.driveRaw = null;            // a drive mode value the car sent that we don't know (shown in the status)
        this.driveVariant = null;        // 'plus' (Sport+ / Comfort+ / Eco Pro+), 'individual', or null
        this.driveName = null;           // the mode as the car names it (driveNameOf), for the small text in the themes
        this.carUnits = { press: null, temp: null, psiSeen: false };   // the car's display units, for the TPMS values
        this.program = null;             // 'S' / 'M' from the MDrive gearbox display, else null (D)
        this.gradeMode = null;           // the same display for the shift grades: D / S / M, null while unknown
        this.fuelL = null; this.rangeKm = null; this.ambient = null;   // KombiIF tank / range, outside temperature
        this.carErange = null; this.carErangeAt = 0;   // the cluster's own electric range (KombiIF displayRangeElectricVehicle), in the car's distance unit
        this.tyres = { p: {}, t: {} };                                  // TPMS pressure (bar) and temperature (C) per corner FL FR RL RR
        this.activeName = null;          // the layout shown now ('off' = nothing)
        this.pixelBytes = 0;             // what the layout's image layers and glyph atlases cost of cluster-render's pixel memory
        this.atlases = new Map();        // "<conn>:<font>" -> { ref, c, ci, cols, rows, cellW, cellH, chars, bytes }: R8 assets, kept across rebuilds
        this.targetState = null;         // { state, holder, reason } of our target
        this.rpmF = null; this.rpmShown = null; this.lastTickT = 0;
        this.themeName = null;
        this.flash = false;
        this.problem = null;             // why nothing shows (a bad layout), for the status line
        this.statusListeners = [];
        this.lastStatus = null;

        this.slotsFile = path.join(ctx.dataDir || '.', 'slots.json');
        this.slotPicks = {};             // { layout: { slot id: sensor id } }: the readout slots' picks (page.js Readouts)
        try { this.slotPicks = JSON.parse(fs.readFileSync(this.slotsFile, 'utf8')) || {}; } catch (e) { /* none yet */ }
        this.layoutSlots = [];           // the active layout's "slots"
        this.placed = [];                // every layer made for the layout: { c, ref, x, y, w, h } (where the layout puts it)
        this.mapLayout = false;          // the active layout has a map window (a widget with holeWhen "mapUp")
        // the Waze map inside the theme (ShakTheme, config.waze; waze.js): "mapUp" is on while it shows
        this.waze = this.config.waze ? new Waze(Object.assign({ dataDir: ctx.dataDir }, this.config.waze), this.log, () => this._guard('waze', () => {
            if (this.mapLayout && this.setting('mapUp') !== this.mapShown) this._rebuild(); else this._status();
        })) : null;
        this.viewNow = null;             // the view the steering wheel's button stepped to (null: the setting "viewSel" decides), see nextView()
        this.layoutViews = [];           // the views the active layout has
        this.mapShown = false;           // "mapUp" when the layout was built
        this.routeActive = null;         // a route is guided on the phone (CarPlay), from GUIDE (probes.js); null until the car says
        // what the car's own signals say (car_extras.js; the values were not seen yet, so each is read tolerantly): the next limit the camera
        // recognised { kmh, at }, a check control message showing (true / false / null), the electric motor's share { q, at }
        this.nextLim = null; this.carAlert = null; this.carQuota = null; this.relPow = null; this.relAlive = false; this.lane = null;
        // the centre window opened for Cluster Centre / Cluster Info (cluster_info.js): the same window the Waze map
        // shows in, see-through while one of them asks for it (setting centreWindow); windowRect is the active
        // layout's, on the panel
        this.windowOpen = false;
        this.windowAskAt = 0;
        this.windowRect = null;
        // the screen shared with the other app (screen.js): stepping aside while the driver gave it to the other one
        this.screen = new Screen(this.target === 'panel' ? 'cluster' : 'hud', ctx.dataDir, this.log,
            () => !!(this.started && this.activeName && this.activeName !== 'off'), () => this._guard('screen', () => this._rebuild()),
            () => this.scenesApart === true);
        // cluster-render 0.5.1+ gives the panel its own scene id, so the cluster and the HUD can show at once; null until
        // its status says (sceneIdsOf), false while they share one (older versions, or a panel fallen back after the guard)
        this.scenesApart = null;
        // the hand-over with the Cluster Info / Cluster Centre apps (cluster_info.js): the battery charge in, out and who asks for it
        this.mapWin = new MapWindow(this.log);       // tells Waze on cluster where the window is (layouts with "mapPlace")
        this.mapPlace = false;           // the active layout has Waze draw the map in its own window (holeWhen "mapUp" and "mapPlace")
        this.ci = new ClusterInfo({ id: ctx.spec && ctx.spec.id, name: ctx.spec && ctx.spec.title, onChange: () => this._guard('power', () => this._powerChanged()) }, this.log);
        // the energy flow (the battery's power in kW) another app shares (eDrive Live): the Sport theme shows it in place of the boost
        // while it does (widgets with toggle "power", "powerShut" or "powerOpen", the boost's with "boostShown"), and the layout is rebuilt when it comes or goes
        this.powerLayout = false;        // the active layout has such a widget
        this.hybridEv = false; this.hybridCharge = false;   // M Blade's hybrid rev counter: the battery alone drives / the battery charges
        this.hybridPow = null;           // while the rev bar shows the battery's power: { kw (>= 0), chg } (blue driving, green charging), else null
        this.powerShown = '';            // whether the layout was built for the power shown or not
        // the "danger zone" alert (danger.js): a file another app writes while a zone is ahead; the layout is rebuilt when it comes
        // or goes (widgets with toggle "danger"), the distance and limit are the tokens {{dangerDist}} {{dangerUnit}} {{dangerLimit}}
        // the theme's colour from the drive mode (accent.js): blue in Hybrid Eco Pro, green in Hybrid, red in Sport; read when the layout is built
        this.accentHue = 'blue'; this.accentLayout = false;
        this.danger = new Danger({}, this.log, () => this._guard('danger', () => this._dangerChanged()));
        // the speed limit (speedlimit.js): a file another app writes; the ring and its number read it every frame (no rebuild)
        this.speedLimit = new SpeedLimit({}, this.log);
        this.dangerLayout = false;       // the active layout has an alert widget (toggle "danger" / "dangerLimit" / "dangerNoLimit")
        this.dangerShown = '';           // which of the alert's states the layout was built for
        this.driveLayout = false;        // the active layout has a widget that follows the drive mode (toggle "driveSport")
        this.driveShown = false;         // the Sport state the layout was built for
        this.claimBy = null;             // the id of another kit app holding the HUD now (hud_claim), we step aside
        this.testAt = null;              // the shift-light test's start (Date.now()), while it runs
        this.nightOn = false;            // the layout was built with the night colours (nightDim)

        this._setupVehicleData();
        this.layouts.onChange(() => this._rebuild());
        ctx.settings.onChange((key) => this._guard('setting ' + key, () => {
            // a theme or layout picked anywhere (the page asks first, the kit's All settings list doesn't): no longer stepping aside
            if (['hudLayout', 'inHybrid', 'inSport', 'inEco', 'byMode'].indexOf(key) >= 0 && this.screen.yielded) this.screen.release();
            if (key === 'viewSel') this.viewNow = null;           // a choice made on the page wins over the button's last step
            if (PLACE_KEYS.indexOf(key) >= 0) this._guard('place', () => this._place());
            else if (LIVE_KEYS.indexOf(key) >= 0) this.widgets.forEach((x) => { x.last = null; });
            else if (key !== 'demo') this._rebuild(); else this._status();
        }));
    }

    /* ---------------- readout slots ---------------- */

    /** The sensor (sensors.js) slot `id` of `layout` shows: the pick, else the layout's default. */
    slotSensor(layout, id, slots) {
        const pick = (this.slotPicks[layout] || {})[id];
        if (pick && sensors.get(pick)) return sensors.get(pick);
        const def = (slots || []).find((x) => x.id === id);
        return def ? sensors.get(def.default) : null;
    }
    /** The slots of `layout` ([{ id, where, default }]), [] when it has none or can't be read. */
    slotsOf(layout) {
        if (layout === this.activeName) return this.layoutSlots;
        try { return this.layouts.load(layout).slots || []; } catch (e) { return []; }
    }
    /** Show `sensorId` in slot `id` of `layout` (null: back to its default); saved in <data>/slots.json, shown at once. */
    setSlot(layout, id, sensorId) {
        const m = this.slotPicks[layout] || (this.slotPicks[layout] = {});
        if (sensorId) m[id] = sensorId; else delete m[id];
        if (!Object.keys(m).length) delete this.slotPicks[layout];
        try { fs.writeFileSync(this.slotsFile, JSON.stringify(this.slotPicks, null, 1)); } catch (e) { this.log.warn('slots: cannot save ' + this.slotsFile + ' (' + e.message + ')'); }
        this.widgets.forEach((x) => { x.last = null; });       // the slot texts paint again on the next tick
        if (layout === this.activeName && this.shownW) this._setNeeds(this.shownW);
    }
    /** needsBoost / needsIntake from the widgets shown: their own text and the sensors their readout slots show
     *  (before Nov 8 2026 only the text counted, so a slot picked to intake never asked the engine unit). */
    _setNeeds(shown) {
        this.shownW = shown;
        const ids = [];
        shown.forEach((w) => [w].concat(Array.isArray(w.tiles) ? w.tiles : []).forEach((b) => {
            const sn = b && b.slot ? this.slotSensor(this.activeName, b.slot, this.layoutSlots) : null;
            if (sn) ids.push(sn.id);
        }));
        const j = JSON.stringify(shown) + ' ' + ids.join(' ');
        this.needsBoost = /boost/.test(j);
        this.needsIntake = /intake/.test(j);
        this.needsHv = /hvSoc|evRange|rangeTotal|evShare/.test(j);
        this.hasReady = /"readyBy"/.test(j);        // the launch cue is on this layout
        this.needsFuel = /fuel|rangeTotal/i.test(j);
    }
    /** A sensor's value now, as its slot shows it ('--' without one). */
    sensorValue(sn) { return sn ? this._token(sn.tok) : '--'; }
    sensorUnit(sn) {
        if (!sn) return '';
        const us = this.setting('units') === 'us';
        return sn.unit ? sn.unit(us) : this._token('ampm');
    }

    /* ---------------- the HUD's place ---------------- */

    /**
     * Move (hudX, hudY px) and scale (hudScale %) every layer of the layout, kept on the target: the move is cut
     * so the layout's box stays inside it. The scale is cluster-render's layer sx / sy about the layout's centre.
     */
    _place() {
        const off = this._offset(), sc = this._scale(), st = this._stripSy();
        if (!this.placed.length) return;
        const b = this._placedBox(), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        this.placed.forEach((l) => {
            if (l.fixed) { l.c.set(l.ref, { x: l.x, y: l.y }); return; }       // the black band: never moved, never squeezed
            const o = { x: l.x + off.x, y: l.y + off.y };
            if (st !== 1) {
                // "Leave BMW's bottom strip clear": the layer's own rectangle is made shorter (y and h times st), no scale: the KOMBI leaves its black
                // boxes while a layer's rectangle reaches its strip, and eroobeeroo's Cluster Layouts, which cuts its rectangles at the line, got none
                // on this car while ours (full-height rectangles squeezed with sy: the bottom of every rectangle was still at 720) kept them
                // (photos of Nov 15 2026). The shaders read v_uv * u_size and an image is resampled, so a shorter rectangle squeezes the picture the same way.
                if (l.scaled) { o.sx = 1; o.sy = 1; o.px = 0; o.py = 0; l.scaled = false; }
                o.y = Math.round((l.y + off.y) * st); o.h = Math.max(1, Math.round(l.h * st)); l.squeezed = true;
            } else if (sc !== 1 || l.scaled) { o.sx = sc; o.sy = sc; o.px = cx - l.x; o.py = cy - l.y; l.scaled = sc !== 1; }
            if (st === 1 && l.squeezed) { o.h = l.h; l.squeezed = false; }
            l.c.set(l.ref, o);
        });
    }
    _placedBox() {
        const ls = this.placed.filter((l) => !l.fixed);
        if (!ls.length) return { x: 0, y: 0, w: 0, h: 0 };
        const x0 = Math.min.apply(null, ls.map((l) => l.x)), y0 = Math.min.apply(null, ls.map((l) => l.y));
        const x1 = Math.max.apply(null, ls.map((l) => l.x + l.w)), y1 = Math.max.apply(null, ls.map((l) => l.y + l.h));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    /**
     * "Leave room for the driver camera" (cluster): a row of shift lights or rev segments that crosses the camera's spot
     * on newer cars (visible.CAMERA) becomes two mirrored wings either side of it, filling from the outer ends in
     * towards the camera. The empty middle as { s, e } px from the widget's left; null when off or not crossing it.
     */
    _wings(w) {
        const C = visible.CAMERA;
        if (!this._cameraOn() || !(w.y < C[3] && w.x < C[0] && w.x + w.w > C[2])) return null;
        return { s: C[0] - w.x, e: C[2] - w.x };
    }
    /** The same for an arc (Rally's revarc, symmetric about 12 o'clock): half the empty middle in radians, 0 = none. */
    _arcWing(w) {
        const C = visible.CAMERA;
        if (!this._cameraOn() || !w.center || w.y + w.center[1] - w.r >= C[3]) return 0;
        const cx = w.x + w.center[0], half = Math.max(cx - C[0], C[2] - cx), inner = w.r - (w.band || 40);
        return half < inner ? Math.asin(half / inner) : 0;
    }
    _cameraOn() { return this.target === 'panel' && !!this.ctx.settings.item('cameraNotch') && this.setting('cameraNotch') === true; }

    /** "Leave BMW's bottom strip clear" is on (the cluster panel only). */
    _stripOn() {
        return this.target === 'panel' && !this.gearWin && !!this.ctx.settings.item('stripClear') && this.setting('stripClear') === true;
    }
    /**
     * The hole over BMW's gear letter for this layout ({ id, x, y, w, h }, shared/gear_window.js) or null: the cluster panel only,
     * one of the four themes, setting "gearWindow" not "off". While it is on, no layer rectangle touches the hole (BMW draws its
     * black box only while a layer covers its gear letter).
     */
    _gearWindow(name) {
        if (this.target !== 'panel' || !this.ctx.settings.item('gearWindow')) return null;
        return gearWindow.pick(this.setting('gearWindow'), name);
    }
    /** u_slotOff of the backdrops: 1 while no black box is expected (bottom strip clear, or the gear letter's hole open): no pocket in the backdrop. */
    _slotOff() { return this._stripOn() || this.gearWin ? 1 : 0; }
    /** The cluster's squeeze for "Leave BMW's bottom strip clear": 646 / 720 while it's on, else 1 (applied to every layer's rectangle in _place). */
    _stripSy() { return this._stripOn() ? STRIP_TOP / TARGET_SIZES.panel[1] : 1; }
    _scale() {
        if (!this.ctx.settings.item('hudScale')) return 1;
        const v = this.setting('hudScale');
        return isNum(v) && v >= 50 && v <= 150 ? v / 100 : 1;
    }
    /** The move asked for, cut so the layout (at its scale) stays on the target. */
    _offset() {
        if (!this.ctx.settings.item('hudX')) return { x: 0, y: 0 };
        const want = { x: this.setting('hudX') || 0, y: this.setting('hudY') || 0 };
        if (!this.placed.length) return want;
        const b = this._placedBox(), sc = this._scale();
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, hw = b.w * sc / 2, hh = b.h * sc / 2;
        const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
        return {
            x: Math.round(clamp(want.x, hw - cx, this.size[0] - hw - cx)),
            y: Math.round(clamp(want.y, hh - cy, this.size[1] - hh - cy)),
        };
    }
    /** Where the HUD sits now, for the page: { x, y, scale, box } (box: the layout's own, unmoved). */
    placeInfo() { return { x: this._offset().x, y: this._offset().y, scale: this._scale(), box: this._placedBox() }; }

    /** A setting's value, or its default when the saved value isn't one the schema allows. */
    setting(key) {
        // "mapUp": not saved, the centre window is open now: the Waze map shows inside the theme (the setting on, waze.js
        // says so, and a route is on when the setting "mapOnlyWithRoute" asks for it), or Cluster Centre / Cluster Info asked for the window (centreWindow)
        if (key === 'mapUp') return !!(this._wazeMapOn() || this.windowOpen === true);
        // "viewSel": the view showing: the button's step when it has been pressed, else the saved choice ("none" = nothing extra)
        if (key === 'viewSel' && this.viewNow !== null) return this.viewNow;
        // "driveSport": not saved, the car's drive mode is Sport (the "drive" view shows the G-meter then, the settings of the modes otherwise)
        if (key === 'driveSport') return this.driveMode === 'sport';
        // "danger": not saved, a danger zone is ahead (danger.js) and the alert is turned on; "dangerLimit" / "dangerNoLimit": and its speed limit is / isn't known
        if (key === 'danger' || key === 'dangerLimit' || key === 'dangerNoLimit') {
            const d = this.target === 'panel' && this.ctx.settings.get('dangerAlert') === true ? this.danger.state() : null;
            return !!d && d.on && (key === 'danger' || (d.limit !== null) === (key === 'dangerLimit'));
        }
        // "power": not saved, an app shares the battery's power (cluster_info.js) and the setting "sportPower" lets it replace the boost;
        // "boostShown": the boost shows (the setting "showBoost", and no power flow in its place)
        // "powerShut" / "powerOpen": the power flow shows and the Waze map window is closed / open (for layouts that draw it twice)
        if (key === 'power' || key === 'powerShut' || key === 'powerOpen' || key === 'boostShown') {
            const flow = this.target === 'panel' && this.ctx.settings.item('sportPower') && this.ctx.settings.get('sportPower') !== false && this._powerHeld();
            if (key === 'boostShown') return !flow && this.ctx.settings.get('showBoost') !== false;
            return key === 'power' ? !!flow : !!flow && (key === 'powerOpen') === (this.setting('mapUp') === true);
        }
        const s = this.ctx.settings.item(key);
        const v = this.ctx.settings.get(key);
        if (!s) return v;
        const ok = s.type === 'bool' ? typeof v === 'boolean'
            : s.type === 'choice' ? (s.options || []).some((o) => o[0] === v)
                : s.type === 'number' ? isNum(v) && (!s.steps || s.steps.indexOf(v) >= 0) : true;
        return ok ? v : s.default;
    }

    _setupVehicleData() {
        const extra = {
            // fuel and range (the kit's live_data, MIT): litres (255 = none) and km (4095 = none)
            'de.bmw.infotainment.KombiIF': {
                statusRangeTankStatus: (v) => {
                    const f = v && v.fluidLevelFuelTank, r = v && v.range;
                    this.fuelL = isNum(f) && f >= 0 && f < 255 ? f : null;
                    this.rangeKm = isNum(r) && r >= 0 && r < 4095 ? r : null;
                },
                // a plug-in hybrid's own electric range, as the cluster shows it (Cluster Centre reads the same signal,
                // on a G05 PHEV): in the unit the cluster is set to, so miles when the "units" setting is US. 0xFFFE and up: none.
                // Not on every car: without it the electric range is the charge times what a full battery gives (evRangeFull).
                displayRangeElectricVehicle: (v) => {
                    const n = typeof v === 'number' ? v : v && typeof v === 'object' ? v.displayRangeElectricVehicle : null;
                    // 0xFFFE and up, and 4093 (the owner's car sent it at the same time as a range of 1: the 12-bit "none" next to the fuel
                    // range's 4095): no range, a plug-in hybrid never goes that far
                    if (!isNum(n) || n < 0 || n >= EV_RANGE_NONE) return;
                    if (!isNum(this.carErange)) this.log.info('electric range from the car: ' + n + (this.setting('units') === 'us' ? ' mi' : ' km'));
                    this.carErange = n * (this.setting('units') === 'us' ? 1.609344 : 1); this.carErangeAt = Date.now();
                },
            },
            // tyre pressure and temperature per corner, in the car's own display units (_tyreBar / _tyreC).
            // The car never notifies these (BMW's own x_call only ever reads them), so they are polled.
            'de.bmw.infotainment.vehicle.TPMS': {
                $pollMs: 10000,
                statusTyrePressure: (v) => TYRE_CORNERS.forEach((k) => { this.tyres.p[k] = this._tyreBar(v && v['actualValuePressureTyre' + k + 'H']); }),
                statusTyreTemperature: (v) => TYRE_CORNERS.forEach((k) => { this.tyres.t[k] = this._tyreC(v && v['actualValueTemperatureTyre' + k + 'H']); }),
            },
            // the car's display units: the TPMS reports pressure as 0.1 x raw in the car's pressure unit and temperature
            // as the car's degrees + 40 (car_vitals, MIT; a car set to psi / F showed 32 psi as 464 psi until this was read)
            'de.bmw.infotainment.vehicle.Vehicle': {
                statusNewCurrentUnitsStatusExt: (v) => {
                    const press = unitName(PRESS_UNITS, v && v.unitOfMeasurementAirPressure), temp = unitName(TEMP_UNITS, v && v.unitOfMeasurementTemperature);
                    if (press === this.carUnits.press && temp === this.carUnits.temp) return;
                    this.carUnits.press = press; this.carUnits.temp = temp;
                    this.log.info('car units: pressure ' + (press || '?') + ', temperature ' + (temp || '?'));
                },
            },
            // S / M next to the gear: the gearbox status carries no programme on some cars, the M drive display does
            'de.bmw.infotainment.misc.MDrive': {
                dataDisplayGearbox: (v) => {
                    const raw = v && v.displayProgramGearbox;
                    this.program = PROGRAMS[raw] || null;
                    // for the shift grades (as Redline): D / S (the gearbox shifts: AUTO) or M, null while the car hasn't said
                    this.gradeMode = PROGRAMS[raw] || (raw === 0 || /^D/i.test(String(raw)) ? 'D' : null);
                },
            },
            // outside temperature: raw * 0.5 - 40 deg C, 255 = none (car_vitals, MIT)
            'de.bmw.infrastructure.EnvironmentalInformation': {
                ExteriorTemperature: (v) => {
                    const t = v && v.temperatureExterior;
                    this.ambient = isNum(t) && t !== 255 ? t * 0.5 - 40 : null;
                },
            },
            'de.bmw.infotainment.drivingexcitement.FES': {
                statusSwitchDriveDynamicSport2: (v) => {
                    const raw = v && v.displayBoostPressure;
                    if (typeof raw !== 'number' || raw === BOOST_SCALE.invalid) return;
                    this.boostFes = raw * BOOST_SCALE.factor + BOOST_SCALE.offset;
                    this.boostFesAt = Date.now();
                },
                // the HMI's sport display: power and torque in % of the car's maximum (car_vitals, MIT); 255 = none
                statusVehicleDynamicEngine: (v) => {
                    const p = v && v.displaySportEnginePower, t = v && v.displaySportEngineTorque;
                    this.sportPower = isNum(p) && p >= 0 && p <= 150 ? p : null;
                    this.sportTorque = isNum(t) && t >= 0 && t <= 150 ? t : null;
                    this.sportAt = Date.now();
                },
                statusFESVehicleDynamicSwitchHMI: (v) => {
                    const raw = v && v.actualValueModeDrivingExperience;
                    const m = driveModeOf(raw), variant = m ? driveVariantOf(raw) : null, name = m ? driveNameOf(raw) : null;
                    if (!m) {
                        // a value we don't know (M cars: Efficient / Sport / Sport+, issue #8): logged and shown on the
                        // Settings tab's status line, so a driver can tell us what the car sends
                        const t = String(JSON.stringify(raw)).slice(0, 60);
                        if (t !== this.driveRaw) { this.driveRaw = t; this.log.info('drive mode not recognised: ' + t); this._status(); }
                        return;
                    }
                    this.driveRaw = null;
                    if (m === this.driveMode && variant === this.driveVariant && name === this.driveName) return;
                    this.log.info('drive mode ' + (name || MODE_NAME[m]) + ' (' + raw + ')');
                    this.driveMode = m; this.driveVariant = variant; this.driveName = name;
                    if (this._layoutName() !== this.activeName || this._accentHue() !== this.accentHue
                        || (this.driveLayout && (this.driveMode === 'sport') !== this.driveShown)) this._rebuild(); else this._status();
                },
            },
        };
        // the signals the car's catalog lists that this app only reads for now (probes.js: their last values go to the page's Signals tab and the log),
        // and the car's own reading of the road signs (its camera), which also feeds the speed limit ring: only an app that declares them (ShakTheme) asks for them
        this.probes = new Probes(this.log);
        const decl = (this.ctx.spec && this.ctx.spec.signals) || {};
        // the car's own sport display (power and torque in %) only feeds the {{powerPct}} and {{torquePct}} readouts (no shipped theme shows them; they
        // fall back to the crank torque): an app that does not declare it does not ask the car for it
        const FES = 'de.bmw.infotainment.drivingexcitement.FES';
        if (!(decl[FES] && decl[FES].statusVehicleDynamicEngine)) delete extra[FES].statusVehicleDynamicEngine;
        PROBES.concat([GUIDE]).forEach((p) => {
            if (!decl[p.iface] || !decl[p.iface][p.field]) return;
            const group = (extra[p.iface] = extra[p.iface] || {}), prev = group[p.field];
            // the cluster's power meter is not told again while it holds one value: read it every 2 s (eroobeeroo's apps do the same)
            if (p.id === 'rel') group.$pollMs = REL_POLL_MS;
            // the second source of the rev counter is told about every 2.5 s on the owner's car (0.4 msg/s): read it as often as the first one
            if (p.id === 'rpm2') group.$pollMs = RPM_POLL_MS;
            group[p.field] = (v) => {
                if (prev) prev(v);
                this.probes.feed(p.id, v);
                if (p.id === 'sign' || p.id === 'next') this._carSign(p.id, v);
                if (p.id === 'guide') this._guard('guidance', () => this._guidance(v));
                if (p.id === 'next') this._guard('nextLimit', () => this._carNext(v));
                if (p.id === 'cc') this._guard('carAlert', () => this._carAlertSet(v));
                if (p.id === 'wheel') this._guard('lane', () => this._laneSet(v));
                if (p.id === 'pdrive' || p.id === 'pdrive2') this._guard('carPower', () => this._carPowerSet(v));
                if (p.id === 'rel') this._guard('relPower', () => this._relSet(v));
                if (p.id === 'rpm2') this._guard('rpm2', () => { const n = rpmAltOf(v); if (n !== null && this.car && this.car.feedRpmAlt) this.car.feedRpmAlt(n); });
            };
        });
        // the rev counter is told when it changes, which on a car that notifies it rarely (or only the first value) leaves the bar where it was: read it
        // as well, RPM_POLL_MS apart (the kit re-reads the interface's fields that often; the same values twice change nothing). The Signals tab's
        // "msg · x/s" beside the rev counter shows how often the car really sends it.
        if (decl[CDS_IFACE] && decl[CDS_IFACE].statusEngineSpeed2) (extra[CDS_IFACE] = extra[CDS_IFACE] || {}).$pollMs = RPM_POLL_MS;
        this.car = new Car(this.ctx, ['rpm', 'speed', 'temps', 'accel', 'gear', 'torque'], extra);
        this.car.setRedline(this.setting('redline'));
        this.gBuf = [];                  // [t, lat, long] of the last G_AVG_MS
        this.gSm = null;                 // { lat, long, at }: their average
        this.car.onSample((d, t) => this._gSample(d, t), () => { this.gBuf = []; this.gSm = null; this.resetG(); });
        this.resetG();
        this.score = new ShiftScore(this.car, () => ({
            redline: this.setting('redline'), shiftBefore: this.setting('shiftBefore'), coldGuard: this.setting('coldGuard'),
            mode: this.car.data().demo ? null : this.gradeMode || null,
        }), this.log);
    }

    /**
     * Connection i to cluster-render, made on first use: 0 is the app's own (named after the app); a widget's
     * "conn" asks for 1..3, named <app id>_2 .. _4, each with its own 8 layers. Layers made before a connection
     * is up are replayed by the client when it connects.
     */
    _clientAt(i) {
        while (this.clients.length <= i) {
            const ci = this.clients.length;
            const c = new ClusterRender(ci ? this.ctx.spec.id + '_' + (ci + 1) : this.ctx.spec.id, this.socketPath);
            this.clients.push(c);
            this._wireClientEvents(c, ci);
            if (this.started) { this.log.info('connection ' + (ci + 1) + ' to cluster-render'); c.connect(); }
        }
        return this.clients[i];
    }

    _wireClientEvents(c, ci) {
        const tag = ci ? ' [connection ' + (ci + 1) + ']' : '';
        // every handler runs from the socket's 'data' event: guarded, an error there would be an uncaught one (the kit exits on those)
        const on = (name, fn) => c.on(name, (...a) => this._guard('cluster-render ' + name, () => fn(...a)));
        on('ready', () => { this.log.info('cluster-render ready' + tag + ' (backend=' + c.backend + ')'); if (ci === 0) this._rebuild(true); else this._status(); });
        on('disconnected', () => { this.log.warn('cluster-render disconnected' + tag + ', client will retry'); this._status(); });
        on('layer', (ref, state, reason) => {
            const key = ci + ':' + ref;
            const old = this.layerStates.get(key);
            const same = old && old.state === state;
            const st = { state, reason, since: same ? old.since : Date.now(), long: same ? old.long : false };
            this.layerStates.set(key, st);
            const name = () => { const w = this._widgetOf(ci, ref); return 'layer ' + ref + tag + (w ? ' (' + w + ')' : ''); };
            if (state === 'error' || (state === 'waiting' && !same)) this.log.warn(name() + ' ' + state + (reason ? ': ' + reason : ''));
            if (state === 'stalled' && !same) {
                // normal for a moment after a rebuild (pixels on their way); a problem only if it lasts
                clearTimeout(this.stallTimers.get(key));
                this.stallTimers.set(key, setTimeout(() => this._guard('stall check', () => {
                    this.stallTimers.delete(key);
                    const now = this.layerStates.get(key);
                    if (now !== st) return;
                    st.long = true;
                    this.log.warn(name() + ' still stalled after ' + STALL_WARN_MS / 1000 + ' s: no pixels reached cluster-render' + (reason ? ' (' + reason + ')' : ''));
                }), STALL_WARN_MS));
            } else if (state !== 'stalled') {
                clearTimeout(this.stallTimers.get(key)); this.stallTimers.delete(key);
                if (old && old.state === 'stalled' && old.long) this.log.info(name() + ' ' + state + ' after ' + ((Date.now() - old.since) / 1000).toFixed(1) + ' s stalled');
            }
            this._statusSoon();
        });
        on('target', (name, state, holder, reason) => {
            if (name !== this.target) return;
            this.targetState = { state, holder, reason };
            this.log.info('target ' + name + tag + ' ' + state + (holder ? ' (holder ' + holder + ')' : '') + (reason ? ': ' + reason : ''));
            this._statusSoon();
        });
        on('refused', (op, ref, reason) => {
            const w = this._widgetOf(ci, ref);
            this.log.warn('refused ' + op + ' on ' + ref + tag + (w ? ' (' + w + ')' : '') + ': ' + reason);
            if (!this.refused) this.refused = (w || op) + ': ' + reason;   // the first one, until the next rebuild
            if (op === 'layer' || op === 'asset') this._retryRefused();
            this._statusSoon();
        });
        on('budget', (capKb, maxKb, reason) => this.log.info('budget' + tag + ' ' + capKb + '/' + maxKb + ' kb/s (' + reason + ')'));
        on('status', (text) => {
            this.log.info('cluster-render status: ' + text);
            const ids = sceneIdsOf(text);
            if (!ids) return;
            const apart = ids.panel !== ids.hud;
            if (apart === this.scenesApart) return;
            this.scenesApart = apart;
            this.log.info(apart ? 'cluster and HUD on their own scenes (panel ' + ids.panel + ', hud ' + ids.hud + '): both apps can show at once'
                : 'cluster and HUD share scene ' + ids.panel + ': one app at a time');
            this.screen.beat();
        });
    }

    start() {
        this.log.info('connecting to cluster-render at ' + this.socketPath);
        this.started = true;
        this.clients.forEach((c) => c.connect());
        this.tickTimer = setInterval(() => this._guard('tick', () => this._tick()), TICK_MS);
        // Auto theme: check for sunrise / sunset once a minute; the status line too
        this.themeTimer = setInterval(() => this._guard('theme check', () => {
            if (this._themeName() !== this.themeName || this._nightDim() !== this.nightOn) this._rebuild();
            this._status();
            if (this.client.ready) this.client.status();      // the scene ids (scenesApart) can change: guard, update
        }), 60000);
        this.statusTimer = setInterval(() => this._guard('status', () => this._status()), 5000);
        if (this.target === 'hud') this.claimTimer = setInterval(() => this._guard('hud claim', () => this._hudClaim()), CLAIM_MS);
        this._status();
        this._startDme();
        if (this.waze) { this.waze.start(); this._wazeWant(); }
        this.screen.start();
        this.ci.start();
        if (this.target === 'panel') { this.danger.start(); this.speedLimit.start(); }
        this.ciTimer = setInterval(() => this._guard('cluster info', () => this._shareWithClusterInfo()), 500);
    }

    /**
     * cluster-render refused a layer (its 32 layers or its pixel memory, shared by every app, were full at that moment: another app starting or
     * letting go at the same time): what the layer carries is missing from the screen until the next rebuild, which may not come for the whole
     * drive. So the layout is made again a little later, REFUSED_RETRY_MS.length times at most, each wait longer; a layout that is refused
     * every time (too big by itself) is then left as it is, and the count starts again once a layout has gone through whole.
     */
    _retryRefused() {
        const k = this.refusedTries || 0;
        if (this.refusedT || k >= REFUSED_RETRY_MS.length) return;
        this.refusedT = setTimeout(() => {
            this.refusedT = null;
            if (!this.refused) return;                       // made again meanwhile, and taken whole
            this.refusedTries = k + 1;
            this.log.info('a layer was refused (' + this.refused + '): making the layout again, try ' + (k + 1) + ' of ' + REFUSED_RETRY_MS.length);
            this._guard('refused retry', () => this._rebuild());
        }, REFUSED_RETRY_MS[k]);
        if (this.refusedT.unref) this.refusedT.unref();
    }

    /** The energy flow replaces the boost or not (see setting("power")), as a string to see when the layout has to be rebuilt. */
    _powerKey() { return this.setting('power') ? '1' : '0'; }

    /**
     * An app shares the battery's power now, or did within the last POWER_HOLD_MS. The layout is rebuilt when the power comes or goes, and a
     * rebuild takes the texts off the cluster for a quarter of a second on the car (owner's video of Nov 19 2026: eDrive Live's power went and
     * came back while driving off, the whole cluster blinked each time). Held, a gap in the sharing only shows "--" where the kW are.
     */
    _powerHeld() {
        const now = Date.now();
        if (this.ci.sharedPower() !== null) { this.powerSeenAt = now; return true; }
        return isNum(this.powerSeenAt) && now >= this.powerSeenAt && now - this.powerSeenAt < POWER_HOLD_MS;
    }

    /** Another app began or stopped sharing the battery's power: rebuild a layout that shows it in place of the boost. */
    _powerChanged() {
        if (this.powerLayout && this._powerKey() !== this.powerShown) this._rebuild(); else this._status();
    }

    /** Which states of the danger alert the layout shows: "on / limit known" as one string, to see when it has to be rebuilt. */
    _dangerKey() { return ['danger', 'dangerLimit'].map((k) => (this.setting(k) ? 1 : 0)).join(''); }

    /** The alert came or went, or its limit became known or unknown (danger.js): rebuild a layout that draws it. */
    _dangerChanged() {
        if (this.dangerLayout && this._dangerKey() !== this.dangerShown) this._rebuild(); else this._status();
    }

    /** Waze's map on the panel only while the setting is on and the theme shown has a map window. */
    _wazeWant() {
        if (this.waze) this.waze.want(this.started && this.setting('mapInTheme') === true && this.mapLayout);
    }

    /**
     * Whether the map may show in the theme as far as the route goes: always, unless the setting "mapOnlyWithRoute" is on and the car says
     * no route is guided (CarPlayManager.projectedGuidanceActive). Not read yet or not understood (routeActive null): as before, the map shows.
     * With no route the map stays on the panel (no moving it back and forth), behind the theme, which is closed then.
     */
    _routeOk() {
        const it = this.ctx.settings.item('mapOnlyWithRoute');
        return !(it && this.ctx.settings.get('mapOnlyWithRoute') !== false && this.routeActive === false);
    }

    /** The Waze map shows in the theme's window now (it is up on the panel, the setting is on, and a route is on if that is asked). */
    _wazeMapOn() {
        return !!this.waze && this.waze.up === true && this.ctx.settings.get('mapInTheme') === true && this._routeOk();
    }

    /** The next speed limit the camera recognised (FASuS.statusNextSpeedLimitRecognition): kept for NEXT_TTL_MS (the car tells it once). */
    _carNext(v) {
        const k = extras.nextLimitOf(v);
        if (k === null) { this.nextLim = null; return; }
        if (!this.nextLim || this.nextLim.kmh !== k) this.log.info('next limit ' + k + ' km/h');
        this.nextLim = { kmh: k, at: Date.now() };
    }

    /** The next limit to show under the ring: { text } while it is fresh and not the present limit; null otherwise (the setting "nextLimit"). */
    _nextLimitNow(now) {
        if (this.target !== 'panel' || this.setting('limitRing') === false || this.setting('nextLimit') === false) return null;
        const n = this.nextLim;
        if (!n || now - n.at > extras.NEXT_TTL_MS) return null;
        const cur = this.speedLimit.limit();
        if (isNum(cur) && Math.round(cur) === n.kmh) return null;
        return { text: formatLimit(n.kmh, this.setting('units') === 'us') };
    }

    /** A check control message of the car is showing (KombiIF.statusActiveCCMessage); the icon asks for it with the setting "carAlert". */
    _carAlertSet(v) {
        const on = extras.alertOf(v);
        if (on === null) return;
        if (on !== this.carAlert) this.log.info('car alert ' + (on ? 'showing' : 'gone'));
        this.carAlert = on;
    }

    _alertNow() {
        return this.target === 'panel' && this.ctx.settings.item('carAlert') && this.ctx.settings.get('carAlert') === true && this.carAlert === true;
    }

    /** The lane assist's steering wheel symbol (DisplayDriverAssistanceLateralCoordinated.displaySteeringWheel): its last reading, { on, tone, warn }. */
    _laneSet(v) {
        const l = extras.laneOf(v);
        if (l.on === null && !l.warn) return;
        const was = this.lane;
        if (!was || was.on !== l.on || was.tone !== l.tone || was.warn !== l.warn) this.log.info('lane assist ' + JSON.stringify(l));
        this.lane = l;
    }

    /** The lane icon's colour role while it shows (the setting "carLane", on the cluster), or null: red only for a lane departure warning, else the car's own colour. */
    _laneNow() {
        const l = this.lane;
        if (this.target !== 'panel' || !this.ctx.settings.item('carLane') || this.ctx.settings.get('carLane') !== true || !l || (l.on !== true && !l.warn)) return null;
        return l.warn ? 'hot' : l.tone === 'green' ? VERDICT['SPOT ON'] : l.tone === 'yellow' ? VERDICT.EARLY : l.tone === 'red' ? 'hot' : 'dim';
    }

    /** The electric motor's share of its power (Efficiencytainment2.displayPowerDrive[2]), -100..100. */
    _carPowerSet(v) {
        const q = extras.powerQuotaOf(v);
        if (q === null) return;
        if (!this.carQuota || this.carQuota.q !== q) this.carQuotaLogs = (this.carQuotaLogs || 0) + 1;
        if (this.carQuotaLogs <= 20 && (!this.carQuota || this.carQuota.q !== q)) this.log.info('motor power share ' + q + ' %');
        this.carQuota = { q, at: Date.now() };
    }

    /**
     * A new value of Efficiencytainment2.statusPowerRelativHybrid, the stock cluster's own power meter: the drive's and the recuperation's share, in
     * %. Kept as { drive, recup, over, at }; relAlive turns on at the first reading above 0 (a meter that only ever reads 0 is not trusted: the
     * estimate draws then). A number over 100 (a scale the app does not know) is kept as `over` and never drawn.
     */
    _relSet(v) {
        const r = extras.relPowerOf(v);
        if (r === null) return;
        const was = this.relPow;
        if (!was || was.drive !== r.drive || was.recup !== r.recup || was.over !== r.over) this.relLogs = (this.relLogs || 0) + 1;
        if (this.relLogs <= 20 && (!was || was.drive !== r.drive || was.recup !== r.recup || was.over !== r.over)) this.log.info('cluster power meter: drive ' + r.drive + ' % recuperation ' + r.recup + ' %' + (r.over ? ' (over 100: scale unknown)' : ''));
        this.relPow = { drive: r.drive, recup: r.recup, over: r.over, at: Date.now() };
        if (!r.over && (r.drive > 0 || r.recup > 0)) this.relAlive = true;
    }

    /**
     * The motor's power as { kw, old } from the stock cluster's power meter (drive % of EV_MAX_KW, recuperation % of REL_RECUP_KW), only while the
     * setting "relPower" is on (the default), the meter has read above 0 once, its scale is 0..100 and its last reading is fresh; else null.
     */
    _relPower() {
        if (!this.ctx.settings.item('relPower') || this.ctx.settings.get('relPower') === false) return null;
        const r = this.relPow;
        return r && !r.over && this.relAlive && Date.now() - r.at < extras.REL_TTL_MS ? { kw: extras.relKw(r), old: false } : null;
    }

    /** The motor's power as { kw, old } from the car's own share, only while the setting "carPower" is on and the share is fresh; else null. */
    _carPower() {
        if (!this.ctx.settings.item('carPower') || this.ctx.settings.get('carPower') !== true) return null;
        const c = this.carQuota;
        return c && Date.now() - c.at < extras.POWER_TTL_MS ? { kw: extras.powerKw(c.q), old: false } : null;
    }

    /**
     * The speed and the acceleration for the estimated electric power, each eased (EST.speedMs, EST.accelMs): the car sends the speed a few
     * times a second, and the acceleration is its slope. Called every tick; no speed (or an absurd one) forgets them.
     */
    _estStep(now) {
        const raw = this.car.data().speed, dt = this.estT ? Math.min(500, now - this.estT) : 0;
        this.estT = now;
        if (!isNum(raw) || raw < 0 || raw > 400) { this.estV = null; this.estA = 0; return; }
        const v = raw / 3.6;
        if (!isNum(this.estV) || dt <= 0) { this.estV = v; this.estA = 0; return; }
        const vf = this.estV + (v - this.estV) * (1 - Math.exp(-dt / EST.speedMs));
        const a = (vf - this.estV) / (dt / 1000);
        this.estA = (isNum(this.estA) ? this.estA : 0) + (a - (isNum(this.estA) ? this.estA : 0)) * (1 - Math.exp(-dt / EST.accelMs));
        this.estV = vf;
    }

    /**
     * The motor's power as { kw, old } estimated from the speed and its slope (the wheels' power: mass x acceleration + air + rolling, times the
     * speed; over the drive efficiency while driving, under the recuperation efficiency while slowing), only while the setting "estPower" is on
     * (the default) and the car sends a speed; else null. An ESTIMATE: no slope of the road, no heating or accessories, the engine's help ignored.
     * Under 2 kW of recovery is coasting, not charging.
     */
    _estPower() {
        if (!this.ctx.settings.item('estPower') || this.ctx.settings.get('estPower') === false) return null;
        const v = this.estV;
        if (!isNum(v)) return null;
        if (v < 0.5) return { kw: 0, old: false };
        const a = isNum(this.estA) ? this.estA : 0;
        const pw = (EST.massKg * a + EST.drag * v * v + EST.roll * EST.massKg * 9.81) * v / 1000;
        let kw = pw >= 0 ? pw / EST.etaDrive : pw * EST.etaRegen;
        kw = Math.max(-EST.maxRegenKw, Math.min(EST.maxKw, kw));
        if (kw < 0 && kw > -EST.minRegenKw) kw = 0;
        return { kw, old: false };
    }

    /** The views the active layout has, in the order the button steps through them (without "none"). */
    views() { return this.layoutViews.slice(); }

    /**
     * The button behind the steering wheel was pressed: the next view of this theme, and after the last one none again (the theme as it is
     * without a view). Returns the name now showing ("none" included). A theme without views does nothing.
     */
    nextView() {
        if (!this.layoutViews.length) return 'none';
        const list = ['none'].concat(this.layoutViews), now = this.setting('viewSel');
        const next = list[(Math.max(0, list.indexOf(now)) + 1) % list.length];
        this.viewNow = next;
        this._rebuild();
        return next;
    }

    /** A new value of CarPlayManager.projectedGuidanceActive: a route started or ended, the theme opens or closes its map window. */
    _guidance(v) {
        if (v === null || v === undefined) return;
        const on = guidanceOf(v);
        if (on !== this.routeActive) {
            this.log.info('CarPlay guidance ' + (on === null ? 'not understood' : on ? 'active: a route is on' : 'inactive: no route'));
            this.routeActive = on;
            if (this.mapLayout && this.setting('mapUp') !== this.mapShown) this._rebuild(); else this._status();
        }
    }

    /**
     * Twice a second: hand the charge this app read itself to Cluster Info / Cluster Centre (never one it took from
     * another app), and say on the panel when a theme covers it (Cluster Centre waits then).
     */
    _shareWithClusterInfo() {
        const now = Date.now();
        const ownFresh = isNum(this.hvSoc) && now - this.hvSocAt < HV_STALE_MS;
        this.ci.publish(ownFresh && !this.car.data().demo ? this.hvSoc : null);
        this.ci.wantPower(this.target === 'panel' && this.started && this.powerLayout && !!this.ctx.settings.item('sportPower') && this.ctx.settings.get('sportPower') !== false);
        if (this.powerLayout && this._powerKey() !== this.powerShown) this._rebuild();      // the hold of _powerHeld ran out: the boost takes its place back
        const shows = this.target === 'panel' && this.started && !!this.activeName && this.activeName !== 'off' && !this.screen.yielded;
        // the centre window: open while Cluster Centre / Cluster Info ask for it (and for a few seconds after), if this
        // theme has one and the setting allows; the layout is rebuilt with the window cut or filled
        const allowed = shows && !!this.windowRect && this.setting('centreWindow') !== false;
        if (allowed && this.ci.wantsWindow()) this.windowAskAt = now;
        const open = allowed && now >= this.windowAskAt && now - this.windowAskAt < WINDOW_HOLD_MS;
        if (open !== this.windowOpen) {
            this.windowOpen = open;
            this.log.info('centre window ' + (open ? 'open: Cluster Centre / Cluster Info draw in it' : 'closed'));
            if (this.mapLayout && this.setting('mapUp') !== this.mapShown) this._rebuild(); else this._status();
        }
        this.ci.markTheme(shows, { window: shows ? this.windowRect : null, open: this.setting('mapUp') === true && this.mapShown === true,
            map: this._wazeMapOn() });
        // a layout with "mapPlace": while its map shows, Waze on cluster draws the map right in the window (the file is kept fresh)
        const place = shows && this.mapPlace && !!this.windowRect && this.mapShown === true && this.setting('mapUp') === true
            && this._wazeMapOn();
        this.mapWin.set(place ? this.windowRect : null);
        // on the HUD: where the layout shown leaves room for Cluster Info's panel (it would sit on the readouts otherwise)
        if (this.target === 'hud') this.ci.markLayout(this.started && !!this.activeName && this.activeName !== 'off' && !this.claimBy, this._panelRoom());
    }

    /**
     * The room the HUD layout shown leaves for Cluster Info's panel, on the HUD's own pixels (the layout's move and
     * scale applied): the biggest empty rectangle in what the windshield shows, round the readouts that are on and BMW's
     * own speed. null when there is none.
     */
    _panelRoom() {
        if (!this.shown || !this.placed.length) return null;
        const off = this._offset(), sc = this._scale(), b = this._placedBox(), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const used = this.shown.filter((w) => isNum(w.x) && isNum(w.y) && isNum(w.w) && isNum(w.h)).map((w) => ({
            x: cx + (w.x - cx) * sc + off.x, y: cy + (w.y - cy) * sc + off.y, w: w.w * sc, h: w.h * sc,
        }));
        const B = visible.HUD_BMW;           // BMW's own speed (and the Sport rev band), bottom left
        used.push({ x: B[0], y: B[1], w: B[2] - B[0], h: B[3] - B[1] });
        return freeRect(used, visible.HUD_WINDOW);
    }

    /** The map window of a layout on the panel, as the see-through hole leaves it: { x, y, w, h }, or null without one. */
    _windowRectOf(layout) {
        const w = layout.widgets.find((x) => x.holeWhen === 'mapUp' && Array.isArray(x.hole) && x.hole.length === 4 && x.hole.every(isNum));
        if (!w) return null;
        const inset = isNum(w.holeInset) ? w.holeInset : 6;
        return { x: w.hole[0] + inset, y: w.hole[1] + inset, w: Math.max(0, w.hole[2] - 2 * inset), h: Math.max(0, w.hole[3] - 2 * inset) };
    }

    /** Boost, intake, fuel % and hybrid battery from the car's units (config.dme), over the read-only link. */
    _startDme() {
        const dme = this.config.dme;
        const hasBoost = !!(dme && Array.isArray(dme.boost) && dme.boost.length);
        const hasIntake = !!(dme && Array.isArray(dme.intake) && dme.intake.length);
        let rd = null, busy = false, baro = 101.3, baroAt = 0, intakeAsk = 0, hvAsk = 0, hvMiss = 0, fuelAsk = 0, fuelMiss = 0;
        try {
            // the kit's read-only link: anything but a read (22 / OBD 01) is refused before it leaves the head unit.
            // silentAfter Infinity: never skip a unit that stopped answering; the retry timers below pace that.
            const { ReadOnlyDiag } = require('./kit/readonly-diag');
            const { DidReader } = require('./kit/dids');
            const link = new ReadOnlyDiag(this.ctx.signals, this.log, { silentAfter: Infinity });
            Promise.resolve().then(() => link.init()).catch((e) => this.log.info('engine unit link not available: ' + (e && e.message || e)));
            rd = new DidReader(link, { ecu: (dme && dme.ecu) || 18 });
        } catch (e) { this.log.info('engine unit boost off: ' + (e && e.message || e)); return; }
        this.dmeTimer = setInterval(() => this._guard('engine unit boost', () => {
            const now = Date.now();
            const wantBoost = hasBoost && this.needsBoost && now - this.boostFesAt >= FRESH_MS;
            const wantIntake = hasIntake && this.needsIntake && now - intakeAsk >= 2000;   // a temperature: every 2 s is plenty
            // the charge is wanted by a shown widget or by Cluster Info / Cluster Centre; another app that shares it
            // (eDrive Live, or the other app here) is believed instead of asking the battery unit a second time
            const wantHv = (this.needsHv || this.ci.wantsBattery()) && !isNum(this.ci.sharedSoc()) && now - hvAsk >= (hvMiss >= 3 ? HV_RETRY_MS : HV_EVERY_MS);
            const wantFuel = this.needsFuel && now - fuelAsk >= (fuelMiss >= 3 ? FUEL_RETRY_MS : FUEL_EVERY_MS);
            if (busy || this.car.data().demo || (!wantBoost && !wantIntake && !wantHv && !wantFuel)) return;
            busy = true;
            (async () => {
                if (wantFuel) {
                    fuelAsk = now;
                    const v = await rd.read(FUEL_OBD);
                    if (isNum(v)) {
                        if (fuelMiss >= 3 || !isNum(this.fuelObd)) this.log.info('fuel level: ' + v.toFixed(0) + ' % from the engine unit (OBD 2F)');
                        this.fuelObd = v; this.fuelObdAt = Date.now(); fuelMiss = 0;
                    } else if (++fuelMiss === 3) {
                        this.log.info('fuel level: the engine unit gives no OBD 2F (' + ((rd.raws[rd.key(FUEL_OBD)] || {}).why || '?') + '); litres / tank size, asked again every 5 min');
                    }
                }
                if (wantHv) {
                    hvAsk = now;
                    const v = await rd.read(HV_SOC);
                    if (isNum(v)) {
                        if (hvMiss >= 3 || !isNum(this.hvSoc)) this.log.info('hybrid battery: ' + v.toFixed(1) + ' % from the battery unit (SME 0x07, DDBC)');
                        this.hvSoc = v; this.hvSocAt = Date.now(); hvMiss = 0;
                    } else if (++hvMiss === 3) {
                        this.log.info('hybrid battery: no answer from the battery unit (' + ((rd.raws[rd.key(HV_SOC)] || {}).why || '?') + '); asked once a minute');
                    }
                }
                if (wantIntake) {
                    intakeAsk = now;
                    const t = await rd.value('intake', dme.intake);
                    if (isNum(t)) { this.intakeDme = t; this.intakeDmeAt = Date.now(); }
                }
                if (!wantBoost) return;
                if (now - baroAt > 60000 && Array.isArray(dme.baro)) {
                    baroAt = now;
                    const b = await rd.value('baro', dme.baro);
                    if (isNum(b)) baro = b;
                }
                const m = await rd.value('boost', dme.boost);
                if (isNum(m)) { this.boostDme = (m - baro) / 100; this.boostDmeAt = Date.now(); }
            })().catch((e) => this.log.info('engine unit boost: ' + (e && e.message || e))).then(() => { busy = false; });
        }), 400);
    }

    stop() {
        clearInterval(this.tickTimer);
        clearInterval(this.themeTimer);
        clearInterval(this.statusTimer);
        clearInterval(this.dmeTimer);
        clearInterval(this.ciTimer);
        this.danger.stop();
        this.speedLimit.stop();
        try { this.ci.markTheme(false); this.ci.markLayout(false); this.ci.stop(); } catch (e) { /* exiting anyway */ }
        try { this.mapWin.release(); } catch (e) { /* exiting anyway */ }
        clearInterval(this.claimTimer);
        clearTimeout(this.statusAskT);
        clearTimeout(this.rebuildT); this.rebuildT = null;
        clearTimeout(this.refusedT); this.refusedT = null;
        this.stallTimers.forEach((t) => clearTimeout(t)); this.stallTimers.clear();
        if (this.waze) this._guard('waze stop', () => this.waze.stop());
        this._guard('screen stop', () => this.screen.stop());
        this.clients.forEach((c) => c.close());
        this.atlases.clear();
    }

    /**
     * The glyph atlas of a font on a connection: an R8 asset of the font's characters in equal cells (cols x
     * rows), made on first use and kept while the connection lives (the client re-sends it by itself after a
     * reconnect). A widget's effect layer samples it; nothing is drawn by the asset itself.
     */
    _atlas(fontName, ci) {
        const key = ci + ':' + fontName;
        if (this.atlases.has(key)) return this.atlases.get(key);
        const font = textRaster.loadFont(fontName), glyphs = font.metrics.glyphs;
        const chars = Object.keys(glyphs).filter((ch) => ch.length === 1 && ch >= ' ' && ch <= '~').sort().slice(0, 64);
        if (!chars.length) throw new Error('font "' + fontName + '" has no printable glyphs for an atlas');
        const cellW = Math.max(1, Math.ceil(Math.max.apply(null, chars.map((ch) => glyphs[ch].advance)))) + 2;
        const cellH = font.metrics.cellHeight;
        const cols = Math.max(1, Math.min(16, Math.floor(2048 / cellW))), rows = Math.ceil(chars.length / cols);
        const w = cols * cellW, h = rows * cellH;
        const buf = Buffer.alloc(w * h, 0);
        chars.forEach((ch, i) => {
            const cell = textRaster.mask(cellW, cellH, ch, { font: fontName, align: 'center' });
            const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
            for (let y = 0; y < cellH; y++) cell.copy(buf, (cy + y) * w + cx, y * cellW, (y + 1) * cellW);
        });
        const c = this._clientAt(ci);
        const ref = c.asset({ target: this.target, format: 'r8', w, h, sampling: 'bilinear' });
        if (!ref) throw new Error('font "' + fontName + '": atlas asset refused (' + w + 'x' + h + ')');
        c.pixels(ref, null, buf);
        const a = { ref, c, ci, cols, rows, cellW, cellH, chars, bytes: w * h * 2 };
        this.atlases.set(key, a);
        this.log.info('glyph atlas "' + fontName + '"' + (ci ? ' on connection ' + (ci + 1) : '') + ': ' + chars.length + ' glyphs in ' +
            cellW + 'x' + cellH + ' cells, ' + w + 'x' + h + ' R8 asset, ' + mib(a.bytes) + ' of pixel memory');
        return a;
    }

    _atlasBytes() {
        let n = 0;
        this.atlases.forEach((a) => { n += a.bytes; });
        return n;
    }

    /** The glyph codes of a text in an atlas widget's cells, aligned; -1 is an empty cell. */
    _atlasCodes(x, s) {
        const a = x.atlas, n = x.cells, text = String(s).slice(0, n);
        const pad = n - text.length, w = x.w;
        const lead = w.align === 'right' ? pad : w.align === 'center' ? Math.floor(pad / 2) : 0;
        const codes = [];
        for (let i = 0; i < 32; i++) {
            const j = i - lead;
            const ch = j >= 0 && j < text.length ? text[j] : null;
            const k = ch === null ? -1 : a.chars.indexOf(ch);
            codes.push(i < n && ch !== null ? (k < 0 ? a.chars.indexOf(' ') : k) : -1);
        }
        return codes;
    }

    _guard(what, fn) {
        try { fn(); } catch (e) { this._fault(what, e); }
    }

    /**
     * An error caught by _guard: counted (faultsShown, for the Signals tab: the owner reads the screen, not the log) and logged, whole the first
     * FAULT_WHOLE times for each `what`, then one line every FAULT_QUIET_MS with the count. A widget that throws on every frame used to write its
     * stack 50 times a second: the log rotated away in seconds and the processor was busy writing it.
     */
    _fault(what, e) {
        const now = Date.now();
        const all = this.faults || (this.faults = { n: 0, last: '', at: 0, by: {} });
        const f = all.by[what] || (all.by[what] = { n: 0, shownAt: 0 });
        all.n++; all.at = now; f.n++;
        try { all.last = (what + ': ' + String(e && e.message || e)).slice(0, 160); } catch (x) { all.last = what; }
        try {
            if (f.n <= FAULT_WHOLE) this.log.error('hud ' + what + ': ' + (e && e.stack || e));
            else if (now - f.shownAt >= FAULT_QUIET_MS) this.log.error('hud ' + what + ': ' + String(e && e.message || e) + ' (' + f.n + ' times so far)');
            else return;
            f.shownAt = now;
        } catch (x) { /* the log failed: nothing to throw from here */ }
    }

    /** { n, last, at }: the errors caught so far in this run (_guard's and, where shared/survive.js is installed, the ones nobody caught), or null when there are none. */
    faultsShown() {
        const a = this.faults, s = process.__shakSurvive;
        const n = (a ? a.n : 0) + (s ? s.n : 0);
        if (!n) return null;
        const newest = s && s.n && (!a || s.at >= a.at) ? { last: 'uncaught: ' + s.last, at: s.at } : { last: a.last, at: a.at };
        return { n, last: newest.last, at: newest.at };
    }

    /* ---------------- status line (the center screen's first row) ---------------- */

    /** fn(text) whenever the status line changes. */
    onStatus(fn) { this.statusListeners.push(fn); if (this.lastStatus) fn(this.lastStatus); }

    /** The layout name to show now: per drive mode when that's on and known, else the plain setting. */
    _layoutName() {
        if (this.hiddenBy()) return 'off';
        return this._chosenName();
    }
    /**
     * Why the layout the driver picked isn't showing now (null: nothing hides it): 'screen' (ShakTheme has the screen),
     * 'claim' (another kit app holds the HUD), 'waze' (config "hideWithWaze" and its setting on: the whole HUD steps aside
     * while Waze's map shows; Waze on Cluster, status.json). The page says which, so a tap that changes nothing isn't silent.
     */
    hiddenBy() {
        if (this.screen && this.screen.yielded) return 'screen';
        if (this.claimBy) return 'claim';
        if (this.config.hideWithWaze === true && this.ctx.settings.get('hideWithWaze') !== false && this._wazeShowing(Date.now())) return 'waze';
        return null;
    }
    /** The layout the driver picked for now, before anything that makes us step aside. */
    _chosenName() {
        if (this.setting('byMode') === true && this.driveMode && MODE_KEY[this.driveMode]) {
            const v = this.setting(MODE_KEY[this.driveMode]);
            if (v) return v;
        }
        return this.setting('hudLayout');
    }

    /**
     * Another kit app (Redline) holding the HUD: step aside while its claim is fresh, come back when it lets go.
     * Every second; also tells the other apps whether we are on (HudClaim.standing).
     */
    _hudClaim() {
        const others = HudClaim.others(CLAIM_ID);
        const by = others.length ? others[0] : null;
        if (by !== this.claimBy) {
            this.claimBy = by;
            this.log.info(by ? 'HUD claim: ' + by + ' has the HUD, stepping aside' : 'HUD claim: the HUD is free again');
            this._rebuild();
        }
        const want = this._chosenName();
        HudClaim.standing(CLAIM_ID, !!(want && want !== 'off'));
    }

    _layoutLabel(name) {
        const lay = this.ctx.settings.item('hudLayout');
        const o = lay && (lay.options || []).find((x) => x[0] === name);
        return o ? o[1] : name;
    }

    /** The first widget on that layer, for the logs; a sheet is named by its first member plus how many more it holds. */
    _widgetOf(ci, ref) {
        let id = null, n = 0;
        this.widgets.forEach((x) => { if (x.ci === ci && x.ref === ref) { if (!id) id = x.w.id; n++; } });
        return n > 1 ? id + ' +' + (n - 1) : id;
    }

    /** Every layer of the layout now (effects, sheets and own image layers), each once: { c, ci, ref, key }. */
    _layerRefs() {
        const refs = [], seen = {};
        this.widgets.forEach((x) => {
            const key = x.ci + ':' + x.ref;
            if (!seen[key]) { seen[key] = true; refs.push({ c: x.c, ci: x.ci, ref: x.ref, key }); }
        });
        return refs;
    }

    /** How many connections the layout now uses. */
    _connCount() {
        const seen = {};
        this.widgets.forEach((x) => { seen[x.ci] = true; });
        return Object.keys(seen).length;
    }

    /** The connection a widget asks for ("conn", 0..3; 0 the app's own). */
    _connOf(w) {
        const n = isNum(w.conn) ? Math.floor(w.conn) : 0;
        return Math.max(0, Math.min(MAX_CONN - 1, n));
    }

    /** Layers per connection in a plan: [n on connection 1, n on 2, ...]. */
    _connCounts(plan) {
        const counts = [];
        plan.forEach((e) => { counts[e.conn] = (counts[e.conn] || 0) + 1; });
        for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
        return counts;
    }

    _layerCount(n) { return n === 1 ? '1 layer' : n + ' layers'; }

    _statusSoon() {
        if (this._statusT) return;
        this._statusT = setTimeout(() => { this._statusT = null; this._guard('status', () => this._status()); }, 500);
    }

    /** ", 3 of 5 layers drawn (2 waiting: <reason>)" while some layers aren't shown; "" when all are. Counts layers, not widgets. */
    _drawnNote() {
        const ts = this.targetState;
        if (ts && (ts.state === 'waiting' || ts.state === 'parked') && ts.holder) {
            return ts.holder === 'foreign' ? ', waiting: another app has this display' : ', waiting: BMW is using this display';
        }
        const refused = this.refused ? ', refused ' + this.refused : '';
        const refs = this._layerRefs();
        if (!refs.length) return refused;
        let shown = 0, why = null, whyN = 0;
        refs.forEach((r) => {
            const st = this.layerStates.get(r.key);
            if (st && st.state === 'shown') shown++;
            else if (st) { whyN++; if (!why) why = st.state + (st.reason ? ': ' + st.reason : ''); }
        });
        if (shown === refs.length || (!why && !shown)) return refused;
        return ', ' + shown + ' of ' + this._layerCount(refs.length) + ' drawn' + (why ? ' (' + whyN + ' ' + why + ')' : '') + refused;
    }

    statusText() {
        if (!this.client.ready) {
            let there = false;
            try { there = fs.existsSync(this.socketPath); } catch (e) { /* treat as missing */ }
            return there ? this.label + ': connecting to cluster-render' : this.label + ' off: cluster-render is not installed or not running';
        }
        if (this.problem) return this.label + ': ' + this.problem;
        const byMode = this.setting('byMode') === true;
        const mode = byMode ? (this.driveRaw ? ' (drive mode not recognised: the car sends ' + this.driveRaw + ')'
            : this.driveMode ? ' (' + (this.driveName || MODE_NAME[this.driveMode]) + ')' : ' (drive mode not seen yet)') : '';
        const what = this.target === 'panel' ? 'cluster' : 'HUD';
        if (this.activeName === 'off' && this.claimBy) return this.label + ' off: ' + this.claimBy.charAt(0).toUpperCase() + this.claimBy.slice(1) + ' has the HUD; it comes back when that app lets go';
        if (this.activeName === 'off' && this.screen.yielded) return this.label + ' off: ' + this.screen.otherName + ' has the screen, pick one here to take it back';
        if (this.activeName === 'off') return this.label + ' off' + mode + ": BMW's own " + what + ' shows';
        const name = this._layoutLabel(this.activeName);
        const d = this.car.data();
        const demo = d.demo ? ', demo data' : '';
        const drawn = this._drawnNote();
        const conns = this._connCount();
        const layers = ', ' + this._layerCount(this._layerRefs().length) + (conns > 1 ? ' on ' + conns + ' connections' : '')
            + (this.pixelBytes ? ', ' + mib(this.pixelBytes) + ' of 16 MiB pixels' : '');
        if (this.layoutTheme) return this.label + ' on' + mode + ': ' + name + ' theme' + layers + demo + drawn;
        const theme = THEMES[this.themeName] ? THEMES[this.themeName].name : this.themeName;
        const auto = this.setting('hudTheme') === 'auto' ? ' (Auto)' : '';
        return this.label + ' on' + mode + ': ' + name + ' layout, ' + theme + ' theme' + auto + layers + demo + drawn;
    }

    _status() {
        // the Waze map's state rides along while that setting is on (and redraws the page's Map tab when it changes)
        const s = this.statusText() + (this.waze && this.setting('mapInTheme') === true ? '; Waze: ' + this.waze.info().text : '');
        if (s === this.lastStatus) return;
        this.lastStatus = s;
        this.statusListeners.forEach((fn) => { try { fn(s); } catch (e) { this.log.warn('status listener: ' + e); } });
    }

/* ---------------- theme, units, values ---------------- */

    _themeName() {
        if (this.layoutTheme) return this.layoutTheme;
        const t = this.setting('hudTheme');
        if (t !== 'auto') return t;
        return sun.isNight(Date.now(), ...this._sunPlace()) ? 'night' : this.setting('dayTheme');
    }

    /** Night colours now: ShakTheme' "nightDim" on Auto, a theme of the layout's own, and the sun down. */
    _nightDim() {
        if (!this.ctx.settings.item('nightDim') || this.setting('nightDim') !== 'auto' || !this.layoutTheme) return false;
        return sun.isNight(Date.now(), ...this._sunPlace());
    }

    /** Start the shift-light test: the rpm the lights, bars and readouts see climbs to the shift point and holds there
     *  (about 4 s). Only while the car stands (or on demo data). Returns false when it can't run now. */
    testShift() {
        const d = this.car.data(), sp = d.speed;
        if (isNum(sp) && sp > 3 && !d.demo) return false;
        this.testAt = Date.now();
        this.log.info('shift-light test');
        return true;
    }
    shiftTesting() { return this.testAt !== null; }

    /** The test's rpm now, or null when no test runs (it ends by itself). */
    _testRpm(now) {
        if (this.testAt === null) return null;
        const t = now - this.testAt;
        if (t > TEST_CLIMB_MS + TEST_HOLD_MS || t < 0) { this.testAt = null; return null; }
        const top = this._shiftPointRaw() + 200;
        return TEST_FROM + (top - TEST_FROM) * Math.min(1, t / TEST_CLIMB_MS);
    }
    _shiftPointRaw() { return this.score.shiftPoint(this.car.data().oil).rpm; }

    /** A readout over its warning limit ("warnOil" C, "warnCoolant" C, "warnBoost" bar; 0 = off): which sensor, else null. */
    _warning(w) {
        const t = String(w.text || '');
        let id = null;
        if (t.indexOf('{{slot:') >= 0 && w.slot) id = (this.slotSensor(this.activeName, w.slot, this.layoutSlots) || {}).id;
        else if (t.indexOf('{{oil}}') >= 0) id = 'oil';
        else if (t.indexOf('{{coolant}}') >= 0) id = 'coolant';
        else if (t.indexOf('{{boost}}') >= 0 || t.indexOf('{{boostPos}}') >= 0) id = 'boost';
        return this._overLimit(id);
    }
    /**
     * The reserve: "fuel" is true while the fuel range is at or under the setting "reserveKm" (90), "battery" while the battery's charge is at or
     * under "reservePct" (10 %). A widget with "lowWhen": "fuel" | "battery" (a number or an icon) turns the shift red then.
     */
    _lowNow(kind) {
        const set = this.ctx.settings;
        if (kind === 'fuel') {
            const lim = set.item('reserveKm') ? this.setting('reserveKm') : 0, r = this._raw('range');
            return isNum(lim) && lim > 0 && isNum(r) && r <= lim;
        }
        if (kind === 'battery') {
            const lim = set.item('reservePct') ? this.setting('reservePct') : 0, v = this._raw('hvSoc');
            return isNum(lim) && lim > 0 && isNum(v) && v <= lim;
        }
        return false;
    }
    /** [fuel, battery] reserve flags (1 / 0) for the themes' bars and dials, and their key part. */
    _lows() { return [this._lowNow('fuel') ? 1 : 0, this._lowNow('battery') ? 1 : 0]; }
    /**
     * The colour role of a tyre pressure number (corner FL FR RL RR): yellow under the setting "tyreLow" (bar, 0 = never), red TYRE_RED_BAR under
     * it, `role` when it is fine or unknown. Compared as shown (to 0.1 bar).
     */
    _tyreRole(corner, role) {
        const lv = this._tyreLevel(corner);
        return lv === 2 ? 'hot' : lv === 1 ? VERDICT.EARLY : role;
    }

    /** 0 fine (or unknown, or the setting is 0), 1 under "tyreLow", 2 TYRE_RED_BAR under it, for a corner FL FR RL RR or 'any' (the worst of the four). */
    _tyreLevel(corner) {
        if (corner === 'any') return Math.max.apply(null, TYRE_CORNERS.map((k) => this._tyreLevel(k)));
        const lim = this.ctx.settings.item('tyreLow') ? this.setting('tyreLow') : 0, v = this._tyre('p', corner);
        if (!isNum(lim) || !(lim > 0) || !isNum(v)) return 0;
        const b = Math.round(v * 10) / 10;
        return b < Math.round((lim - TYRE_RED_BAR) * 10) / 10 ? 2 : b < lim ? 1 : 0;
    }

    /** The lowest tyre pressure in bar, or null. */
    _tyreMin() {
        const all = TYRE_CORNERS.map((k) => this._tyre('p', k)).filter(isNum);
        return all.length ? Math.min.apply(null, all) : null;
    }

    /**
     * The warm-up cue: true during the few flashes after the oil or coolant ("oil" | "coolant") goes from under its cold limit ("oilCold" /
     * "coolantCold") to over it, while the app runs. An engine that was already warm when the app started does not flash. The text and the icon
     * ask each frame; the first one to see the crossing starts it for both.
     */
    _warmPulse(id, now) {
        const all = this.warm || (this.warm = {}), s = all[id] || (all[id] = { cold: false, at: 0 });
        const v = this._raw(id), lim = this.setting(COLD_BELOW[id]);
        if (isNum(v) && isNum(lim) && lim > 0) {
            if (v < lim) s.cold = true;
            else if (s.cold) { s.cold = false; s.at = now; }
        }
        return s.at > 0 && now - s.at < WARM_PULSE_MS && Math.floor((now - s.at) / WARM_FLASH_MS) % 2 === 0;
    }

    /** The share of this drive done on electricity, 0..100, or null (not a hybrid, the setting off, under 0.3 km, or not the cluster). */
    _evShare() {
        if (this.target !== 'panel' || this.setting('evShare') === false || !isNum(this._raw('hvSoc')) || !(this.tripKm >= 0.3)) return null;
        return Math.round(100 * Math.min(1, this.evKm / this.tripKm));
    }

    /**
     * The ice alert: { on, blink } while the outside temperature (C) is at or under the setting "iceBelow" (0 = never), off again 1 degree above it
     * (so it doesn't flicker at the limit). `blink`: for the first ICE_BLINK_MS after it came on (or after the app started in the cold) the
     * snowflake flashes, then it stays lit.
     */
    _ice(now) {
        const s = this.ice || (this.ice = { on: false, at: 0 });
        const v = this._raw('ambient'), lim = this.setting('iceBelow');
        if (!isNum(v) || !isNum(lim) || lim <= 0) s.on = false;
        else if (!s.on && v <= lim) { s.on = true; s.at = now; }
        else if (s.on && v > lim + 1) s.on = false;
        return { on: s.on, blink: s.on && now - s.at < ICE_BLINK_MS && Math.floor((now - s.at) / 500) % 2 === 1 };
    }

    /** The 0-100 timer's time now (s), or null: it shows on the cluster only, while the setting "launchTimer" is on. */
    _launchTime(now) {
        if (this.target !== 'panel' || this.setting('launchTimer') === false) return null;
        return this.runs.shownHeld(now);
    }

    /**
     * The launch cue: the timer is armed (the car has stood still half a second, runs.js), the drive mode is Sport, the engine speed is at the
     * setting "launchRpm" (2000 tr/min; the foot is on the throttle, not at a red light) and there is no time to show yet; a chequered flag and "Launch Control Ready" then wait in green (the setting "launchReady"; the car's own launch control can't be
     * read, it is the timer that is ready). They sit at the bottom centre. Only on the layouts that have "readyBy" widgets.
     */
    _launchReady(now) {
        const ok = this.hasReady === true && this.setting('launchTimer') !== false && this.setting('launchReady') !== false
            && this.driveMode === 'sport' && this.runs.state === 'armed' && !isNum(this.runs.shownHeld(now));
        const lim = isNum(this.setting('launchRpm')) ? this.setting('launchRpm') : LAUNCH_RPM, rpm = this._raw('rpm');
        // the engine speed asks for the throttle: on from the setting "launchRpm" (0 = from the stop), off again 400 rpm under it (a lifted foot
        // doesn't make it flicker); no engine speed known, no cue
        if (!ok || (lim > 0 && !isNum(rpm))) this.launchOn = false;
        else if (lim <= 0 || rpm >= lim) this.launchOn = true;
        else if (rpm < lim - LAUNCH_RPM_HYST) this.launchOn = false;
        return this.launchOn === true;
    }

    /** The speed limit ring now: { text (the number shown), over (the speed shown is over it) }, or null when there is none to show. */
    /**
     * What the car says about the road signs: 'sign' (the sign the cluster shows: TrafficSignDisplayControl) feeds the limit ring, 'next' (FASuS,
     * the next limit the camera has recognised) is only logged until a drive's log shows what it means. The raw value of each goes to the log
     * (every new one, 40 lines in all), since the field list of the sign signal is cut on the owner's photo.
     */
    _carSign(src, v) {
        let raw = '';
        try { raw = JSON.stringify(v); } catch (e) { raw = String(v); }
        raw = String(raw).slice(0, 300);
        this.signRaw = this.signRaw || {};
        if (this.signRaw[src] !== raw) {
            this.signRaw[src] = raw;
            this.signLogs = (this.signLogs || 0) + 1;
            if (this.signLogs <= 40) this.log.info('road sign ' + src + ': ' + raw);
        }
        if (src !== 'sign') return;
        const d = decodeSign(v);
        if (!d.found) {
            if (!this.signNoField) { this.signNoField = true; this.log.warn('road sign: no speed field in ' + Object.keys(v || {}).join(', ')); }
            return;
        }
        if (d.invalid) return;
        this.speedLimit.feed(d.limit, 'car');
    }

    _limitNow(now) {
        if (this.target !== 'panel' || this.setting('limitRing') === false) return null;
        const kmh = this.speedLimit.limit();
        if (!isNum(kmh)) return null;
        const us = this.setting('units') === 'us', text = formatLimit(kmh, us), v = this._raw('speed');
        return { text, over: isNum(v) && Math.round(us ? v * 0.621371 : v) > Number(text) };
    }

    /** `id` (oil / coolant / boost) if that reading is over its warning limit now, else null. */
    _overLimit(id) {
        if (!WARN[id]) return null;
        const lim = this.setting(WARN[id]), v = this._raw(id);
        return isNum(lim) && lim > 0 && isNum(v) && v > lim ? id : null;
    }

    _barMax(w) { return Math.ceil(this.setting('redline') / 1000) * 1000 + ((w && w.over) || 0); }

    /** The shift point now ({ rpm, cold }) and whether the rpm is at or past it. */
    _shift() {
        const d = this.car.data();
        const sp = this.score.shiftPoint(d.oil);
        const rpm = isNum(this.rpmF) ? this.rpmF : d.rpm;
        sp.now = isNum(rpm) && rpm >= sp.rpm;
        sp.oilCold = isNum(d.oil) && d.oil < 80;
        return sp;
    }

    /**
     * The zone of the rev counter now: 0 normal (the bar is white), 1 the run-up (orange: the 700 rpm before the redline, see _redMarks),
     * 2 the red zone (from the redline, or the shift point if that comes first). The engine's rpm only: the hybrid's electric power keeps
     * its blue and its charge its green, so the callers pass 0 there.
     */
    _zoneRev(max) {
        const rpm = this._barRaw('rpm');
        if (!isNum(rpm) || !(max > 0)) return 0;
        const [red, orange] = this._redMarks(max), f = rpm / max;
        return this._shift().now || f >= red ? 2 : f >= orange ? (this.runUp ? 1 : 0) : 0;
    }

    /**
     * The zone (0 / 1 / 2) of the bar that a scale label belongs to: 'speed' and 'mspeed' labels follow the speed bar, 'rpm' labels the rev
     * counter (rpmMax = the scale's top, as the bars' own _redMarks). The hybrid's electric power and charge have no zone.
     */
    _zoneOf(kind, rpmMax) {
        if (kind === 'rpm') return this.hybridEv ? 0 : this._zoneRev(rpmMax || 7000);
        return this._zoneSpeed();
    }

    /**
     * The zone of the speed bar now: 0 normal (white), 1 orange from 85 % of the setting "speedZone" (km/h, 0 = none), 2 red from it. The
     * car's speed is in km/h whatever the display unit is.
     */
    _zoneSpeed() {
        const lim = this.ctx.settings.item('speedZone') ? this.setting('speedZone') : 0, v = this._barRaw('speed');
        if (!isNum(lim) || !(lim > 0) || !isNum(v)) return 0;
        return v >= lim ? 2 : v >= lim * 0.85 ? (this.runUp ? 1 : 0) : 0;
    }

    /** The start-up sweep now, 0..1 (0 = not running): up to the top and back down, smooth at both ends; it stops at once if the car moves. */
    _sweepF(now) {
        if (this.sweepAt === null) return 0;
        const d = this.car.data(), t = now - this.sweepAt;
        if (t > SWEEP_MS || (isNum(d.speed) && d.speed > 3 && !d.demo)) { this.sweepAt = null; return 0; }
        if (t < 0) return 0;
        const h = t < SWEEP_MS / 2 ? t / (SWEEP_MS / 2) : 1 - (t - SWEEP_MS / 2) / (SWEEP_MS / 2);
        return h * h * (3 - 2 * h);
    }

    /**
     * The value a bar, a scale number or a zone sees: the car's, or while the start-up sweep runs the larger of it and the sweep's, so the
     * sweep ends on the real value with no jump. Only the bars and what follows them: the readouts, the shift lights and the shift
     * scoring keep the car's own values.
     */
    _barRaw(name) {
        const v = this._raw(name), f = this._sweepF(Date.now());
        if (name === 'speed' && f <= 0 && isNum(v) && isNum(this.speedF)) return this.speedF;       // eased (_smoothSpeed); the sweep and the readouts use the car's own
        return f > 0 && (name === 'rpm' || name === 'speed') ? Math.max(isNum(v) ? v : 0, f * (name === 'rpm' ? 7000 : 330)) : v;
    }

    /** A number that eases to its target (per key, over ZONE_EASE_MS): the zone colours fade between white, orange and red instead of jumping. */
    _ease(key, target, now) {
        const e = this.zoneEase || (this.zoneEase = {}), s = e[key] || (e[key] = { v: target, t: now });
        const k = 1 - Math.exp(-Math.min(500, Math.max(0, now - s.t)) / ZONE_EASE_MS);
        s.t = now;
        s.v += (target - s.v) * k;
        if (Math.abs(target - s.v) < 0.02) s.v = target;
        return s.v;
    }

    /**
     * The rev counter's held peak 0..1 for the bar's own state x: the highest value of the last PEAK_HOLD_MS, held there, then eased down onto the
     * value; 0 while it is not clearly above the value (a tick that sat on the marker would only blur it), and 0 when the bar shows the hybrid's
     * power ("off": the peak starts again when the engine runs). The tick is drawn by the shaders (u_peak; mstyle's u_v.y).
     */
    _peakRev(x, v, now, off) {
        if (off) { x.pk = null; return 0; }
        const p = x.pk || (x.pk = { v, at: now, t: now });
        if (v >= p.v) { p.v = v; p.at = now; } else if (now - p.at > PEAK_HOLD_MS) p.v = Math.max(v, p.v - (now - p.t) * PEAK_FALL);
        p.t = now;
        return p.v > v + 0.03 ? Math.round(p.v * 200) / 200 : 0;
    }

    /** The colour (rgb 0..1) of a zone number between 0 and 2: white, orange (the run-up), red. */
    _zoneRgb(z) {
        const i = Math.min(1, Math.max(0, Math.floor(z))), f = Math.min(1, Math.max(0, z - i)), a = ZONE_RGB[i], b = ZONE_RGB[i + 1];
        return a.map((v, n) => v + (b[n] - v) * f);
    }

    /** Boost in bar: the sport display's value while fresh, else the engine unit's, else null. */
    _boost() {
        const now = Date.now();
        if (isNum(this.boostFes) && now - this.boostFesAt < FRESH_MS) return this.boostFes;
        if (isNum(this.boostDme) && now - this.boostDmeAt < FRESH_MS) return this.boostDme;
        return null;
    }

    /** A tyre's pressure ('p', bar) or temperature ('t', C) at corner FL FR RL RR; steady made-up values on the demo drive. */
    /** A TPMS pressure raw (0.1 x the car's unit, 65532 and up = none) in bar: by the car's unit when known, else by the
     *  unit whose plausible tyre pressures the value falls in (bar 0.5-6, psi 7-60, kPa 60-600; psi also means F). */
    _tyreBar(raw) {
        if (!isNum(raw) || raw < 0 || raw >= 65532) return null;
        const v = raw / 10, k = PRESS_TO_BAR[this.carUnits.press];
        if (k) return v * k;
        if (v >= 0.5 && v <= 6) return v;
        if (v >= 7 && v < 60) { this.carUnits.psiSeen = true; return v / 14.5038; }
        if (v >= 60 && v <= 600) return v / 100;
        return v;
    }

    /** A TPMS temperature raw (the car's degrees + 40, 65535 = none) in C (the car sends F when set to F). */
    _tyreC(raw) {
        if (!isNum(raw) || raw < 0 || raw >= 65535) return null;
        const v = raw - 40, f = this.carUnits.temp ? this.carUnits.temp === 'F' : this.carUnits.psiSeen;
        return f ? (v - 32) * 5 / 9 : v;
    }

    /** The shifter programme letter next to the gear: S or M from the M drive display, else from the gearbox status, else D. */
    _program(d) {
        const p = this.program || d.program;
        return p === 'S' || p === 'M' ? p : 'D';
    }

    _tyre(kind, corner) {
        const v = this.tyres[kind][corner];
        if (isNum(v)) return v;
        if (!this.car.data().demo) return null;
        const rear = corner === 'RL' || corner === 'RR';
        return kind === 'p' ? (rear ? 2.5 : 2.3) : (rear ? 27 : 24);
    }

    /** A dial's scale: { max, ticks } in display units (speed: DIAL_SPEED by the units setting; rpm: "max", 8000). */
    _dialScale(w) {
        if (w.measure === 'speed') return DIAL_SPEED[this.setting('units') === 'us' ? 'us' : 'metric'];
        if (w.measure === 'rpm') { const max = w.max || 8000; return { max, ticks: max / 1000 }; }
        return { max: w.max || 1, ticks: w.ticks || 8 };
    }

    /** Peak hold for a gauge: the highest value of the last `hold` ms (true: 3 s), as 0..1. */
    _peakHold(x, v, now, hold) {
        const ms = hold === true ? 3000 : hold;
        if (!isNum(x.peakV) || v >= x.peakV || now - x.peakAt > ms) { x.peakV = v; x.peakAt = now; }
        return x.peakV;
    }

    /** One car sample: the g average (G_BAD, G_AVG_MS). */
    _gSample(d, t) {
        if (!isNum(d.gLong) || Math.abs(d.gLong) > G_BAD || (isNum(d.gLat) && Math.abs(d.gLat) > G_BAD)) return;
        this.gBuf.push([t, isNum(d.gLat) ? d.gLat : 0, d.gLong]);
        while (this.gBuf.length && (t - this.gBuf[0][0] > G_AVG_MS || t < this.gBuf[0][0] || this.gBuf.length > 2000)) this.gBuf.shift();      // (a clock set back: the old samples go at once)
        const n = this.gBuf.length;
        this.gSm = { lat: this.gBuf.reduce((a, s) => a + s[1], 0) / n, long: this.gBuf.reduce((a, s) => a + s[2], 0) / n, at: Date.now() };
    }

    /** Forget the G-meter's envelope, trail and bests (the page's Reset button, the demo / car switch). */
    resetG() {
        this.gEnv = new Array(G_SECTORS).fill(0);    // car frame: sector n at n * 7.5 degrees, atan2(long, lat)
        this.gBest = { left: 0, right: 0, accel: 0, brake: 0, total: 0 };
        this.gTrail = [];                            // [t, lat, long], newest first
        this.gEnvAt = Date.now();                    // changes when the envelope does (widgets resend it)
    }

    /** The G-meter's range in g: the setting, else the layout's "max", else 1.2. */
    _gRange(w) {
        const v = Number(this.setting('gRange'));
        return v > 0 ? v : (w && w.max) || 1.2;
    }

    /** The g every tick (car frame, lat + = left, long + = speeding up): the envelope, bests and trail. */
    _gTick(now) {
        const lat = this._raw('gLat'), lon = this._raw('gLong');
        if (!isNum(lat) || !isNum(lon)) return;
        const r = Math.sqrt(lat * lat + lon * lon), B = this.gBest;
        if (lat > B.left) B.left = lat;
        if (-lat > B.right) B.right = -lat;
        if (lon > B.accel) B.accel = lon;
        if (-lon > B.brake) B.brake = -lon;
        if (r > B.total) B.total = r;
        if (r > 0.05) {
            const n = Math.round(Math.atan2(lon, lat) / (2 * Math.PI) * G_SECTORS);
            for (let o = -G_SPREAD; o <= G_SPREAD; o++) {
                const i = ((n + o) % G_SECTORS + G_SECTORS) % G_SECTORS;
                const v = Math.round(r * Math.cos(o * 2 * Math.PI / G_SECTORS) * 50) / 50;
                if (v > this.gEnv[i]) { this.gEnv[i] = v; this.gEnvAt = now; }
            }
        }
        const secs = Number(this.setting('gTrail')), step = secs > 0 ? secs * 1000 / (G_TRAIL - 1) : 0;
        if (!step) { this.gTrail = []; return; }
        if (!this.gTrail.length || now - this.gTrail[0][0] >= step) {
            this.gTrail.unshift([now, lat, lon]);
            if (this.gTrail.length > G_TRAIL - 1) this.gTrail.length = G_TRAIL - 1;
        }
    }

    /** Screen signs for the G-meter: [sx, sy], drawn x = sx * lat, drawn y (down) = sy * long. */
    _gSigns(w) {
        const fx = (this.setting('gFlipLat') === true) !== !!(w && w.flipX), fy = (this.setting('gFlipLong') === true) !== !!(w && w.flipY);
        return [fx ? 1 : -1, fy ? 1 : -1];
    }

    /** What the page's G-meter tab shows: the g now, the trail and envelope as drawn, the bests, the range. */
    gState() {
        const S = this._gSigns(null), lat = this._raw('gLat'), lon = this._raw('gLong');
        return {
            x: isNum(lat) ? S[0] * lat : null, y: isNum(lon) ? S[1] * lon : null,
            trail: this.gTrail.map((p) => [S[0] * p[1], S[1] * p[2]]), env: this._gEnvDrawn(S),
            best: this.gBest, max: this._gRange(null), live: isNum(lat) && isNum(lon),
        };
    }

    /** The envelope by drawn sector: sector m at m * 7.5 degrees counter-clockwise from + x, + y up. */
    _gEnvDrawn(S) {
        const out = new Array(G_SECTORS);
        for (let m = 0; m < G_SECTORS; m++) {
            const a = m * 2 * Math.PI / G_SECTORS;
            // drawn up vector u = (sx * lat, -sy * long), so the car's direction is (sx cos a, -sy sin a)
            const n = Math.round(Math.atan2(-S[1] * Math.sin(a), S[0] * Math.cos(a)) / (2 * Math.PI) * G_SECTORS);
            out[m] = this.gEnv[((n % G_SECTORS) + G_SECTORS) % G_SECTORS];
        }
        return out;
    }

    _raw(name) {
        if (name === 'boost') return this._boost();
        if (name === 'gLat' || name === 'gLong') {
            // the 150 ms average while samples come in; else the car's last reading, unless it is a bad one
            if (this.gSm && Date.now() - this.gSm.at < 1000) return name === 'gLat' ? this.gSm.lat : this.gSm.long;
            const g = this.car.data()[name];
            return isNum(g) && Math.abs(g) <= G_BAD ? g : null;
        }
        if (name === 'intake') {
            if (isNum(this.intakeDme) && Date.now() - this.intakeDmeAt < 10000) return this.intakeDme;
            return this.car.data().demo ? 31 : null;
        }
        if (name === 'rpm' && isNum(this.rpmF)) return this.rpmF;
        if (name === 'hvSoc') {
            if (isNum(this.hvSoc) && Date.now() - this.hvSocAt < HV_STALE_MS) return this.hvSoc;     // read here
            const shared = this.ci.sharedSoc();                                                        // or shared by eDrive Live / the other app
            return isNum(shared) ? shared : this.car.data().demo ? 64 : null;
        }
        if (name === 'evRange') return this._evRangeNow();
        // the electric view (19 Nov 2026): the motor's power as two readings, what it gives (evPower) and what it takes back (evRecup), in kW
        if (name === 'evPower' || name === 'evRecup') { const kw = this._evKw(); return kw === null ? null : name === 'evPower' ? Math.max(0, kw) : Math.max(0, -kw); }
        if (name === 'fuel' || name === 'range' || name === 'ambient') {
            // the kit's demo drive has none of these: made-up but steady values while it runs
            const demo = this.car.data().demo;
            if (name === 'fuel') {
                if (isNum(this.fuelObd) && Date.now() - this.fuelObdAt < FUEL_STALE_MS) return this.fuelObd / 100;
                return isNum(this.fuelL) ? Math.min(1, this.fuelL / this._tankLitres()) : demo ? 0.62 : null;
            }
            if (name === 'range') return isNum(this.rangeKm) ? this.rangeKm : demo ? 368 : null;
            return isNum(this.ambient) ? this.ambient : demo ? 24 : null;
        }
        if (name === 'torquePct' || name === 'powerPct') {
            // the car's own sport display % while it sends one, else from the crank torque and app.json
            // config.engine's peaks (an M40i makes 500 Nm, 285 kW)
            if (Date.now() - (this.sportAt || 0) < FRESH_MS) {
                const v = name === 'powerPct' ? this.sportPower : this.sportTorque;
                if (isNum(v)) return v;
            }
            const e = this.config.engine || {}, d = this.car.data();
            if (!isNum(d.torque)) return null;
            if (name === 'torquePct') return Math.max(0, d.torque) / (e.torqueNm || 500) * 100;
            return isNum(d.rpm) ? Math.max(0, d.torque) * d.rpm / 9549 / (e.powerKw || 285) * 100 : null;
        }
        if (name.indexOf('setupLevel:') === 0) { const s = this._setup(); return s ? SETUP_LEVEL[s[name.slice(11)]] || 0 : 0; }
        const d = this.car.data();
        return Object.prototype.hasOwnProperty.call(d, name) ? d[name] : null;
    }

    /** Where the red and orange marks start on a rev scale that ends at `max` rpm, as fractions 0..1: red from the
     *  redline, but always covering at least the last 500 rpm (the M40i's scale ends right at its 7000 redline),
     *  orange over the 700 rpm before the red. */
    _redMarks(max) {
        const redFrom = Math.min(this.setting('redline'), max - 500) / max;
        return [redFrom, redFrom - 700 / max];
    }

    /**
     * Where the needle is on a scale, in label steps: 'speed' (SPEED_SCALE index), 'mspeed' (the M Blade scale) or 'rpm' (thousands, or
     * the battery's power in tens of kW while the bar shows that); null without data.
     */
    _nearPos(kind) {
        if (kind === 'rpm') {
            if (this.hybridPow) return this.hybridPow.kw / 10;
            const r = this._barRaw('rpm');
            return isNum(r) ? r / 1000 : null;
        }
        const v = this._barRaw('speed');
        if (!isNum(v)) return null;
        const us = this.setting('units') === 'us';
        return scaleFrac(us ? v * 0.621371 : v, (kind === 'mspeed' ? M_SCALE : SPEED_SCALE)[us ? 'us' : 'metric']) * 8;
    }

    /**
     * The scale label the needle has reached: the highest label of this layout at or under the needle (a label lights when the needle gets
     * to it, and goes out when it falls back under it); null before the first label or without data.
     */
    _nearMark(kind) {
        const pos = this._nearPos(kind);
        if (pos === null) return null;
        const labels = this.nearLabels && this.nearLabels[kind];
        if (!labels) return Math.floor(pos + 1e-6);
        let best = null;
        labels.forEach((i) => { if (i <= pos + 1e-6) best = i; });
        return best;
    }

    /**
     * The electric motor's power now in kW, negative while it charges the battery (recuperation), or null: what eDrive Live shares, else the
     * stock cluster's own power meter, else the estimate (the same order as the hybrid rev bar, _hybridTach).
     */
    _evKw() {
        const shared = this.ci && this.ci.sharedPower ? this.ci.sharedPower() : null, rel = !shared ? this._relPower() : null;
        const est = !shared && !rel ? this._estPower() : null, pw = shared || rel || est;
        return pw && !pw.old && isNum(pw.kw) ? pw.kw : null;
    }

    /** The setup rows for the drive mode now, or null before the car has said. */
    _setup() {
        if (!this.driveMode) return null;
        if (this.driveVariant === 'individual') return SETUP.individual;
        return SETUP[this.driveMode === 'sport' && this.driveVariant === 'plus' ? 'sportplus' : this.driveMode];
    }

    /** {{token}} -> display text. */
    _token(tok) {
        const us = this.setting('units') === 'us';
        const fix = (v, n) => (isNum(v) ? v.toFixed(n) : '--');
        if (tok.indexOf('slot') === 0 && tok.indexOf(':') > 0) {
            const kind = tok.slice(0, tok.indexOf(':')), sn = this.slotSensor(this.activeName, tok.slice(kind.length + 1), this.layoutSlots);
            if (kind === 'slot') return this.sensorValue(sn);
            if (kind === 'slotHead') return sn ? sn.head : '';
            // the heading with the unit, for a slot with no unit of its own: "FUEL %" (a temperature's ° is on its value)
            if (kind === 'slotHeadU') { const u = sn && !sn.suffix ? this.sensorUnit(sn) : ''; return sn ? sn.head + (u ? ' ' + u : '') : ''; }
            if (kind === 'slotUnit') return this.sensorUnit(sn);
            if (kind === 'slotSuffix') return sn && sn.suffix ? sn.suffix : '';
        }
        if (tok.indexOf('tyreP:') === 0) { const v = this._tyre('p', tok.slice(6)); return isNum(v) ? (us ? fix(v * 14.5038, 0) : fix(v, 1)) : '--'; }
        if (tok.indexOf('tyreT:') === 0) { const v = this._tyre('t', tok.slice(6)); return isNum(v) ? String(Math.round(us ? v * 9 / 5 + 32 : v)) : '--'; }
        if (tok.indexOf('dial:speed:') === 0) {     // a speed dial's label i ({{dial:speed:<i>}}): DIAL_SPEED's steps
            const D = DIAL_SPEED[us ? 'us' : 'metric'];
            return String(Math.round(D.max / D.ticks * Number(tok.slice(11))));
        }
        switch (tok) {
            case 'u:pressure': return us ? 'psi' : 'bar';
            case 'intake': { const v = this._raw('intake'); return fix(isNum(v) ? (us ? v * 9 / 5 + 32 : v) : v, 0); }
            case 'boostPeak': { const v = this.boostPeak; return us ? fix(isNum(v) ? v * 14.5038 : v, 1) : fix(v, 2); }
            case 'run': { const v = this.runs.shown(Date.now()); return isNum(v) ? v.toFixed(this.runs.state === 'run' ? 1 : 2) : '0.00'; }
            case 'runBest': { const v = this.runs.best[us ? 'us' : 'metric']; return v > 0 ? v.toFixed(2) : '-.--'; }
            case 'runState': return this.runs.word();
            case 'runLabel': return us ? '0-60 MPH' : '0-100 KM/H';
            case 'warm': { const o = this._raw('oil'); return isNum(o) ? (o < 80 ? 'WARMING UP' : 'ENGINE WARM') : ''; }
            case 'badge': return badges.text(this.setting('badge'), this.setting('badgeBMW') === true);
            case 'speed': { const v = this._raw('speed'); return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0); }
            case 'u:speed': return us ? 'MPH' : 'KM/H';
            case 'oil': case 'coolant': { const v = this._raw(tok); return fix(isNum(v) ? (us ? v * 9 / 5 + 32 : v) : v, 0); }
            case 'boost': { const v = this._raw('boost'); return us ? fix(isNum(v) ? v * 14.5038 : v, 1) : fix(v, 2); }
            // the views' boost readout, beside a bar that starts at 0: a vacuum (the engine unit's reading, below the air's pressure) reads 0.00, as
            // the bar does, and "-0.35" no longer runs out of its box on the left
            case 'boostPos': { const v = this._raw('boost'), p = isNum(v) ? Math.max(0, v) : v; return us ? fix(isNum(p) ? p * 14.5038 : p, 1) : fix(p, 2); }
            case 'u:boost': return us ? 'PSI' : 'BAR';
            case 'u:temp': return us ? '°F' : '°C';
            case 'u:speedLc': return us ? 'mph' : 'km/h';
            case 'u:distLc': return us ? 'mi' : 'km';
            case 'u:dist': return us ? 'MI' : 'KM';
            case 'avgSpeed': { const v = this._avgSpeed(); return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0); }
            case 'range': { const v = this._raw('range'); return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0); }
            // the lowest tyre pressure while one is under the setting "tyreLow" (the HUD's warning), else nothing
            case 'tyreMin': { const v = this._tyreMin(); return this._tyreLevel('any') > 0 && isNum(v) ? (us ? fix(v * 14.5038, 0) : fix(v, 1)) : ''; }
            // the total range: the fuel's and the battery's together (the fuel's alone on a car without a plug-in battery; '--' with neither)
            case 'rangeTotal': {
                const f = this._raw('range'), e = this._raw('evRange'), v = isNum(f) ? f + (isNum(e) ? e : 0) : isNum(e) ? e : null;
                return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0);
            }
            case 'ambient': {
                const v = this._raw('ambient');
                if (!isNum(v)) return '--';
                const n = Math.round(us ? v * 9 / 5 + 32 : v);
                return (n > 0 ? '+' : '') + n;
            }
            case 'u:torque': return us ? 'lb-ft' : 'Nm';
            case 'power': {          // kW from the crank torque and rpm; hp in US units
                const d = this.car.data(), rpm = this._raw('rpm');
                if (!isNum(d.torque) || !isNum(rpm)) return '--';
                const kw = Math.max(0, d.torque) * rpm / 9549;
                return String(Math.round(us ? kw * 1.341 : kw));
            }
            case 'tachUnit': return this.hybridEv ? 'kW x 10' : (this.config.lang === 'fr' ? 'tr/min x 1000' : '1/min x 1000');     // the hybrid rev counter's marks: kW x 10 while it shows the power
            case 'chargeNote': return this.hybridCharge ? 'CHARGE' : '';
            case 'powerKw': {        // the battery's power in kW, - while charging (recuperation); -- when no app shares it
                const p = this.ci.sharedPower();
                return p ? String(Math.round(p.kw)) : '--';
            }
            case 'dangerDist': return formatDistance(this.danger.state().distM, us).n;
            case 'dangerUnit': return formatDistance(this.danger.state().distM, us).unit;
            case 'dangerLimit': return formatLimit(this.danger.state().limit, us);
            // the speed limit ring's number (blank when no limit is known or the ring is off)
            case 'limit': { const l = this._limitNow(Date.now()); return l ? l.text : ''; }
            // the next limit the camera recognised, under the ring (blank when there is none, or it is the present one)
            case 'nextLimit': { const l = this._nextLimitNow(Date.now()); return l ? l.text : ''; }
            // the 0-100 km/h timer (0-60 mph): the running clock, then the finished run held a few seconds; blank otherwise
            case 'launch': { const v = this._launchTime(Date.now()); return isNum(v) ? v.toFixed(this.runs.state === 'run' || v >= 10 ? 1 : 2) : ''; }
            // the launch cue's words, whole or in two lines (blank unless the cue is up)
            case 'launchReady': return this._launchReady(Date.now()) ? 'Launch Control Ready' : '';
            case 'launchReady1': return this._launchReady(Date.now()) ? 'Launch Control' : '';
            case 'launchReady2': return this._launchReady(Date.now()) ? 'Ready' : '';
            // the share of this drive done with the engine off, in % (a plug-in hybrid only, from 0.3 km on; the setting "evShare"); blank otherwise
            case 'evShare': { const v = this._evShare(); return isNum(v) ? String(v) : ''; }
            case 'evShareUnit': return isNum(this._evShare()) ? '%' : '';
            case 'launchUnit': return isNum(this._launchTime(Date.now())) ? 's' : '';
            case 'hvSoc': { const v = this._raw('hvSoc'); return isNum(v) ? String(Math.round(v)) : '--'; }
            case 'evPower': case 'evRecup': { const v = this._raw(tok); return isNum(v) ? String(Math.round(v)) : '--'; }
            case 'evRange': { const v = this._raw('evRange'); return isNum(v) ? String(Math.round(us ? v * 0.621371 : v)) : '--'; }
            case 'fuelPct': { const v = this._raw('fuel'); return isNum(v) ? String(Math.round(v * 100)) : '--'; }
            case 'ambientN': { const v = this._raw('ambient'); return isNum(v) ? String(Math.round(us ? v * 9 / 5 + 32 : v)) : '--'; }
            case 'torque': { const v = this._raw('torque'); return fix(isNum(v) ? (us ? v * 0.737562 : v) : v, 0); }
            case 'torquePct': case 'powerPct': { const v = this._raw(tok); return isNum(v) ? String(Math.min(100, Math.round(v))) : '--'; }
            case 'boostHi': return us ? '20' : '1.4';
            case 'boostMid': return us ? '10' : '0.7';
            case 'ampmLc': return this._token('ampm').toLowerCase();
            case 'gLat': case 'gLong': { const v = this._raw(tok); return isNum(v) ? Math.abs(v).toFixed(2) : '--'; }
            case 'gSide': case 'gFwd': {
                // the car's left / right (gFlipLat: its sign the other way round); brake on top doesn't change the words
                const v = this._raw(tok === 'gSide' ? 'gLat' : 'gLong');
                if (!isNum(v)) return '--';
                const a = Math.abs(v).toFixed(2);
                if (a === '0.00') return a;
                if (tok === 'gFwd') return a + (v > 0 ? ' ACC' : ' BRK');
                return a + ((v > 0) !== (this.setting('gFlipLat') === true) ? ' L' : ' R');
            }
            case 'gBest': return this.gBest.total > 0 ? this.gBest.total.toFixed(2) : '--';
            case 'gMax': return this._gRange(null).toFixed(1);
            case 'rpm': case 'rpm10': return isNum(this.rpmShown) ? String(this.rpmShown) : (tok === 'rpm' ? '--' : '----');
            case 'shiftAt': return String(this._shift().rpm);
            case 'lastShift': return this.score.last ? String(this.score.last.rpm) : '--';
            case 'lastGears': { const l = this.score.last; return l && l.from !== '?' ? l.from + ' > ' + l.to : ''; }
            case 'verdict': return this.score.last ? this.score.last.verdict : '';
            case 'shiftPrompt': return this._shift().now ? 'SHIFT' : '';
            case 'coldNote': {
                const sp = this._shift();
                if (!sp.oilCold) return '';
                return sp.cold ? 'COLD · LIMIT ' + sp.rpm : 'OIL COLD · GO EASY';
            }
            case 'gearnum': {
                const d = this.car.data();
                if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
                return isNum(d.gear) && d.gear > 0 ? String(d.gear) : (d.gear === 0 ? 'N' : '-');
            }
            case 'stage': {          // the selector letter alone: P R N, or D / S / M by the shifter programme
                const d = this.car.data();
                return d.stage === 'D' || (!d.stage && isNum(d.gear) && d.gear > 0) ? this._program(d) : (d.stage || '-');
            }
            case 'gearInD': {        // the gear number while driving, else nothing (the M "2D")
                const d = this.car.data();
                return (d.stage === 'D' || (!d.stage && isNum(d.gear))) && isNum(d.gear) && d.gear > 0 ? String(d.gear) : '';
            }
            case 'mode': {
                if (!this.driveMode) return '';
                if (this.driveName) return this.driveName.toUpperCase();
                const base = { sport: 'SPORT', eco: 'HYBRID ECO PRO', electric: 'ELECTRIC', hybrid: 'HYBRID' }[this.driveMode] || 'HYBRID';
                return base + (this.driveVariant === 'plus' ? ' PLUS' : this.driveVariant === 'individual' ? ' INDIVIDUAL' : '');
            }
            case 'modeName': {      // the drive mode as the car's own screens write it: "Hybrid", "Hybrid Eco Pro", "Sport Plus"
                if (!this.driveMode) return '';
                return this.driveName || (MODE_NAME[this.driveMode] || 'Hybrid') + (this.driveVariant === 'plus' ? ' Plus' : this.driveVariant === 'individual' ? ' Individual' : '');
            }
            case 'gear': {
                const d = this.car.data();
                if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
                const g = isNum(d.gear) && d.gear > 0 ? String(d.gear) : '';
                return d.stage === 'D' ? this._program(d) + g : g;
            }
            case 'time': case 'ampm': {
                const now = this._now();
                const h = now.getHours(), m = now.getMinutes();
                if (tok === 'ampm') return this.setting('clock') === '12h' ? (h < 12 ? 'AM' : 'PM') : '';
                if (this.setting('clock') === '24h') return pad2(h) + ':' + pad2(m);
                return ((h % 12) || 12) + ':' + pad2(m);
            }
            default:
                if (tok.indexOf('pc:') === 0) { const v = Number(tok.slice(3)); return us ? String(Math.round(v * 14.5038)) : String(v); }   // a fixed number of bar in the display unit (psi: whole)
                if (tok.indexOf('tc:') === 0) { const v = Number(tok.slice(3)); return String(Math.round(us ? v * 9 / 5 + 32 : v)); }   // a fixed Celsius number in the display unit
                if (tok.indexOf('ms:') === 0) { const v = M_SCALE[us ? 'us' : 'metric'][Number(tok.slice(3))]; return v === undefined ? '' : String(v); }   // the M Blade speed scale labels
                if (tok.indexOf('spd:') === 0) { const v = SPEED_SCALE[us ? 'us' : 'metric'][Number(tok.slice(4))]; return v === undefined ? '' : String(v); }   // speed scale labels
                if (tok.indexOf('temp:') === 0) { const c = Number(tok.slice(5)); return isNum(c) ? String(us ? Math.round((c * 9 / 5 + 32) / 10) * 10 : Math.round(c)) : '--'; }   // gauge labels: °F to the 10
                if (tok.indexOf('setup:') === 0) { const s = this._setup(), v = s ? s[tok.slice(6)] || '' : '--'; return this.config.lang === 'fr' ? SETUP_FR[v] || v : v; }
                if (tok.indexOf('signal:') === 0) { const v = this._raw(tok.slice(7)); return isNum(v) ? (Math.round(v * 10) / 10).toString() : '--'; }
                return '{{' + tok + '}}';
        }
    }

    /**
     * The electric range now, in km: the cluster's own figure (KombiIF displayRangeElectricVehicle) unless the charge says it cannot be.
     * The owner's car showed "93 km" in red at a charge of 9 % (the battery's reserve), where a figure of a few km is what the charge gives: a
     * range over twice a full battery's (the setting "evRangeFull") or over twice the charge's share plus 10 km is dropped, and the charge's
     * share (the charge times a full battery's range) shows in its place. Without the car's figure, the charge's share; without either, null.
     */
    _evRangeNow() {
        const full = this._evRangeFull(), soc = this._raw('hvSoc');
        const est = isNum(soc) ? soc * full / 100 : null;
        const car = isNum(this.carErange) && Date.now() - this.carErangeAt < CAR_ERANGE_MS ? this.carErange : null;
        if (car === null) return est;
        const cap = est === null ? full * 2 : Math.min(full * 2, est * 2 + 10);
        if (car <= cap) { this.evIgnored = null; return car; }
        if (this.evIgnored !== Math.round(car)) {
            this.evIgnored = Math.round(car);
            this.log.warn('electric range from the car ignored: ' + Math.round(car) + ' km at a charge of ' + (isNum(soc) ? Math.round(soc) + ' %' : 'unknown') + ' (most it can be: ' + Math.round(cap) + ' km)');
        }
        return est;
    }
    /** The electric range of a full battery in km: the "evRangeFull" setting, else config.evRangeFull (the car's WLTP figure is 42-50 km, real driving less). */
    _evRangeFull() {
        const s = this.ctx.settings.item('evRangeFull') ? this.setting('evRangeFull') : null;
        return isNum(s) && s > 0 ? s : (this.config.evRangeFull || 40);
    }

    /**
     * The hybrid rev counter's state for a layer that asks for it ("hybridTach"), from the battery's power that eDrive Live shares and the
     * engine's rpm: { kw, engineOff, ev, chg }. ev: the battery alone drives (engine off, power >= 0); chg: 0..1, the power going back into the
     * battery over hybrid_tach's CHARGE_KW. Without any power (shared, the car's own, or the estimated one) nothing is hybrid: ev false, chg 0,
     * so the rpm shows alone.
     */
    _hybridTach(w, rpm) {
        // the cluster themes: the setting "sportPower"; the HUD (ShakHUD): the setting "hybridRev"
        const on = this.target === 'panel' ? this.ctx.settings.item('sportPower') && this.ctx.settings.get('sportPower') !== false
            : this.ctx.settings.item('hybridRev') && this.ctx.settings.get('hybridRev') !== false;
        const flow = w.hybridTach === true && !!on;
        // the power eDrive Live shares, else (the setting "carPower") the car's own share of the motor: with that one, an rpm the car does not send
        // counts as 0 (the engine at rest: the car sends no engine speed then, as far as the owner's photos show), so the blue power shows
        // and last, the power estimated from the speed (setting "estPower", on): the same for an rpm the car does not send
        // between them, the stock cluster's own power meter (setting "relPower", on): a measure of the car, ahead of its share and of the estimate
        const shared = flow ? this.ci.sharedPower() : null, rel = flow && !shared ? this._relPower() : null;
        const own = flow && !shared && !rel ? this._carPower() : null;
        const est = flow && !shared && !rel && !own ? this._estPower() : null, pw = shared || rel || own || est;
        return hybridTach.state(pw && !pw.old ? pw.kw : null, (rel || own || est) && !isNum(rpm) ? 0 : rpm);
    }

    /** The fuel tank's size in litres: the "tankLitres" setting, else config.tankLitres (the car sends litres only). */
    _tankLitres() {
        const s = this.ctx.settings.item('tankLitres') ? this.setting('tankLitres') : null;
        return isNum(s) && s > 0 ? s : (this.config.tankLitres || 65);
    }

    /**
     * Local time. The head unit's clock runs on UTC (issues #6, #8: the clock 5 to 7 hours ahead), so the "timeZone"
     * setting wins (minutes from UTC, or a named zone that follows its own daylight saving: shared/tz.js;
     * TZ_AUTO = the unit's own), then config.utcOffsetMinutes.
     */
    _now() {
        const setting = this.ctx.settings.item('timeZone') ? this.setting('timeZone') : TZ_AUTO;
        const zoned = tz.offset(setting);            // a fixed offset, or a named zone with its daylight saving
        const off = isNum(zoned) ? zoned : this.config.utcOffsetMinutes;
        if (!isNum(off)) return new Date();
        const d = new Date(Date.now() + off * 60000);
        return { getHours: () => d.getUTCHours(), getMinutes: () => d.getUTCMinutes() };
    }

    /**
     * Where sunrise and sunset are worked out (the Auto theme, Night colours): config.location if a layout author set
     * one, else the middle of the zone the "timeZone" setting names (shared/tz.js), else the middle of the US.
     */
    _sunPlace() {
        const c = this.config.location;
        if (c && isNum(c.lat) && isNum(c.lon)) return [c.lat, c.lon];
        const setting = this.ctx.settings.item('timeZone') ? this.setting('timeZone') : TZ_AUTO;
        const p = tz.place(isNum(setting) && setting !== TZ_AUTO ? setting : this.config.utcOffsetMinutes);
        return p ? [p.lat, p.lon] : [tz.FALLBACK.lat, tz.FALLBACK.lon];
    }

    // (a token's argument can be a negative or a decimal number: "{{tc:-20}}" was left as it stood, and only looked right because the scale's font has
    // no braces or letters: it drew "-20" in Fahrenheit too)
    _resolve(template) { return String(template).replace(/\{\{([a-zA-Z0-9:.-]+)\}\}/g, (_, t) => this._token(t)); }

    /* ---------------- layers ---------------- */

    /**
     * Makes the layout again: every layer dropped, then made anew. At most one every REBUILD_MIN_MS while the app runs: a second one asked
     * sooner waits for the rest of that time, and several asked meanwhile make one (the last state wins: a rebuild reads everything afresh).
     * Two rebuilds back to back are what a flicker is made of (a Waze status that hesitates, a danger zone at the edge, a drive mode and a
     * setting changing together), and each one keeps the car's processor for a while. `now`: at once whatever came before (cluster-render
     * is back: nothing of ours is on the screen).
     */
    _rebuild(now) {
        const t = Date.now(), since = t - (this.rebuiltAt || 0);
        if (now !== true && this.started && since >= 0 && since < REBUILD_MIN_MS) {
            if (!this.rebuildT) this.rebuildT = setTimeout(() => { this.rebuildT = null; this._guard('rebuild later', () => this._rebuild(true)); }, REBUILD_MIN_MS - since);
            return;
        }
        clearTimeout(this.rebuildT); this.rebuildT = null;
        if (this.client.ready) this.rebuiltAt = t;
        // every connection holds its writes till the whole new layout is made: the drops, the new layers and their first pixels reach
        // cluster-render together (cluster_render_client.js cork), so it has no time to draw the cluster without the theme in between
        const corked = this.clients.filter((c) => typeof c.cork === 'function' && c.cork());
        try {
            this._guard('rebuild', () => this._rebuildInner());
            // the values of now go out with the layers (a layer kept through the rebuild had its uniforms set to their starting values just above: sent
            // apart, the rev bar would fall to 0 for a frame)
            const t0 = Date.now();
            if (this.client.ready && this.widgets) this.widgets.forEach((x) => this._guard('widget ' + x.w.id, () => this._update(x, t0, true)));
        } finally { corked.forEach((c) => { try { c.uncork(); } catch (e) { /* a socket gone meanwhile */ } }); }
        this._status();
    }

    _rebuildInner() {
        if (!this.client.ready) return; // the 'ready' handler calls us again
        // the layers on the screen now: those the new layout has just the same are kept (_keepLayers), the others dropped once the new plan is
        // known. After a refusal everything is made anew (a layer cluster-render refused is not there to be kept).
        this.oldLayers = this.live || new Map();
        this.live = new Map();
        if (this.refused) this._dropOld();
        this.placed = [];
        this.widgets.clear();
        this.sheets = [];
        this.pixelBytes = 0;
        this.layerStates.clear();
        this.stallTimers.forEach((t) => clearTimeout(t)); this.stallTimers.clear();
        if (!this.refused) this.refusedTries = 0;        // the layout before this one went through whole (see _retryRefused)
        this.refused = null;
        clearTimeout(this.statusAskT); this.statusAskT = null;
        this.car.setRedline(this.setting('redline'));
        const name = this._layoutName();
        this.activeName = name;
        this.mapLayout = false;
        this.dangerLayout = false;
        this.powerLayout = false;
        this.windowRect = null;
        this.mapPlace = false;
        this.mapShown = this.setting('mapUp');
        if (name === 'off') {
            this._wazeWant();
            this.problem = null; this.layoutTheme = null; this.needsBoost = false; this.needsIntake = false; this.needsHv = false; this.needsFuel = false;
            this.log.info('off: nothing drawn, BMW\'s own ' + (this.target === 'panel' ? 'cluster' : 'HUD') + ' shows');
            this._dropOld();
            return;
        }
        let layout;
        try { layout = this.layouts.load(name); } catch (e) {
            this.problem = e.message;
            this.log.warn('layout "' + name + '" unusable (' + e.message + '); showing nothing');
            this._wazeWant();
            this._dropOld();
            return;
        }
        this.problem = null;
        this.mapLayout = layout.widgets.some((w) => w.holeWhen === 'mapUp');
        this.layoutViews = viewsOf(layout.widgets);
        if (this.viewNow !== null && this.viewNow !== 'none' && this.layoutViews.indexOf(this.viewNow) < 0) this.viewNow = null;      // this theme doesn't have it
        this.dangerLayout = layout.widgets.some((w) => /^!?danger/.test(w.toggle || ''));
        this.driveLayout = layout.widgets.some((w) => /(^|&)!?driveSport(&|$)/.test(w.toggle || ''));
        this.driveShown = this.driveMode === 'sport';
        this.dangerShown = this._dangerKey();
        this.powerLayout = layout.widgets.some((w) => w.toggle === 'power' || w.toggle === 'powerShut' || w.toggle === 'powerOpen' || w.toggle === 'boostShown');
        this.powerShown = this._powerKey();
        this.windowRect = this._windowRectOf(layout);
        this.mapPlace = layout.widgets.some((w) => w.holeWhen === 'mapUp' && w.mapPlace === true);
        // (a layout without a window can't have it open for Cluster Centre; the map flag is re-read for this layout)
        if (this.windowOpen && !this.windowRect) this.windowOpen = false;
        this.mapShown = this.setting('mapUp');
        this._wazeWant();
        this.layoutSlots = layout.slots || [];
        this.layoutTheme = layout.theme && THEMES[layout.theme] ? layout.theme : null;
        this.runUp = layout.runUp !== false;
        this.zoneRed = layout.zoneRed !== false;
        // the start-up sweep: once for each layout that shows (a Waze map opening or a setting changing rebuilds the same one: no sweep)
        if (name !== this.sweptName) {
            this.sweptName = name;
            const on = !this.ctx.settings.item('startupSweep') || this.setting('startupSweep') !== false;
            this.sweepAt = on ? Date.now() + SWEEP_WAIT_MS : null;
        }
        this.accentLayout = layout.widgets.some((w) => !!shaders.ACCENT_LITERALS[w.type]);
        this.accentHue = this._accentHue();
        this.themeName = this._themeName();
        this.theme = accentTheme(THEMES[this.themeName] || THEMES.classic, ACCENT_ROLES[this.themeName], this.accentHue);
        this.nightOn = this._nightDim();
        if (this.nightOn) this.theme = dimTheme(this.theme, NIGHT_DIM);
        this.log.info('layout "' + layout.name + '", theme ' + this.theme.name + (this.layoutTheme ? '' : ' (' + this.setting('hudTheme') + ')'));
        this.gearWin = this._gearWindow(name);   // the hole over BMW's gear letter (before _stripOn: it wins over the strip option)
        this._avoid = this.gearWin;              // _plan keeps every sheet off it
        const stripOn = this._stripOn();         // BMW's bottom strip left clear: no row it already shows, a black band under the theme
        let shown = layout.widgets.filter((w) => !(w.toggle && !this._toggleOn(w.toggle)) && !(w.themes && w.themes.indexOf(this.themeName) < 0)
            && !(stripOn && bottomStrip.duplicates(w.id)));
        if (stripOn) bottomStrip.band().forEach((b) => shown.push(b));
        if (this.gearWin) {
            const g = gearWindow.apply(shown, this.gearWin, (t) => !!IMAGE_TYPES[t]);
            shown = g.widgets;
            this.log.info('gear window ' + this.gearWin.id + ' (x ' + this.gearWin.x + '..' + (this.gearWin.x + this.gearWin.w) + ', y ' + this.gearWin.y + '..' + (this.gearWin.y + this.gearWin.h) + '): ' +
                g.cropped.length + ' backdrop(s) cut at y ' + this.gearWin.y + (g.pieces.length ? ', ' + g.pieces.length + ' bottom pieces' : '') + (g.dropped.length ? ', left out: ' + g.dropped.join(' ') : '') + (g.nudged.length ? ', moved: ' + g.nudged.join(' ') : ''));
        }
        this.shown = shown;              // for a scale to find its rev bar (driver camera wings)
        this.hybridEv = false; this.hybridCharge = false; this.hybridPow = null;   // the bar of this layout says again
        this.nearLabels = {};            // the scale labels this layout has, per kind ("near"): the needle lights the last one it has reached
        shown.forEach((w) => { if (w.near) (this.nearLabels[w.near[0]] = this.nearLabels[w.near[0]] || []).push(w.near[1]); });
        Object.keys(this.nearLabels).forEach((k) => this.nearLabels[k].sort((a, b) => a - b));
        this._setNeeds(shown);
        // plan the layers first (a sheet's size is only known once every member is placed), then make them
        // in that order: within a class and z, cluster-render puts the newer layer on top. Small sheets
        // first; a bigger limit only when the layer budget needs it (see the header).
        const area = this.size[0] * this.size[1];
        const over = (p) => this._connCounts(p).some((k) => k > LAYER_BUDGET);
        // a layout's "packWaste" (the Nov 7 2026 themes): a widget joins a sheet only while the sheet's box stays within
        // that many times its members' own area, so far-apart readouts don't share one mostly empty sheet (pixel
        // memory); relaxed along with the size limit when the layer budget needs it. Without it: the size limit only.
        let waste = isNum(layout.packWaste) ? layout.packWaste : Infinity;
        if (this.gearWin) {
            // the two pieces of the backdrop under the theme (or the two black bands) go on the least used connections (each connection holds 8 layers)
            const covers = shown.filter((w) => w.follow || /^gw_cover/.test(w.id));
            const used = this._connCounts(this._plan(shown.filter((w) => covers.indexOf(w) < 0), Math.floor(area / SHEET_AREA_FRAC), waste));
            covers.forEach((w) => {
                let ci = 0;
                for (let i = 1; i < MAX_CONN; i++) if ((used[i] || 0) < (used[ci] || 0)) ci = i;
                w.conn = ci; used[ci] = (used[ci] || 0) + 1;
            });
        }
        let maxPx = Math.floor(area / SHEET_AREA_FRAC), plan = this._plan(shown, maxPx, waste);
        while (over(plan) && (maxPx !== Infinity || waste !== Infinity)) {
            maxPx = maxPx * 2 >= area ? Infinity : maxPx * 2;
            waste = waste * 2 > 64 ? Infinity : waste * 2;
            plan = this._plan(shown, maxPx, waste);
        }
        if (this.gearWin) this._balance(plan);
        const kept = this._keepLayers(plan, name);
        let effects = 0, own = 0, sheets = 0, bytes = 0, px = 0;
        plan.forEach((e) => {
            this.reuse = e.kind === 'sheet' ? null : (e.reuse || null); this.reuseSig = e.sig;
            if (e.kind === 'sheet') {
                sheets++; bytes += e.w * e.h * 4; px += e.w * e.h * 8; this._guard('sheet ' + e.members[0].id, () => this._createSheet(e));
                // what each sheet costs (the car's own log then says which sheet to shrink when its pixel memory runs out)
                this.log.info('  sheet ' + e.w + 'x' + e.h + ' at ' + e.x + ',' + e.y + ' on connection ' + ((e.conn || 0) + 1) + ': ' + mib(e.w * e.h * 8) + ', ' + e.members.length + ' widgets (' +
                    e.members.slice(0, 24).map((m) => m.id).join(' ') + (e.members.length > 24 ? ' ...' : '') + ')');
            }
            else {
                if (IMAGE_TYPES[e.w.type]) { own++; px += e.w.w * e.w.h * 8; } else effects++;
                this._guard('widget ' + e.w.id, () => this._create(e.w, null));
            }
        });
        if (this._offset().x || this._offset().y || this._scale() !== 1 || this._stripSy() !== 1) this._place();
        const atlasBytes = this._atlasBytes();
        px += atlasBytes;
        this.pixelBytes = px;
        const n = this._layerRefs().length, counts = this._connCounts(plan);
        this.log.info('layout "' + layout.name + '": ' + shown.length + ' widgets, ' + this._layerCount(n) + ' (' + effects + ' effects, ' +
            sheets + ' image sheets' + (own ? ', ' + own + ' own image layers' : '') + ')' +
            (counts.length > 1 ? ' on ' + counts.length + ' connections (' + counts.join(' + ') + ')' : '') + ', sheet limit ' +
            (maxPx === Infinity ? 'unlimited' : maxPx + ' px') + ', ' + kept + ' layers kept from before, whole-sheet writes ' + bytes + ' bytes, pixel memory ' + mib(px) + ' of 16 MiB' +
            (atlasBytes ? ' (' + this.atlases.size + ' glyph atlas' + (this.atlases.size > 1 ? 'es' : '') + ' ' + mib(atlasBytes) + ')' : ''));
        counts.forEach((k, ci) => {
            if (k > LAYER_BUDGET) this.log.warn('layout "' + layout.name + '" needs ' + k + ' layers on connection ' + (ci + 1) + ', cluster-render draws at most ' + LAYER_BUDGET + ' per connection');
        });
        if (px > PIXEL_BYTES) this.log.warn('layout "' + layout.name + '" needs ' + mib(px) + ' of pixel memory; cluster-render has 16 MiB for every app together (each image counts twice)');
        this.statusAskT = setTimeout(() => { this.statusAskT = null; this._guard('status request', () => this.client.status()); }, STATUS_ASK_MS);
    }

    /** Drops what is left of the layers of the layout before (those the new one did not keep). */
    _dropOld() {
        const old = this.oldLayers;
        this.oldLayers = null;
        if (old) old.forEach((l) => l.c.drop(l.ref));
    }

    /**
     * Which layers of the layout before stay as they are. A rebuild used to drop every layer and make them all again; on the car the image
     * sheets (every text and icon) then take about a quarter of a second to come back: the whole cluster blinked at each change of view, each
     * Waze map opening, each danger alert (owner's video of Nov 19 2026). Now a layer the new plan has just the same (the same widgets at the
     * same place on the same connection, for an effect the same shader) keeps its layer: its uniforms and its texts are set again by the usual
     * path and only what differs is sent. Only the layers that really change are dropped (first, so the connection's 8 layers are never
     * exceeded) and made.
     * The stacking is kept: within a class and z cluster-render puts a newer layer on top, so a kept layer that should lie over a new one of
     * its class and z it overlaps is made anew too. Marks each entry of `plan` (e.sig, e.reuse: the ref kept); returns how many are kept.
     */
    _keepLayers(plan, name) {
        const old = this.oldLayers || new Map();
        const bySig = new Map();
        old.forEach((l, key) => { if (!bySig.has(l.sig)) bySig.set(l.sig, key); });
        const box = (m) => [m.x, m.y, m.w, m.h].join(',');
        const info = plan.map((e) => {
            if (e.kind === 'sheet') {
                e.sig = ['S', name, e.conn || 0, e.klass, e.z, box(e), e.members.map((m) => m.id + '@' + box(m)).join(' ')].join('|');
                return { klass: e.klass, z: e.z, r: e };
            }
            const w = e.w, fx = IMAGE_TYPES[w.type] ? '' : (w.type === 'swatch' ? 'swatch' : w.type + '/' + this.accentHue);
            e.sig = ['W', name, this._connOf(w), fx, JSON.stringify(w)].join('|');
            return { klass: w.class || 'content', z: w.z || 0, r: w.rect || w };
        });
        plan.forEach((e) => {
            const key = bySig.get(e.sig);
            e.reuse = null;
            if (key === undefined) return;
            bySig.delete(e.sig);
            e.reuse = old.get(key); e.reuseKey = key;
        });
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        for (let again = true; again;) {
            again = false;
            plan.forEach((e, i) => {
                if (!e.reuse) return;
                for (let j = 0; j < i; j++) {
                    if (!plan[j].reuse && info[j].klass === info[i].klass && info[j].z === info[i].z && hit(info[j].r, info[i].r)) { e.reuse = null; again = true; return; }
                }
            });
        }
        let kept = 0;
        plan.forEach((e) => { if (e.reuse) { old.delete(e.reuseKey); kept++; } });
        this._dropOld();
        return kept;
    }

    /**
     * The gear window splits sheets (a sheet's box must not cover the hole), which can push a connection over its LAYER_BUDGET layers: whole
     * image sheets move to the least used connection until none is over (nothing moves when every connection is full: the warning stays).
     * Image sheets only: an effect layer keeps the connection its widget asks for.
     */
    _balance(plan) {
        for (let guard = 0; guard < 64; guard++) {
            const counts = this._connCounts(plan);
            while (counts.length < MAX_CONN) counts.push(0);
            const from = counts.findIndex((k) => k > LAYER_BUDGET);
            if (from < 0) return;
            let to = 0;
            counts.forEach((k, i) => { if (k < counts[to]) to = i; });
            if (counts[to] >= LAYER_BUDGET) return;
            const moved = plan.filter((e) => e.kind === 'sheet' && e.conn === from).sort((a, b) => a.w * a.h - b.w * b.h)[0];
            if (!moved) return;
            moved.conn = to;
            this.log.info('  sheet ' + moved.members[0].id + ' moved from connection ' + (from + 1) + ' to ' + (to + 1) + ' (the gear window split sheets: ' + counts[from] + ' layers there, at most ' + LAYER_BUDGET + ')');
        }
    }

    /**
     * The layers of a layout, in the order to make them: { kind: 'layer', w } for an effect or an "own"
     * image widget, { kind: 'sheet', klass, z, x, y, w, h, members } for a packed image layer. Widgets are
     * taken in file order; an image widget joins the first sheet of its (class, z) group that was opened
     * after every earlier entry of that group its rect intersects (so what overlaps it stays under it, as
     * file order says) and whose union box with it stays within maxPx pixels, else a new sheet is opened
     * at the end.
     */
    _plan(widgets, maxPx, waste) {
        if (!isNum(waste)) waste = Infinity;
        const plan = [];
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const union = (s, w) => {
            const x = Math.min(s.x, w.x), y = Math.min(s.y, w.y);
            return { x, y, w: Math.max(s.x + s.w, w.x + w.w) - x, h: Math.max(s.y + s.h, w.y + w.h) - y };
        };
        widgets.forEach((w) => {
            const klass = w.class || 'content', z = w.z || 0, conn = this._connOf(w);
            if (!IMAGE_TYPES[w.type] || w.own === true) { plan.push({ kind: 'layer', w, klass, z, conn }); return; }
            // "sheet": "<name>" (tools/pack_sheets.py): the layout says which widgets share a sheet, so the memory a theme needs
            // is the sum of tight boxes, not of whatever the file order and the size limit made of it; only keyed widgets
            // of the same name join one (the size limit and "packWaste" don't apply to them)
            const key = typeof w.sheet === 'string' && w.sheet ? w.sheet : null;
            let after = -1;
            plan.forEach((e, i) => {
                if (e.klass !== klass || e.z !== z || e.conn !== conn) return;
                if (e.kind === 'layer' ? hit(e.w, w) : e.members.some((m) => hit(m, w))) after = i;
            });
            let sheet = null, box = null;
            for (let i = after + 1; i < plan.length && !sheet; i++) {
                const s = plan[i];
                if (s.kind !== 'sheet' || s.klass !== klass || s.z !== z || s.conn !== conn || (s.key || null) !== key) continue;
                const u = union(s, w);
                if (this._avoid && hit(u, this._avoid)) continue;      // a sheet's box must not cover the gear letter's hole
                const own = s.members.reduce((a, m) => a + m.w * m.h, 0) + w.w * w.h;
                if (key || (u.w * u.h <= maxPx && u.w * u.h <= waste * own)) { sheet = s; box = u; }
            }
            if (!sheet) { sheet = { kind: 'sheet', key, klass, z, conn, x: w.x, y: w.y, w: w.w, h: w.h, members: [], ref: 0, c: null, ci: conn, buf: null }; plan.push(sheet); }
            else { sheet.x = box.x; sheet.y = box.y; sheet.w = box.w; sheet.h = box.h; }
            sheet.members.push(w);
        });
        return plan;
    }

    /** One image layer for a sheet: every member painted into a local buffer, then sent whole once. */
    _createSheet(s) {
        const c = this._clientAt(s.conn);
        const ref = s.reuse ? s.reuse.ref : c.image({ target: this.target, klass: s.klass, z: s.z, x: s.x, y: s.y, w: s.w, h: s.h, iw: s.w, ih: s.h });
        if (ref && this.live) this.live.set((s.conn || 0) + ':' + ref, { c, ref, sig: s.sig });
        if (!ref) { this.log.warn('sheet ' + s.klass + '/' + s.z + ' at ' + s.x + ',' + s.y + ' ' + s.w + 'x' + s.h + ': layer refused'); return; }
        s.ref = ref; s.c = c; s.ci = s.conn;
        this.placed.push({ c, ref, x: s.x, y: s.y, w: s.w, h: s.h });
        s.buf = Buffer.alloc(s.w * s.h * 4, 0);
        this.sheets.push(s);
        s.members.forEach((w) => this._guard('widget ' + w.id, () => this._create(w, s)));
        const buf = s.buf;
        s.buf = null;                    // from here on _blit sends dirty rects
        c.pixels(ref, null, buf);
    }

    /**
     * Every pixel painter goes through here: the widget's pixels (rects in the widget's own px, or null for
     * the whole widget) to its own layer, or into its sheet: the local buffer while the sheet is being
     * filled on create, else dirty rects translated by the sheet's offset.
     */
    _blit(x, rects, buf) {
        const w = x.w, s = x.sheet;
        if (!s) { x.c.pixels(x.ref, rects, buf); return; }
        const rs = rects && rects.length ? rects : [{ x: 0, y: 0, w: w.w, h: w.h }];
        const dx = w.x - s.x, dy = w.y - s.y;
        const moved = rs.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
        if (!s.buf) { s.c.pixels(s.ref, moved, buf); return; }
        let off = 0;
        moved.forEach((r) => {
            for (let y = 0; y < r.h; y++) {
                buf.copy(s.buf, ((r.y + y) * s.w + r.x) * 4, off, off + r.w * 4);
                off += r.w * 4;
            }
        });
    }

    /**
     * A whole repaint of an image widget: the first time (or while its sheet is being filled) the whole widget
     * goes up; after that only the one rectangle around the pixels that changed, or nothing at all.
     */
    _blitDiff(x, buf) {
        const w = x.w, was = x.px;
        x.px = buf;
        if (!was || (x.sheet && x.sheet.buf)) { this._blit(x, null, buf); return; }
        const c = changes(was, buf, w.w, w.h);
        if (c) this._blit(x, [c.rect], c.px);
    }

    /** Waze on Cluster says its map is showing (status.json state "showing", fresh), wherever it draws it. Read once a second. */
    _wazeShowing(now) {
        if (this._wzAt !== undefined && now >= this._wzAt && now - this._wzAt < 1000) return this._wz === true;      // (not for as long as a clock set back went back)
        this._wzAt = now;
        let on = false;
        try {
            const f = process.env.WAZE_STATUS || '/run/waze-on-cluster/status.json';
            if (Date.now() - fs.statSync(f).mtime.getTime() < 10000) on = JSON.parse(fs.readFileSync(f, 'utf8')).state === 'showing';
        } catch (e) { on = false; }
        this._wz = on;
        return on;
    }

    /** "key" is on while that bool setting is on; "!key" while it is off; "a&!b" while every one of them is (a bar shown only without the map window). */
    _toggleOn(t) {
        if (t.indexOf('&') > 0) return t.split('&').every((p) => this._toggleOn(p));
        const not = t.charAt(0) === '!';
        const k = not ? t.slice(1) : t, eq = k.indexOf('=');
        const on = eq > 0 ? String(this.setting(k.slice(0, eq))) === k.slice(eq + 1) : this.setting(k) !== false;
        return not ? !on : on;
    }

    /** A widget: on its own layer (sheet null: an effect, or an image widget with "own": true), or a member of a sheet. */
    _create(w, sheet) {
        let ref, c;
        if (sheet) { ref = sheet.ref; c = sheet.c; }
        else {
            c = this._clientAt(this._connOf(w));
            // "rect": the layer shows only that part of the widget (the gear window cuts a backdrop into pieces, shared/gear_window.js); the widget keeps its
            // own x, y, w, h for every uniform, and the four backdrop shaders read u_rect / u_org to know which part of the picture the layer holds
            const r = w.rect || w;
            const base = { target: this.target, klass: w.class || 'content', z: w.z || 0, x: r.x, y: r.y, w: r.w, h: r.h };
            const keep = this.reuse; this.reuse = null;
            if (keep) ref = keep.ref;                                   // the same layer as before the rebuild (_keepLayers)
            else if (IMAGE_TYPES[w.type]) ref = c.image(Object.assign({ iw: w.w, ih: w.h }, base));
            else ref = c.effect(Object.assign({ fs: w.type === 'swatch' ? calibration.SWATCH : shaders.accented(w.type, this.accentHue) }, base));
            if (ref && this.live) this.live.set(this._connOf(w) + ':' + ref, { c, ref, sig: this.reuseSig });
            if (!ref) { this.log.warn('widget "' + w.id + '": layer refused'); return; }
            this.placed.push({ c, ref, x: r.x, y: r.y, w: r.w, h: r.h, fixed: !!w.fixed });
        }
        const x = { w, ref, c, ci: sheet ? sheet.ci : this._connOf(w), sheet: sheet || null, last: null, lastPaint: 0, px: null };
        this.widgets.set(w.id, x);
        const t = this.theme;
        if (w.type === 'atext') {
            const a = this._atlas(w.font, x.ci);
            x.atlas = a;
            x.cells = Math.max(1, Math.min(32, isNum(w.cells) ? Math.floor(w.cells) : Math.floor(w.w / a.cellW)));
            c.bind(ref, 'u_font', a.ref);
            c.uniform(ref, 'u_cells', [x.cells]);
            c.uniform(ref, 'u_grid', [a.cols, a.rows]);
            c.uniform(ref, 'u_color', rgba(color(t, w.color || 'fg')));
            c.uniform(ref, 'u_text', this._atlasCodes(x, ''), { type: 'vec4' });
            if (w.w !== x.cells * a.cellW || w.h !== a.cellH) {
                this.log.info('widget "' + w.id + '": ' + x.cells + ' cells of ' + (w.w / x.cells).toFixed(1) + 'x' + w.h +
                    ' px; the glyphs keep their shape at w ' + x.cells * a.cellW + ', h ' + a.cellH);
            }
        } else if (w.type === 'gridlabels') this._paintGridLabels(x);
        else if (w.type === 'icon') this._blit(x, null, paintIcon(w.icon, w.w, w.h, color(t, w.color || 'fg')));
        else if (w.type === 'emblem') {
            // the picked lettering ("setting": the choice setting that names it, "off" = none), hidden while the Waze map is up in the theme
            const name = String(this.setting(w.setting || 'emblem') || 'off');
            const mask = name === 'off' || (this.setting('mapUp') === true && !w.keepWithMap) || !/^[a-z0-9_]+$/i.test(name) ? null : hudData.json('emblems/' + name + '.json');
            this._blit(x, null, paintEmblem(mask, w.w, w.h, w.stops));
        }
        else if (w.type === 'sdash') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_geo', w.geo);
            c.uniform(ref, 'u_k', w.k);
            c.uniform(ref, 'u_w', [w.band]);
            c.uniform(ref, 'u_inner', [w.inner || w.band + 18]);
            c.uniform(ref, 'u_scale', w.scale || [w.geo[2], w.geo[0]]);
            c.uniform(ref, 'u_ticks', w.ticks);
            const [redFrom, orange] = this._redMarks(w.rpmMax || 8000);
            c.uniform(ref, 'u_redFrom', [redFrom]);
            c.uniform(ref, 'u_orange', [orange]);
            c.uniform(ref, 'u_hy', [0, 0, 0, 0]);
            c.uniform(ref, 'u_zone', [0, 0]);
            c.uniform(ref, 'u_peak', [0]);
            c.uniform(ref, 'u_fuelSeg', w.fuelSeg);
            c.uniform(ref, 'u_oilSeg', w.oilSeg);
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_strip', w.strip);
            c.uniform(ref, 'u_topEnd', [w.topEnd]);
            c.uniform(ref, 'u_tint', [this._tint() * (isNum(w.tintScale) ? Math.max(0, w.tintScale) : 1)]);      // a layout's "tintScale": its share of the setting
            c.uniform(ref, 'u_facets', [this._facets()]);
            c.uniform(ref, 'u_slotOff', [this._slotOff()]);
        } else if (w.type === 'mblade') {
            // the M Blade theme (shaders.js mblade): geometry in panel px from the layout, see the widget notes in the header
            const [redFrom, orange] = this._redMarks(w.rpmMax || 7000);
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_hex', w.hex || [0, 0, 0, 0]);
            const sy = w.sy || [0, 0, 0];
            c.uniform(ref, 'u_sp', w.sp || [0, 0, 0, 0]);
            c.uniform(ref, 'u_sq', w.sq ? [w.sq[0], w.sq[1], w.sq[2], 0] : [0, 0, 0, 0]);
            c.uniform(ref, 'u_sy', [sy[0], sy[1], sy[2], 5 / 8]);
            c.uniform(ref, 'u_speed', [0]);
            c.uniform(ref, 'u_bl', w.bl);
            c.uniform(ref, 'u_br', w.br);
            c.uniform(ref, 'u_bx', w.bx);
            c.uniform(ref, 'u_sc', w.scale);
            c.uniform(ref, 'u_g0', w.g0);
            c.uniform(ref, 'u_fh', [w.fuelH ? 1 : 0]);
            c.uniform(ref, 'u_g1', w.g1);
            c.uniform(ref, 'u_g2', w.g2);
            c.uniform(ref, 'u_gv', [0, 0, 0]);
            c.uniform(ref, 'u_oc', rgb(VERDICT['SPOT ON']));
            c.uniform(ref, 'u_deco', [w.deco ? 1 : 0]);
            c.uniform(ref, 'u_ticks', [(w.rpmMax || 7000) / 1000]);
            c.uniform(ref, 'u_value', [0]);
            c.uniform(ref, 'u_orange', [orange]);
            c.uniform(ref, 'u_redFrom', [redFrom]);
            c.uniform(ref, 'u_zone', [0, 0]);
            c.uniform(ref, 'u_peak', [0]);
            c.uniform(ref, 'u_red', [0.97, 0.98, 1.0, 0]);
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_tint', [this._tint() * (isNum(w.tintScale) ? Math.max(0, w.tintScale) : 1)]);      // a layout's "tintScale": its share of the setting
            c.uniform(ref, 'u_facets', [this._facets()]);
        } else if (VIEW_PANEL[w.type]) {
            // M Blade's view panel (shaders.js mpanel): "shape" [x, y of the point, the sides' slope, the band's width], "bar" [left x, right x],
            // "rows" [{ y, signal, min, max, red, tone }] (up to four), "div" (marks), all in panel px
            // The other themes' card (shaders.js vcard) takes the same rows, bars and tyres; in place of "shape": "card" [skew, corner radius, accent bar
            // width], "glass" and "edge" (two colours, 0..1). Both: "lean" (the bars', 0.5) and "rule" (the line between rows, px above a bar: 47).
            const sh = w.shape || [0, 0, 0, 1], rows = (w.rows || []).slice(0, 4), pad = (f, d) => [0, 1, 2, 3].map((i) => (rows[i] ? f(rows[i]) : d));
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_pan', [sh[1] - w.y, sh[2], sh[3], sh[0] - w.x]);
            c.uniform(ref, 'u_lean', [isNum(w.lean) ? w.lean : 0.5]);
            c.uniform(ref, 'u_rule', [isNum(w.rule) ? w.rule : 47]);
            if (w.type === 'vcard' || w.type === 'sring' || w.type === 'nline') {     // (nline, Navi's thin lines: "card" is [the step's x, its height, 0])       // (sring, Sport's round gauges: "card" is [radius, thickness, the tyres' frame's cut corner])
                c.uniform(ref, 'u_card', w.card || [0, 16, 0]);
                c.uniform(ref, 'u_ca', w.glass || [0.03, 0.09, 0.27]);
                c.uniform(ref, 'u_cb', w.edge || [0.45, 0.65, 1.0]);
            }
            c.uniform(ref, 'u_bx', w.bar ? [w.bar[0] - w.x, w.bar[1] - w.x] : [0, 1]);
            c.uniform(ref, 'u_ry', pad((r) => r.y - w.y, -1));
            c.uniform(ref, 'u_rz', pad((r) => (isNum(r.red) ? r.red : 2), 2));
            c.uniform(ref, 'u_v', [0, 0, 0, 0]);
            c.uniform(ref, 'u_tone', [0, 0, 0, 0]);
            c.uniform(ref, 'u_div', [w.div || 2]);
            // "seg": each bar's segments (24); "mode": "tyres" draws the car from above with "tiles" [left x, right x, front y, rear y] (the plates' middles)
            c.uniform(ref, 'u_seg', [w.seg || 24]);
            c.uniform(ref, 'u_mode', [w.mode === 'tyres' ? 1 : 0]);
            c.uniform(ref, 'u_wh', [0, 0, 0, 0]);
            if (w.mode === 'tyres' && w.tiles) {
                c.uniform(ref, 'u_bx', [w.tiles[0] - w.x, w.tiles[1] - w.x]);
                c.uniform(ref, 'u_ry', [w.tiles[2] - w.y, w.tiles[3] - w.y, -1, -1]);
            }
        } else if (w.type === 'navi') {
            const B = w.band, L = w.line, L2 = w.line2;
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_L', [B.tip[0], B.tip[1], B.slope, B.bottom]);
            c.uniform(ref, 'u_W', [B.sep[0], B.sep[1], B.edge[0], B.edge[1]]);
            c.uniform(ref, 'u_top', [B.top]);
            c.uniform(ref, 'u_sc', w.scale || [236, B.bottom]);
            c.uniform(ref, 'u_speed', [0]);
            c.uniform(ref, 'u_rev', [0]);
            c.uniform(ref, 'u_zone', [0, 0]);
            c.uniform(ref, 'u_peak', [0]);
            c.uniform(ref, 'u_redFrom', [2]);
            c.uniform(ref, 'u_orange', [2]);
            c.uniform(ref, 'u_hy', [0, 0, 0, 0]);
            c.uniform(ref, 'u_ln', L);
            c.uniform(ref, 'u_ln2', L2);
            c.uniform(ref, 'u_barL', [w.barL[0], w.barL[1], w.barL[2], 0]);
            c.uniform(ref, 'u_barR', [w.barR[0], w.barR[1], w.barR[2], 0]);
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_tint', [this._tint() * (isNum(w.tintScale) ? Math.max(0, w.tintScale) : 1)]);      // a layout's "tintScale": its share of the setting
            c.uniform(ref, 'u_facets', [this._facets()]);
            c.uniform(ref, 'u_slotOff', [this._slotOff()]);
        } else if (w.type === 'mdash') {
            const ty = w.tyres || [0, 0, 0], L = w.gaugeL || {}, R = w.gaugeR || {}, b = w.blade || {};
            const bars = Array.isArray(w.segbars) ? w.segbars.slice(0, 4) : [];
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_card', w.card || [0, 0, 0, 0]);
            c.uniform(ref, 'u_cardTop', w.cardTop || [0, 0, -99999]);
            c.uniform(ref, 'u_cardCutR', w.cardCutR || [0, 0, 0]);
            c.uniform(ref, 'u_cardFill', [isNum(w.cardFill) ? w.cardFill : 0]);
            c.uniform(ref, 'u_blade', [isNum(b.xm) ? b.xm - w.x : 99999, (b.ym || 0) - w.y, b.kTop || 0, b.kBot || 0]);
            c.uniform(ref, 'u_bladeB', [b.round || 40, isNum(w.bladeGap) ? w.bladeGap : 14]);
            c.uniform(ref, 'u_line', w.line || [0, -99, 0, 1]);
            c.uniform(ref, 'u_tyre', [ty[0] - w.x, ty[1] - w.y, ty[2] || 0]);
            c.uniform(ref, 'u_tyreLv', [0, 0, 0, 0]);
            c.uniform(ref, 'u_mark', w.mark && !this._cameraOn() ? w.mark : [0, 0, 0]);   // no M stripes where the driver camera sits
            c.uniform(ref, 'u_red', rgb(t.hot));
            [0, 1, 2, 3].forEach((i) => {
                const s = bars[i];
                c.uniform(ref, 'u_seg' + i, s ? [s.x - w.x, s.y - w.y, s.w, s.h] : [0, 0, 0, 0]);
            });
            c.uniform(ref, 'u_segMax', [0, 1, 2, 3].map((i) => (bars[i] && bars[i].max) || 1));
            c.uniform(ref, 'u_segSlant', [isNum(w.segSlant) ? w.segSlant : 9]);
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            // the plate under the cut window (the gear and the speed on it): only while the window is cut, as the hole
            const pl = Array.isArray(w.plate) && w.plate.length === 5 && w.plate.every(isNum) && this._hole(w)[2] > 0 ? w.plate : null;
            c.uniform(ref, 'u_plate', pl ? [pl[0] - w.x, pl[1] - w.y, pl[2], pl[3]] : [0, 0, 0, 0]);
            c.uniform(ref, 'u_split', [pl ? pl[4] - w.x : 0]);
            x.gauges = [['u_gaugeL', L], ['u_gaugeR', R]];
            x.bars = bars;
        } else if (w.type === 'mtach') {
            const max = w.max || 8000, [redFrom, orange] = this._redMarks(max);
            const right = w.side === 'right';
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_side', [right ? 1 : -1]);
            c.uniform(ref, 'u_geoA', [w.y0 - w.y, w.y8 - w.y, w.ym - w.y, right ? w.x + w.w - w.xm : w.xm - w.x]);
            c.uniform(ref, 'u_geoB', [w.kTop, w.kBot, w.round || 40]);
            c.uniform(ref, 'u_wid', [w.wBot, w.wTop, w.wBend || 0]);
            c.uniform(ref, 'u_ticks', [max / 1000]);
            c.uniform(ref, 'u_orange', [orange]);
            c.uniform(ref, 'u_redFrom', [redFrom]);
            c.uniform(ref, 'u_red', rgb(t.hot));
            c.uniform(ref, 'u_zone', [0]);
            c.uniform(ref, 'u_peak', [0]);
        }
        else if (w.type === 'grid') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_step', [w.step || 50]);
            c.uniform(ref, 'u_major', [w.major || 2]);
            c.uniform(ref, 'u_minor', rgba([255, 255, 255, 90]));
            c.uniform(ref, 'u_majorC', rgba([0, 255, 140, 255]));
        } else if (w.type === 'stripe') this._paintStripe(x);
        else if (w.type === 'scale') this._paintScale(x);
        else if (w.type === 'shiftbar') {
            const max = this._barMax(), red = this.setting('redline');
            const midAt = t.bar.midAt === 'shift' ? (red - 1500) / max : t.bar.midAt;
            c.uniform(ref, 'u_size', [w.w, w.h]);
            const wg = this._wings(w);         // driver camera wings: half the segments on each side
            c.uniform(ref, 'u_segs', [wg ? Math.round((w.segments || 40) / 2) : w.segments || 40]);
            c.uniform(ref, 'u_skip', wg ? [wg.s, wg.e] : [0, 0]);
            c.uniform(ref, 'u_low', rgb(t.bar.low));
            c.uniform(ref, 'u_mid', rgb(t.bar.mid));
            c.uniform(ref, 'u_high', rgb(t.bar.high));
            c.uniform(ref, 'u_midAt', [midAt]);
            c.uniform(ref, 'u_highAt', [(red - 500) / max]);
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_flash', [0]);
        } else if (w.type === 'dial') {
            const D = this._dialScale(w);
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_start', [(w.start === undefined ? 225 : w.start) * Math.PI / 180]);
            c.uniform(ref, 'u_sweep', [(w.sweep === undefined ? 270 : w.sweep) * Math.PI / 180]);
            c.uniform(ref, 'u_ticks', [D.ticks]);
            c.uniform(ref, 'u_minor', [w.minor || 4]);
            c.uniform(ref, 'u_redFrom', [w.measure === 'rpm' ? this._redMarks(D.max)[0] : (isNum(w.redFrom) ? w.redFrom : 2)]);
            c.uniform(ref, 'u_ringW', [w.ringW || 14]);
            c.uniform(ref, 'u_ring', rgb(color(t, w.ring || 'line')));
            c.uniform(ref, 'u_ring2', rgb(color(t, w.ring2 || 'dim')));
            c.uniform(ref, 'u_tick', rgb(color(t, w.tick || 'fg')));
            c.uniform(ref, 'u_needle', rgb(color(t, w.needle || 'hot')));
            c.uniform(ref, 'u_red', rgb(t.hot));
            c.uniform(ref, 'u_face', rgb(color(t, w.face || 'bg')));
            c.uniform(ref, 'u_hot', [0]);
        } else if (w.type === 'gmeter') {
            const L = color(t, w.line || 'dim');
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_line', rgba([L[0], L[1], L[2], isNum(w.lineAlpha) ? w.lineAlpha : 150]));
            c.uniform(ref, 'u_c1', rgb(color(t, w.dot || 'fg')));
            c.uniform(ref, 'u_c2', rgb(G_AMBER));
            c.uniform(ref, 'u_c3', rgb(t.hot));
            c.uniform(ref, 'u_at', [0.5, 0.8]);
            c.uniform(ref, 'u_envC', rgb(color(t, w.envColor || 'fg')));
            c.uniform(ref, 'u_envOn', [w.envelope === false ? 0 : 1]);
            c.uniform(ref, 'u_g', [0, 0]);
            c.uniform(ref, 'u_trailN', [0]);
            c.uniform(ref, 'u_trail', new Array(32).fill(0), { type: 'vec4' });
            c.uniform(ref, 'u_env', new Array(G_SECTORS).fill(0), { type: 'vec4' });
        } else if (w.type === 'revarc') {
            const max = this._barMax(), red = this.setting('redline');
            const midAt = t.bar.midAt === 'shift' ? (red - 1500) / max : t.bar.midAt;
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_center', w.center);
            c.uniform(ref, 'u_r', [w.r]);
            c.uniform(ref, 'u_w', [w.band || 40]);
            c.uniform(ref, 'u_start', [w.start * Math.PI / 180]);
            c.uniform(ref, 'u_sweep', [w.sweep * Math.PI / 180]);
            const wa = this._arcWing(w);       // driver camera wings: half the segments on each side
            c.uniform(ref, 'u_segs', [wa ? Math.round((w.segments || 30) / 2) : w.segments || 30]);
            c.uniform(ref, 'u_wing', [wa]);
            c.uniform(ref, 'u_low', rgb(t.bar.low));
            c.uniform(ref, 'u_mid', rgb(t.bar.mid));
            c.uniform(ref, 'u_high', rgb(t.bar.high));
            c.uniform(ref, 'u_midAt', [midAt]);
            c.uniform(ref, 'u_highAt', [(red - 500) / max]);
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_flash', [0]);
            c.uniform(ref, 'u_value', [0]);
        } else if (w.type === 'meter') {
            const cs = w.colors || ['fg', 'fg', 'hot'];
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_segs', [w.segments || 20]);
            c.uniform(ref, 'u_gap', [isNum(w.gap) ? w.gap : 4]);
            c.uniform(ref, 'u_vertical', [w.vertical ? 1 : 0]);
            c.uniform(ref, 'u_c1', rgb(color(t, cs[0])));
            c.uniform(ref, 'u_c2', rgb(color(t, cs[1] || cs[0])));
            c.uniform(ref, 'u_c3', rgb(color(t, cs[2] || cs[1] || cs[0])));
            c.uniform(ref, 'u_at', w.at || [1, 1]);
            c.uniform(ref, 'u_track', rgba(color(t, w.trackColor || 'track')));
            c.uniform(ref, 'u_peak', [-1]);
            c.uniform(ref, 'u_peakC', rgb(color(t, w.peakColor || 'fg')));
        } else if (w.type === 'slantbar') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_slant', [isNum(w.slant) ? w.slant : 10]);
            c.uniform(ref, 'u_value', [0]);
            c.uniform(ref, 'u_on', [0.3, 0.75, 1.0, 1]);
            c.uniform(ref, 'u_track', rgba(color(t, w.trackColor || 'track')));
        } else if (w.type === 'arc') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_peak', [-1]);
            c.uniform(ref, 'u_peakC', rgb(color(t, w.peakColor || 'fg')));
            c.uniform(ref, 'u_color', rgb(color(t, w.color || 'arc')));
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_width', [w.width || 7]);
            c.uniform(ref, 'u_start', [(w.start === undefined ? 225 : w.start) * Math.PI / 180]);
            c.uniform(ref, 'u_sweep', [(w.sweep === undefined ? 270 : w.sweep) * Math.PI / 180]);
        } else if (w.type === 'segbar') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_segs', [w.max]);
            c.uniform(ref, 'u_on', rgba(color(t, w.color || 'hot')));
            c.uniform(ref, 'u_offC', rgba(color(t, 'track')));
            c.uniform(ref, 'u_slant', [w.slant || 0]);
        } else if (w.type === 'revbar') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_top', [w.top || 8]);
            c.uniform(ref, 'u_barH', [w.barH]);
            c.uniform(ref, 'u_slant', [w.slant || 12]);
            c.uniform(ref, 'u_max', [this._barMax(w)]);
            c.uniform(ref, 'u_red', [this.setting('redline')]);
            c.uniform(ref, 'u_from', rgb(t.rev.from));
            c.uniform(ref, 'u_to', rgb(t.rev.to));
            c.uniform(ref, 'u_hot', rgb(t.hot));
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_tick', rgba(t.dim));
            c.uniform(ref, 'u_fg', rgba(t.fg));
        } else if (w.type === 'mstyle') {
            const P = w.pts.map((q) => [q[0] - w.x, q[1] - w.y]), max = w.rpmMax || 7000;
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_A', [P[0][0], P[0][1], P[1][0], P[1][1]]);
            c.uniform(ref, 'u_B', [P[2][0], P[2][1]]);
            c.uniform(ref, 'u_g', [w.bar, Math.min(0.95, Math.max(0.05, (w.corner || 2000) / max)), max / 1000, this._redMarks(max)[0]]);
            c.uniform(ref, 'u_v', [0, 0, 0, 0]);
            c.uniform(ref, 'u_hy', [0, 0, 0, 0]);
            c.uniform(ref, 'u_hot', rgb(t.hot));
            c.uniform(ref, 'u_fg', rgba(t.fg));
            c.uniform(ref, 'u_track', rgba(t.track));
        } else if (w.type === 'lights') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            // driver camera wings: half the lights (and the blue tail) on each side, filling in towards the camera
            const wg = this._wings(w), n = w.count || 12;
            c.uniform(ref, 'u_n', [wg ? Math.ceil(n / 2) : n]);
            c.uniform(ref, 'u_tail', [wg ? Math.ceil((w.tail || 0) / 2) : w.tail || 0]);
            c.uniform(ref, 'u_skip', wg ? [wg.s, wg.e] : [0, 0]);
            c.uniform(ref, 'u_round', [w.round ? 1 : 0]);
            c.uniform(ref, 'u_green', rgb(LIGHTS.green));
            c.uniform(ref, 'u_yellow', rgb(LIGHTS.yellow));
            c.uniform(ref, 'u_red', rgb(LIGHTS.red));
            c.uniform(ref, 'u_blue', rgb(LIGHTS.blue));
            c.uniform(ref, 'u_off', [w.off === undefined ? 0.14 : w.off]);
        } else if (w.type === 'shiftlight') {
            const h = w.h;
            c.uniform(ref, 'u_size', [w.w, h]);
            c.uniform(ref, 'u_n', [w.segments || 5]);
            c.uniform(ref, 'u_cw', [isNum(w.center) ? w.center : Math.round(h * 1.4)]);
            c.uniform(ref, 'u_gap', [isNum(w.gap) ? w.gap : 7]);
            c.uniform(ref, 'u_skew', [isNum(w.skew) ? w.skew : Math.round(h * 0.4)]);
            c.uniform(ref, 'u_lean', [w.lean === 'out' ? -1 : 1]);
            c.uniform(ref, 'u_color', rgb(LIGHTS.orange));
            c.uniform(ref, 'u_red', rgb(LIGHTS.red));
            c.uniform(ref, 'u_off', [w.off === undefined ? 0.14 : w.off]);
            c.uniform(ref, 'u_lit', [0]);
            c.uniform(ref, 'u_flash', [0]);
        } else if (w.type === 'fill') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_color', rgba(color(t, w.color || 'bg')));
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
        } else if (w.type === 'box') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_fill', rgba(color(t, w.fill || 'panel')));
            c.uniform(ref, 'u_line', rgba(color(t, w.line || 'line')));
            c.uniform(ref, 'u_head', rgba(color(t, w.headColor || 'head')));
            c.uniform(ref, 'u_headH', [w.head || 0]);
            c.uniform(ref, 'u_border', [w.border === undefined ? 2 : w.border]);
            c.uniform(ref, 'u_radius', [w.radius || 0]);
        } else if (w.type === 'swatch') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_n', [w.steps || 11]);
        } else if (w.type === 'swatchimg') this._blit(x, null, calibration.swatchImage(w.w, w.h, w.steps || 11));
        else if (w.type === 'boxes') {
            // the box list goes up as two vec4 arrays (x, y, w, h and headH, border, radius, headKind), 12 slots
            const list = (Array.isArray(w.boxes) ? w.boxes : []).filter((b) => b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h)
                && !(b.toggle && !this._toggleOn(b.toggle))).slice(0, 12);
            const rects = [], styles = [];
            for (let i = 0; i < 12; i++) {
                const b = list[i];
                rects.push(b ? b.x - w.x : 0, b ? b.y - w.y : 0, b ? b.w : 0, b ? b.h : 0);
                styles.push(b ? b.head || 0 : 0, b ? (b.border === undefined ? 2 : b.border) : 0, b ? b.radius || 0 : 0, b && b.headColor === 'accent' ? 1 : 0);
            }
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_bg', rgba(color(t, w.color || 'bg')));
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_n', [list.length]);
            c.uniform(ref, 'u_box', rects, { type: 'vec4' });
            c.uniform(ref, 'u_boxStyle', styles, { type: 'vec4' });
            c.uniform(ref, 'u_fill', rgba(color(t, w.fill || 'panel')));
            c.uniform(ref, 'u_line', rgba(color(t, w.line || 'line')));
            c.uniform(ref, 'u_head', rgba(color(t, w.head || 'head')));
            c.uniform(ref, 'u_accent', rgba(color(t, w.accent || 'accent')));
        } else if (w.type === 'tiles') {
            const list = this._tiles(w), rects = [];
            for (let i = 0; i < TILE_MAX; i++) {
                const b = list[i];
                rects.push(b ? b.x - w.x : 0, b ? b.y - w.y : 0, b ? b.w : 0, b ? b.h : 0);
            }
            const zc = w.colors || ['bar1', 'bar2', 'hot'];
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_bg', rgba(color(t, w.color || 'bg')));
            c.uniform(ref, 'u_n', [list.length]);
            c.uniform(ref, 'u_tile', rects, { type: 'vec4' });
            c.uniform(ref, 'u_geo', [isNum(w.radius) ? w.radius : 8, isNum(w.border) ? w.border : 1.5, isNum(w.strip) ? w.strip : 3, w.barH || 6]);
            c.uniform(ref, 'u_fill', rgba(color(t, w.fill || 'panel')));
            c.uniform(ref, 'u_warn', rgba(color(t, w.warn || 'warn')));
            c.uniform(ref, 'u_line', rgba(color(t, w.line || 'line')));
            c.uniform(ref, 'u_track', rgba(color(t, w.trackColor || 'track')));
            c.uniform(ref, 'u_accent', rgb(color(t, w.accent || 'accent')));
            c.uniform(ref, 'u_c1', rgb(color(t, zc[0])));
            c.uniform(ref, 'u_c2', rgb(color(t, zc[1] || zc[0])));
            c.uniform(ref, 'u_c3', rgb(color(t, zc[2] || zc[1] || zc[0])));
            c.uniform(ref, 'u_at', w.at || [0.6, 0.85]);
        }
        if (BACKDROP_TYPES[w.type]) {
            const r = w.rect || w;
            c.uniform(ref, 'u_rect', [r.w, r.h]);
            c.uniform(ref, 'u_org', [r.x - w.x, r.y - w.y]);
        }
        if (w.follow) { this._follow(x); return; }
        this._update(x, Date.now(), true);
    }

    /**
     * A follower (the gear window's bottom pieces of a backdrop, "follow": the leader's id) is a second layer of the same shader: it never
     * updates on its own, every uniform its leader sends goes to it too (the leader's client is wrapped once), so the pieces always draw
     * the same picture. The leader sends everything again at once, which brings a new follower up to date.
     */
    _follow(x) {
        x.follower = true;
        const lead = this.widgets.get(x.w.follow);
        if (!lead) return;
        if (!lead.followers) {
            const real = lead.c, list = lead.followers = [];
            lead.c = new Proxy(real, {
                get(t, k) {
                    if (k === 'uniform') return (ref, name, values, opts) => { t.uniform(ref, name, values, opts); list.forEach((f) => f.c.uniform(f.ref, name, values, opts)); };
                    const v = t[k];
                    return typeof v === 'function' ? v.bind(t) : v;
                },
            });
        }
        lead.followers.push({ c: x.c, ref: x.ref });
        this._update(lead, Date.now(), true);
    }

    /** A tiles widget's tiles in use: [{ x, y, w, h, slot, bar }], the ones with a valid rect, toggles on, TILE_MAX at most. */
    _tiles(w) {
        return (Array.isArray(w.tiles) ? w.tiles : []).filter((b) => b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h)
            && !(b.toggle && !this._toggleOn(b.toggle))).slice(0, TILE_MAX);
    }

    /** A widget's map hole in layer px, inset by "holeInset" (6) a side, while "holeWhen" is on; else no hole. */
    _hole(w) {
        const on = w.holeWhen === true || (w.holeWhen && this.setting(w.holeWhen) === true);   // true: always cut
        const h = w.hole && on ? w.hole : null;
        if (!h) return [0, 0, 0, 0];
        const inset = isNum(w.holeInset) ? w.holeInset : 6;
        return [h[0] + inset - w.x, h[1] + inset - w.y, Math.max(0, h[2] - 2 * inset), Math.max(0, h[3] - 2 * inset)];
    }

    _holeRadius(w) { return isNum(w.holeRadius) ? w.holeRadius : 28; }
    /** The hue the blue themes (Sport, M Blade, Navi) take now: from the drive mode while the setting "accentByMode" is on; blue elsewhere (accent.js). */
    _accentHue() {
        if (!this.accentLayout || this.target !== 'panel' || this.setting('accentByMode') === false) return 'blue';
        return hueOfMode(this.driveMode);
    }

    /** The colour of the drive mode's name (a text with "accentBy"): the theme's own bright blue in the mode's hue, [r, g, b, a]; null when the colours don't follow the mode (the setting off, no mode yet, not the cluster). */
    _accentColor() {
        if (this.target !== 'panel' || this.setting('accentByMode') === false || !this.driveMode) return null;      // (the M theme too: only its mode name)
        return mapRole(ACCENT_BRIGHT, hueOfMode(this.driveMode));
    }

    /** The strength of the navy backdrop of the Sport, M Blade and Navi themes: the setting "sportTint" in % of the car's own blue (0 = pure black). */
    _tint() { return this.ctx.settings.item('sportTint') ? Math.max(0, this.setting('sportTint')) / 100 : 0; }
    /** The strength of the facets on that backdrop: the setting "sportFacets" in % (100 = the full pattern, 0 = the plain navy). */
    _facets() { return this.ctx.settings.item('sportFacets') ? Math.min(1, Math.max(0, this.setting('sportFacets') / 100)) : 1; }

    /** One gauge frame, timed (perfShown, for the Signals tab): a frame that takes longer than TICK_MS, or a timer that fires late, is what a flicker or a stutter on the car is made of. */
    _tick() {
        const t0 = Date.now();
        try { this._tickBody(); } finally { this._perfNote(t0, Date.now()); }
    }

    /** The loop's timing over the last 5 s window: frames per second, the average and the slowest frame (ms), and the longest wait between two frame starts (ms). */
    _perfNote(t0, t1) {
        const p = this.perf || (this.perf = { n: 0, sum: 0, max: 0, gap: 0, prev: 0, at: t1, shown: null });
        const dur = t1 - t0;
        if (p.prev && t0 - p.prev > p.gap) p.gap = t0 - p.prev;
        p.prev = t0; p.n++; p.sum += dur; if (dur > p.max) p.max = dur;
        if (t1 - p.at >= PERF_WINDOW_MS) {
            p.shown = { perSec: Math.round(p.n * 1000 / (t1 - p.at)), avg: Math.round(p.sum / p.n * 10) / 10, max: p.max, gap: p.gap, at: t1 };
            p.n = 0; p.sum = 0; p.max = 0; p.gap = 0; p.at = t1;
        }
    }

    /** { perSec, avg, max, gap, at } of the last full window, or null before the first one. */
    perfShown() { return this.perf && this.perf.shown ? this.perf.shown : null; }

    _tickBody() {
        const now = Date.now();
        this._smoothRpm(now);
        this._smoothSpeed(now);
        this._estStep(now);
        // (a rebuild put off, see _rebuild: the gauges go on meanwhile)
        if (this.config.hideWithWaze === true && this.started && this._layoutName() !== this.activeName) { this._rebuild(); if (!this.rebuildT) return; }
        // the 0-60 timer only on the car's own data (the demo drive would set a best time)
        if (!this.car.data().demo) this.runs.update(this.car.data().speed, now, this.setting('units') === 'us' ? 'us' : 'metric');
        this._trip(now);
        this._gTick(now);
        const b = this._boost();
        if (isNum(b) && (!isNum(this.boostPeak) || b > this.boostPeak)) this.boostPeak = b;
        if (!this.client.ready) return;
        // shift light: blink the whole bar at 8 Hz once the rpm reaches the redline
        const rpm = this._raw('rpm');
        const flashing = isNum(rpm) && rpm >= this.setting('redline') - 150;
        this.flash = flashing ? Math.floor(now / 62.5) % 2 === 0 : false;
        this.widgets.forEach((x) => this._guard('widget ' + x.w.id, () => this._update(x, now, false)));
    }

    /** This drive's distance and moving time (the car's own data only; standing still doesn't count). */
    _trip(now) {
        const d = this.car.data(), dt = this.tripT ? Math.min(1000, now - this.tripT) : 0;
        this.tripT = now;
        if (d.demo || !isNum(d.speed) || d.speed < 2) return;
        this.tripKm += d.speed * dt / 3600000;
        this.tripMs += dt;
        if (isNum(d.rpm) && d.rpm < hybridTach.ENGINE_RPM) this.evKm += d.speed * dt / 3600000;      // the engine is at rest: the battery drives
    }

    /** km/h: the average moving speed this drive, from the first minute on (null before it, 54 on the demo). */
    _avgSpeed() {
        if (this.car.data().demo) return 54;
        return this.tripMs >= 60000 ? this.tripKm / (this.tripMs / 3600000) : null;
    }

    /** BMW-like tach: a 120 ms filter, and a readout that moves in 50 rpm steps, only by 40 rpm or more. */
    _smoothRpm(now) {
        const test = this._testRpm(now);
        const raw = isNum(test) ? test : this.car.data().rpm;
        const dt = this.lastTickT ? Math.min(500, now - this.lastTickT) : 0;
        this.lastTickT = now;
        if (!isNum(raw)) { this.rpmF = null; this.rpmShown = null; return; }
        this.rpmF = isNum(this.rpmF) ? this.rpmF + (raw - this.rpmF) * (1 - Math.exp(-dt / 120)) : raw;
        if (!isNum(this.rpmShown) || Math.abs(this.rpmF - this.rpmShown) >= 40) this.rpmShown = Math.max(0, Math.round(this.rpmF / 50) * 50);
    }

    /** The speed the bars see: the car's, eased over about SPEED_FILTER_MS so a bar glides between two readings instead of stepping (the readouts keep the car's own). */
    _smoothSpeed(now) {
        const raw = this.car.data().speed, dt = this.lastSpdT ? Math.min(500, now - this.lastSpdT) : 0;
        this.lastSpdT = now;
        if (!isNum(raw)) { this.speedF = null; return; }
        // (a jump of 40 km/h or more at once is not a drive: the demo restarting, a unit change: no easing through it)
        this.speedF = isNum(this.speedF) && Math.abs(raw - this.speedF) < 40 ? this.speedF + (raw - this.speedF) * (1 - Math.exp(-dt / SPEED_FILTER_MS)) : raw;
        if (Math.abs(raw - this.speedF) < 0.05) this.speedF = raw;
    }

    _update(x, now, force) {
        if (x.follower) return;          // a gear window piece: its leader sends its uniforms (_follow)
        const w = x.w;
        if (w.type === 'atext') {
            if (!force && now - x.lastPaint < (w.rate || TEXT_MS)) return;
            const s = this._resolve(w.text);
            if (!force && s === x.last) return;
            x.last = s; x.lastPaint = now;
            x.c.uniform(x.ref, 'u_text', this._atlasCodes(x, s), { type: 'vec4' });
        } else if (w.type === 'text') {
            if (!force && now - x.lastPaint < (w.nearFont ? ZOOM_MS : (w.rate || TEXT_MS))) return;
            const s = w.readyHides && this._launchReady(now) ? '' : this._resolve(w.text);                              // (M Blade: the cue takes the drive mode's name's place)
            let role = w.color || 'fg';
            if (w.colorBy === 'verdict' && this.score.last) role = VERDICT[this.score.last.verdict] || role;
            const here = !!(w.near && this._nearMark(w.near[0]) === w.near[1]);
            if (here) role = w.nearColor || 'fg';
            // a readout slot goes red / blue at the shift point only while it shows engine speed or the shift point
            const shiftish = !w.slot || ['rpm', 'shiftAt'].indexOf((this.slotSensor(this.activeName, w.slot, this.layoutSlots) || {}).id) >= 0;
            if ((w.hotWhen || w.coldWhen) && shiftish) {
                const sp = this._shift();
                if (w.coldWhen && sp[w.coldWhen]) role = VERDICT.COLD;
                if (w.hotWhen && sp[w.hotWhen]) role = 'hot';
            }
            // a temperature in the temperature colours: blue while cold, green once warm (over the limit: dark red, the flash below makes it bright)
            if (w.tempBy && COLD_BELOW[w.tempBy]) {
                const tv = this._raw(w.tempBy), cold = this.setting(COLD_BELOW[w.tempBy]);
                if (isNum(tv)) role = isNum(cold) && cold > 0 && tv < cold ? VERDICT.COLD : VERDICT['SPOT ON'];
                if (this._warning(w)) role = WARN_DIM;
                else if (this._warmPulse(w.tempBy, now)) role = 'fg';       // just warm: a few white flashes
            }
            if (w.tyreBy) role = this._tyreRole(w.tyreBy, role);               // a low tyre pressure: yellow, then red
            if (w.limitBy) { const l = this._limitNow(now); if (l && l.over) role = 'hot'; }                         // over the speed limit: the shift red
            if (w.accentBy) role = this._accentColor() || role;                                                       // the drive mode's own text: in the mode's colour
            if (w.iceBy && this._ice(now).on) role = VERDICT.COLD;                                                    // ice: the outside temperature in the cold blue
            if (w.launchBy && this.runs.state !== 'run' && this.runs.record) role = VERDICT['SPOT ON'];            // a new best time: green
            if (w.readyBy === true) role = VERDICT['SPOT ON'];                                                        // the launch cue: green ("plain": the widget's own colour)
            if (w.lowWhen && this._lowNow(w.lowWhen)) role = 'hot';             // in reserve: the shift red, steady
            // over its warning limit: the value flashes in the shift red
            // ("warnFlash": false: not on a tile that turns red itself, the Dyno theme's)
            if (w.warnFlash !== false && this._warning(w) && Math.floor(now / WARN_FLASH_MS) % 2 === 0) role = 'hot';
            // the scale numbers, eased (no jump): the rev number under the needle is red, a moving index, and grows a little (1.1, then 1.2 times:
            // "nearMid", "nearFont") while the rev bar is in its zone; a speed number takes the speed zone's colour (the layout's "zoneRed": false
            // makes the zoom numbers yellow instead of red: the M theme; its bars still go red)
            let col = null, lvl = 0;
            if (w.nearFont && w.near && w.zoomColor !== false) {
                const kind = w.near[0], base = color(this.theme, role), hot = this.zoneRed ? color(this.theme, 'hot') : VERDICT.EARLY, mixc = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
                if (kind === 'rpm') {
                    // the label under the needle: the shift red (yellow on the M theme) while the engine runs, light blue while the battery drives
                    // and green while it charges, as the bar itself (the power on the bar: hybridPow); not on label 0, nor with the engine off
                    const pw = this.hybridPow, rpm = this._barRaw('rpm');
                    const idx = here && w.near[1] >= 1 && (pw ? pw.kw >= 1 : isNum(rpm) && rpm >= 300);
                    col = mixc(base, pw ? (pw.chg ? HY_GREEN : HY_BLUE) : hot, Math.round(this._ease(w.id + 'c', idx ? 1 : 0, now) * 12) / 12);
                } else {
                    const lv = Math.round(this._ease(w.id + 'c', here ? this._zoneOf(kind, w.rpmMax) : 0, now) * 12) / 12;
                    col = !this.runUp ? mixc(base, hot, lv / 2) : lv <= 1 ? mixc(base, VERDICT.EARLY, lv) : mixc(VERDICT.EARLY, hot, lv - 1);       // no run-up: straight to red
                }
            }
            if (w.nearFont && w.near) {
                const sz = this._ease(w.id + 'z', here && this._zoneOf(w.near[0], w.rpmMax) > 0 ? 1 : 0, now);
                lvl = sz < 0.12 ? 0 : sz < 0.6 && w.nearMid ? 1 : 2;
            }
            const key = s + '|' + role + '|' + lvl + '|' + (col ? col.join(',') : '');
            if (!force && key === x.last) return;
            x.last = key; x.lastPaint = now;
            // "fit": smaller fonts to fall back on when the text is wider than the box (a readout slot showing a
            // longer value than its default) or has a character the font lacks (Retro's seven-segment digits have no
            // letters, + or °), on the same baseline
            let font = lvl === 2 ? w.nearFont : lvl === 1 ? w.nearMid : w.font, offsetY = 0, shiftX = 0;
            if (w.grow) {
                // a box grown for the zoomed digits ("grow" [left, top, right, bottom]): the normal digits stay where the nominal box has them, the
                // larger ones sit on the same line and keep the nominal box's edge their alignment names
                const gr = w.grow, hNom = w.h - gr[1] - gr[3];
                if (lvl > 0) offsetY = gr[1] + Math.round((hNom - textRaster.loadFont(font).metrics.cellHeight) / 2);
                else {
                    offsetY = gr[1];
                    shiftX = w.align === 'right' ? -gr[2] : w.align === 'left' ? gr[0] : Math.round((gr[0] - gr[2]) / 2);
                }
            }
            const has = (n) => { const g = textRaster.loadFont(n).metrics.glyphs; return s.split('').every((ch) => ch === ' ' || g[ch]); };
            if (w.fit && (textRaster.measure(s, font, w.spacing) > w.w || !has(font))) {
                const f = w.fit.find((n) => has(n) && textRaster.measure(s, n, w.spacing) <= w.w) || w.fit[w.fit.length - 1];
                offsetY = textRaster.loadFont(w.font).metrics.baseline - textRaster.loadFont(f).metrics.baseline;
                font = f;
            }
            const buf = textRaster.drawText(w.w, w.h, s, {
                font, offsetY, x: shiftX, color: col || color(this.theme, role), align: w.align, spacing: w.spacing,
                color2: w.color2 && role !== 'hot' ? color(this.theme, w.color2) : null,
                glow: w.glow ? this.theme.glow : 0,
            });
            this._blitDiff(x, buf);
        } else if (w.type === 'icon' && ((w.tempBy && COLD_BELOW[w.tempBy]) || w.lowWhen || w.tyreBy || w.limitBy || w.launchBy || w.iceBy || w.evShareBy || w.nextBy || w.alertBy || w.laneBy || w.readyBy || w.readyHides)) {
            // an oil or coolant icon in the colour of its number (blue while cold, green once warm, flashing red over the limit);
            // a fuel or battery icon in the shift red while that is in reserve ("lowWhen")
            let role = w.color || 'fg';
            if (w.tempBy && COLD_BELOW[w.tempBy]) {
                const tv = this._raw(w.tempBy), cold = this.setting(COLD_BELOW[w.tempBy]);
                if (isNum(tv)) role = isNum(cold) && cold > 0 && tv < cold ? VERDICT.COLD : VERDICT['SPOT ON'];
                if (this._overLimit(w.tempBy)) role = Math.floor(now / WARN_FLASH_MS) % 2 === 0 ? 'hot' : WARN_DIM;
                else if (this._warmPulse(w.tempBy, now)) role = 'fg';
            }
            if (w.lowWhen && this._lowNow(w.lowWhen)) role = 'hot';
            // a tyre pressure warning icon: yellow, then red, and nothing at all while the tyres are fine ("tyreOnly")
            let hide = false;
            if (w.tyreBy) { role = this._tyreRole(w.tyreBy, role); hide = w.tyreOnly === true && this._tyreLevel(w.tyreBy) === 0; }
            // the speed limit ring (white, red while over) shows only with a limit; the stopwatch only while the 0-100 timer shows
            if (w.limitBy) { const l = this._limitNow(now); hide = !l; if (l && l.over) role = 'hot'; }
            if (w.nextBy) hide = !this._nextLimitNow(now);                                                            // the small ring of the next limit
            if (w.alertBy) { hide = !this._alertNow(); role = VERDICT.EARLY; }                                         // the car's check control message: the warning triangle in yellow
            if (w.laneBy) { const ln = this._laneNow(); hide = !ln; if (ln) role = ln; }                              // the lane assist's steering wheel, in the car's own colour
            if (w.iceBy) { const ic = this._ice(now); hide = !ic.on || ic.blink; role = VERDICT.COLD; }              // the snowflake: flashing, then lit
            if (w.evShareBy) hide = !isNum(this._evShare());                                                          // the leaf only with a share to show
            if (w.launchBy) {
                hide = !isNum(this._launchTime(now));
                if (this.runs.state !== 'run' && this.runs.record) role = VERDICT['SPOT ON'];
            }
            if (w.readyBy) { hide = !this._launchReady(now); if (w.readyBy === true) role = VERDICT['SPOT ON']; }       // the chequered flag, only while ready
            if (w.readyHides && this._launchReady(now)) hide = true;                                                  // an icon the cue takes the place of (the HUD's oil and coolant row)
            const key = JSON.stringify(role) + hide;
            if (!force && key === x.last) return;
            x.last = key;
            this._blitDiff(x, hide ? Buffer.alloc(w.w * w.h * 4) : paintIcon(w.icon, w.w, w.h, color(this.theme, role)));
        } else if (w.type === 'badge') {
            if (!force && now - x.lastPaint < TEXT_MS) return;
            const s = this._resolve(w.text);
            let tone = VERDICT.COLD, fresh = false;
            if (w.tone === 'verdict' && this.score.last) {
                tone = VERDICT[this.score.last.verdict] || this.theme.fg;
                fresh = now - this.score.last.at < 2500;
            }
            const key = s + '|' + tone + '|' + fresh;
            if (!force && key === x.last) return;
            x.last = key; x.lastPaint = now;
            this._blitDiff(x, this._paintBadge(w, s, tone, fresh));
        } else if (w.type === 'tiles') {
            // per tile: its bar (the slot's sensor, TILE_BAR) and whether that reading is over its warning limit
            const list = this._tiles(w), vals = [];
            let key = '';
            for (let i = 0; i < TILE_MAX; i++) {
                const b = list[i];
                let v = -1, warn = 0, z = 0;
                if (b) {
                    const sn = b.slot ? this.slotSensor(this.activeName, b.slot, this.layoutSlots) : null;
                    const bar = sn && b.bar !== false ? TILE_BAR[sn.id] : null;
                    if (bar) {
                        let raw = this._raw(bar.raw);
                        if (bar.abs && isNum(raw)) raw = Math.abs(raw);
                        const max = bar.max === 'rpm' ? this._barMax() : bar.max === 'evRangeFull' ? this._evRangeFull() : bar.max;
                        v = isNum(raw) ? Math.round(Math.min(1, Math.max(0, (raw - bar.min) / (max - bar.min))) * 200) / 200 : 0;
                        z = bar.z ? 1 : 0;
                    }
                    warn = sn && this._overLimit(sn.id) ? 1 : 0;
                }
                vals.push(v, warn, z, 0);
                key += v + ',' + warn + ',' + z + ';';
            }
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_tileV', vals, { type: 'vec4' });
        } else if (w.type === 'gmeter') {
            // the car's lateral g is + turning left, longitudinal + speeding up (G-Force's labels). Drawn as G-Force
            // draws it: the dot moves the way the car accelerates, into the turn and up when speeding up (the shader
            // draws + x right, + y down). The settings "gFlipLat" / "gFlipLong" swap left / right and accel / brake;
            // a layout's "flipX" / "flipY" swap again on top
            // range and envelope go only when they change; the trail with every move of the dot (its first point)
            const S = this._gSigns(w), gx = this._raw('gLat'), gy = this._raw('gLong');
            const q = (v) => Math.round(v * 50) / 50;
            const qx = isNum(gx) ? q(S[0] * gx) : 0, qy = isNum(gy) ? q(S[1] * gy) : 0;
            const max = this._gRange(w), step = max > 1.2 ? 0.5 : 0.25;
            const envKey = this.gEnvAt + '|' + S.join(',');
            const tr = this.gTrail, trKey = tr.length ? qx + ',' + qy + '|' + tr[0][0] + '|' + tr.length + '|' + S.join(',') : 'none';
            const key = qx + '|' + qy + '|' + max + '|' + envKey + '|' + trKey;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_g', [qx, qy]);
            if (force || x.gMax !== max) { x.gMax = max; x.c.uniform(x.ref, 'u_max', [max]); x.c.uniform(x.ref, 'u_step', [step]); }
            if (force || x.gEnvKey !== envKey) {
                x.gEnvKey = envKey;
                x.c.uniform(x.ref, 'u_env', this._gEnvDrawn(S), { type: 'vec4' });
            }
            if (force || x.gTrKey !== trKey) {
                // point 0 is the dot itself, so the trail joins it; then the samples, newest first
                x.gTrKey = trKey;
                const pts = [qx, qy];
                tr.forEach((p) => pts.push(q(S[0] * p[1]), q(S[1] * p[2])));
                const n = tr.length ? pts.length / 2 : 0;
                while (pts.length < 32) pts.push(0);
                x.c.uniform(x.ref, 'u_trail', pts, { type: 'vec4' });
                x.c.uniform(x.ref, 'u_trailN', [n]);
            }
        } else if (w.type === 'shiftbar' || w.type === 'revarc') {
            const rpm = this._raw('rpm');
            const segs = w.segments || (w.type === 'revarc' ? 30 : 40);
            const v = isNum(rpm) ? Math.min(1, Math.max(0, rpm / this._barMax())) : 0;
            const q = Math.round(v * segs * 2) / (segs * 2);        // only resend on half-segment steps
            const key = q + (this.flash ? 'f' : '');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            x.c.uniform(x.ref, 'u_flash', [this.flash ? 1 : 0]);
        } else if (w.type === 'arc' || w.type === 'meter') {
            // a meter with a "slot" (Dyno) shows the bar of whatever sensor that readout slot shows (TILE_BAR)
            let sig = w.signal, mn = w.min, mx = w.max, ab = false;
            if (w.slot) {
                const sn = this.slotSensor(this.activeName, w.slot, this.layoutSlots);
                const bar = sn ? TILE_BAR[sn.id] : null;
                sig = bar ? bar.raw : null; mn = bar ? bar.min : 0; mx = bar ? (bar.max === 'rpm' ? this._barMax() : bar.max) : 1; ab = !!(bar && bar.abs);
            }
            if (mx === 'evRangeFull') mx = this._evRangeFull();   // a bar of the electric range runs to the full battery's range
            let raw = sig ? this._raw(sig) : null;
            if (ab && isNum(raw)) raw = Math.abs(raw);
            const v = isNum(raw) && mx !== mn ? Math.min(1, Math.max(0, (raw - mn) / (mx - mn))) : 0;
            const q = Math.round(v * 200) / 200;
            const pk = w.peak ? this._peakHold(x, q, now, w.peak) : -1;
            const key = q + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            if (w.peak) x.c.uniform(x.ref, 'u_peak', [pk > q ? pk : -1]);
        } else if (w.type === 'dial') {
            const D = this._dialScale(w), us = this.setting('units') === 'us';
            let raw = this._raw(w.measure === 'rpm' ? 'rpm' : w.measure === 'speed' ? 'speed' : w.signal);
            if (w.measure === 'speed' && isNum(raw) && us) raw *= 0.621371;
            const v = isNum(raw) ? Math.min(1, Math.max(0, raw / D.max)) : 0;
            const q = Math.round(v * 1000) / 1000;
            const hot = w.measure === 'rpm' && this._shift().now ? 1 : 0;
            const key = q + '|' + hot;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            x.c.uniform(x.ref, 'u_hot', [hot]);
        } else if (w.type === 'sdash') {
            const us = this.setting('units') === 'us';
            // the right-hand bar is the oil temperature (50..150 C) unless the layout names another signal ("oilSignal",
            // "oilMin", "oilMax": the plug-in hybrid layouts show the battery charge, hvSoc 0..100)
            const sp = this._barRaw('speed'), rpm = this._barRaw('rpm'), fuel = this._raw('fuel'), oil = this._raw(w.oilSignal || 'oil');
            const oMin = isNum(w.oilMin) ? w.oilMin : 50, oMax = isNum(w.oilMax) ? w.oilMax : 150;
            const q = (v) => Math.round(Math.min(1, Math.max(0, v)) * 500) / 500;
            // the hybrid rev counter ("hybridTach"): engine off and the battery driving = its power in blue (10 kW per mark); engine off and the
            // battery charging = the power in green ("chgOnBar"); else the rpm in red, as on a combustion car
            const hy = this._hybridTach(w, rpm), bar = hy.ev ? 1 : (w.chgOnBar === true && hy.engineOff && hy.chg > 0 ? 2 : 0);
            this.hybridEv = bar > 0; this.hybridCharge = bar === 2;
            this.hybridPow = bar > 0 ? { kw: Math.abs(hy.kw), chg: bar === 2 } : null;
            const vals = [
                q(isNum(sp) ? scaleFrac(us ? sp * 0.621371 : sp, SPEED_SCALE[us ? 'us' : 'metric']) : 0),
                q(bar ? Math.abs(hy.kw) * 100 / (w.rpmMax || 8000) : isNum(rpm) ? rpm / (w.rpmMax || 8000) : 0),
                q(isNum(fuel) ? fuel : 0),
                q(isNum(oil) ? (oil - oMin) / (oMax - oMin) : 0),
            ];
            // the right bar is the battery on the plug-in hybrid layouts: red in reserve too
            const low = this._lows(), lowR = w.oilSignal === 'hvSoc' ? low[1] : 0;
            const zone = [this._ease(w.id + 's', this._zoneSpeed(), now), this._ease(w.id + 'r', bar ? 0 : this._zoneRev(w.rpmMax || 8000), now)];
            const pk = this._peakRev(x, vals[1], now, bar > 0 || this.sweepAt !== null);
            const key = vals.join('|') + '|' + bar + '|' + low[0] + lowR + '|' + zone.map((z) => Math.round(z * 20)).join(',') + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_zone', zone);
            x.c.uniform(x.ref, 'u_peak', [pk]);
            x.c.uniform(x.ref, 'u_low', [low[0], lowR]);
            x.c.uniform(x.ref, 'u_speed', [vals[0]]);
            const marks = bar ? [2, 2] : this._redMarks(w.rpmMax || 8000);
            x.c.uniform(x.ref, 'u_redFrom', [marks[0]]);
            x.c.uniform(x.ref, 'u_orange', [marks[1]]);
            x.c.uniform(x.ref, 'u_hy', bar === 1 ? [0.25, 0.6, 1.0, 1] : bar === 2 ? [0.2, 0.85, 0.5, 1] : [0, 0, 0, 0]);
            x.c.uniform(x.ref, 'u_rpm', [vals[1]]);
            x.c.uniform(x.ref, 'u_fuel', [vals[2]]);
            x.c.uniform(x.ref, 'u_oil', [vals[3]]);
            x.c.uniform(x.ref, 'u_ozone', [w.oilSignal === 'hvSoc' ? 2.0 : 1.0]);   // the battery bar has no red top (full is not an alarm)
        } else if (w.type === 'mblade') {
            // rpm on the blade, the speed on the scale line (the M_SCALE labels); the strips are the fuel, the oil temperature (50..150 C,
            // lit blue while cold, green once warm, flashing red over its warning limit) and the hybrid battery (0..100 %)
            const us = this.setting('units') === 'us';
            const rpm = this._barRaw('rpm'), hv = this._raw('hvSoc'), fuel = this._raw('fuel'), spd = this._barRaw('speed'), oil = this._raw('oil');
            const q = (v) => Math.round(Math.min(1, Math.max(0, v)) * 500) / 500;
            const cold = this.setting('oilCold');
            const over = !!this._overLimit('oil');
            const flash = over && Math.floor(now / WARN_FLASH_MS) % 2 === 0;
            const oc = over ? (flash ? this.theme.hot : WARN_DIM) : isNum(oil) && isNum(cold) && cold > 0 && oil < cold ? VERDICT.COLD : VERDICT['SPOT ON'];
            // the hybrid rev counter: the engine runs = rpm; the battery alone drives = its power on the blade (blue); charging = the foot fills green
            const hy = this._hybridTach(w, rpm), ev = hy.ev, chg = hy.chg, kw = hy.kw;
            this.hybridEv = ev; this.hybridCharge = chg > 0;
            this.hybridPow = ev ? { kw, chg: false } : null;
            const vals = [q(ev ? kw * 100 / (w.rpmMax || 7000) : isNum(rpm) ? rpm / (w.rpmMax || 7000) : 0), q(isNum(fuel) ? fuel : 0), q(isNum(oil) ? (oil - 50) / 100 : 0), q(isNum(hv) ? hv / 100 : 0),
                q(isNum(spd) ? scaleFrac(us ? spd * 0.621371 : spd, M_SCALE[us ? 'us' : 'metric']) : 0), q(chg)];
            const low = this._lows();
            const zone = [this._ease(w.id + 's', this._zoneSpeed(), now), this._ease(w.id + 'r', ev ? 0 : this._zoneRev(w.rpmMax || 7000), now)];
            const pk = this._peakRev(x, vals[0], now, ev || this.sweepAt !== null);
            const key = vals.join('|') + '|' + oc.join(',') + '|' + ev + '|' + low.join('') + '|' + zone.map((z) => Math.round(z * 20)).join(',') + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_zone', zone);
            x.c.uniform(x.ref, 'u_peak', [pk]);
            x.c.uniform(x.ref, 'u_low', low);
            x.c.uniform(x.ref, 'u_value', [vals[0]]);
            x.c.uniform(x.ref, 'u_gv', [vals[1], vals[2], vals[3]]);
            x.c.uniform(x.ref, 'u_oc', rgb(oc));
            x.c.uniform(x.ref, 'u_speed', [vals[4]]);
            // the blade: blue on the electric power, else white, orange in the run-up to the redline, red from it
            x.c.uniform(x.ref, 'u_red', ev ? [0.2, 0.55, 1.0, vals[5]] : this._zoneRgb(zone[1]).concat([vals[5]]));
        } else if (w.type === 'navi') {
            // the marker on the speed band (the same scale as the Sport theme's), the rev counter (the purple stripe: the rpm, or while the
            // battery alone drives its power in light blue, or while it charges in green, as Sport's bar) and the two bottom bars
            const us = this.setting('units') === 'us';
            const sp = this._barRaw('speed'), fuel = this._raw('fuel'), hv = this._raw('hvSoc'), rpm = this._barRaw('rpm');
            const q = (v) => Math.round(Math.min(1, Math.max(0, v)) * 500) / 500;
            const hy = this._hybridTach(w, rpm), bar = hy.ev ? 1 : (w.chgOnBar === true && hy.engineOff && hy.chg > 0 ? 2 : 0);
            this.hybridEv = bar > 0; this.hybridCharge = bar === 2;
            this.hybridPow = bar > 0 ? { kw: Math.abs(hy.kw), chg: bar === 2 } : null;
            const vals = [q(isNum(sp) ? scaleFrac(us ? sp * 0.621371 : sp, SPEED_SCALE[us ? 'us' : 'metric']) : 0), q(isNum(fuel) ? fuel : 0), q(isNum(hv) ? hv / 100 : 0),
                q(bar ? Math.abs(hy.kw) * 100 / (w.rpmMax || 7000) : isNum(rpm) ? rpm / (w.rpmMax || 7000) : 0)];
            const low = this._lows();
            const zone = [this._ease(w.id + 's', this._zoneSpeed(), now), this._ease(w.id + 'r', bar ? 0 : this._zoneRev(w.rpmMax || 7000), now)];
            const pk = this._peakRev(x, vals[3], now, bar > 0 || this.sweepAt !== null);
            const key = vals.join('|') + '|' + bar + '|' + low.join('') + '|' + zone.map((z) => Math.round(z * 20)).join(',') + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_zone', zone);
            x.c.uniform(x.ref, 'u_peak', [pk]);
            x.c.uniform(x.ref, 'u_low', low);
            x.c.uniform(x.ref, 'u_speed', [vals[0]]);
            x.c.uniform(x.ref, 'u_rev', [vals[3]]);
            const marks = bar ? [2, 2] : this._redMarks(w.rpmMax || 7000);
            x.c.uniform(x.ref, 'u_redFrom', [marks[0]]);
            x.c.uniform(x.ref, 'u_orange', [marks[1]]);
            x.c.uniform(x.ref, 'u_hy', bar === 1 ? [0.3, 0.75, 1.0, 1] : bar === 2 ? [0.2, 0.85, 0.5, 1] : [0, 0, 0, 0]);
            x.c.uniform(x.ref, 'u_barL', [w.barL[0], w.barL[1], w.barL[2], vals[1]]);
            x.c.uniform(x.ref, 'u_barR', [w.barR[0], w.barR[1], w.barR[2], vals[2]]);
        } else if (w.type === 'mdash') {
            const vals = x.gauges.map(([u, G]) => {
                const v = G.signal ? this._raw(G.signal) : null;
                return [u, G, isNum(v) ? Math.round(Math.min(1, Math.max(0, (v - G.min) / (G.max - G.min))) * 200) / 200 : 0];
            });
            // the setup level bars: the segment at round(signal) is lit (1-based; 0 = none)
            const lit = [0, 1, 2, 3].map((i) => {
                const s = x.bars[i], v = s && s.signal ? this._raw(s.signal) : null;
                return s && isNum(v) ? Math.max(0, Math.min(s.max || 1, Math.round(v))) : 0;
            });
            const low = this._lows();
            const tl = TYRE_CORNERS.map((k) => this._tyreLevel(k));         // the wheels of the tyre block's car: green, yellow, red
            const key = vals.map((v) => v[2]).join('|') + '|' + lit.join('|') + '|' + low.join('') + '|' + tl.join('');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_tyreLv', tl);
            x.c.uniform(x.ref, 'u_low', low);
            vals.forEach(([u, G, v]) => x.c.uniform(x.ref, u, [G.cx || 0, G.cy || 0, G.r || 0, v]));
            x.c.uniform(x.ref, 'u_segLit', lit);
        } else if (w.type === 'mtach') {
            const rpm = this._barRaw('rpm'), zone = this._ease(w.id, this._zoneRev(w.max || 8000), now);
            const v = isNum(rpm) ? Math.min(1, Math.max(0, rpm / (w.max || 8000))) : 0;
            const pk = this._peakRev(x, v, now, this.sweepAt !== null);
            const key = Math.round(v * 600) + '|' + Math.round(zone * 20) + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [v]);
            x.c.uniform(x.ref, 'u_zone', [zone]);
            x.c.uniform(x.ref, 'u_peak', [pk]);
        } else if (w.type === 'mstyle') {
            const rpm = this._barRaw('rpm'), max = w.rpmMax || 7000;
            const hy = this._hybridTach(w, rpm), bar = hy.ev ? 1 : (w.chgOnBar === true && hy.engineOff && hy.chg > 0 ? 2 : 0);
            this.hybridEv = bar > 0; this.hybridCharge = bar === 2;
            this.hybridPow = bar > 0 ? { kw: Math.abs(hy.kw), chg: bar === 2 } : null;
            const v = Math.round(Math.min(1, Math.max(0, bar ? Math.abs(hy.kw) * 100 / max : isNum(rpm) ? rpm / max : 0)) * 500) / 500;
            const zone = this._ease(w.id, bar ? 0 : this._zoneRev(max), now);
            const pk = this._peakRev(x, v, now, bar > 0 || this.sweepAt !== null);
            const key = v + '|' + bar + '|' + Math.round(zone * 20) + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_v', [v, pk, zone, 0]);
            x.c.uniform(x.ref, 'u_hy', bar === 1 ? [0.3, 0.75, 1.0, 1] : bar === 2 ? [0.2, 0.85, 0.5, 1] : [0, 0, 0, 0]);
        } else if (VIEW_PANEL[w.type]) {
            // the panel's bars: each row's reading between its min and max, in its tone: "temp" (oil, coolant) blue while cold, green once warm, flashing
            // red over the warning limit; "boost" light blue; "ice" (the outside) blue under the setting "iceBelow"; else white
            const rows = (w.rows || []).slice(0, 4), v = [0, 0, 0, 0], tn = [0, 0, 0, 0];
            const flash = Math.floor(now / WARN_FLASH_MS) % 2 === 0;
            rows.forEach((r, i) => {
                const raw = this._raw(r.signal), mn = isNum(r.min) ? r.min : 0, mx = isNum(r.max) ? r.max : 1;
                v[i] = isNum(raw) && mx !== mn ? Math.round(Math.min(1, Math.max(0, (raw - mn) / (mx - mn))) * 200) / 200 : 0;
                if (r.tone === 'temp') {
                    const cold = COLD_BELOW[r.signal] ? this.setting(COLD_BELOW[r.signal]) : 0;
                    tn[i] = this._overLimit(r.signal) ? (flash ? 3 : 4) : isNum(raw) && isNum(cold) && cold > 0 && raw < cold ? 1 : 2;
                } else if (r.tone === 'boost' || r.tone === 'blue') tn[i] = 5;
                else if (r.tone === 'green') tn[i] = 2;
                else if (r.tone === 'ice') tn[i] = this._ice(now).on ? 1 : 0;
            });
            // the tyres' view: each wheel in its tyre's state (the readouts' own rule, _tyreLevel: 0 fine, 1 low, 2 very low)
            const wh = w.mode === 'tyres' ? ['FL', 'FR', 'RL', 'RR'].map((k) => this._tyreLevel(k) || 0) : [0, 0, 0, 0];
            const key = v.join(',') + '|' + tn.join(',') + '|' + wh.join(',');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_v', v);
            x.c.uniform(x.ref, 'u_tone', tn);
            if (w.mode === 'tyres') x.c.uniform(x.ref, 'u_wh', wh);
        } else if (w.type === 'slantbar' && SENSOR_BAR[w.sensor]) {
            // a sensor's bar ("sensor": oil | coolant | boost, "min" / "max" in C or bar): blue while the oil / the coolant is under its cold limit, green once
            // warm, light blue for the boost, and over the warning limit flashing between the shift red and a dark red (the readouts' colours, "tempBy")
            const raw = this._raw(w.sensor), mn = isNum(w.min) ? w.min : 0, mx = isNum(w.max) ? w.max : 1;
            const v = isNum(raw) && mx !== mn ? Math.min(1, Math.max(0, (raw - mn) / (mx - mn))) : 0, q = Math.round(v * 200) / 200;
            const cold = COLD_BELOW[w.sensor] ? this.setting(COLD_BELOW[w.sensor]) : 0;
            const over = !!this._overLimit(w.sensor);
            const flash = over && Math.floor(now / WARN_FLASH_MS) % 2 === 0;
            const col = over ? (flash ? this.theme.hot : WARN_DIM)
                : w.sensor === 'boost' ? SENSOR_BAR.boost
                    : isNum(raw) && isNum(cold) && cold > 0 && raw < cold ? VERDICT.COLD : VERDICT['SPOT ON'];
            const key = q + '|' + col.join(',');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            x.c.uniform(x.ref, 'u_on', rgba(col));
        } else if (w.type === 'slantbar') {
            const raw = this._raw(w.signal || 'hvSoc'), mn = isNum(w.min) ? w.min : 0, mx = isNum(w.max) ? w.max : 100;
            const v = isNum(raw) && mx !== mn ? Math.min(1, Math.max(0, (raw - mn) / (mx - mn))) : 0, q = Math.round(v * 200) / 200;
            // light blue; green while the battery charges (recuperation, the plug); amber when nearly empty
            const chg = this._hybridTach({ hybridTach: true }, this._raw('rpm')).chg > 0;
            const low = this._lowNow('battery');
            const tone = low ? 3 : chg ? 2 : 1;
            const key = q + '|' + tone;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            x.c.uniform(x.ref, 'u_on', tone === 3 ? [1.0, 0.16, 0.16, 1] : tone === 2 ? [0.2, 0.85, 0.5, 1] : [0.3, 0.75, 1.0, 1]);
        } else if (w.type === 'segbar') {
            const v = this._raw(w.signal);
            const lit = isNum(v) ? Math.max(0, Math.min(w.max, Math.round(v))) : 0;
            if (!force && lit === x.last) return;
            x.last = lit;
            x.c.uniform(x.ref, 'u_lit', [lit]);
        } else if (w.type === 'revbar') {
            const rpm = this._raw('rpm'), sp = this._shift();
            const v = isNum(rpm) ? Math.round(Math.max(0, rpm) / 10) * 10 : 0;
            const peak = Math.round(this.score.peak / 10) * 10;
            const key = v + '|' + sp.rpm + '|' + peak + '|' + sp.now;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [v]);
            x.c.uniform(x.ref, 'u_shift', [sp.rpm]);
            x.c.uniform(x.ref, 'u_peak', [peak]);
            x.c.uniform(x.ref, 'u_shiftNow', [sp.now ? 1 : 0]);
        } else if (w.type === 'shiftlight') {
            const rpm = this._raw('rpm'), n = w.segments || 5;
            // the orange lights fill from "from" (3000) up to where the red block comes on (4500 on the X3 30e, the setting
            // "shiftLightRed"); the red zone runs to "shiftLightFlash" (5500), where everything flashes
            const rs = this.ctx.settings.item('shiftLightRed'), fs = this.ctx.settings.item('shiftLightFlash');
            const red = rs ? this.setting('shiftLightRed') : isNum(w.red) ? w.red : this._shift().rpm;
            const flash = Math.max(red + 100, fs ? this.setting('shiftLightFlash') : isNum(w.flash) ? w.flash : this.setting('redline'));
            const st = shiftLightState(rpm, { n, from: w.from, red, flash }, now), lit = st.lit, blink = st.flash;      // (8 Hz in the red zone's end)
            const key = lit + '|' + (blink ? 'f' : '');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_lit', [lit]);
            x.c.uniform(x.ref, 'u_flash', [blink ? 1 : 0]);
        } else if (w.type === 'lights') {
            const rpm = this._raw('rpm'), sp = this._shift(), n = this._wings(w) ? Math.ceil((w.count || 12) / 2) : w.count || 12;
            // the lights fill from "from" rpm (3000) up to the shift point; a "from" at or past it means the last 500 rpm
            const from = Math.min(isNum(w.from) ? w.from : 3000, sp.rpm - 500);
            const lit = isNum(rpm) ? Math.floor(Math.min(1, Math.max(0, (rpm - from) / (sp.rpm - from))) * n) : 0;
            const key = lit + '|' + sp.now;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_lit', [lit]);
            x.c.uniform(x.ref, 'u_strobe', [sp.now ? 1 : 0]);
        }
    }

    /** A rounded tag: fill in the tone colour (bright for a fresh grade), text centred on it. Empty text: nothing. */
    _paintBadge(w, s, tone, fresh) {
        const W = w.w, H = w.h, buf = Buffer.alloc(W * H * 4, 0);
        if (!s) return buf;
        const r = Math.min(6, H / 2), fillA = fresh ? 0.45 : 0.2;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                // rounded-rect coverage, 1 px soft edge
                const qx = Math.max(Math.abs(x + 0.5 - W / 2) - (W / 2 - r), 0), qy = Math.max(Math.abs(y + 0.5 - H / 2) - (H / 2 - r), 0);
                const cov = Math.min(1, Math.max(0, r + 0.5 - Math.sqrt(qx * qx + qy * qy)));
                if (cov <= 0) continue;
                const o = (y * W + x) * 4;
                buf[o] = tone[0]; buf[o + 1] = tone[1]; buf[o + 2] = tone[2]; buf[o + 3] = Math.round(255 * fillA * cov);
            }
        }
        const font = textRaster.loadFont(w.font);
        const ty = Math.round((H - font.metrics.cellHeight) / 2);
        const m = textRaster.mask(W, H, s, { font: w.font, align: 'center', spacing: w.spacing, offsetY: ty });
        const tc = fresh ? this.theme.fg : tone;
        for (let i = 0; i < m.length; i++) {
            if (!m[i]) continue;
            const a = m[i] / 255, o = i * 4, ba = buf[o + 3] / 255;
            const outA = a + ba * (1 - a);
            for (let c = 0; c < 3; c++) buf[o + c] = Math.round((tc[c] * a + buf[o + c] * ba * (1 - a)) / outA);
            buf[o + 3] = Math.round(outA * 255);
        }
        return buf;
    }

    /** "x/y" at every step, uploaded as small rects (not the whole, mostly empty, image). */
    _paintGridLabels(x) {
        const w = x.w, W = w.w, H = w.h, step = w.step || 100, font = w.font;
        const cell = textRaster.loadFont(font).metrics.cellHeight;
        const rects = [], parts = [];
        for (let gy = 0; gy < H; gy += step) {
            for (let gx = 0; gx < W; gx += step) {
                const label = (w.x + gx) + '/' + (w.y + gy);
                const lw = Math.min(W - gx - 2, textRaster.measure(label, font, 0) + 2);
                const lh = Math.min(H - gy - 2, cell);
                if (lw <= 0 || lh <= 0) continue;
                const buf = textRaster.drawText(lw, lh, label, { font, color: [255, 230, 0, 255] });
                rects.push({ x: gx + 2, y: gy + 2, w: lw, h: lh });
                parts.push(buf);
            }
        }
        this._blit(x, rects, Buffer.concat(parts));
    }

    _paintStripe(x) {
        const w = x.w, buf = Buffer.alloc(w.w * w.h * 4, 0);
        for (let px = 0; px < w.w; px++) {
            const c = M_STRIPE[Math.min(2, Math.floor(px * 3 / w.w))];
            for (let py = 0; py < w.h; py++) c.forEach((v, i) => { buf[(py * w.w + px) * 4 + i] = v; });
        }
        this._blit(x, null, buf);
    }

    _paintScale(x) {
        const w = x.w, n = this._barMax(w) / 1000 + 1, red = this.setting('redline');
        const m = Buffer.alloc(w.w * w.h, 0), hot = Buffer.alloc(w.w * w.h, 0);
        // the rev bar right above this scale (same x and width) in driver camera wings: no numbers (they'd only fit one wing)
        const bar = (this.shown || []).filter((b) => b.type === 'shiftbar' && b.x === w.x && b.w === w.w && b.y < w.y)
            .sort((a, b) => b.y - a.y)[0];
        if (bar && this._wings(bar)) { this._blit(x, null, Buffer.alloc(w.w * w.h * 4, 0)); return; }
        for (let i = 0; i < n; i++) {
            const label = String(i);
            const lw = textRaster.measure(label, w.font, 0);
            const cx = i / (n - 1) * w.w;
            const left = Math.round(Math.max(0, Math.min(w.w - lw, cx - lw / 2)));
            const one = textRaster.mask(w.w, w.h, label, { font: w.font, x: left });
            const into = w.redFrom && i * 1000 >= red ? hot : m;
            for (let k = 0; k < m.length; k++) if (one[k] > into[k]) into[k] = one[k];
        }
        const buf = textRaster.tint(m, w.w, w.h, { color: color(this.theme, w.color || 'dim'), font: w.font });
        if (w.redFrom) {
            const hb = textRaster.tint(hot, w.w, w.h, { color: this.theme.hot, font: w.font });
            for (let k = 0; k < hot.length; k++) if (hot[k]) hb.copy(buf, k * 4, k * 4, k * 4 + 4);
        }
        this._blit(x, null, buf);
    }
}

/** A theme with its whites and greys (any colour with little tint) at k brightness; colours keep theirs. */
function dimTheme(theme, k) {
    const out = {};
    Object.keys(theme).forEach((key) => {
        const c = theme[key];
        const grey = Array.isArray(c) && c.length >= 3 && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 40;
        out[key] = grey ? [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)].concat(c.length > 3 ? [c[3]] : []) : c;
    });
    out.name = theme.name;
    return out;
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }
function mib(bytes) { return (bytes / 1048576).toFixed(1) + ' MiB'; }

HudApp.driveModeOf = driveModeOf; HudApp.driveNameOf = driveNameOf; HudApp.driveVariantOf = driveVariantOf;   // for tools/test_drive_modes.js
HudApp.viewsOf = viewsOf;
HudApp.VIEW_ORDER = VIEW_ORDER;
module.exports = HudApp;
