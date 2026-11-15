# ShakHUD

<img src="icon.png" width="72" align="left" alt="icône ShakHUD">

Un HUD pour le pare-brise de l'iDrive 7, par shakzer. Son premier thème, **M Style**, est un compte-tours en barre brisée : une montée en
biais, puis un plat jusqu'à 7, avec les chiffres dessous. Pas encore essayé sur la voiture : le shader et la mise en page tournent sur le banc d'essai.

## M Style

- **Moteur allumé :** la barre se remplit en rouge avec le régime ; la zone rouge commence au réglage « Zone rouge » (7000 par défaut). Les chiffres sont des milliers de tr/min.
- **Électrique (moteur éteint) :** la barre devient bleu clair et montre la puissance de la batterie, 10 kW par graduation (« kW x 10 » sous la barre).
- **Recharge (moteur éteint, puissance qui rentre dans la batterie) :** verte, avec « CHARGE » sous la barre.
- Les deux derniers demandent eDrive Live (ou une autre appli qui partage la puissance de la batterie, `/dev/shm/cluster-info`) et le réglage **Compte-tours hybride** (activé par défaut). Sans mesure de puissance, la barre montre seulement le régime.
- **Shiftlight :** celui de BMW, sous les chiffres : cinq voyants inclinés de chaque côté d'un bloc rouge, qui se remplissent de l'extérieur vers le centre dès 3000 tr/min, bloc rouge à 4500, clignotement rouge à 5500 (réglages **Le shiftlight passe au rouge à** et **clignote à partir de**).
- **En bas à droite :** la charge de la batterie en gros, l'autonomie électrique et l'autonomie essence à côté, une barre de batterie inclinée (bleu clair ; verte en recharge ; ambre sous 15 %) et les températures d'huile (icône de burette) et du liquide de refroidissement (icône de thermomètre), sans mots (bleu à froid, vert à chaud, rouge clignotant au-dessus de la limite). Réglage **Batterie, autonomies et températures**. Le bloc reste à droite de la vitesse de BMW.
- **Zones (0.3.0) :** la barre est blanche au départ, **orange** 700 tr/min avant la zone rouge, **rouge** dans la zone ; en électrique (bleu clair) et en recharge (vert), elle garde ses couleurs. L'autonomie essence à 90 km ou moins et la batterie à 10 % ou moins passent au rouge (réglages **Réserve : autonomie essence en rouge à partir de** et **Réserve : batterie en rouge à partir de**). Les icônes d'huile et de liquide ont la couleur de leur chiffre.
- **Finitions (0.4.0) :** fondu doux entre les couleurs de zone, fin trait blanc qui garde la pointe du régime 1,5 s, et balayage de la barre au démarrage à l'arrêt (réglage **Balayage des barres au démarrage**).
- **Finitions (0.5.0) :** l'autonomie du bas est la **totale** (carburant + électrique) avec une icône pompe-éclair ; une petite roue avec la **pression la plus basse** s'affiche en haut à gauche, jaune puis rouge, **seulement** quand un pneu est sous le réglage **Pneus : pression en jaune sous** (2,0 bar par défaut, 0 = jamais ; l'appli lit alors le TPMS du véhicule) ; l'huile et le liquide clignotent trois fois en blanc quand ils arrivent à chaud (pas au démarrage si le moteur est déjà chaud).
- **Launch Control Ready (0.6.0) :** voiture immobile en mode Sport, moteur à 2 000 tr/min ou plus (le pied sur l'accélérateur), un drapeau à damier et « Launch Control Ready » s'affichent en vert en bas, au centre de l'image ; le chrono 0-100 compte dès que la voiture démarre. Réglages **Drapeau « Launch Control Ready » (mode Sport, à l'arrêt)** et **Launch Control Ready : à partir de** (0 = dès l'arrêt). L'appli ne lit ni le launch control de la voiture ni le frein.
- **Waze :** quand Waze on Cluster affiche sa carte, tout le HUD s'éteint pour ne rien mettre dessus (réglage **Cacher tout le HUD quand la carte Waze est affichée**).
- Les couleurs suivent le thème du HUD (Auto : couleurs M de jour, ambre après le coucher du soleil ; onglet Couleurs).
- Tout est en français, en km/h, °C et 24 h par défaut ; la page de l'écran central, les réglages et les textes du HUD (les mots sont courts et naturels : CHARGE, tr/min ; les températures n'ont qu'une icône).

## Partage du HUD

ShakHUD et HUD Widgets sont deux applis du kit : quand les deux sont actives, elles se partagent le HUD par `hud_claim` et l'une s'efface devant l'autre.
Mets l'autre appli sur « Éteint » pour être sûr. ShakTheme (le cluster) n'est pas touché.

## Réglages

La page de l'écran central : **Thèmes** (éteint ou M Style, aussi selon le mode de conduite), **Position** (déplacer et agrandir tout le HUD),
**Couleurs** et **Réglages** (unités, horloge, fuseau horaire, zone rouge, point de passage, compte-tours hybride, shiftlight, données de démonstration).
