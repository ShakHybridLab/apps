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
    'Map only with the BC button (else always shown)': 'Carte seulement avec la touche BC (sinon toujours affichée)',
    'Now showing': 'Affichage actuel', 'Hybrid': 'Hybride', 'Electric': 'Électrique', 'Hybrid  ·  now': 'Hybride  ·  actuel',
    'Electric  ·  now': 'Électrique  ·  actuel', 'Sport  ·  now': 'Sport  ·  actuel', 'Change with the drive mode': 'Changer avec le mode de conduite',
    'Theme': 'Thème', 'Layout': 'Disposition', 'Otherwise': 'Sinon', 'Off': 'Désactivé', 'On': 'Activé',
    "BMW's own": 'Celui de BMW', "BMW's own HUD": 'Le HUD de BMW', "BMW's own cluster": 'Le cluster de BMW',
    'HUD is off': 'HUD éteint', 'Tap to turn the HUD off': 'Touche pour éteindre le HUD',
    'At the redline': 'À la zone rouge', ' rpm before': ' tr/min avant', ' rpm': ' tr/min',
    // confirmation
    "A cluster theme and the HUD can't show at the same time.": "Un thème du cluster et le HUD ne peuvent pas s'afficher en même temps.",
    "The HUD and a cluster theme can't show at the same time.": "Le HUD et un thème du cluster ne peuvent pas s'afficher en même temps.",
    'Turn HUD off': 'Éteindre le HUD', 'Turn theme off': 'Éteindre le thème', 'Cancel': 'Annuler', 'Centre': 'Centrer',
    'The phone\'s map is showing': 'La carte du téléphone est affichée', 'The HUD hides while the phone\'s map is showing.': 'Le HUD se cache tant que la carte du téléphone est affichée.',
    'Show the HUD': 'Afficher le HUD',
    'Hidden · the phone\'s map is showing · tap the layout to show the HUD anyway': 'Caché · la carte du téléphone est affichée · touche la disposition pour afficher le HUD quand même',
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
    'Engine speed (rev counter)': 'Régime moteur (compte-tours)', 'Engine speed: second source (display data)': 'Régime moteur : seconde source (données d\'affichage)', 'Electric motor speed': 'Régime du moteur électrique', 'Engine temperatures (oil, coolant)': 'Températures moteur (huile, liquide)', 'Car speed': 'Vitesse de la voiture',
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
    'GPS: where the car is': 'GPS : où est la voiture', 'Engine speed under other names (the car\'s catalog)': "Régime moteur sous d'autres noms (catalogue de la voiture)", 'BC button, on-board computer and stalk (the car\'s catalog)': 'Touche BC, ordinateur de bord et commodo (catalogue de la voiture)', 'BC button and stalk: next entries': 'Touche BC et commodo : suite', 'Speed limit signs: next entries': 'Panneaux de limitation : suite', 'Total distance of the car (the car\'s catalog)': 'Kilométrage total de la voiture (catalogue de la voiture)', 'Navigation map: navigation.ADAS': 'Carte de navigation : navigation.ADAS', 'Navigation map: next entries': 'Carte de navigation : suite',
    'GPS: next entries': 'GPS : suite',
    'Signals in the car\'s catalog': 'Signaux du catalogue de la voiture',
    'Catalog not readable': 'Catalogue illisible', "Nothing found in the car's catalog": 'Rien dans le catalogue de la voiture',
    'Names only, no values: photograph this page to give the names the app can read next.': "Les noms seulement, pas les valeurs : photographie cette page pour donner les noms que l'appli pourra lire ensuite.",
    'get: can be read; notify: told when it changes. Read only: nothing here changes the car.': 'get : lisible ; notify : prévenu à chaque changement. Lecture seule : rien ici ne change la voiture.',
    'Blue: what the app understood of the value. Read only: nothing here changes the car.': "Bleu : ce que l'appli a compris de la valeur. Lecture seule : rien ici ne change la voiture.",
    'Read only: nothing here changes the car.': 'Lecture seule : rien ici ne modifie la voiture.',
    'Show the map only with a route': "Carte seulement avec un itinéraire",
    'CarPlay guidance active (route)': "Guidage CarPlay actif (itinéraire)",
    'Navigation map on the cluster': 'Carte de navigation sur le cluster', 'Show the phone\'s map inside the theme': 'Afficher la carte du téléphone dans le thème',
    'Not available in this app': 'Indisponible dans cette appli',
    'This theme has no map version (Sport, M, M Blade and Navi do)': "Ce thème n'a pas de version avec carte (Sport, M, M Blade et Navi en ont une)",
    'Centre window for Cluster Centre / Cluster Info': 'Fenêtre centrale pour Cluster Centre / Cluster Info',
    'Window open: Cluster Centre / Cluster Info draw in it': 'Fenêtre ouverte : Cluster Centre / Cluster Info y dessinent',
    'Asked for, opening': 'Demandée, ouverture en cours', 'Closed (nothing asks for it)': 'Fermée (personne ne la demande)',
    'Danger zone': 'Zone de danger', 'Danger zone alert': 'Alerte zone de danger',
    'Shown now: the car is in a zone.': 'Affichée en ce moment : la voiture est dans une zone.',
    'Nothing to show now: no zone near.': 'Rien à afficher pour le moment : pas de zone proche.',
    'Off: no alert shown.': 'Éteinte : aucune alerte affichée.',
    'On the four themes, from the car\'s GPS': 'Sur les quatre thèmes, avec le GPS de la voiture',
    'and the list of zones in the app.': "et la liste des zones de l'appli.",
    'On: Sport, M, M Blade and Navi open a window in the middle and Maps on Cluster draws its map in it, above':
        'Activé : Sport, M, M Blade et Navi ouvrent une fenêtre au milieu et Maps on Cluster y dessine sa carte, par-dessus',
    "BMW's own map view, so nothing shows twice. When the map goes away the theme fills back in.":
        "la vue carte de BMW, donc rien ne s'affiche deux fois. Quand la carte part, le thème reprend la place.",
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
    // l'état de Maps on Cluster (Waze, Apple Maps ou Google Maps : ça dessine n'importe lequel), sur l'onglet Carte (shared/waze.js)
    "Maps on Cluster isn't running": "Maps on Cluster n'est pas lancé",
    "Maps on Cluster: this car isn't supported": "Maps on Cluster : cette voiture n'est pas prise en charge",
    "The phone's map is turned off": "La carte du téléphone est éteinte",
    "Off. The phone's map shows in BMW's own map view": "Éteint. La carte du téléphone s'affiche dans la vue carte de BMW",
    'Map showing in the theme': 'Carte affichée dans le thème',
    'Map frozen, waiting for the phone': 'Carte figée, en attente du téléphone',
    'Maps on Cluster reports an error': 'Maps on Cluster signale une erreur',
    'Waiting for the map': 'En attente de la carte',
};

