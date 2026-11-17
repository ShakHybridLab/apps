'use strict';
/**
 * fr.js - les textes de la page de l'écran central en français (ShakTheme, ShakHUD, RideTube cluster : "config": { "lang": "fr" }).
 * page.js passe chaque texte dessiné par tr() quand l'appli demande le français ; ce qui n'est pas dans la table reste tel quel.
 * Les accents viennent de tools/bake_accents.py (les polices de la page n'avaient que l'ASCII). Les noms de BMW (Hybrid, Hybrid Eco Pro,
 * Sport Plus, M Blade, Navi, Waze) ne sont pas traduits.
 */
const EXACT = {
    // onglets et titres
    'Readouts': 'Données', 'Position': 'Position', 'Map': 'Carte', 'Badge': 'Badge', 'Alerts': 'Alertes', 'G-meter': 'Capteur G',
    'Colours': 'Couleurs', 'Display': 'Affichage', 'Settings': 'Réglages', 'Layouts': 'Thèmes', 'Themes': 'Thèmes',
    'Now showing': 'Affichage actuel', 'Change with the drive mode': 'Changer avec le mode de conduite',
    'Theme': 'Thème', 'Layout': 'Disposition', 'Otherwise': 'Sinon', 'Off': 'Désactivé', 'On': 'Activé',
    "BMW's own": 'Celui de BMW', "BMW's own HUD": 'Le HUD de BMW', "BMW's own cluster": 'Le cluster de BMW',
    'HUD is off': 'HUD éteint', 'Tap to turn the HUD off': 'Touche pour éteindre le HUD',
    'At the redline': 'À la zone rouge', ' rpm before': ' tr/min avant', ' rpm': ' tr/min',
    // confirmation
    "A cluster theme and the HUD can't show at the same time.": "Un thème du cluster et le HUD ne peuvent pas s'afficher en même temps.",
    "The HUD and a cluster theme can't show at the same time.": "Le HUD et un thème du cluster ne peuvent pas s'afficher en même temps.",
    'Turn HUD off': 'Éteindre le HUD', 'Turn theme off': 'Éteindre le thème', 'Cancel': 'Annuler', 'Centre': 'Centrer',
    'Waze map is showing': 'La carte Waze est affichée', 'The HUD hides while the Waze map is showing.': 'Le HUD se cache tant que la carte Waze est affichée.',
    'Show the HUD': 'Afficher le HUD',
    'Hidden · Waze map is showing · tap the layout to show the HUD anyway': 'Caché · la carte Waze est affichée · touche la disposition pour afficher le HUD quand même',
    'Hidden · another app has the HUD': 'Caché · une autre appli a le HUD',
    'DEMO DATA': 'DONNÉES DE DÉMO',
    // thèmes
    '  ·  now': '  ·  actuel', 'none here': 'aucune ici', ' slots': ' emplacements', 'moved': 'déplacé', 'centred': 'centré',
    'warnings off': 'alertes éteintes', 'no picture': "pas d'image", 'no g reading': 'pas de mesure g',
    // position
    'Move': 'Déplacer', 'Size': 'Taille',
    'The dashed frame is the part of the HUD you can see.': 'Le cadre en pointillés est la partie visible du HUD.',
    'Every tap moves the real HUD right away.': 'Chaque appui déplace le vrai HUD tout de suite.',
    // carte (cluster)
    '(empty)': '(vide)', 'Subscribing': 'Abonnement en cours', 'The car does not answer': 'La voiture ne répond pas', 'Subscribed, nothing received': 'Abonné, rien reçu', 'Car signals': 'Signaux', 'Signals of the car, read only': 'Signaux de la voiture, en lecture seule', 'Not heard yet': 'Pas encore reçu',
    'Engine speed (rev counter)': 'Régime moteur (compte-tours)', 'Engine temperatures (oil, coolant)': 'Températures moteur (huile, liquide)', 'Car speed': 'Vitesse de la voiture',
    'Road sign read by the camera': 'Panneau lu par la caméra', 'Next limit read by the camera': 'Prochaine limite lue par la caméra',
    'Driver assistance: lane warnings': 'Aides à la conduite : alertes de voie', 'Driver assistance: steering wheel light': 'Aides à la conduite : voyant du volant',
    'Lane assist: steering wheel symbol': 'Maintien de voie : symbole du volant', 'Power meter: drive and recuperation': 'Puissance : propulsion et récupération',
    'Power meter: second reading': 'Puissance : seconde lecture', 'Power meter: cluster (drive and recuperation, %)': 'Puissance : compteur du tableau de bord (propulsion et récup., %)', 'Electric power: drive and air conditioning': 'Puissance électrique : propulsion et clim',
    'Check control message showing': "Message d'alerte affiché", 'Electric range (cluster)': "Autonomie électrique (tableau de bord)",
    'Photograph this page after a drive: it shows the last values the car sent.': 'Photographie cette page après un trajet : elle montre les dernières valeurs envoyées par la voiture.',
    'Not read in this version': 'Non lu dans cette version',
    '→ no limit read': '→ aucune limite lue', '→ no next limit': '→ aucune limite suivante', '→ not understood': '→ non compris', '→ wheel off': '→ volant éteint',
    'Photograph pages 1 and 2 after a drive: they show the last values the car sent.': 'Photographie les pages 1 et 2 après un trajet : elles montrent les dernières valeurs envoyées par la voiture.',
    "Steering wheel and stalk buttons (the car's catalog)": 'Boutons du volant et des manettes (catalogue de la voiture)',
    "Media: what is playing (the car's catalog)": 'Média : ce qui est en lecture (catalogue de la voiture)',
    "Speed limit signs (the car's catalog)": 'Panneaux de limitation de vitesse (catalogue de la voiture)',
    'Reading the car\'s catalog (once, a few seconds)...': 'Lecture du catalogue de la voiture (une seule fois, quelques secondes)...',
    "Electric motor, battery and power (the car's catalog)": 'Moteur électrique, batterie et puissance (catalogue de la voiture)',
    "Pedals, steering and road slope (the car's catalog)": 'Pédales, direction et pente de la route (catalogue de la voiture)',
    "Speed cameras and road hazards (the car's catalog)": 'Radars et dangers sur la route (catalogue de la voiture)',
    'Cameras: CameraProxy and ICAM2Proxy': 'Caméras : CameraProxy et ICAM2Proxy',
    'Cameras: next entries': 'Caméras : suite',
    'GPS: where the car is': 'GPS : où est la voiture',
    'GPS: next entries': 'GPS : suite',
    'Signals in the car\'s catalog': 'Signaux du catalogue de la voiture',
    'Catalog not readable': 'Catalogue illisible', "Nothing found in the car's catalog": 'Rien dans le catalogue de la voiture',
    'Names only, no values: photograph this page to give the names the app can read next.': "Les noms seulement, pas les valeurs : photographie cette page pour donner les noms que l'appli pourra lire ensuite.",
    'get: can be read; notify: told when it changes. Read only: nothing here changes the car.': 'get : lisible ; notify : prévenu à chaque changement. Lecture seule : rien ici ne change la voiture.',
    'Blue: what the app understood of the value. Read only: nothing here changes the car.': "Bleu : ce que l'appli a compris de la valeur. Lecture seule : rien ici ne change la voiture.",
    'Read only: nothing here changes the car.': 'Lecture seule : rien ici ne modifie la voiture.',
    'Show the map only with a route': "Carte seulement avec un itinéraire",
    'CarPlay guidance active (route)': "Guidage CarPlay actif (itinéraire)",
    'Navigation map on the cluster': 'Carte de navigation sur le cluster', 'Show Waze map inside the theme': 'Afficher la carte Waze dans le thème',
    'Not available in this app': 'Indisponible dans cette appli',
    'This theme has no map version (Sport, M, M Blade and Navi do)': "Ce thème n'a pas de version avec carte (Sport, M, M Blade et Navi en ont une)",
    'Centre window for Cluster Centre / Cluster Info': 'Fenêtre centrale pour Cluster Centre / Cluster Info',
    'Window open: Cluster Centre / Cluster Info draw in it': 'Fenêtre ouverte : Cluster Centre / Cluster Info y dessinent',
    'Asked for, opening': 'Demandée, ouverture en cours', 'Closed (nothing asks for it)': 'Fermée (personne ne la demande)',
    'Danger zone alert (M Blade and Navi)': 'Alerte zone de danger (M Blade et Navi)',
    'Nothing to show: it needs an app that tells it where a zone is (danger-<app>.json in /dev/shm/cluster-themes).':
        "Rien à afficher : il faut une appli qui indique où est la zone (danger-<appli>.json dans /dev/shm/cluster-themes).",
    'On: Sport, M, M Blade and Navi open a window in the middle and Waze on Cluster draws its map in it, above':
        'Activé : Sport, M, M Blade et Navi ouvrent une fenêtre au milieu et Waze on Cluster y dessine sa carte, par-dessus',
    "BMW's own map view, so nothing shows twice. When the map goes away the theme fills back in.":
        "la vue carte de BMW, donc rien ne s'affiche deux fois. Quand la carte part, le thème reprend la place.",
    "While on, Waze's map on the HUD is off (the cluster and the HUD share one picture).":
        'Activé, la carte Waze du HUD est éteinte (le cluster et le HUD partagent une seule image).',
    'Needs the Waze on Cluster app. Turning this off gives Waze its usual place back.':
        "Demande l'appli Waze on Cluster. Désactivé, Waze reprend sa place habituelle.",
    // badge
    'Series': 'Série', 'Model': 'Modèle', 'On the cluster': 'Sur le cluster', 'No badge': 'Aucun badge', 'BMW lettering': 'Lettrage BMW',
    "Drawn as text in the theme's own font.": 'Dessiné en texte avec la police du thème.', 'Sport and M show it at the bottom.': "Sport et M l'affichent en bas.",
    // alertes
    'Warnings · the readout flashes red over its limit': 'Alertes · la valeur clignote en rouge au-dessus de sa limite',
    'Warm-up colours · blue below, green above': 'Couleurs de chauffe · bleu en dessous, vert au-dessus',
    'Shift lights': 'Shiftlight', 'Test the shift lights': 'Tester le shiftlight', 'Running': 'En cours', 'Stop the car first': "Arrête d'abord la voiture",
    'Run test': 'Lancer le test', 'Runs the rpm up to the shift point for': "Monte le régime jusqu'au point de passage pendant",
    'about 4 seconds: the lights fill, go red': 'environ 4 secondes : les voyants se remplissent, passent au rouge',
    'and flash. Only while the car stands.': "et clignotent. Seulement voiture à l'arrêt.",
    'Set a limit to 0 (Off) to turn it off.': 'Mets une limite à 0 (désactivé) pour la couper.',
    // capteur G
    'Range': 'Échelle', 'Trail': 'Traînée', 'Swap left / right': 'Inverser gauche / droite', 'Brake on top': 'Freinage en haut',
    'BEST THIS DRIVE, IN G': 'MEILLEUR DE CE TRAJET, EN G', 'Left': 'Gauche', 'Right': 'Droite', 'Accel': 'Accél.', 'Brake': 'Frein', 'Peak': 'Pic',
    'Reset': 'Remise à zéro', 'Live': 'En direct', 'BRAKE': 'FREIN', 'ACCEL': 'ACCÉL.',
    "From the car's own acceleration sensor. Parked on level ground it reads 0.00; hills add a little.":
        "Vient du capteur d'accélération de la voiture. À l'arrêt sur du plat il lit 0,00 ; les pentes en ajoutent un peu.",
    'The outline is the most g this drive in every direction; Reset clears it with the bests.':
        "Le contour est le maximum de g de ce trajet dans chaque direction ; la remise à zéro l'efface avec les meilleurs.",
    // couleurs
    'Colours on the glass': 'Couleurs sur le pare-brise', 'In daylight': 'De jour',
    'Auto switches to Night after sunset. The HUD is a projector: bright, solid colours read best.':
        'Auto passe en Nuit après le coucher du soleil. Le HUD est un projecteur : les couleurs vives et pleines se lisent le mieux.',
    // fuseaux de l'horloge (shared/tz.js)
    'Automatic': 'Automatique', 'US Eastern': 'États-Unis Est', 'US Central': 'États-Unis Centre', 'US Mountain': 'États-Unis Rocheuses',
    'US Pacific': 'États-Unis Pacifique', 'Alaska': 'Alaska', 'Hawaii': 'Hawaï', 'Arizona': 'Arizona', 'Canada Atlantic': 'Canada Atlantique',
    'Mexico': 'Mexique', 'UK, Ireland, Portugal': 'Royaume-Uni, Irlande, Portugal', 'Central Europe': 'Europe centrale',
    'Eastern Europe': "Europe de l'Est",
    // l'état de Waze on Cluster, sur l'onglet Carte (shared/waze.js)
    "Waze on Cluster isn't running": "Waze on Cluster n'est pas lancé",
    "Waze on Cluster: this car isn't supported": "Waze on Cluster : cette voiture n'est pas prise en charge",
    'Waze map is turned off in the Waze app': "La carte Waze est éteinte dans l'appli Waze",
    "Off. Waze shows the map in BMW's own map view": 'Éteint. Waze affiche la carte dans la vue carte de BMW',
    'Waze app is open, retrying': "L'appli Waze est ouverte, nouvel essai",
    'Moving the map into the theme': 'La carte passe dans le thème',
    'Map showing in the theme': 'Carte affichée dans le thème',
    'Map frozen, waiting for the phone': 'Carte figée, en attente du téléphone',
    'Waze on Cluster reports an error': 'Waze on Cluster signale une erreur',
    'Waiting for the map': 'En attente de la carte',
};

