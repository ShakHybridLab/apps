# RideTube, shakzer's fork (service only)

[RideTube](https://github.com/JustAnotherPU/ridetube) is JustAnotherPU's unofficial YouTube client for the BMW iDrive 7,
GPL-3.0-or-later. It is not affiliated with Google or YouTube, and this fork is not endorsed by its developer.

This folder holds **one changed component**, the RideTube service `jap-ridetube-d` **0.3.92**, made from the published 0.3.9
by `tools/patch_service.py`. The RideTube app itself is the original's 0.3.8, unmodified, downloaded from its own release.

## The two changes

Once the video decoder has made its frame file `/dev/shm/mgu-video-ridetube`, the service makes it readable by the apps' group
(`tm_oap_app`, the same group that may already use the service's control socket): mode 0640 instead of 0600, owner unchanged.
That lets **RideTube on cluster** (`bimmer/apps/ridetube_cluster`) show the video in a ShakTheme window on the instrument
cluster and on the HUD, **only while the car is parked**.

And while a video plays or is paused, the service writes `/run/jap-ridetube-d/now.json` once a second (state, title, channel,
position, length; removed when nothing plays), for that app's "now playing" card: words only, the one thing it shows while driving.

Thirty-one lines of `ytd.js` in all; the decoder binary, yt-dlp and every other file are byte for byte the original's (the script
checks the original's sha256 and each file's hash).

What it means: any app installed on the head unit can now read the frames of the video being played, and its title. Install only apps you
trust (the original already says so of its control socket).

RideTube's own rule is kept: while the car drives it stops decoding the picture, so no frames exist to show anywhere.

## Install (MGU Store)

1. Remove the original first if it is installed: the **RideTube** app, then the **RideTube service** (this deletes the
   YouTube sign-in).
2. Keep the source `JustAnotherPU/mgu-apps:releases` (Node.js 22 comes from it).
3. Add this catalog as a source: `https://raw.githubusercontent.com/shakzer/x3-hybride/main/ridetube-fork/catalog.json`
4. Install **RideTube service (shakzer fork)**, then **RideTube**, from this source. Sign in again in the app.
5. From the source `shakzer/x3-hybride`, install **RideTube on cluster** and turn on the settings you want (all off by default).

To go back: remove the app and the service, then install RideTube from `JustAnotherPU/ridetube:releases`.

## Not tried on a car

Checked here: the original's own 65 service tests pass on the patched `ytd.js`, `now.json` is written and removed as described, and
the package's hashes match its catalog. Not checked: an install
from this catalog on a head unit, and that an app's process is in `tm_oap_app` and can open the file.

## Source and licence

The corresponding source is the original repository at the commit of its 0.3.9 service plus the change that
`tools/patch_service.py` applies (it is spelled out in the script). GPL-3.0-or-later; the licence and the third-party notices are
in the package (`files/LICENSE`, `files/THIRD_PARTY_LICENSES`).
