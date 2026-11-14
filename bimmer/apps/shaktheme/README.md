# ShakTheme

<img src="icon.png" width="72" align="left" alt="ShakTheme logo">

By shakzer. Redraws the whole instrument cluster of an iDrive 7 BMW in one of four themes: **Sport**, **M**, **M Blade** and **Navi**. Open **ShakTheme** from the apps menu on the center screen: its own menu (after BMW's iDrive 8.5) has the themes with pictures, the badge, the Waze map, warnings, display and settings.

<p align="center"><img src="../../docs/images/page-cluster-themes.png" width="900" alt="The ShakTheme page on the center screen"></p>

## Themes

Four themes, plus BMW's own cluster.

### M

A current M8's cluster, traced off a photo of it and drawn on black.

- **Middle:** two bowed glass rev blades either side of the gear and speed, reading 0 to 7000 rpm like the M40i's own cluster. A red marker rides each blade at the rpm, the blade glows below it, and orange and red marks sit before and past your redline. The gear shows with its shifter programme: P, D3, S3 or M3.
- **Left:** a black card with a grey rim, filling the panel from top to bottom, with the tyre block: pressure and temperature at each corner round a car glyph (from the car's tyre monitor, read every 10 seconds, in the car's own units). The fuel dial sits over the card's lower corner, drawn like the M8's: a thin glass bracket inside a hatched chrome bezel, lit from the bottom up to the level, with a red streak at the level and another at the reserve.
- **Right:** what the engine, chassis, steering and gearbox are set to, as rows with a step bar (two above BMW's black gear box and two below it, since the car paints over that spot), and the oil temperature dial, the same glass bracket (blue streak at the cold end, red at the hot end). The rows follow the drive mode buttons: Hybrid, Electric, Electric Eco Pro, Sport, Sport Plus and Xtraboost. The car only reports that an Individual setup is on, not what each part is set to, so those rows read INDIVIDUAL.
- **Bottom:** range, the clock, and the outside temperature.

<p align="center"><img src="../../docs/images/cluster-m.png" width="900" alt="M theme"></p>

### Sport

The look of BMW's newer Live Cockpit Sport view.

- **Left:** speed as a blue bracket on BMW's 0 to 200 mph scale (0 to 320 km/h), with the digital speed and a fuel bar inside it.
- **Right:** revs as a red bracket on the M40i's 0 to 7000 rpm scale, with yellow and red marks around your redline, with the gear and an oil temperature bar inside it.
- **Middle:** deep navy with a lighter glow and a faceted pattern of lozenges, as on BMW's Sport view, or the Waze map with "Show Waze map inside the theme" on. The whole panel behind the brackets is navy too, not black (the setting "Blue background", 80 % by default, 0 = black).
- **Bottom:** boost in the blue and red strip (the battery's power in kW instead of it while eDrive Live shares one, see "Sport theme: energy flow"), plus the clock, range and outside temperature.

<p align="center"><img src="../../docs/images/cluster-sport.png" width="900" alt="Sport theme"></p>

### M Blade

A blue M card on the left and one big red rev blade on the right (0 to 7000 rpm, with the marks around your redline), copied from a screenshot of a cluster style seen online. Added next to M and Sport, they are not replaced. Both have the same navy faceted backdrop as the Sport theme instead of black (setting "Blue background (Sport, M Blade, Navi)"; BMW's black gear box, which the car draws over the panel and which cannot be removed, sits in a rounded dark window with a soft shadow so it does not show as a hard rectangle; the map window stays see-through).

- **Left:** a blue card with M-coloured stripes and the speed, big, on a dark plate (no gear: BMW's own black box at the right already shows it). With "Show Waze map inside the theme" or Cluster Centre on, the theme is rebuilt as the Sport theme is: the window opens in the middle (the map's full height), the rev blade stays on the left, the card with the speed moves to the right, with the gauges under it. Nothing is hidden under the map. (Waze draws its map at a fixed place, the centre of the panel, and BMW's black gear box covers its right edge, so the window shows the middle 852 px of it; it cannot sit on the card as in the screenshot.)
- **Right:** the revs as the red blade, then two thin slanted gauges: the **hybrid battery** (in the place the photo has an oil gauge) with the electric range under it, and the **fuel** with the range under it. The battery charge is also written at the bottom right, the clock at the bottom left.
- **Oil and outside temperature:** in the free space on the right, under BMW's black gear box.
- **Top:** the shift light, which sits where BMW's own does. There is no ONE OF ONE lettering in this theme: centred under the shift light it ran into the card and the blade.

<p align="center"><img src="../../docs/images/cluster-mblade.png" width="900" alt="M Blade theme"></p>

### Navi

A diagonal speed band on the left, a big rounded window in the middle for the map and a thin line along the bottom, copied from the same screenshot.

- **Left:** the speed as a blue band running down to the lower right, with the speed scale along its edge and a purple band beside it. With the middle window closed, the speed is big in the centre (no gear: BMW's own black box already shows it); with it open, the band gets steeper and narrower to stay left of the window, and the gear and speed go big on the right.
- **Middle:** the map window (Waze on Cluster, or the pages of Cluster Centre and Cluster Info). Black with a thin outline when nothing shows in it.
- **Bottom:** a fuel bar with its range at the left, the clock, and a hybrid battery bar with its charge and electric range at the right. Oil and outside temperature are in the free space on the right.
- **Top:** the shift light, and under it, centred above the speed, the ONE OF ONE lettering (from the "lettering" setting). The lettering goes away while the middle window is open, so it never covers the Waze map.

Neither theme has been tried on a car; they are checked on the bench against the screenshot and for BMW's black gear box, seat-belt light and the hood. The gear letters use the app's own font, not the boxed one of the screenshot.

**Danger zone alert (M Blade and Navi, off by default).** Both can draw a Waze-style card while a danger zone is ahead: a camera, DANGER, the distance and, when it is known, the speed limit in a red ring. On M Blade it sits under the card on the right, on Navi in the top strip beside the shift light; both stay clear of the map window, so the map is never covered. **This app cannot find a zone by itself.** It has no position and no map data (CarPlay gives the car the picture of Waze's map and nothing else), so it only shows what another app tells it, through a file: `/dev/shm/cluster-themes/danger-<app>.json` with `{ "t": <ms since 1970, now>, "app": "<name>", "distance": <metres>, "limit": <km/h, optional> }`, rewritten about once a second (the card goes three seconds after the file stops; the nearest zone wins when several apps write). Nothing writes that file yet, so with the setting on the card stays hidden. The wording is "danger zone" on purpose: in France only zones may be announced, not the exact place or the kind of a speed camera (décret n° 2012-3); this is not legal advice. Checked on the bench with a fake source, not on a car.

<p align="center"><img src="../../docs/images/cluster-navi.png" width="900" alt="Navi theme"></p>

## Off and drive modes

- **Off (BMW's own cluster):** pick it as the theme and the app draws nothing, so BMW's cluster comes back.
- **Sport theme: lettering at the top** (the upright, light stacked ONE / OF / ONE, number 4b, by default): thirteen "ONE OF ONE" / "1/1 EDITION" lettering options for the top centre of the Sport theme, painted in the M theme's colours as a gradient. It is our own lettering, not a brand's logo; it is hidden while the Waze map shows inside the theme. Navi also has it, centred under its shift light; M Blade has none. The images are baked by `tools/bake_emblems.py`.
- **Change with the drive mode** (on by default): the cluster follows the drive mode switch of a plug-in hybrid (X3 30e, no Comfort), with a theme for each of three slots: Electric Eco Pro (also Electric and Electric Individual), Hybrid (also Battery Control), and Sport Plus (also Sport, Sport Individual and Xtraboost). Out of the box, Sport Plus shows the M theme, Electric Eco Pro shows the Sport theme, and Hybrid leaves BMW's own cluster. Every theme also writes the real mode name small at the bottom right, as the car's own screen names it. Until the car reports a mode, the plain theme setting is used.
- **M cars:** the Efficient, Sport and Sport+ modes of M cars are not recognised yet, so the theme doesn't change with them. The last line of the Settings tab shows the value your car sends; please post it in an issue so it can be added.
- **With HUD Widgets:** on cluster-render 0.5.1 and newer, a cluster theme and a HUD layout show at the same time. On older cluster-render they share one screen slot and take turns: pick a theme while the HUD is on and the page asks whether to turn HUD Widgets off, and it asks the same the other way round.

## Settings

- **Theme**, and one per drive mode.
- **Show Waze map inside the theme:** Sport, M, M Blade and Navi open a window in the middle and Waze on Cluster draws its map in it, above BMW's own map view, so nothing shows twice. When the map goes away the theme fills back in. While it is on, Waze's map on the HUD is off. Needs the Waze on Cluster app; turning it off gives Waze its usual place back.
- **Blue background (Sport, M Blade, Navi):** how strong the navy faceted backdrop is, in % of the car's own blue (80 % by default, 0 = pure black, up to 140 %). The car brightens dark tints, so set it by eye. The M theme keeps its black background.
- **Backdrop facets (Sport, M Blade, Navi):** how strong the lozenge pattern is, 0 to 100 % (100 % by default; 0 = plain navy).
- **Sport theme: energy flow (kW) in place of the boost** (on by default): the Sport theme's bottom strip shows the high-voltage battery's power in kW (negative = charging, recuperation) instead of the boost while another app shares it. eDrive Live 1.9.6 or later does, when this app asks for it (it writes its own `wanted-shaktheme.json` in `/dev/shm/cluster-info`, once a second, and removes it when the theme no longer needs it). When nothing shares the power, or eDrive Live stops (3 s without an update), the boost is shown as before. Off: the boost always stays. The other themes keep their boost.
- **Oil / Coolant temperature: blue below** (M theme): the oil and coolant readouts in the M theme's bottom row are blue while cold (under 75 °C for the oil, 70 °C for the coolant by default), green once warm, and flash bright red and dark red over their warning limit. 0 = never blue.
- **Danger zone alert (M Blade and Navi):** shows the alert card while another app reports a zone ahead (see the two themes above). Off by default; nothing appears until an app writes the file.
- **Badge:** the model name, like "BMW X3 M40i", as text in the theme's font (Sport and M, at the bottom). Off by default.
- **Warnings:** oil, coolant and boost limits. A readout over its limit flashes red (oil 130°C and coolant 115°C by default, boost off).
- **Test the shift lights:** runs the rpm up to the shift point for about 4 seconds while the car stands.
- **Night colours:** after sunset the theme's whites and greys dim to 60% (Auto, the default), or Off.
- **Units:** mph, °F, psi or km/h, °C, bar.
- **Clock:** 12-hour or 24-hour.
- **Time zone (clock):** the head unit's clock runs on UTC, so pick your zone once. Named zones (US Eastern, Central, Mountain, Pacific, Alaska, Hawaii, Arizona, Canada Atlantic, Mexico, UK / Ireland / Portugal, Central Europe, Eastern Europe) change for daylight saving by themselves; for anywhere else, pick your offset from UTC. Night colours uses the same zone to work out sunset.
- **Fuel tank size:** the fuel gauge asks the engine unit for the level in %. Where the engine unit doesn't answer, it works it out from the litres the car reports and this size (65 L on an X3, 59 L on a 3 Series).
- **Redline:** where the red marks start on the rev scales (they always cover at least the last 500 rpm, and the yellow marks sit in the 700 rpm before them).
- **Shift point before redline:** how far below the redline the shift lights peak (300 rpm by default).
- **Cold-engine rev guard:** until the oil reaches 80°C, the shift point starts at 4500 rpm and climbs as the oil warms up.
- **Show boost.**
- **Leave BMW's bottom strip clear** (off by default): the theme draws only above BMW's own bottom strip (range, clock, belt light, P), squeezed a little to fit. Try it if BMW draws black boxes over the theme: one M car owner found that leaving the strip clear stopped them (issue #5). Not yet tested on a car with this setting.
- **Leave room for the driver camera** (off by default): for newer cars with a driver attention camera in the top middle of the cluster, where other cars show the model badge. The shift light moves aside and M's logo is hidden. The camera's spot is taken from where the badge sits on a car without one. Not yet tested on a car with a camera; please report how it lines up on yours.
- **Demo data:** fake driving data for trying it out parked.
- **Calibration grid:** a theme that draws lines every 50 px with labels, for checking on a photo where things land on the real screen. It also carries a few test marks used to measure cluster-render's limits on the car.
- **Map calibration:** a theme that leaves BMW's whole map window open with a grid through it, for photographing exactly what shows through the map cut-out with a navigation map up.

<p align="center"><img src="../../docs/images/page-cluster-settings.png" width="900" alt="The Settings tab with the time zone set to US Eastern"></p>

**Shift grades:** every upshift is graded on its peak rpm. EARLY means more than 250 rpm under the shift point, LATE more than 200 over it, COLD REV the same while the cold guard is on, LIMITER within 25 rpm of the redline, and anything in between is SPOT ON. Only shifts aimed at the shift point are graded: one more than 1500 rpm under it (an everyday shift) or one the gearbox made itself in D or S is left out, and the last grade stays on screen. When Redline 2.0.28 or newer is running, the shift point and the grade come from Redline, which learns a shift point for each gear.

## Requirements

[cluster-render](https://github.com/robertnisipeanu/idrive-apps), installed from the `robertnisipeanu/idrive-apps` Store source. Version 0.5.1 or newer lets the theme show together with HUD Widgets.

## On the car

**Not tried on a car yet.** Everything was checked on the bench (the themes drawn frame by frame, the menu in the kit's emulator) and by automatic tests (`node tools/test_*.js`). To be checked in a real X3 30e:

- the four themes on the real screen, with and without the Waze map window;
- whether BMW's warning lights still show over the themes (start the car with a seat belt off and look);
- the battery charge and power readings, and the drive mode numbers the car sends;
- the clock with a named time zone, and the fuel % from the engine unit;
- the menu on the real centre screen (the emulator may differ a little).

If something looks wrong on your car, the last line of the Settings tab says what the app is doing and why anything is not drawn.

See [Use at your own risk](../../README.md#use-at-your-own-risk) before installing.

Version history is in the repo's [CHANGELOG.md](../../CHANGELOG.md).

## Licence

ShakTheme's changes and additions are by shakzer, under the MIT licence. The app builds on code under other free licences, whose notices must stay with it: see `NOTICE` and the repository's `LICENSE` and `LICENSES.md`.
