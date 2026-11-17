# ShakPark 0.1.0 — la caméra avant et arrière dans le cluster

Montre la caméra de la voiture dans la fenêtre centrale d'un thème de ShakTheme, sur le cluster de l'iDrive 7. **Pas encore essayé sur la voiture.**

## Les règles (sans réglage pour les changer)

| Situation | Image |
|---|---|
| Rapport **D**, vitesse connue et récente, **moins de 15 km/h** | caméra **avant** |
| Rapport **R** (marche arrière) | caméra **arrière**, et 2 s après avoir quitté R |
| Rapport P ou N, vitesse inconnue ou de plus de 5 s, **15 km/h et plus** | **aucune** image |

- La caméra avant n'apparaît qu'à moins de 14 km/h, après 400 ms, et disparaît dès 15 km/h (1 km/h d'écart pour qu'elle ne clignote pas).
- La caméra arrière s'éteint aussi à 15 km/h et plus quand la vitesse est connue.
- Dès que les règles disent « aucune », tout est caché dans le même tick et la fenêtre est rendue au thème.
- La caméra avant s'écarte quand la carte Waze ou une page d'une autre appli est dans la fenêtre ; la caméra arrière demande la fenêtre malgré eux (c'est le thème qui décide).
- 15 images par seconde au plus, 640 px de large au plus.

## Réglages

- **Caméra avant en avançant sous 15 km/h** (activé)
- **Caméra arrière en marche arrière** (activé)

## Ce qui manque : la capture de l'image

ShakPark **dessine** les caméras ; il ne les **capte** pas. Il lit deux fichiers d'images que l'outil de capture doit écrire (format MGVF de `shared/video_bridge.js`, I420) : `/dev/shm/shakpark-front` et `/dev/shm/shakpark-rear`. Sans ces fichiers, aucune image : l'appli reste muette.

L'outil de capture reste à écrire. Il lui faut deux choses que seule la voiture peut dire :

1. **Comment demander une caméra au calculateur** : les interfaces SOME/IP `de.bmw.infotainment.video.cameraproxy.CameraProxy` et `de.bmw.infotainment.video.cameraproxy.ICAM2Proxy` (leurs méthodes et leurs arguments ne sont écrits nulle part dans le dépôt ; photos de leurs pages du catalogue de Cluster Layouts demandées).
2. **Quel flux AVB porte l'image**, et son format (H.264 en RTP, comme le flux de Waze on cluster, `media_transport.avb_streaming.15` ?). Le décodage se fait avec l'Intel Media SDK de l'autoradio, comme Waze on cluster (GPL-3.0, robertnisipeanu/idrive-apps).

## Où c'est dans le dépôt

- `bimmer/apps/shakpark/` : l'appli (`app.json`, `main.js`).
- `bimmer/shared/park.js` : les règles (rapport, vitesse, caméra à montrer), sans accès à la voiture.
- `bimmer/shared/park_app.js` : la lecture des fichiers d'images et le dessin dans la fenêtre du thème.
- `bimmer/tools/test_park.js` : les tests.

Signaux déclarés : tous déjà acceptés par la voiture (`Vehicle2.statusCarSpeed2`, `VehicleInformation.statusGearboxDrive` et `DataPowerTrain2`).

## Compiler et tester

Depuis la racine du dépôt : `python3 bimmer/kit/tools/build.py shakpark`, puis `node bimmer/tools/test_park.js`.