// les phrases qui contiennent un nom ou un nombre
// La ligne d'état du moteur d'affichage (hud.js statusText, _drawnNote, et l'état de la carte derrière « ; Map: ») : des morceaux mis bout à
// bout, traduits un par un. Le propriétaire photographie cette ligne pour dire ce que fait la voiture : elle se lit en français (20 nov. 2026).
const STATUS = [
    [/^(Cluster|HUD) on/, '$1 actif'], [/^(Cluster|HUD) off/, '$1 éteint'],
    [/\(drive mode not seen yet\)/, '(mode de conduite pas encore vu)'], [/\(drive mode not recognised: the car sends (.*?)\)/, '(mode de conduite inconnu : la voiture envoie $1)'],
    [/: (.*?) layout, (.*?) theme( \(Auto\))?/, ' : disposition $1, couleurs $2$3'], [/: (.*?) theme/, ' : thème $1'],
    [/, (\d+) layers? on (\d+) connections/, ', $1 couches sur $2 connexions'], [/, (\d+) layers?(?=,|;|$)/, ', $1 couches'],
    [/, ([\d.]+) MiB of 16 MiB pixels/, ', $1 Mio de pixels sur 16'], [/, demo data/, ', données de démo'],
    [/, (\d+) of (\d+) layers? drawn/, ', $1 couches affichées sur $2'],
    [/, cluster delay (\d+) ms/, ', délai du cluster $1 ms'],
    [/, (\d+) stalled connections made again/, ', $1 connexions figées refaites'],
    [/, last gap (\d\d:\d\d) \(app started\)/, ', dernier trou $1 (appli démarrée)'],
    [/, last gap (\d\d:\d\d) \(connection stalled, made again( \[connection \d+\])? \(([^)]*)\)\)/, ', dernier trou $1 (connexion figée refaite$2 : $3)'],
    [/, last gap (\d\d:\d\d) \(cluster-render lost( \[connection \d+\])?\)/, ', dernier trou $1 (cluster-render perdu$2)'],
    [/, last gap (\d\d:\d\d) \(drive mode ([^:]+): BMW's own cluster in that mode\)/, ', dernier trou $1 (mode $2 : compteur d\'origine dans ce mode)'],
    [/, last gap (\d\d:\d\d) \(target ([^)]*)\)/, ', dernier trou $1 (cible $2)'],
    [/, last gap (\d\d:\d\d) \(([^)]*)\)/, ', dernier trou $1 ($2)'],
    [/ \[connection (\d+)\]/g, ' [connexion $1]'], [/no answer for (\d+) s/, 'pas de réponse pendant $1 s'], [/socket full, nothing read for (\d+) s/, 'envoi bloqué, rien lu pendant $1 s'],
    [/\((\d+) waiting: /, '($1 en attente : '], [/, waiting: another app has this display/, ', en attente : une autre appli a cet écran'],
    [/, waiting: BMW is using this display/, ', en attente : BMW utilise cet écran'], [/, refused /, ', refusé : '],
    [/: connecting to cluster-render/, ' : connexion à cluster-render'], [/: cluster-render is not installed or not running/, " : cluster-render n'est pas installé ou ne tourne pas"],
    [/: BMW's own cluster shows/, ' : le cluster de BMW'], [/: BMW's own HUD shows/, ' : le HUD de BMW'],
];
function status(s) {
    const cut = s.indexOf('; Map: ');
    let head = cut < 0 ? s : s.slice(0, cut);
    STATUS.forEach((r) => { head = head.replace(r[0], r[1]); });
    return cut < 0 ? head : head + ' ; Carte : ' + tr(s.slice(cut + 7));
}

