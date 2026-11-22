'use strict';
/**
 * Les applis d'essai de signaux (shared/signal_probe.js) : une par groupe de noms, pour qu'un nom refusé par la voiture ne fasse échouer
 * que son appli (la voiture refuse l'installation ENTIÈRE si un seul signal déclaré ne lui convient pas). Les noms et les drapeaux viennent
 * des photos du catalogue de la voiture (17 nov. 2026) : « get notify » et « notify » sont déclarés « s » (on s'abonne ; « s » passe aussi
 * sur un champ « rs », comme le fait ShakCamDiag). tools/make_probe_apps.py écrit les app.json de ces applis à partir de cette table.
 *
 * Written for ShakTheme (MIT, as the rest of shared/).
 */
module.exports = {
    shakvolant: {
        title: 'ShakVolant', glyph: 'VOL', logId: 'OAVL',
        description: "Essai : quel signal répond quand on appuie sur les boutons du volant (favori, molette, vocal, téléphone, volume, recherche).",
        note: 'Appuie sur chaque bouton du volant (molette : tourne et appuie) : la ligne qui bouge est le bon signal. Photographie l\'écran.',
        signals: {
            'de.bmw.infotainment.controlelements.SteeringWheelPushButton': [
                'operationSteerWheelFAV', 'operationSteerWheelFC', 'statusAudioVolumeButton', 'statusPTTButton1',
                'statusRotaryPress', 'statusRotarySteps', 'statusSearchSwitch1', 'statusTelephoneButton',
            ],
        },
    },
    shakmanette: {
        title: 'ShakManette', glyph: 'MAN', logId: 'OAMN',
        description: "Essai : quel signal répond quand on touche les manettes derrière le volant (clignotants, bouton de l'ordinateur de bord au bout de la manette).",
        note: 'Appuie sur le bouton au bout de la manette de gauche (ordinateur de bord), puis bouge chaque manette : la ligne qui bouge est le bon signal.',
        signals: {
            'de.bmw.body.Light': ['IndicatorSteeringColumn', 'IndicatorSteeringColumnComplete'],
        },
    },
    shakconso: {
        title: 'ShakConso', glyph: 'CNS', logId: 'OACN', version: '0.3.0',
        description: "Essai : ce que l'ordinateur de bord donne à une appli (consommation et vitesse moyennes, distance et durée du trajet, données électriques).",
        note: 'Roule quelques minutes, puis photographie l\'écran : chaque ligne qui a reçu une valeur est lisible par les thèmes.',
        signals: {
            // (noms lus dans le catalogue de la voiture, photos du 19 nov. 2026, pages « Touche BC, ordinateur de bord et commodo »)
            'de.bmw.infotainment.KombiIF': ['statusBordcomputerAverage', 'statusBordcomputerTravelData', 'statusBordcomputerElectricData',
                'statusConsumptionAverageElectricVehicle', 'statusBordcomputerStatus2'],
        },
    },
    shakgps: {
        title: 'ShakGPS', glyph: 'GPS', logId: 'OAGP', version: '0.1.1',
        description: "Essai : la position GPS de la voiture (latitude, longitude, cap, altitude, qualité, vitesse), pour les alertes de radars et de zones de danger.",
        note: 'Reste dehors ou roule un peu : les deux lignes doivent se remplir (position, puis cap / altitude / qualité / vitesse). Photographie l\'écran.',
        // le propriétaire a lu ces noms au catalogue (17 nov. 2026, « infotainment.GPSData », lisible et notifié) : le nom complet est celui des
        // autres interfaces de ce dossier (KombiIF). Pas encore vu accepté : d'où une appli à part. wide : les valeurs sont des structures, longues
        wide: true,
        live: 'EN DIRECT : ce que la voiture envoie',
        signals: {
            'de.bmw.infotainment.GPSData': ['GPSPositionCAN', 'GPSPositionExtendedCAN'],
        },
    },
    shakmedia: {
        title: 'ShakMedia', glyph: 'MED', logId: 'OAMD',
        description: "Essai : ce que la voiture donne de la lecture en cours (titre, artiste, pochette) : les champs du lecteur multimédia.",
        note: 'Lance un morceau (radio ou USB, puis Bluetooth) : un champ doit changer. Photographie l\'écran pour chaque source.',
        signals: {
            'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer': ['subtitle', 'availableSubtitles', 'playlistNumAlbums', 'playlistNumArtists'],
        },
    },
};
