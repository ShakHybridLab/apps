# ShakCamDiag 0.1.0 — prototype de diagnostic iDrive 7

## Objectif
Application séparée de ShakTheme, en lecture seule, pour relever les indices d'accès vidéo sur le MGU du BMW X3 G01.

## Sécurité
- N'ouvre aucun `/dev/video*`.
- N'ouvre aucun socket BMW / AVB et ne démarre/arrête aucun service.
- N'écrit dans aucun dossier système.
- Ne change ni Waze, ni ShakTheme, ni les réglages du véhicule.
- Un nœud `/dev/video*`, un service `dasvideo` ou un fichier partagé ne prouve pas qu'un flux avant/arrière est disponible.

## Ce que l'application relève
- Vitesse et position du sélecteur via les signaux BMW déjà utilisés dans ShakTheme.
- Existence de quelques chemins connus et noms liés à camera/video/AVB dans `/dev`, `/sys/class/video4linux` et `/sys/class/net`.
- Les chemins trouvés sont inscrits dans le journal de l'application.

## Limites connues
Cette version ne décode pas les images et ne sait pas associer un périphérique générique à la caméra avant ou arrière. Elle ne peut donc pas valider les deux flux. La prochaine étape, après récupération du journal sur le véhicule, sera d'identifier l'interface réelle et les permissions requises avant de développer un bridge privilégié.

## Installation de test
À intégrer dans l'arborescence des applications Bimmer selon le mécanisme de déploiement habituel du dépôt. Ce ZIP est un prototype source, pas un paquet compilé ni un dépôt GitHub.

## Tests locaux
Depuis ce dossier : `node test/test.js`.
