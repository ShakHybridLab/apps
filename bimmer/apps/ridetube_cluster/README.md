# RideTube on cluster

Shows the video that [RideTube](https://github.com/JustAnotherPU/ridetube) plays on the centre screen in a ShakTheme window
on the instrument cluster and on the HUD. **Only while the car stands.** Not tried on a car yet.

## Parked only, with no switch

The picture shows only when the car's speed is known, fresh (read less than 5 s ago) and zero, and has been for 2 seconds.
The first reading that is not (the car moves, the speed is unknown, the readings stop) hides the picture at once and gives the
theme its window back. There is no setting for this and none will be added: a moving picture in the driver's instruments is
dangerous and, in most countries, illegal. The sound is RideTube's own and is not touched.

## What it does

- **Cluster:** asks the theme for its centre window (the one Waze's map uses), waits until it is open, and draws the video
  inside it, 16:9, scaled to the window: about 548 x 308 on M Blade, 640 x 360 on Navi and Sport, 444 x 250 on M. With no theme
  showing, nothing is drawn on BMW's own cluster.
- **HUD:** in the room HUD Widgets leaves free; without HUD Widgets, in the right part of the HUD, clear of BMW's own speed.
- At most 15 frames a second and 640 px wide: the head unit is also decoding the video.
- A paused or stopped video frees the window after 1.5 s.
- **Now playing (no picture):** where no picture shows (the car drives, or the picture's setting is off), a card with the
  video's title, its channel, a progress bar and the times, redrawn once a second. On the cluster it sits in the theme's window
  and stays away while Waze's map or a Cluster Centre / Cluster Info page is in it. Characters the font lacks are dropped.

## Settings (all off by default)

- **Video in the cluster theme's window (parked only)**
- **Video on the HUD (parked only)**
- **Now playing (title, no picture) in the cluster theme's window**
- **Now playing (title, no picture) on the HUD**

## Needs

- RideTube installed and working, in a build that lets other apps read its frame file (`/dev/shm/mgu-video-ridetube`). The stock
  RideTube keeps that file private and does not say what it plays, so with it this app shows nothing: install the service
  (0.3.92 or later) from `ridetube-fork/` at the root of this repository (its README has the steps).
- cluster-render (as ShakTheme), and for the cluster a ShakTheme theme showing.

## Not done yet

- A run on the car. On the bench it is driven by `tools/test_video_app.js` with made-up frames and a fake speed.
