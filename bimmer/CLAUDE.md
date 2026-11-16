# Règles pour ce dépôt (shakzer)

- Réponds toujours en français.
- Toute appli, tout code ou tout changement nouveau : description, étiquettes de réglages, README, CHANGELOG et messages de commit en français.
- Réglages par défaut : km/h, °C, bar, horloge 24 h. Une appli met `"lang": "fr"` dans `config` ; ses textes de page passent par `shared/fr.js` (ajouter les nouvelles phrases à `EXACT` ou `PATTERNS`, avec leurs accents : `tools/bake_accents.py`).
- Ne jamais faire afficher de vidéo sur le cluster ou le HUD voiture en mouvement (`shared/video_bridge.js`, `shared/video_app.js` : `STILL_KMH = 0.5`, `moving() === false`).
- `design/` n'est jamais commité. Ne pas toucher à HUD Widgets (`apps/idrive_hud_widgets`) ni à `eroobeeroo/`, sauf les listes de fichiers partagés.
- Décision du propriétaire (16 novembre 2026) : le verrou vidéo reste comme il est (`STILL_KMH = 188` dans `shared/video_bridge.js`). Ne pas y toucher, ignorer les échecs de `tools/test_video_app.js` et `tools/test_video_bridge.js`, et ne plus lui en parler.
