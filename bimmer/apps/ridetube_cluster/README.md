# RideTube on cluster

Shows the video that [RideTube](https://github.com/JustAnotherPU/ridetube) plays on the centre screen in a ShakTheme window
on the instrument cluster and on the HUD. **Only while the car stands.** Not tried on a car yet.

## Parked only, with no switch

The picture shows only when the car's speed is known, fresh (read less than 5 s ago) and zero, and has been for 2 seconds.
The first reading that is not (the car moves, the speed is unknown, the readings stop) hides the picture at once and gives the
theme its window back. There is no setting for this. The sound is RideTube's own and is not touched.

## What it does

- **Cluster:** asks the theme for its centre window (the one Waze's map uses), waits until it is open, and draws the video
  inside it, 16:9, scaled to the window. With no theme showing, nothing is drawn on BMW's own cluster. While Waze's map or a
  Cluster Centre / Cluster Info page is in the window, no picture.
- **HUD:** in the room HUD Widgets leaves free; without HUD Widgets, in the right part of the HUD, clear of BMW's own speed.
- At most 15 frames a second and 640 px wide: the head unit is also decoding the video.
- A paused or stopped video frees the window after 1.5 s.

## Settings (both off by default)

- **Video in the cluster theme's window (parked only)**
- **Video on the HUD (parked only)**

## Needs

- RideTube and its service, both from this repository's `ridetube/` folder (the service has one change: it lets apps read the
  decoder's frame file). Install them from the same Store source as this app.
- cluster-render (as ShakTheme), and for the cluster a ShakTheme theme showing.

## Tests

`node tools/test_video_bridge.js` and `node tools/test_video_app.js` (made-up frames and a fake speed). Not run on a car.