const PATTERNS = [
    [/^(Cluster|HUD)( on| off|:).*$/, (m) => status(m)],
    [/^(.*)\. It is the same window the phone's map shows in \(Sport, M, M Blade and Navi\)\.$/, (m, a) => tr(a) + ". C'est la fenêtre de la carte du téléphone (Sport, M, M Blade, Navi)."],
    // onglet Signaux : l'étape de la voiture qui ne finit jamais (kit/runtime/signals.js busyWith)
    [/^Stuck while opening \((\d+) s\)$/, "Bloqué à l'ouverture ($1 s)"],
    [/^Stuck while waiting for the car \((\d+) s\)$/, 'Bloqué : attend la voiture ($1 s)'],
    [/^Stuck while subscribing to (.*) \((\d+) s\)$/, "Bloqué à l'abonnement à $1 ($2 s)"],
    [/^Waiting: (.*) is stuck \((\d+) s\)$/, 'En attente : $1 est bloqué ($2 s)'],
    [/^Error: (.*)$/, 'Erreur : $1'], [/^Refused: (.*)$/, 'Refusé : $1'], [/^Read refused: (.*)$/, 'Lecture refusée : $1'],
    [/^(\d+) of (\d+) read$/, '$1 sur $2 lus'],
    [/^→ no value \((\d+)\)$/, '→ pas de valeur ($1)'], [/^→ none \((\d+)\)$/, '→ aucune ($1)'],
    [/^(\d+) msg · ([\d.]+)\/s$/, '$1 msg · $2/s'],
    // onglet Signaux : la mesure de la boucle des jauges (hud.js _perfNote)
    [/^Errors caught: (\d+) · last: (.*)$/, 'Erreurs rattrapées : $1 · dernière : $2'],
    // onglet Signaux de ShakTheme : l'état de l'alerte zone de danger (page.js)
    [/^Danger alert: (.*?) · positions (\d+)(?: \((\d+) s ago\))? · heading (unknown|\d+°)(.*)$/, (m, why, n, age, h, rest) => 'Alerte danger : ' + ({
        'turned off': 'éteinte', 'no position yet': 'aucune position reçue', 'position not understood': 'position non comprise', 'position too old': 'position trop ancienne',
        'zone behind': 'zone derrière', 'in a zone': 'dans une zone', 'zone ahead': 'zone devant' }[why] || (/^no zone within/.test(why) ? 'pas de zone proche' : why))
        + ' · positions ' + n + (age ? ' (il y a ' + age + ' s)' : '') + ' · cap ' + (h === 'unknown' ? 'inconnu' : h) + rest.replace(' · write ', ' · écriture ')],
    [/^Loop: (\d+)\/s · average ([\d.]+) ms · slowest (\d+) ms · longest wait (\d+) ms$/, 'Boucle : $1/s · moyenne $2 ms · la plus lente $3 ms · attente la plus longue $4 ms'],
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
    [/^Map · (on|off)(.*)$/, (m, a, b) => 'Carte · ' + (a === 'on' ? 'activée' : 'éteinte') + b.replace(' · centre off', ' · centre éteint')],
    [/^(\d+) warnings? on$/, '$1 alerte(s)'],
    [/^(.*) · trail (.*)$/, '$1 · traînée $2'],
    [/^blue (\d+) %$/, 'bleu $1 %'],
    [/^black · facets (\d+) %$/, 'noir · facettes $1 %'],
    [/^(.*) · facets (\d+) %$/, '$1 · facettes $2 %'],
    [/^Slot (\d+) · pick a sensor$/, 'Emplacement $1 · choisis une mesure'],
    [/^Reset slots$/, 'Réinitialiser'],
    [/^Shown now: a zone (\d+) m ahead\.$/, 'Affichée en ce moment : une zone à $1 m.'],
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
