# ShakHUD

<img src="icon.png" width="72" align="left" alt="icône ShakHUD">

Un HUD pour le pare-brise de l'iDrive 7, par shakzer. Son premier thème, **M Style**, est un compte-tours en barre brisée : une montée en
biais, puis un plat jusqu'à 7, avec les chiffres dessous. Pas encore essayé sur la voiture : le shader et la mise en page tournent sur le banc d'essai.

## M Style

- **Moteur allumé :** la barre se remplit en rouge avec le régime ; la zone rouge commence au réglage « Zone rouge » (7000 par défaut). Les chiffres sont des milliers de tr/min.
- **Électrique (moteur éteint) :** la barre devient bleu clair et montre la puissance de la batterie, 10 kW par graduation (« kW x 10 » sous la barre).
- **Recharge (moteur éteint, puissance qui rentre dans la batterie) :** verte, avec « RECHARGE » sous la barre.
- Les deux derniers demandent eDrive Live (ou une autre appli qui partage la puissance de la batterie, `/dev/shm/cluster-info`) et le réglage **Compte-tours hybride** (activé par défaut). Sans mesure de puissance, la barre montre seulement le régime.
- **Shiftlight :** celui de BMW, sous les chiffres : cinq voyants inclinés de chaque côté d'un bloc rouge, qui se remplissent de l'extérieur vers le centre dès 3000 tr/min, bloc rouge à 4500, clignotement rouge à 5500 (réglages **Le shiftlight passe au rouge à** et **clignote à partir de**).
- **En bas à droite :** la charge de la batterie en gros, l'autonomie électrique et l'autonomie essence à côté, une barre de batterie inclinée (bleu clair ; verte en recharge ; ambre sous 15 %) et les températures d'huile et d'eau (bleu à froid, vert à chaud, rouge clignotant au-dessus de la limite). Réglage **Batterie, autonomies et températures**. Le bloc reste à droite de la vitesse de BMW.
- **Waze :** quand Waze on Cluster affiche sa carte, tout le HUD s'éteint pour ne rien mettre dessus (réglage **Cacher tout le HUD quand la carte Waze est affichée**).
- Les couleurs suivent le thème du HUD (Auto : couleurs M de jour, ambre après le coucher du soleil ; onglet Couleurs).
- Tout est en français, en km/h, °C et 24 h par défaut ; la page de l'écran central, les réglages et les textes du HUD (HUILE, EAU, RECHARGE, tr/min).

## Partage du HUD

ShakHUD et HUD Widgets sont deux applis du kit : quand les deux sont actives, elles se partagent le HUD par `hud_claim` et l'une s'efface devant l'autre.
Mets l'autre appli sur « Éteint » pour être sûr. ShakTheme (le cluster) n'est pas touché.

## Réglages

La page de l'écran central : **Thèmes** (éteint ou M Style, aussi selon le mode de conduite), **Position** (déplacer et agrandir tout le HUD),
**Couleurs** et **Réglages** (unités, horloge, fuseau horaire, zone rouge, point de passage, compte-tours hybride, shiftlight, données de démonstration).
