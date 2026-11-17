# shakpark-capture (squelette)

Service root qui fournit à **ShakPark** les images de la caméra avant ou arrière. **Pas encore installable depuis le Store** : il n'est pas déclaré dans `mgu-repo.json` tant que le décodeur natif n'existe pas.

## Ce qui est fait (testé ici, `node shakpark-capture/test_capture.js`)
- `capture.js` : lit `/dev/shm/shakpark-capture/request.json` (`{ t, cam: 'front'|'rear'|'off' }`, écrit par ShakPark toutes les 500 ms). Demande fraîche (moins de 2 s) : il lance `<décodeur> <cam> /dev/shm/shakpark-<cam>`. `off` ou demande périmée : il garde le décodeur 3 s, l'arrête, supprime le fichier. Une seule caméra à la fois. Un décodeur qui meurt est relancé (2 s entre essais, 5 essais) puis le service reste en vie à l'état `failed`. État dans `status.json`, même dossier.
- `mgvf_writer.js` : écrit le format MGVF que `bimmer/shared/video_bridge.js` lit (testé avec ce lecteur).
- `fake_decoder.js` : décodeur de test, même ligne de commande que le vrai.
- `component.json` + `jap-shakpark-capture.service` : modèle `ridetube/service`.

## Ce qui manque : le décodeur natif `shakpark-decode <front|rear> <fichier>`
Il doit ouvrir le flux de la caméra et écrire des images I420 en MGVF dans `<fichier>` (largeur multiple de 4). Deux inconnues que **seule la voiture** peut donner (pages « Caméras » de l'onglet Signals de ShakTheme) :
1. la demande au calculateur caméra (`CameraProxy` / `ICAM2Proxy`, SOME/IP) : noms des méthodes et arguments, pour choisir avant / arrière ;
2. le flux vidéo AVB de la caméra (nom du flux, H.264 ou MPEG-TS).

Base de code possible, sous GPL-3.0 : `robertnisipeanu/idrive-apps`, `waze-on-cluster` (`avb_source`, `rtp_h264`, `nal_reader`, `decoder_msdk`). Le code de Turn View (licence PolyForm Strict) n'est ni copié ni lu pour l'écrire.

## Règle de sécurité à l'installation
Quand le nom du signal sera connu, la première version ne déclarera QUE ce signal, pour qu'un refus de la voiture ne bloque rien d'autre.
