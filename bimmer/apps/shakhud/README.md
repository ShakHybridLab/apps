# ShakHUD

<img src="icon.png" width="72" align="left" alt="ShakHUD icon">

A HUD of its own for the iDrive 7 windshield, by shakzer. Its first layout, **M Style**, is a rev counter drawn as a bent bar: a rising
slant, then a level run to 7, with the numbers under it. It is made to sit with **Waze's HUD map** (Waze on cluster): thin lines and
small numbers only, nothing that fills an area, clear of BMW's own speed (bottom left) and of the turn-signal arrows (top middle).
Not tried on a car yet: the shader and the layout run on the bench.

## M Style

- **Engine running:** the bar fills in red with the rpm; the red zone starts at the redline setting (7000 by default; 6500 on the bar).
  The numbers are thousands of rpm.
- **Electric (engine off):** the bar becomes light blue and shows the battery's power, 10 kW a mark ("kW x 10" under the bar).
- **Charging (engine off, power going back into the battery):** green, with "CHARGE" under the bar.
- The two last need eDrive Live (or any app that shares the battery's power, `/dev/shm/cluster-info`) and the setting
  **Hybrid rev counter** (on by default). Without a power reading the bar shows the engine's rpm alone.
- The colours follow the HUD theme (Auto: day colours, amber after sunset; the page's Colours tab).

## Sharing the HUD

ShakHUD and HUD Widgets are both kit apps: when one is on (not "Off") and the other too, they share the HUD through the kit's
`hud_claim` and one steps aside. Set the other app's layout to Off to be sure. ShakTheme (the cluster) is not affected.
Waze's HUD map is another app's layer under ours.

## Settings

The page on the centre screen: **Layouts** (Off or M Style, also by drive mode), **Position** (move and scale the whole HUD),
**Colours**, and **Settings** (units, clock, time zone, redline, shift point, Hybrid rev counter, demo data).

## Files

- `hud/layouts/mstyle.json` is made by `tools/gen_shakhud.py` (the bar's points and the numbers' places are at its top).
- The effect is `mstyle` in `shared/shaders.js` and `shared/hud.js` (documented in the header of hud.js).
- `tools/test_shakhud.js` checks the app, the layout's places and the shader's wiring.
