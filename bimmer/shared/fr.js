'use strict';
/**
 * fr.js - les textes de la page de l'écran central en français (ShakTheme, ShakHUD, RideTube cluster : "config": { "lang": "fr" }).
 * page.js passe chaque texte dessiné par tr() quand l'appli demande le français ; ce qui n'est pas dans la table reste tel quel.
 * Les accents viennent de tools/bake_accents.py (les polices de la page n'avaient que l'ASCII). Les noms de BMW (Hybrid, Electric Eco Pro,
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
    'DEMO DATA': 'DONNÉES DE DÉMO',
    // thèmes
    '  ·  now': '  ·  actuel', 'none here': 'aucune ici', ' slots': ' emplacements', 'moved': 'déplacé', 'centred': 'centré',
    'warnings off': 'alertes éteintes', 'no picture': "pas d'image", 'no g reading': 'pas de mesure g',
    // position
    'Move': 'Déplacer', 'Size': 'Taille',
    'The dashed frame is the part of the HUD you can see.': 'Le cadre en pointillés est la partie visible du HUD.',
    'Every tap moves the real HUD right away.': 'Chaque appui déplace le vrai HUD tout de suite.',
    // carte (cluster)
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
};

// les phrases qui contiennent un nom ou un nombre
const PATTERNS = [
    [/^Turn HUD Widgets off so (.*) shows\?$/, 'Éteindre HUD Widgets pour afficher $1 ?'],
    [/^Turn the cluster theme off so (.*) shows\?$/, 'Éteindre le thème du cluster pour afficher $1 ?'],
    [/^(.*) is on$/, '$1 est actif'],
    [/^Off · (.*) has the screen · pick one to take it back$/, "Éteint · $1 a l'écran · choisis-en un pour le reprendre"],
    [/^(.*) · tap a drive mode to give it that layout$/, '$1 · touche un mode de conduite pour lui donner cette disposition'],
    [/^ON THE (.*)$/, 'SUR LE $1'],
    [/^(.*) OFF$/, '$1 ÉTEINT'],
    [/^stock (.*)$/, '$1 de BMW'],
    [/^BMW's own (HUD|cluster)$/, '$1 de BMW'],
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