// les phrases qui contiennent un nom ou un nombre
const PATTERNS = [
    [/^Can't reach Waze on Cluster \((.*)\)$/, 'Waze on Cluster est injoignable ($1)'],
    [/^(.*)\. It is the same window Waze's map shows in \(Sport, M, M Blade and Navi\)\.$/, (m, a) => tr(a) + ". C'est la fenêtre de la carte Waze (Sport, M, M Blade, Navi)."],
    // onglet Signaux : l'étape de la voiture qui ne finit jamais (kit/runtime/signals.js busyWith)
    [/^Stuck while opening \((\d+) s\)$/, "Bloqué à l'ouverture ($1 s)"],
    [/^Stuck while waiting for the car \((\d+) s\)$/, 'Bloqué : attend la voiture ($1 s)'],
    [/^Stuck while subscribing to (.*) \((\d+) s\)$/, "Bloqué à l'abonnement à $1 ($2 s)"],
    [/^Waiting: (.*) is stuck \((\d+) s\)$/, 'En attente : $1 est bloqué ($2 s)'],
    [/^Error: (.*)$/, 'Erreur : $1'], [/^Refused: (.*)$/, 'Refusé : $1'], [/^Read refused: (.*)$/, 'Lecture refusée : $1'],
    [/^(\d+) of (\d+) read$/, '$1 sur $2 lus'],
    [/^Turn HUD Widgets off so (.*) shows\?$/, 'Éteindre HUD Widgets pour afficher $1 ?'],
    [/^Turn the cluster theme off so (.*) shows\?$/, 'Éteindre le thème du cluster pour afficher $1 ?'],
    [/^Show (.*) on the HUD anyway\?$/, 'Afficher $1 sur le HUD quand même ?'],
    [/^(.*) is on$/, '$1 est actif'],
    [/^Off · (.*) has the screen · pick one to take it back$/, "Éteint · $1 a l'écran · choisis-en un pour le reprendre"],
    [/^(.*) · tap a drive mode to give it that layout$/, '$1 · touche un mode de conduite pour lui donner cette disposition'],
    [/^ON THE (.*)$/, 'SUR LE $1'],
    [/^(.*) OFF$/, '$1 ÉTEINT'],
    [/^stock (.*)$/, '$1 de BMW'],
    [/^BMW's own (HUD|cluster)$/, '$1 de BMW'],
    [/^→ (\d+) rpm$/, '→ $1 tr/min'], [/^→ range (\d+)$/, '→ autonomie $1'], [/^→ limit (\d+)$/, '→ limite $1'], [/^→ next limit (\d+)$/, '→ limite suivante $1'],
    [/^→ drive (-|\d+) % · recup (-|\d+) %(?: · (bar (-?\d+) kW|not used))?$/, (m, d, g, x, k) => '→ propulsion ' + d + ' % · récup ' + g + ' %' + (x === undefined ? '' : k !== undefined ? ' · barre ' + k + ' kW' : ' · pas utilisé')],
    [/^→ above 100 %: scale to confirm$/, '→ au-dessus de 100 % : échelle à confirmer'],
    [/^→ share (-?\d+) \(scale to confirm\)(?: · estimate (-?\d+) kW)?$/, (m, q, e) => '→ part ' + q + ' (échelle à confirmer)' + (e !== undefined ? ' · estimée ' + e + ' kW' : '')], [/^→ coolant (-?\d+) C(?: · oil (-?\d+) C)?$/, (m, c, o) => '→ liquide ' + c + ' °C' + (o ? ' · huile ' + o + ' °C' : '')], [/^→ oil (-?\d+) C$/, '→ huile $1 °C'],
    [/^→ wheel on(?:, (green|yellow|red|grey))?(, warning)?$/, (m, c, w) => '→ volant allumé' + (c ? ', ' + { green: 'vert', yellow: 'jaune', red: 'rouge', grey: 'gris' }[c] : '') + (w ? ', alerte' : '')],
    [/^→ (alert|route): (yes|no)$/, (m, k, a) => '→ ' + (k === 'alert' ? 'alerte' : 'itinéraire') + ' : ' + (a === 'yes' ? 'oui' : 'non')],
    [/^Route on(.*)$/, 'Itinéraire en cours$1'], [/^No route(.*)$/, "Pas d'itinéraire$1"], [/^Value not understood(.*)$/, 'Valeur non comprise$1'],
    [/^Waze map · (on|off)(.*)$/, (m, a, b) => 'Carte Waze · ' + (a === 'on' ? 'activée' : 'éteinte') + b.replace(' · centre off', ' · centre éteint')],
    [/^(\d+) warnings? on$/, '$1 alerte(s)'],
    [/^(.*) · trail (.*)$/, '$1 · traînée $2'],
    [/^blue (\d+) %$/, 'bleu $1 %'],
    [/^black · facets (\d+) %$/, 'noir · facettes $1 %'],
    [/^(.*) · facets (\d+) %$/, '$1 · facettes $2 %'],
    [/^Slot (\d+) · pick a sensor$/, 'Emplacement $1 · choisis une mesure'],
    [/^Reset slots$/, 'Réinitialiser'],
    [/^Showing a zone (\d+) m ahead \(from (.*)\)$/, 'Zone à $1 m (de $2)'],
    [/^(.*) · where it sits on the glass$/, '$1 · où il se place sur le pare-brise'],
    [/^None of these (.*) has readout slots\.$/, "Aucun de ces $1 n'a d'emplacements de données."],
    [/^(.*) · readout slots$/, '$1 · emplacements de données'],
    [/^(.*) · (\d+) slots$/, '$1 · $2 emplacements'],
    [/^(\d+) rpm before$/, '$1 tr/min avant'],
    [/^(\d+) rpm$/, '$1 tr/min'],
    // la ligne d'état de l'engine : « ShakHUD on: M Style layout, Classic theme, 3 layers, 0.4 MiB of 16 MiB pixels »
    [/^(.*) on: (.*) layout, (.*) theme, (\d+) layers?, (.*) MiB of (.*) MiB pixels$/, '$1 actif : $2, couleurs $3, $4 couches, $5 Mio sur $6 Mio de pixels'],
    [/^(.*) off: BMW's own (.*) shows$/, '$1 éteint : $2 de BMW'],
];

const cache = new Map();

function tr(s) {
    s = String(s == null ? '' : s);
    if (!/[A-Za-z]{2}/.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    let out = Object.prototype.hasOwnProperty.call(EXACT, s) ? EXACT[s] : null;
    if (out === null) {
        out = s;
        for (let i = 0; i < PATTERNS.length; i++) {
            if (PATTERNS[i][0].test(s)) { out = s.replace(PATTERNS[i][0], PATTERNS[i][1]); break; }
        }
    }
    if (cache.size > 1024) cache.clear();
    cache.set(s, out);
    return out;
}

module.exports = { tr, EXACT };
